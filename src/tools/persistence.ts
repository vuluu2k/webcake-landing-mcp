/**
 * Persistence tools (need WEBCAKE_API_BASE + WEBCAKE_JWT): list organizations,
 * create a page, list/read existing pages, and update a page. Mutating tools
 * default to dry_run=true and return a JWT-redacted request preview; they only
 * hit the network when dry_run===false. Validation uses the injected Domain;
 * the HTTP calls go through the Webcake client.
 *
 * Credentials resolve per request: in remote/Streamable-HTTP mode each call's
 * headers (extra.requestInfo.headers) carry the client's own Webcake JWT, so a
 * hosted server is multi-user; in stdio/single-user mode they come from env.
 */
import { createHash } from "node:crypto";
import { withGoogleWeightLinks } from "../persistence/html-ingest.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { text, warningsField, autoFixedField } from "../mcp/response.js";
import { objectOrJson, objectsOrJson } from "../mcp/params.js";
import { readConfig, configFromHeaders } from "../persistence/config.js";
import { sourceOps, applyOps,
  buildRequestRedacted,
  buildUpdateRequestRedacted,
  buildAppendRequestRedacted,
  buildPublishRequestRedacted,
  buildPageApp,
  createPage,
  listOrganizations,
  listPages,
  searchPages,
  listVerifiedDomains,
  getPageSource,
  getPageVersion,
  updatePageSource,
  appendSection,
  publishPage,
  toPreviewUrl,
} from "../persistence/webcake-client.js";
import { matchAccountDomain, normalizeDomain } from "../persistence/domain-match.js";
import { healBrokenResizeUrls } from "../persistence/rehost.js";
import { putDraft, getDraft, updateDraft, deleteDraft } from "../persistence/draft-cache.js";
import {
  sourceFingerprint,
  decideOverwrite,
  rememberPageVersion,
  forgetPageVersion,
  lastKnownPageVersion,
  sourceCacheKey,
  cachePageSource,
  cachedPageSource,
  cachedPageSourceVersion,
  dropCachedPageSource,
} from "../persistence/page-version.js";
import { resolveOrgScope, rememberPageOrg, notFoundOrgHint } from "../persistence/org-scope.js";
import type { WebcakeConfig } from "../persistence/types.js";
import {
  locate as locateNode,
  outline as pageOutline,
  selectIds,
  matchProblem,
  dropStaleMeasure,
  dropStaleAgainst,
  moveNode,
  duplicateNode,
  refsTo,
  subtreeIds,
} from "../domains/landing/tree.js";

/**
 * What a save learned beyond pass/fail, for the tools that pick their response
 * fields by hand: the image/font re-host report, the org Font Group sync, and
 * add_section's note about Google weights it couldn't link.
 */
function saveExtras(o: { rehost?: unknown; fonts?: unknown; font_weights_notice?: string }) {
  return {
    ...(o.rehost ? { rehost: o.rehost } : {}),
    ...(o.fonts ? { fonts: o.fonts } : {}),
    ...(o.font_weights_notice ? { font_weights_notice: o.font_weights_notice } : {}),
  };
}


/** Errors of `after` the `before` tree did not already have (matched by message with array indices
 *  removed, so a moved/reordered element's unchanged problem is not "new"). No before → all. */
function addedErrors(domain: Domain, before: any, after: string[]): string[] {
  const prior = priorErrors(domain, before);
  return prior ? addedAgainst(prior, after) : after;
}
/** The errors a stored tree already has (undefined when there is none / it can't be judged). */
function priorErrors(domain: Domain, before: any): string[] | undefined {
  if (!before) return undefined;
  try {
    return domain.validate(domain.expand(before)).errors;
  } catch {
    return undefined;
  }
}
function addedAgainst(prior: string[], after: string[]): string[] {
  const norm = (e: string) => e.replace(/\[\d+\]/g, "[]").replace(/\/\d+\//g, "/");
  const seen = new Map<string, number>();
  for (const e of prior) seen.set(norm(e), (seen.get(norm(e)) ?? 0) + 1);
  return after.filter((e) => {
    const k = norm(e);
    const n = seen.get(k) ?? 0;
    if (n > 0) {
      seen.set(k, n - 1);
      return false;
    }
    return true;
  });
}

export function registerPersistenceTools(server: McpServer, domain: Domain) {
  // Resolve config from THIS request's headers (remote per-user JWT) first, then env.
  const cfgFor = (extra: any) => readConfig(configFromHeaders(extra?.requestInfo?.headers));

  // Organization scope for the page tools: explicit organization_id > org remembered for the page >
  // WEBCAKE_ORG_ID / header > the account's only org > ask (organization_required). See org-scope.ts.
  const orgArg = () =>
    z
      .string()
      .optional()
      .describe(
        "Organization the page(s) belong to: an organization id, or 'personal' (= no organization). Settle it first (list_organizations; ask the user when the account has 2+). When omitted: the org remembered for this page_id (from get_page), else WEBCAKE_ORG_ID / x-webcake-org-id, else the account's only organization, else ok:false reason:'organization_required' with the list."
      );
  const scopedCfg = async (extra: any, organization_id: string | undefined, pageId?: string, retryTool?: string) => {
    const r = cfgFor(extra);
    if (!r.config) return { config: undefined as WebcakeConfig | undefined, missing: r.missing, refusal: undefined as Record<string, unknown> | undefined };
    const sc = await resolveOrgScope(r.config, organization_id, { pageId, retryTool });
    if (!sc.ok) return { config: undefined, missing: r.missing, refusal: sc.response };
    return { config: sc.config as WebcakeConfig | undefined, missing: r.missing, refusal: undefined };
  };

  // ---- live source read (version-validated cache) ---------------------------
  // Every live read used to download the whole tree, and the concurrency guard
  // added one more. It cannot be served from a plain cache — a cached answer
  // cannot see an edit made after it was written, which is the bug the guard
  // exists to catch. So the SERVER decides: GET /api/v1/ai/page_version returns
  // page_source.updated_at (a few hundred bytes; bumped by every save, editor and
  // MCP alike), and we reuse the cached tree only when that token is unchanged.
  // Freshness is identical to a full read because the token comes from the backend.
  //
  // We probe only when something IS cached, so a cold read costs exactly one
  // request as before; a warm one costs a tiny probe and no download. A backend
  // without the route answers 404 → nothing ever caches → one full read, as before.
  // trust: true = use whatever is cached without asking (the write's base check catches a stale one);
  // a version string = use the cache only when it holds exactly that version.
  const readLiveSource = async (config: WebcakeConfig, pageId: string, opts: { trust?: true | string } = {}) => {
    const key = sourceCacheKey(pageId, config.jwt);
    const cv = cachedPageSourceVersion(key);
    // only an exact (md5) version is trusted: updated_at has 1 s precision
    if (cv && /^[0-9a-f]{32}$/.test(cv) && opts.trust && (opts.trust === true || opts.trust === cv)) {
      const hit = cachedPageSource(key, cv);
      if (hit) return { ...hit, source: structuredClone(hit.source), from_cache: true as const, trusted: true as const };
    }
    if (cachedPageSourceVersion(key)) {
      const probe = await getPageVersion(config, pageId);
      if (probe.ok && probe.version) {
        const hit = cachedPageSource(key, probe.version);
        // a copy: callers edit the tree they get (patch ops, expand) — the cache must stay the STORED tree
        if (hit) return { ...hit, source: structuredClone(hit.source), from_cache: true as const };
      }
    }
    const full = await getPageSource(config, pageId);
    if (full.ok && full.source != null) cachePageSource(key, full.version, { ...full, source: structuredClone(full.source) });
    return { ...full, from_cache: false as const };
  };

  /** Our own write changed the stored tree — the cached copy is spent. */
  const invalidateSource = (config: WebcakeConfig, pageId: string | undefined) => {
    if (pageId) dropCachedPageSource(sourceCacheKey(pageId, config.jwt));
  };
  // The server version of the last tree get_page handed the MODEL, per page: a whole-tree
  // update_page without base_version is checked against it — the tree the model sends can only be
  // that version plus its edits, so a page that moved on since (an editor save, and also this
  // session's own patch_page / add_section, which the model's copy does not contain) is refused.
  const served = new Map<string, string>();
  const servedOf = (config: WebcakeConfig, pageId: string) => served.get(sourceCacheKey(pageId, config.jwt));
  const rememberServed = (config: WebcakeConfig, pageId: string, version: string | undefined) => {
    if (!version) return;
    const key = sourceCacheKey(pageId, config.jwt);
    served.delete(key);
    served.set(key, version);
    if (served.size > 500) served.delete(served.keys().next().value!); // ponytail: oldest-first cap
  };
  /** Both publish routes store `JSON.stringify(source)` byte for byte: its md5 is the version a publish leaves. */
  const publishedVersion = (source: unknown) => createHash("md5").update(JSON.stringify(source)).digest("hex");
  /** A version probe after a re-save is only trusted when it is EXACTLY the bytes we stored — anything
   *  else means another save landed in between, so forget instead of re-labelling a stale tree. */
  const probeIs = async (config: WebcakeConfig, pageId: string, expected: string) => {
    const v = await getPageVersion(config, pageId).catch(() => null);
    return !!v?.ok && v.version === expected;
  };
  /** A page the model just created: its tree IS the stored version — the create's own (exact, from
   *  the response), or the auto-publish re-save's when that ran and the probe proves nothing else landed. */
  const servedAfterCreate = async (config: WebcakeConfig, pageId: string | undefined, created: { version?: string }, published?: unknown) => {
    if (!pageId) return;
    if (published === undefined) return rememberServed(config, pageId, created.version);
    const expected = publishedVersion(published);
    if (await probeIs(config, pageId, expected)) rememberServed(config, pageId, expected);
  };
  const isServerToken = (v?: string) => !!v && (/^[0-9a-f]{32}$/.test(v) || /^\d{4}-\d\d-\d\dT/.test(v));
  /** After a write the backend versioned (source_hash / updated_at): the stored tree IS what we sent,
   *  so cache it under that version — the next read is a version probe, not a download. */
  // A whole-tree write stored `hosted`; a patch stored applyOps(rawBefore, sent_ops) — the same ops
  // applied to the same stored tree the backend applied them to (its base check guarantees it).
  const afterWrite = (config: WebcakeConfig, pageId: string, outcome: { version?: string; via?: string; sent_ops?: any[]; unchanged?: boolean }, hosted: unknown, rawBefore: unknown, meta?: any) => {
    if (outcome.unchanged) return; // nothing written: the cache still holds the stored tree
    let stored: unknown;
    if (outcome.via === "update") stored = hosted;
    else if (outcome.via === "patch" && outcome.sent_ops && rawBefore != null)
      try {
        stored = applyOps(rawBefore, outcome.sent_ops);
      } catch {
        stored = undefined;
      }
    // a patch result is only as exact as its version: never cache one under a 1 s updated_at
    if (outcome.via === "patch" && !/^[0-9a-f]{32}$/.test(outcome.version ?? "")) stored = undefined;
    if (outcome.version && stored != null && meta?.ok) cachePageSource(sourceCacheKey(pageId, config.jwt), outcome.version, { ...meta, version: outcome.version, source: structuredClone(stored), from_cache: undefined });
    else invalidateSource(config, pageId);
  };
  /** The backend refused the write: the page moved on between our read and the save (under its row lock). */
  const pageChangedPayload = (pageId: string, outcome: { live_version?: string }, retryHint: string) => ({
    reason: "page_changed_externally",
    page_id: pageId,
    live_version: outcome.live_version,
    hint:
      "The page was saved by someone else (the Webcake editor, another agent) between this read and the write — the backend refused it, nothing was overwritten. " +
      `Do ONE of these: (a) patch_page({ page_id, patches:[…] }) — it re-reads and merges into the LIVE tree; (b) get_page again, re-apply, save; (c) to discard their change, re-run ${retryHint} with force:true.`,
  });

  // ---- stale-overwrite guard ------------------------------------------------
  // update_page (and a committed 'update' draft) REPLACES the stored source with a
  // tree the model read earlier. If the user edited the page in the Webcake editor
  // in between, that overwrite silently reverts their work — the exact failure the
  // draft cache makes easy to hit, since a draft can sit for ~2 h. The backend has
  // no version column, so we do optimistic concurrency ourselves: re-read the page
  // and compare its fingerprint with the baseline we recorded when the model last
  // read/wrote it (or with an explicit base_version the caller passes back).
  //
  //   baseline matches live  → the model is current; overwrite (deletes are intentional)
  //   baseline differs       → someone else edited the page → REFUSE
  //   no baseline + the overwrite would DROP live element ids → REFUSE
  //   no baseline + nothing is dropped → allow, but say the check could not be made
  //
  // force:true skips the check (an explicit "yes, discard the editor's changes").
  const guardOverwrite = async (
    config: WebcakeConfig,
    pageId: string,
    incoming: any,
    opts: { baseVersion?: string; force?: boolean; retryHint: string }
  ): Promise<{ ok: true; liveVersion?: string; notice?: string; base?: { base?: string; before?: any; verified?: boolean }; live?: any } | { ok: false; payload: any }> => {
    if (opts.force) return { ok: true, notice: "force:true — the staleness check was skipped and any newer editor changes were overwritten." };

    const tokenBase = isServerToken(opts.baseVersion) ? opts.baseVersion : undefined;
    const live = await readLiveSource(config, pageId, tokenBase ? { trust: tokenBase } : {});
    // Cannot read the live page (offline/404): don't block the write on our own check.
    if (!live.ok || live.source == null) return { ok: true };
    // A server version token (from get_page): exact. The write carries it, the backend re-checks it under its lock.
    if (tokenBase && live.version) {
      const before = domain.expand(structuredClone(live.source));
      if (live.version === tokenBase) return { ok: true, liveVersion: live.version, base: { base: tokenBase, before, verified: !(live as any).trusted }, live };
      // the page moved on but already holds exactly this tree (a timed-out save that did land): done
      // (the save adds the Google weight links itself — compare what it would have stored)
      const landed = sourceOps(before, withGoogleWeightLinks(incoming));
      if (landed && landed.length === 0) return { ok: true, liveVersion: live.version, base: { base: live.version, before, verified: true }, live };
      return {
        ok: false,
        payload: {
          reason: "page_changed_externally",
          page_id: pageId,
          live_version: live.version,
          base_version: tokenBase,
          hint:
            "The page changed after the get_page this source was built from — saved in the Webcake editor or by another agent, or by this session's own patch_page / add_section, which your copy does not contain. Saving it would revert those changes. " +
            "Do ONE of these: (a) patch_page({ page_id, patches:[…] }) — it merges into the LIVE tree; (b) get_page({ page_id }) again, re-apply your edit to the fresh tree, then save; " +
            `(c) if discarding the newer changes is intended, re-run ${opts.retryHint} with force:true.`,
        },
      };
    }

    // The backend versions sources exactly, yet nothing says which version this tree was built
    // from (no base_version, no get_page / create_page in this session): an overwrite cannot be
    // checked, so it is refused rather than allowed when it happens to drop no ids.
    if (!opts.baseVersion && /^[0-9a-f]{32}$/.test(live.version ?? ""))
      return {
        ok: false,
        payload: {
          reason: "unverified_overwrite",
          page_id: pageId,
          live_version: live.version,
          hint:
            "Nothing ties this source to a version of the page (no get_page of the whole tree in this session, no base_version), so the save cannot be checked against edits made since — it could revert them. " +
            `Do ONE of these: (a) patch_page({ page_id, patches:[…] }) for element edits — it merges into the live tree; (b) get_page({ page_id }) (the whole tree), apply your edit to it, then update_page({ page_id, source }) — or pass that get_page's source_version as update_page's base_version; (c) to overwrite regardless, re-run ${opts.retryHint} with force:true.`,
        },
      };
    // An explicit base_version comes from get_page's source_version — a real read.
    const baseline = opts.baseVersion
      ? ({ fp: opts.baseVersion, origin: "read" } as const)
      : lastKnownPageVersion(pageId);
    const verdict = decideOverwrite(live.source, incoming, baseline);
    if (verdict.allow) {
      return {
        ok: true,
        liveVersion: verdict.liveVersion,
        // the write goes against THIS read: the backend refuses it if the page moved since
        // (expanded like the incoming tree, so only sections that really change are sent)
        base: { base: live.version, before: domain.expand(structuredClone(live.source)) },
        live,
        ...(verdict.unverified
          ? {
              notice:
                "No baseline for this page in this session, so the overwrite could not be verified against the live tree — " +
                "no live element ids are lost, so it was allowed. Call get_page first next time to make the check exact.",
            }
          : {}),
      };
    }
    const { reason, liveVersion, baseVersion, dropped } = verdict;

    return {
      ok: false,
      payload: {
        reason,
        page_id: pageId,
        live_version: liveVersion,
        base_version: baseVersion,
        would_delete_element_ids: dropped.slice(0, 30),
        would_delete_count: dropped.length,
        hint:
          (baseVersion
            ? "The page was edited OUTSIDE this session (the Webcake editor, another agent) after this source was read, so saving it would revert those changes. "
            : "This source was not read from the live page in this session and the overwrite would delete element ids that exist on the page right now. ") +
          "Do ONE of these: (a) patch_page({ page_id, patches:[…] }) — it always merges into the LIVE tree, so it never reverts anything; " +
          "(b) get_page({ page_id }) again, re-apply your edit to the fresh tree, then save; " +
          `(c) if discarding the newer changes is intended, re-run ${opts.retryHint} with force:true.`,
      },
    };
  };

  // After a successful CREATE, build the rendered app and publish via the
  // editor's publish_html route so the page renders immediately — without this
  // a fresh page's preview is a blank shell until publish_page runs or the page
  // is re-saved in the editor. Failures here never fail the create (the page
  // exists either way); the result tells the caller how to retry. Skipped when
  // no build host is configured (a source-only legacy publish renders nothing).
  const autoPublish = async (config: WebcakeConfig, pageId: string, source: any) => {
    if (!config.buildBase) {
      return {
        published: false,
        skipped: true,
        note: "No build host configured (WEBCAKE_BUILD_BASE env / x-webcake-build-base header; prod preset auto-configures https://build.webcake.io) — created source-only; the preview stays blank until publish_page runs with a build host or the page is re-saved in the editor.",
      };
    }
    console.error(`[create_page] auto-publish: building ${pageId} via ${config.buildBase}`);
    const build = await buildPageApp(config.buildBase, pageId, source);
    if (!build.ok) {
      console.error(`[create_page] auto-publish build failed: ${build.error}`);
      return {
        published: false,
        error: `Build host failed (${build.error ?? "unknown error"})`,
        hint: `The page was CREATED fine — only the rendering publish failed. Retry via publish_page({ page_id: "${pageId}", dry_run: false }).`,
      };
    }
    const outcome = await publishPage(config, pageId, source, { app: build.app, app_css: build.app_css });
    if (!outcome.ok) {
      console.error(`[create_page] auto-publish publish failed: ${outcome.error}`);
      return {
        published: false,
        status: outcome.status,
        error: outcome.error,
        hint: `The page was CREATED fine — only the rendering publish failed. Retry via publish_page({ page_id: "${pageId}", dry_run: false }).`,
      };
    }
    return {
      published: true,
      rendered: true,
      note: "Auto-published (no domain): the preview link renders for ~10 minutes after each publish, then expires. For a permanent public URL attach a domain via publish_page({ page_id, custom_domain, dry_run:false }).",
    };
  };

  // 8) List organizations -----------------------------------------------------
  server.tool(
    "list_organizations",
    "Returns the account's Webcake organizations (id, name, is_default). The default org (type===1, usually the personal workspace) is where pages normally go. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {},
    { title: "List Webcake Organizations", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async (_args, extra) => {
      const { config, missing } = cfgFor(extra);
      if (!config) {
        return text({
          ok: false,
          reason: "missing_env",
          missing_env: missing,
          hint: "Configure WEBCAKE_API_BASE and WEBCAKE_JWT in the MCP server env (stdio), or send the JWT via the x-webcake-jwt header (remote).",
        });
      }
      return text(await listOrganizations(config));
    }
  );

  // 9) Create page (persist) --------------------------------------------------
  server.tool(
    "create_page",
    "Creates a new page in the user's Webcake account from a page source { page, popup, settings, options, cartConfigs }, saves it, and then publishes it (builds the rendered app on the Webcake build host and publishes it through the editor's publish route) so its preview renders; publish:false skips publishing, and a failed publish does not fail the create (result.publish reports the outcome). Before validating it applies deterministic layout corrections (off-canvas boxes, elements below wrapped text, containers grown to fit) and lists them in auto_fixed. External images and self-hosted font files in the source are re-hosted on Webcake's CDN during the save. dry_run defaults to true: it validates, caches the source under a draft_id, and returns the request it would send with the token masked; dry_run:false performs the create. A draft_id (from a validation failure, dry run, or timed-out create) re-runs from the cached source. Organization: explicit organization_id ('personal' = no organization), then WEBCAKE_ORG_ID / x-webcake-org-id, then automatic — no organizations → personal, exactly one → selected (organization_auto_selected:true), two or more → ok:false with the organization list. A page without a custom domain has a preview link that renders for about 10 minutes after each publish. Requires Webcake credentials.",
    {
      source: objectOrJson()
        .optional()
        .describe("Page source { page, popup, settings, options, cartConfigs } (object or JSON string). Required unless draft_id is given. Elements may be sparse — id, type, responsive.<bp>.styles for both breakpoints, specials and real events; omitted properties/runtime/empty events and children/per-breakpoint config are filled from factory defaults (full nodes also work)."),
      draft_id: z
        .string()
        .optional()
        .describe("A draft_id from a previous create_page call (validation failure, dry_run=true, or a timed-out/failed create). Loads the cached source, so the full JSON is not re-sent; covers the dry-run → real call step, fixes after errors, and retries after a timeout."),
      name: z.string().optional().describe("Page name (default 'AI Page')."),
      organization_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Organization to create the page in (an organization id). The string 'personal' saves without any organization and skips auto-resolution. When omitted: WEBCAKE_ORG_ID / x-webcake-org-id, else automatic — one organization is selected, two or more return the list (ok:false), none means personal."),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default TRUE — validate, cache the source as draft_id, and preview the request without sending. Set false to actually create."),
      publish: z
        .boolean()
        .optional()
        .describe("Default TRUE — after a successful create, automatically build the rendered app and publish (publish_html) so the preview renders immediately. Set false to create source-only (blank preview until publish_page runs)."),
    },
    { title: "Create Webcake Page", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ source, draft_id, name, organization_id, dry_run, publish }, extra) => {
      const isDry = dry_run !== false; // default true (safe)

      // --- Resolve source: from cache (draft_id) or from the argument ---
      let expanded: any;
      let existingDraftId: string | undefined = draft_id;

      if (draft_id) {
        const cached = await getDraft(draft_id);
        if (!cached) {
          return text({
            created: false,
            reason: "draft_expired",
            hint: "The cached draft is gone (expired after ~2 h or evicted). Re-send the full source via create_page({ source:…, dry_run:false }).",
          });
        }
        if (cached.kind != null && cached.kind !== "page") {
          return text({
            created: false,
            reason: "wrong_draft_kind",
            hint: `That draft_id belongs to a '${cached.kind}' draft, not a page draft. Use the appropriate tool (add_section / patch_page) for that kind.`,
          });
        }
        expanded = cached.source;
      } else {
        if (source == null) {
          return text({ created: false, reason: "no_source", hint: "Pass source (the page JSON) or a draft_id from a previous create_page call." });
        }
        expanded = domain.expand(source);
      }

      // Resolve name/org from args, then fall back to what the draft stored.
      const cachedDraft = existingDraftId ? await getDraft(existingDraftId) : null;
      const pageName = name ?? cachedDraft?.name ?? "AI Page";

      // 'personal' is a sentinel meaning "no org, skip auto-resolution".
      const isExplicitPersonal = organization_id != null && `${organization_id}`.toLowerCase() === "personal";
      const explicitOrgId = (organization_id != null && !isExplicitPersonal) ? `${organization_id}` : undefined;
      // On dry_run, use the explicit arg or the draft's stored org (if any).
      const draftOrgId = cachedDraft?.organization_id;
      const orgId = explicitOrgId ?? draftOrgId;

      // Deterministic layout auto-fix (off-canvas clamp + wrapped-text reflow)
      // BEFORE validate/persist, so the saved tree is the corrected one and the
      // dominant validate→patch→re-validate loop is skipped for those defects.
      // Mutates `expanded` in place — the draft cached below is the fixed tree.
      const autoFixed = domain.autofixLayout?.(expanded) ?? [];

      const result = domain.validate(expanded);
      if (!result.valid) {
        // Cache the failed source so the model can fix ONLY the broken elements via
        // patch_page({ draft_id }) instead of regenerating + re-shipping the whole
        // source (there is no page_id yet, so patch_page can't target a live page).
        if (existingDraftId) {
          await updateDraft(existingDraftId, expanded);
        } else {
          existingDraftId = await putDraft({ source: expanded, name: pageName, organization_id: orgId });
        }
        return text({
          created: false,
          reason: "validation_failed",
          errors: result.errors,
          ...autoFixedField(autoFixed),
          ...warningsField(result.warnings),
          draft_id: existingDraftId,
          hint:
            "Do NOT rebuild the whole source — it is cached as draft_id. Each error names the offending element id — fix ONLY those elements with patch_page({ draft_id, patches:[…], dry_run:false }); it re-validates the merged tree and creates the page. A wrong element type → { op:'update', id:'<element id>', type:'<allowed type>' } (run list_elements/get_element if unsure). A stray/extra key ('must NOT have additional properties') → { op:'replace', id, element:<clean node> } — op:'update' MERGES and cannot delete a key. The draft expires in ~2 h.",
        });
      }
      const parsed = domain.coerce(expanded);
      const { config, missing } = cfgFor(extra);

      // A big single create_page payload is what drops the client↔Claude
      // connection on large pages. If the source is heavy, steer the model to the
      // incremental path (small skeleton now, then add_section per section).
      const sectionCount = Array.isArray((parsed as any)?.page) ? (parsed as any).page.length : 0;
      const payloadKB = Math.round(JSON.stringify(parsed ?? {}).length / 1024);
      const isLarge = sectionCount >= 4 || payloadKB > 80;
      const largePageAdvisory = isLarge
        ? `This page is large (${sectionCount} sections, ~${payloadKB}KB) — a single create_page payload this size can drop the connection. Prefer the INCREMENTAL path: create_page with just ONE section (a hero skeleton), then call add_section once per remaining section (each call ships only that section). Send the sections you already built one at a time via add_section instead of all in this one call.`
        : undefined;

      if (isDry) {
        // Cache (or refresh) the validated source so the model can confirm with
        // dry_run=false without re-sending the full payload.
        if (existingDraftId) {
          await updateDraft(existingDraftId, expanded);
        } else {
          existingDraftId = await putDraft({ source: expanded, name: pageName, organization_id: orgId });
        }

        // Describe what will happen on the real run given current inputs (cheap, no network call).
        let organizationNote: string;
        if (isExplicitPersonal) {
          organizationNote = "Will save as a personal page (organization_id:'personal' was passed — auto-resolution skipped).";
        } else if (explicitOrgId) {
          organizationNote = `Will use the explicitly supplied organization_id: ${explicitOrgId}.`;
        } else if (config?.orgId) {
          organizationNote = `Will use the org from WEBCAKE_ORG_ID env / x-webcake-org-id header: ${config.orgId}.`;
        } else {
          organizationNote = "No organization_id supplied and no WEBCAKE_ORG_ID env set — on the real run list_organizations will be called: 1 org → auto-selected; 2+ orgs → will ask you to pick; 0 orgs → personal.";
        }

        return text({
          dry_run: true,
          validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
          ...autoFixedField(autoFixed),
          ...(largePageAdvisory ? { large_page_advisory: largePageAdvisory } : {}),
          env_ready: missing.length === 0,
          missing_env: missing,
          target_organization_id: orgId ?? config?.orgId ?? null,
          organization_note: organizationNote,
          publish_step:
            publish === false
              ? { would_run: false, note: "publish:false — the real run will create source-only (blank preview until publish_page)." }
              : config?.buildBase
              ? { would_run: true, build_host: config.buildBase, note: "After creating, the real run auto-builds the rendered app and publishes (publish_html) so the preview renders immediately." }
              : { would_run: false, note: "No build host configured — the real run creates source-only (blank preview). Set WEBCAKE_BUILD_BASE env or x-webcake-build-base header (prod preset auto-configures) to enable auto-publish." },
          draft_id: existingDraftId,
          request: config
            ? buildRequestRedacted(config, pageName, parsed, orgId)
            : {
                note:
                  "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable real creation. Would POST to {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source.",
              },
          hint: largePageAdvisory
            ? `Large page — consider the skeleton + add_section flow above. Otherwise re-run create_page({ draft_id: "${existingDraftId}", dry_run: false }) — no need to re-send source.`
            : `Re-run create_page({ draft_id: "${existingDraftId}", dry_run: false }) — no need to re-send source.`,
        });
      }

      if (!config) {
        return text({
          created: false,
          reason: "missing_env",
          missing_env: missing,
          hint: "Configure WEBCAKE_API_BASE and WEBCAKE_JWT (env), or send the x-webcake-jwt header (remote), then retry.",
        });
      }

      // --- Organization resolution (real run only — dry_run is cheap) ---
      // Resolution order:
      //   1. 'personal' sentinel → no org (skip auto-resolution entirely)
      //   2. Explicit organization_id arg → use as-is
      //   3. WEBCAKE_ORG_ID env / x-webcake-org-id header (config.orgId) → use as-is
      //   4. Call listOrganizations:
      //      - 0 orgs or call fails → personal (proceed, add a note in result)
      //      - exactly 1 org → auto-select (return organization_auto_selected:true)
      //      - 2+ orgs → return ok:false with org list; caller must re-call with organization_id
      let resolvedOrgId: string | undefined = orgId; // may already be set from arg or draft
      let organizationAutoSelected = false;
      let organizationNote: string | undefined;

      if (isExplicitPersonal) {
        // Deliberate personal — skip auto-resolution entirely.
        resolvedOrgId = undefined;
      } else if (resolvedOrgId == null && !config.orgId) {
        // No explicit org and no env default → look up orgs.
        const orgResult = await listOrganizations(config);
        if (!orgResult.ok || !orgResult.organizations) {
          // Lookup failed — proceed personal, note the failure.
          console.error(`[create_page] listOrganizations failed: ${orgResult.error}`);
          organizationNote = `org lookup failed (${orgResult.error ?? "unknown error"}) — saving as personal page.`;
        } else {
          const orgs = orgResult.organizations;
          if (orgs.length === 0) {
            // No orgs — personal is the only option.
          } else if (orgs.length === 1) {
            // Exactly one org → auto-select.
            resolvedOrgId = `${orgs[0].id}`;
            organizationAutoSelected = true;
          } else {
            // Multiple orgs — cannot guess; ask the caller to pick.
            const orgList = orgs.map((o) => ({ id: o.id, name: o.name, is_default: o.is_default }));
            // Cache so the model can retry with organization_id without re-sending source.
            if (existingDraftId) {
              await updateDraft(existingDraftId, expanded);
            } else {
              existingDraftId = await putDraft({ source: expanded, name: pageName, organization_id: undefined });
            }
            return text({
              created: false,
              reason: "organization_required",
              organizations: orgList,
              draft_id: existingDraftId,
              error: "This account has multiple organizations. Re-call create_page with organization_id set to one of the listed org ids (or 'personal' to save without an org).",
              hint: `Ask the user which organization to use, then re-call: create_page({ draft_id: "${existingDraftId}", organization_id: "<chosen id>", dry_run: false }).`,
            });
          }
        }
      } else if (resolvedOrgId == null && config.orgId) {
        // Env default present — use it (already reflected in authHeaders via config.orgId).
        resolvedOrgId = config.orgId;
      }

      // CACHE-FIRST: write to draft cache BEFORE the network call. On timeout or
      // network failure the draft survives and the model can retry without re-sending.
      if (existingDraftId) {
        await updateDraft(existingDraftId, expanded);
      } else {
        existingDraftId = await putDraft({ source: expanded, name: pageName, organization_id: resolvedOrgId });
      }

      const outcome = await createPage(config, pageName, parsed, resolvedOrgId);
      if (outcome.ok) {
        await deleteDraft(existingDraftId); // created — drop the draft
        rememberPageVersion(outcome.page_id, sourceFingerprint(outcome.rehosted_source ?? parsed), "write");
        invalidateSource(config!, outcome.page_id);
        // Auto-publish (default): build + publish_html so the preview renders
        // immediately. Never fails the create — result.publish carries the state.
        const publishOutcome =
          publish === false
            ? { published: false, skipped: true, note: "publish:false — created source-only; the preview stays blank until publish_page runs." }
            : await autoPublish(config, outcome.page_id!, outcome.rehosted_source ?? parsed);
        await servedAfterCreate(config, outcome.page_id, outcome, (publishOutcome as any)?.published ? outcome.rehosted_source ?? parsed : undefined);
        return text({
          created: true,
          ...outcome,
          publish: publishOutcome,
          ...autoFixedField(autoFixed),
          ...warningsField(result.warnings),
          ...(organizationAutoSelected ? { organization_auto_selected: true } : {}),
          ...(organizationNote ? { note: organizationNote } : {}),
        });
      }
      // Failure (including timeout): keep the draft so the model can retry.
      await updateDraft(existingDraftId, expanded);
      // A backend 404/5xx on a route that normally works is usually a transient
      // deploy/restart window — the fix is to RETRY THE SAME REQUEST, not to
      // change parameters. (Observed failure mode: a transient 404 with an
      // organization_id made the model "work around" it by dropping the org —
      // the page then landed in personal instead of the requested workspace.)
      const transient = outcome.status === 404 || (outcome.status ?? 0) >= 500 || outcome.status === 0;
      return text({
        created: false,
        ...outcome,
        ...warningsField(result.warnings),
        draft_id: existingDraftId,
        hint:
          `Create failed — source is cached. Retry via create_page({ draft_id: "${existingDraftId}", dry_run: false }) or fix elements via patch_page({ draft_id: "${existingDraftId}", patches:[…], dry_run:false }). The draft expires in ~2 h.` +
          (transient
            ? ` A ${outcome.status === 0 ? "network error" : outcome.status} from the backend is usually TRANSIENT (deploy/restart window) — retry the SAME draft with the SAME organization_id after a short pause. Do NOT drop or change organization_id to work around it: the page would land in the wrong workspace.`
            : ""),
      });
    }
  );

  // 10) List pages ------------------------------------------------------------
  server.tool(
    "list_pages",
    "Lists the pages owned by the account (id, name, organization_id, updated_at), most-recent first. Pages are scoped per organization: pass organization_id (an id, or 'personal'); with 2+ organizations and none chosen it returns ok:false reason:'organization_required' with the list. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    { organization_id: orgArg() },
    { title: "List Webcake Pages", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ organization_id }, extra) => {
      const { config, missing, refusal } = await scopedCfg(extra, organization_id, undefined, "list_pages");
      if (refusal) return text(refusal);
      if (!config) return text({ ok: false, reason: "missing_env", missing_env: missing });
      return text(await listPages(config));
    }
  );

  // 10b) Find pages (search by name / domain / id) ----------------------------
  // The lookup step before an edit: locate the page the user means by name,
  // domain (custom OR default), and/or page id, then feed its id to get_page →
  // (edit) → update_page/add_section. Filters are AND-combined server-side and
  // results carry both domain fields so the model can disambiguate by URL.
  //
  // Searches via the dedicated /api/v1/ai/search_pages endpoint (proper DB query,
  // not limited to the 50 most-recent). If that route is missing (older backend
  // → 404) it FALLS BACK to listing pages and filtering client-side by name/id
  // (domain search is unavailable in the fallback — list_pages omits domains).
  server.tool(
    "find_pages",
    "Searches the account's pages by name, domain and/or page id. Filters are AND-combined; name and domain are case-insensitive substrings, and domain matches custom_domain or default_domain. Each result includes id, name, organization_id, custom_domain, default_domain and updated_at. With no filters it returns the most recently updated pages. Requires Webcake credentials.",
    {
      name: z.string().optional().describe("Case-insensitive substring of the page name to match."),
      domain: z
        .string()
        .optional()
        .describe("Case-insensitive substring of the page's domain (matches custom_domain OR default_domain)."),
      page_id: z.string().optional().describe("Exact page id — narrows to that single page (useful to confirm it exists/owned)."),
      limit: z.number().int().positive().max(100).optional().describe("Max results (default 50, capped at 100)."),
      organization_id: orgArg(),
    },
    { title: "Find Webcake Pages", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ name, domain, page_id, limit, organization_id }, extra) => {
      const { config, missing, refusal } = await scopedCfg(extra, organization_id, page_id, "find_pages");
      if (refusal) return text(refusal);
      if (!config) return text({ ok: false, reason: "missing_env", missing_env: missing });

      const res = await searchPages(config, { name, domain, id: page_id, limit });
      if (!res.endpoint_missing) {
        return text({ ok: res.ok, pages: res.pages, count: res.pages?.length ?? 0, status: res.status, error: res.error });
      }

      // Fallback: older backend without /search_pages — list and filter client-side.
      const listed = await listPages(config);
      if (!listed.ok) return text({ ok: false, status: listed.status, error: listed.error });
      let pages = listed.pages ?? [];
      const nameQ = name?.toLowerCase();
      if (nameQ) pages = pages.filter((p) => p.name?.toLowerCase().includes(nameQ));
      if (page_id) pages = pages.filter((p) => `${p.id}` === page_id);
      if (limit != null) pages = pages.slice(0, limit);
      return text({
        ok: true,
        pages,
        count: pages.length,
        via: "legacy_list_filter_fallback",
        ...(domain ? { note: "Domain search is unavailable on this backend (list_pages omits domains); the domain filter was ignored." } : {}),
      });
    }
  );

  // 11) Get page (read source) ------------------------------------------------
  server.tool(
    "get_page",
    "Fetches an existing page's source tree { page, popup, settings, options, cartConfigs } with its name, organization_id and source_version. By default the tree is compacted: boilerplate shared by every element (properties, runtime, empty events/children, per-breakpoint config and factory-default style keys) is stripped, giving the same sparse shape the save tools accept and re-hydrate. compact:false returns the raw stored tree. outline:true returns only a one-line-per-element tree (`id type \"text…\" d:left,top,w×h m:left,top,w×h [hidden-on-mobile] [events:n]`, indented by depth) — read it first, then fetch one element with element_id (its subtree + parent_id + path). draft_id reads a cached draft instead of a live page. Requires Webcake credentials for page_id.",
    {
      page_id: z.string().optional().describe("The page id (from list_pages or a URL). Provide page_id OR draft_id."),
      draft_id: z.string().optional().describe("Read a cached draft (from create_page / add_section / update_page / patch_page) instead of a live page."),
      outline: z.boolean().optional().describe("true → only the compact element tree (ids, types, text, desktop/mobile boxes), far smaller than the source."),
      element_id: z.string().optional().describe("Return just this element's subtree, with its parent_id, root and path of ids."),
      compact: z
        .boolean()
        .optional()
        .describe("Default TRUE — strip factory-default boilerplate from every element (sparse shape, far fewer tokens). false returns the raw stored tree."),
      organization_id: orgArg(),
    },
    { title: "Get Webcake Page Source", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ page_id, draft_id, outline, element_id, compact, organization_id }, extra) => {
      // Outline / one element / a draft: a narrow read of the same tree.
      const narrow = (src: any, meta: Record<string, unknown>) => {
        if (typeof src === "string") src = JSON.parse(src);
        if (element_id) {
          const hit = locateNode(src, element_id);
          if (!hit) return text({ ok: false, reason: "element_not_found", element_id, ...meta, hint: "Call get_page({ outline:true }) to see the current ids; ids are case-sensitive." });
          const parent = hit.chain.length > 1 ? hit.chain[hit.chain.length - 2] : null;
          return text({
            ok: true,
            ...meta,
            element: compact === false ? hit.node : (domain.compact({ page: [hit.node] }) as any).page[0],
            parent_id: parent?.id ?? null,
            root: hit.root,
            index: hit.index,
            path: hit.chain.map((n) => n.id),
          });
        }
        if (outline) {
          return text({ ok: true, ...meta, outline: pageOutline(src), legend: "id type \"text\" d:left,top,width×height m:… — px, relative to the parent; sections/popups show their height. Edit with patch_page (move/duplicate/style/match)." });
        }
        return text({ ok: true, ...meta, source: compact === false ? src : domain.compact(src), compacted: compact !== false });
      };

      if (draft_id) {
        const d = await getDraft(draft_id);
        if (!d) return text({ ok: false, reason: "draft_expired", hint: "The cached draft is gone (expired after ~2 h or evicted)." });
        return narrow(d.source, { draft_id, draft_kind: d.kind ?? "page", ...(d.page_id ? { page_id: d.page_id } : {}) });
      }
      if (!page_id) return text({ ok: false, reason: "no_target", hint: "Pass page_id (a live page) or draft_id (a cached draft)." });
      const { config, missing, refusal } = await scopedCfg(extra, organization_id, page_id, "get_page");
      if (refusal) return text(refusal);
      if (!config) return text({ ok: false, reason: "missing_env", missing_env: missing });
      const res = await readLiveSource(config, page_id);
      if (!res.ok || res.source == null) return text({ ...res, ...(await notFoundOrgHint(config, res.status, res.error)) });
      // the page's own org: later update/add_section/patch/publish on it need no question
      if ("organization_id" in res) rememberPageOrg(config, page_id, res.organization_id);
      // Fingerprint what the page holds RIGHT NOW: this read is the baseline a
      // later update_page is checked against, so an edit made in the Webcake
      // editor after this point cannot be silently overwritten.
      const source_version = res.version ?? sourceFingerprint(res.source);
      rememberPageVersion(page_id, sourceFingerprint(res.source), "read");
      if (outline || element_id) return narrow(res.source, { page_id, name: res.name, source_version });
      // only a WHOLE tree handed to the model is a base an update_page tree can come from
      rememberServed(config, page_id, res.version);
      if (compact === false) return text({ ...res, source_version });
      return text({
        ...res,
        source: domain.compact(res.source),
        compacted: true,
        source_version,
        note: "Source is COMPACTED (factory-default boilerplate stripped). Edit elements in this same sparse shape — keep ids — and send the edited tree back to update_page (or use patch_page for small edits); the server re-hydrates omitted boilerplate. Pass source_version back as update_page({ base_version }) so a save is rejected instead of reverting an edit someone made in the editor meanwhile.",
      });
    }
  );

  // 12) Update page (edit existing) -------------------------------------------
  server.tool(
    "update_page",
    "Replaces an existing page's stored source with an edited tree (source only; the published build is not refreshed). Validates first. Concurrency check: the save is refused with page_changed_externally when the page was edited elsewhere since it was last read (base_version, or the version the server recorded), or with unverified_overwrite when an unverified save would delete live element ids; force:true overrides. dry_run defaults to true: it validates, caches the source under a draft_id and returns the masked request; dry_run:false saves. A draft_id from a dry run or a failed/timed-out update re-runs from the cached source. Requires Webcake credentials.",
    {
      page_id: z.string().optional().describe("The page id to update (must be owned by the account). Required unless draft_id is given (the page_id is stored in the draft)."),
      source: objectOrJson()
        .optional()
        .describe("The edited page source { page, popup, settings, options, cartConfigs } (object or JSON string). Required unless draft_id is given. The compacted tree from get_page can be edited and sent back AS-IS — sparse nodes are re-hydrated from factory defaults (a full tree also works)."),
      draft_id: z
        .string()
        .optional()
        .describe("A draft_id from a previous update_page call (dry_run=true or a timed-out/failed update). Loads the cached source, so the full JSON is not re-sent; covers the dry-run → real call step and retries after a timeout."),
      base_version: z
        .string()
        .optional()
        .describe("The page's source_version as returned by get_page. When it no longer matches the live page, the save is rejected rather than reverting edits made in the Webcake editor meanwhile. Optional — when omitted, the server uses the version it recorded at this session's last read or write of the page."),
      force: z
        .boolean()
        .optional()
        .describe("Default false. true saves even when the page changed outside this session, discarding those outside changes."),
      dry_run: z.boolean().optional().describe("Default TRUE — validate, cache the source as draft_id, and preview without sending. Set false to actually save."),
      organization_id: orgArg(),
    },
    { title: "Update Webcake Page (Overwrite)", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ page_id, source, draft_id, base_version, force, dry_run, organization_id }, extra) => {
      const isDry = dry_run !== false;

      // --- Resolve source: from cache (draft_id) or from the argument ---
      let expanded: any;
      let existingDraftId: string | undefined = draft_id;
      let resolvedPageId: string | undefined = page_id;
      // The version of the live page this source was built from. Explicit wins;
      // a draft carries the one captured when it was first cached.
      let resolvedBaseVersion: string | undefined = base_version;
      let draftPrior: string[] | undefined;

      if (draft_id) {
        const cached = await getDraft(draft_id);
        if (!cached) {
          return text({
            updated: false,
            reason: "draft_expired",
            hint: "The cached draft is gone (expired after ~2 h or evicted). Re-send the full source via update_page({ page_id, source:…, dry_run:false }).",
          });
        }
        if (cached.kind !== "update") {
          return text({
            updated: false,
            reason: "wrong_draft_kind",
            hint: `That draft_id belongs to a '${cached.kind ?? "page"}' draft, not an update draft. Use the appropriate tool for that kind.`,
          });
        }
        expanded = cached.source;
        draftPrior = cached.prior_errors;
        resolvedPageId = page_id ?? cached.page_id;
        resolvedBaseVersion = base_version ?? cached.base_version;
      } else {
        if (source == null) {
          return text({ updated: false, reason: "no_source", hint: "Pass source (the edited page JSON) or a draft_id from a previous update_page call." });
        }
        if (!page_id) {
          return text({ updated: false, reason: "no_page_id", hint: "Pass page_id (the page to overwrite) or a draft_id from a previous update_page call." });
        }
        expanded = domain.expand(source);
        resolvedPageId = page_id;
      }

      if (!resolvedPageId) {
        return text({ updated: false, reason: "no_page_id", hint: "Pass page_id explicitly or use a draft_id that has a stored page_id." });
      }

      // The live page as it is now (version-validated cache): a text whose content changed against it
      // loses its stale measured height, and only errors this overwrite ADDS refuse it.
      const sc0 = await scopedCfg(extra, organization_id, resolvedPageId, "update_page");
      if (sc0.refusal) return text({ updated: false, ...sc0.refusal });
      const cfg0 = sc0.config;
      // no explicit base: the version of the tree get_page last handed the model
      if (!resolvedBaseVersion && cfg0 && !draft_id) resolvedBaseVersion = servedOf(cfg0, resolvedPageId);
      let liveSrc: any = null;
      if (cfg0 && !draft_id) {
        const live = await readLiveSource(cfg0, resolvedPageId, isServerToken(resolvedBaseVersion) ? { trust: resolvedBaseVersion } : {}).catch(() => null);
        liveSrc = live?.ok ? live.source : null;
        if (typeof liveSrc === "string") {
          try {
            liveSrc = JSON.parse(liveSrc);
          } catch {
            liveSrc = null;
          }
        }
      }
      dropStaleAgainst(liveSrc, expanded);
      const result = domain.validate(expanded);
      const prior = liveSrc ? priorErrors(domain, liveSrc) : draftPrior;
      const added = result.valid ? [] : prior ? addedAgainst(prior, result.errors) : result.errors;
      if (!result.valid && added.length) {
        if (existingDraftId) {
          await updateDraft(existingDraftId, expanded);
        } else {
          existingDraftId = await putDraft({ source: expanded, kind: "update", page_id: resolvedPageId, base_version: resolvedBaseVersion, prior_errors: prior });
        }
        return text({
          updated: false,
          reason: "validation_failed",
          errors: added,
          ...(added.length < result.errors.length ? { pre_existing_errors: result.errors.length - added.length } : {}),
          ...warningsField(result.warnings),
          draft_id: existingDraftId,
          hint: `Fix the errors, then retry update_page({ draft_id: "${existingDraftId}", dry_run:false }) — no need to re-send source. Or use patch_page({ page_id: "${resolvedPageId}", patches:[…] }) for surgical fixes.`,
        });
      }
      const parsed = domain.coerce(expanded);
      const config = cfg0;
      const missing = sc0.missing;

      if (isDry) {
        // Cache (or refresh) the validated source so the model can confirm with
        // dry_run=false without re-sending the full payload.
        if (existingDraftId) {
          await updateDraft(existingDraftId, expanded);
        } else {
          existingDraftId = await putDraft({ source: expanded, kind: "update", page_id: resolvedPageId, base_version: resolvedBaseVersion, prior_errors: prior });
        }
        return text({
          dry_run: true,
          page_id: resolvedPageId,
          validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
          env_ready: missing.length === 0,
          missing_env: missing,
          draft_id: existingDraftId,
          request: config
            ? buildUpdateRequestRedacted(config, resolvedPageId, parsed)
            : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable real updates." },
          hint: `Re-run update_page({ draft_id: "${existingDraftId}", dry_run: false }) — no need to re-send source.`,
        });
      }
      if (!config) return text({ updated: false, reason: "missing_env", missing_env: missing });

      // CACHE-FIRST: write to draft cache BEFORE the network call.
      if (existingDraftId) {
        await updateDraft(existingDraftId, expanded);
      } else {
        existingDraftId = await putDraft({ source: expanded, kind: "update", page_id: resolvedPageId, base_version: resolvedBaseVersion, prior_errors: prior });
      }

      const guard = await guardOverwrite(config, resolvedPageId, parsed, {
        baseVersion: resolvedBaseVersion,
        force,
        retryHint: `update_page({ draft_id: "${existingDraftId}", dry_run:false })`,
      });
      if (!guard.ok) {
        return text({ updated: false, ...guard.payload, draft_id: existingDraftId });
      }

      const outcome = await updatePageSource(config, resolvedPageId, parsed, guard.base);
      if (outcome.page_changed) {
        return text({ updated: false, ...pageChangedPayload(resolvedPageId, outcome, `update_page({ draft_id: "${existingDraftId}", dry_run:false })`), draft_id: existingDraftId });
      }
      if (outcome.ok) {
        await deleteDraft(existingDraftId);
        // The page now holds exactly what we sent — that becomes the new baseline.
        rememberPageVersion(resolvedPageId, sourceFingerprint(outcome.rehosted_source ?? parsed), "write");
        afterWrite(config!, resolvedPageId, outcome, outcome.rehosted_source ?? parsed, guard.live?.source, guard.live);
        // the model's tree is now exactly what is stored
        rememberServed(config!, resolvedPageId, outcome.version);
        return text({ updated: true, ...outcome, ...warningsField(result.warnings), ...(guard.notice ? { stale_check: guard.notice } : {}) });
      }
      // what the save would have stored (images re-hosted, font links) — a retry after a save that
      // did land then matches the live tree
      await updateDraft(existingDraftId, outcome.rehosted_source ?? expanded);
      return text({
        updated: false,
        ...outcome,
        ...warningsField(result.warnings),
        draft_id: existingDraftId,
        hint: `Update failed — source is cached. Retry via update_page({ draft_id: "${existingDraftId}", dry_run: false }) or fix elements via patch_page({ page_id: "${resolvedPageId}", patches:[…] }). The draft expires in ~2 h.`,
      });
    }
  );

  // 13) Add section (incremental build) ---------------------------------------
  // Why this exists: create_page/update_page take the ENTIRE source as one tool
  // argument, so the model must generate the whole (often huge) page JSON inline
  // — a long generation that can drop the client↔Claude connection on big pages.
  // add_section keeps each call small: the model sends ONLY the new section(s).
  //
  // The append happens server-side via the dedicated /api/v1/ai/append_section
  // endpoint — the backend reads the stored source, appends, guards duplicate ids,
  // and saves, so the MCP never get+puts the whole tree (light: one small POST per
  // section). If that endpoint is missing (older backend → 404) we FALL BACK to the
  // legacy get→merge→validate-whole-tree→put path so add_section still works.
  // Build a large page as: create_page(small skeleton) → repeat add_section per
  // section. The big merge lives server↔backend, never in a tool argument the model
  // has to stream.
  //
  // Validation: the light path can't see the live tree, so it validates the NEW
  // section(s) in a throwaway page shell (catches per-section structural errors,
  // missing field_name, duplicate ids WITHIN the batch). Collisions with EXISTING
  // ids are caught server-side by the append endpoint. The legacy fallback still
  // validates the whole merged tree client-side.
  //
  // Draft-cache flow (mirrors create_page → draft_id → patch_page):
  //  - dry_run=true (valid): putDraft(shell, kind='sections', page_id) and include
  //    draft_id in the response; the model re-runs add_section({page_id, draft_id,
  //    dry_run:false}) without re-sending the section JSON.
  //  - validation failure: putDraft the invalid shell and return draft_id so the model
  //    calls patch_page({draft_id, patches, dry_run:false}) to fix ONLY the bad elements.
  //  - real append success: deleteDraft if one was used/created.
  //  - real append failure (server error, duplicate vs live tree): keep the draft and
  //    return its draft_id so the model can retry/fix without re-shipping the payload.
  //  - draft_id provided: load the cached shell instead of re-accepting sections.
  const asSections = (input: any): any[] => {
    let v = input;
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        /* not JSON — fall through to the single-value wrap */
      }
    }
    return Array.isArray(v) ? v : [v];
  };
  const sectionLabel = (s: any): string =>
    s?.properties?.name ?? s?.specials?.name ?? s?.id ?? s?.type ?? "section";

  server.tool(
    "add_section",
    "Appends one or more section nodes to the end of an existing page's `page` array, server-side: only the new sections are sent, and the backend rejects element ids that already exist on the page. The sections are validated first. dry_run defaults to true: it validates, caches the payload under a draft_id and previews the request; dry_run:false appends. A validation failure also returns a draft_id, which patch_page accepts for element-level fixes. Section-level saves cannot change page settings, so font weights that need new font links are reported in font_weights_notice. Requires Webcake credentials.",
    {
      page_id: z.string().describe("The page id to append to (from create_page or list_pages; must be owned by the account)."),
      sections: objectsOrJson()
        .optional()
        .describe(
          "One section node, or an array of section nodes, appended to the end of `page` (object/array or JSON string). Each is a normal section element { id, type:'section', responsive, children, … } with a unique id; sections stack vertically after the existing ones. Nodes may be sparse — omitted properties/runtime/empty events and children/per-breakpoint config are filled from factory defaults. Required unless draft_id is supplied."
        ),
      draft_id: z
        .string()
        .optional()
        .describe(
          "A draft id returned by a previous add_section call (dry_run=true or validation failure). Loads the cached section payload, so the sections are not re-sent."
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default TRUE — validate the section(s) and preview the request without writing. Set false to actually append."),
      organization_id: orgArg(),
    },
    { title: "Append Section(s) to Webcake Page", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ page_id, sections, draft_id, dry_run, organization_id }, extra) => {
      const isDry = dry_run !== false; // default true (safe)

      // --- Resolve section payload: from cache (draft_id) or from the argument ---
      let expandedShell: any;
      let existingDraftId: string | undefined = draft_id;

      if (draft_id) {
        // Load cached shell from a previous add_section dry_run or failure round.
        const cached = await getDraft(draft_id);
        if (!cached) {
          return text({
            added: false,
            reason: "draft_expired",
            hint: "The cached section draft is gone (expired after ~2 h or evicted). Re-send the sections via add_section({ page_id, sections:[…] }).",
          });
        }
        if (cached.kind !== "sections") {
          return text({
            added: false,
            reason: "wrong_draft_kind",
            hint: "That draft_id belongs to a page draft (create_page failure), not a section batch. Use patch_page({ draft_id }) for page drafts.",
          });
        }
        // Sections already expanded; re-validate the shell for correctness.
        expandedShell = cached.source;
      } else {
        // Build from the supplied sections argument.
        const rawSections = asSections(sections).filter((s: any) => s != null);
        if (rawSections.length === 0) {
          return text({ added: false, reason: "no_sections", hint: "Pass sections (a section object or non-empty array) or a draft_id from a previous add_section call." });
        }

        // Hydrate sparse section(s) into full nodes (the model may omit boilerplate),
        // then send/validate the EXPANDED sections so the stored tree is complete.
        const shell = {
          page: rawSections,
          popup: [],
          dynamic_pages: [],
          settings: {},
          options: { mobileOnly: false, versionID: null },
          cartConfigs: { isActive: false },
          svariations: [],
        };
        expandedShell = domain.expand(shell);
      }

      // Same deterministic layout auto-fix as create_page, on the section shell
      // (off-canvas clamp + wrapped-text reflow) before validate/append.
      const autoFixed = domain.autofixLayout?.(expandedShell) ?? [];

      const newSections = Array.isArray(expandedShell?.page) ? expandedShell.page : [];
      const labels = newSections.map(sectionLabel);

      // Light validation: the append path does NOT fetch the live tree, so validate
      // the NEW section(s) inside the throwaway page shell — catches per-section
      // structural errors, missing field_name, container rules, and duplicate ids
      // WITHIN this batch. Collisions with EXISTING page ids are caught server-side
      // by the append endpoint. (A section event that targets an id living on the
      // live page — not in this batch — may surface here as an advisory warning.)
      const result = domain.validate(expandedShell);
      if (!result.valid) {
        // Cache the invalid shell so the model can fix ONLY the broken elements via
        // patch_page({ draft_id, patches, dry_run:false }) instead of rebuilding the
        // whole section batch (same pattern as create_page failure caching).
        if (existingDraftId) {
          await updateDraft(existingDraftId, expandedShell);
        } else {
          existingDraftId = await putDraft({ source: expandedShell, kind: "sections", page_id });
        }
        return text({
          added: false,
          reason: "validation_failed",
          errors: result.errors,
          ...autoFixedField(autoFixed),
          ...warningsField(result.warnings),
          draft_id: existingDraftId,
          hint:
            "Do NOT rebuild the section batch — it is cached as draft_id. Each error names the offending element id — fix ONLY those elements with patch_page({ draft_id, patches:[…], dry_run:false }); it re-validates the merged shell and appends the sections. A wrong element type → { op:'update', id:'<element id>', type:'<allowed type>' }. A stray/extra key ('must NOT have additional properties') → { op:'replace', id, element:<clean node> } — op:'update' MERGES and cannot delete a key. The draft expires in ~2 h.",
        });
      }

      const { config, missing, refusal } = await scopedCfg(extra, organization_id, page_id, "add_section");
      if (refusal) return text({ added: false, ...refusal });
      if (!config) {
        return text({
          added: false,
          reason: "missing_env",
          missing_env: missing,
          hint: "Configure WEBCAKE_API_BASE and WEBCAKE_JWT (env), or send the x-webcake-jwt header (remote), then retry.",
        });
      }

      if (isDry) {
        // Cache (or refresh) the validated shell so the model can confirm with
        // dry_run=false without re-sending the section payload.
        if (existingDraftId) {
          await updateDraft(existingDraftId, expandedShell);
        } else {
          existingDraftId = await putDraft({ source: expandedShell, kind: "sections", page_id });
        }
        return text({
          dry_run: true,
          page_id,
          sections_added: newSections.length,
          section_labels: labels,
          validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
          ...autoFixedField(autoFixed),
          draft_id: existingDraftId,
          request: buildAppendRequestRedacted(config, page_id, newSections),
          note: "The backend appends these to the END of `page` and rejects duplicate element ids across the live tree.",
          hint: `Re-run add_section({ page_id: "${page_id}", draft_id: "${existingDraftId}", dry_run: false }) — no need to re-send the sections.`,
        });
      }

      // Real append — light server-side path (one small POST, no get+put).
      const outcome = await appendSection(config, page_id, newSections);
      if (!outcome.endpoint_missing) {
        if (outcome.ok) {
          // Success: drop the draft now that sections are persisted.
          if (existingDraftId) await deleteDraft(existingDraftId);
          // The BACKEND appended server-side, so the stored tree is no longer any
          // source we hold — drop the baseline so the next whole-source overwrite
          // has to prove itself against a fresh read.
          forgetPageVersion(page_id);
          invalidateSource(config, page_id);
        } else {
          // Server-side failure (duplicate id vs live tree, etc.): keep the draft so
          // the model can retry/fix without re-shipping the payload.
          if (existingDraftId) {
            await updateDraft(existingDraftId, expandedShell);
          } else {
            existingDraftId = await putDraft({ source: expandedShell, kind: "sections", page_id });
          }
        }
        return text({
          added: outcome.ok,
          sections_added: outcome.sections_added ?? newSections.length,
          section_labels: labels,
          page_section_count: outcome.section_count != null ? { after: outcome.section_count } : undefined,
          page_id: outcome.page_id,
          editor_url: outcome.editor_url,
          preview_url: outcome.preview_url,
          status: outcome.status,
          error: outcome.error,
          ...saveExtras(outcome),
          ...autoFixedField(autoFixed),
          ...warningsField(result.warnings),
          ...(outcome.ok ? {} : {
            draft_id: existingDraftId,
            hint: "Append failed — the section batch is still cached. Fix the listed error (e.g. a duplicate id vs the live tree can be changed via patch_page({ draft_id, patches:[{op:'replace',id:'<old-id>',element:{…,id:'<new-id>'}}] })) then retry add_section({ page_id, draft_id, dry_run:false }).",
          }),
        });
      }

      // Fallback for an older backend WITHOUT /append_section (404): the original
      // heavier path — get the live source → merge → validate the WHOLE tree → put.
      const current = await readLiveSource(config, page_id);
      if (!current.ok || current.source == null) {
        return text({
          added: false,
          reason: "fetch_failed",
          status: current.status,
          error: current.error ?? "Page source not found.",
          hint: "Check the page_id (list_pages) and that the account owns it.",
        });
      }
      let base: any = current.source;
      if (typeof base === "string") {
        try {
          base = JSON.parse(base);
        } catch {
          return text({ added: false, reason: "bad_source", hint: "The stored page source could not be parsed." });
        }
      }
      const existing = Array.isArray(base.page) ? base.page : [];
      const merged = { ...base, page: [...existing, ...newSections] };
      const counts = { before: existing.length, after: existing.length + newSections.length };

      const mergedResult = domain.validate(merged);
      // only errors the new sections ADD (the stored page may already carry some)
      const mergedAdded = mergedResult.valid ? [] : addedErrors(domain, base, mergedResult.errors);
      if (mergedAdded.length) {
        return text({
          added: false,
          reason: "validation_failed",
          errors: mergedAdded,
          ...warningsField(mergedResult.warnings),
          page_section_count: counts,
          hint: "Fix the section(s) — duplicate ids vs existing sections are a common cause — then retry.",
        });
      }
      const parsed = domain.coerce(merged);
      const fbOutcome = await updatePageSource(config, page_id, parsed, { base: current.version, before: domain.expand(base) });
      if (fbOutcome.page_changed) {
        return text({ added: false, ...pageChangedPayload(page_id, fbOutcome, "add_section"), hint: "The page was saved by someone else while the sections were being merged — nothing was written. Re-run the same add_section call." });
      }
      if (fbOutcome.ok && existingDraftId) await deleteDraft(existingDraftId);
      // The fallback merged into the tree it JUST read, so no staleness guard is
      // needed here — but the save makes a new baseline worth recording.
      if (fbOutcome.ok) rememberPageVersion(page_id, sourceFingerprint(fbOutcome.rehosted_source ?? parsed), "write");
      if (fbOutcome.ok) invalidateSource(config!, page_id);
      return text({
        added: fbOutcome.ok,
        sections_added: newSections.length,
        section_labels: labels,
        page_section_count: counts,
        via: "legacy_get_put_fallback",
        page_id: fbOutcome.page_id,
        editor_url: fbOutcome.editor_url,
        preview_url: fbOutcome.preview_url,
        status: fbOutcome.status,
        error: fbOutcome.error,
        ...saveExtras(fbOutcome),
        ...warningsField(mergedResult.warnings),
      });
    }
  );

  // 14) Patch page (surgical element edit / fix-after-error) -------------------
  // Why this exists: update_page takes the ENTIRE source as one tool argument, so
  // fixing one bad element — or making a small edit — forces the model to re-emit
  // the whole (often huge) page JSON, the same large payload that can drop the
  // client↔Claude connection. patch_page lets the model send ONLY the diff: a list
  // of per-element ops keyed by element id. The MCP fetches the live source, applies
  // the ops, validates the WHOLE merged tree, and PUTs — the big merge lives on the
  // robust MCP↔backend link, never in a tool argument the model has to stream.
  //
  // This is the fix-after-error path: when create_page/add_section/update_page
  // returns validation errors, the model corrects ONLY the offending element ids via
  // patch_page instead of rebuilding the source. It is also the everyday surgical-edit
  // path (change one element's text/color/position without resending the tree).
  //
  // Ops (each keyed by element id, found anywhere in page or popup):
  //   { op:"update", id, specials?, styles?:{desktop?,mobile?}, config?:{desktop?,mobile?}, events?, properties? }
  //        — shallow-merge the given fields into the existing element (op defaults to "update").
  //   { op:"replace", id, element }     — swap the whole node in place (compact authoring ok; keeps the id).
  //   { op:"remove",  id }              — delete the element and its subtree.
  //   { op:"add", parent_id, element }  — append a new child element to the parent container.
  // Unlike create_page's env-less preview, patch_page MUST read the live page, so it
  // needs creds even on dry_run; dry_run only gates the final write.
  const asArray = (input: any): any[] => {
    let v = input;
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        /* not JSON — wrap as single */
      }
    }
    return Array.isArray(v) ? v : [v];
  };
  // Find a node by id within the real array refs (so remove/add mutate the live tree),
  // recursing into children; returns the node, its parent array, and index.
  const findById = (
    arr: any[],
    id: string
  ): { node: any; parentArr: any[]; index: number } | null => {
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (!n || typeof n !== "object") continue;
      if (n.id === id) return { node: n, parentArr: arr, index: i };
      if (Array.isArray(n.children)) {
        const found = findById(n.children, id);
        if (found) return found;
      }
    }
    return null;
  };
  const mergeStyleMap = (node: any, kind: "styles" | "config", byBp: any): string[] => {
    const touched: string[] = [];
    for (const bp of ["desktop", "mobile"] as const) {
      const patch = byBp?.[bp];
      if (!patch || typeof patch !== "object") continue;
      node.responsive = node.responsive ?? {};
      node.responsive[bp] = node.responsive[bp] ?? { config: {}, styles: {} };
      node.responsive[bp][kind] = { ...(node.responsive[bp][kind] ?? {}), ...patch };
      touched.push(`${bp}.${kind}`);
    }
    return touched;
  };

  // patch_page body. `fresh`: the retry after the backend refused a write made against a cached
  // tree (page_changed) — re-read the live page and apply the same ops to it, once.
  const runPatch = async ({ page_id, draft_id, patches, force, dry_run, organization_id }: any, extra: any, fresh = false): Promise<any> => {
    const isDry = dry_run !== false; // default true (safe)
    const ops = asArray(patches).filter((p) => p != null && typeof p === "object");
    // Empty ops are only valid when a draft_id is supplied (commit-as-is / retry path).
    // For a live-page patch with no draft_id, we still require at least one op.
    if (ops.length === 0 && !draft_id) {
      return text({ patched: false, reason: "no_patches", hint: "Pass an op object or a non-empty array of { op, id, … } ops, or provide a draft_id to commit the cached draft as-is." });
    }
    if (!page_id && !draft_id) {
      return text({ patched: false, reason: "no_target", hint: "Pass page_id (a live page) or draft_id (the cached source from a failed/timed-out create_page, update_page, or add_section)." });
    }

    // A live page (page_id, or an update/section draft that targets one) is scoped by organization;
    // a create draft is not — createPage resolves its own org.
    const draftPre = draft_id ? await getDraft(draft_id) : null;
    const scopePid: string | undefined = page_id ?? (draftPre && draftPre.kind !== "page" ? draftPre.page_id : undefined);
    const scoped = scopePid ? await scopedCfg(extra, organization_id, scopePid, "patch_page") : { ...cfgFor(extra), refusal: undefined as Record<string, unknown> | undefined };
    if (scoped.refusal) return text({ patched: false, ...scoped.refusal });
    const { config, missing } = scoped;

    // Resolve the base source: a cached draft (create-before-save), else a live page.
    let base: any;
    let liveRead: any; // the live read a page_id patch merges into (its version guards the save)
    const draft = draft_id ? await getDraft(draft_id) : null;
    if (draft_id) {
      if (!draft) {
        return text({
          patched: false,
          reason: "draft_expired",
          hint: "The cached draft is gone (expired after ~2 h or evicted). Re-send the full source via create_page.",
        });
      }
      // a working copy: a batch that fails part-way must not leave its first ops in the cached draft
      base = structuredClone(draft.source); // already an expanded full tree
    } else {
      if (!config) {
        return text({
          patched: false,
          reason: "missing_env",
          missing_env: missing,
          hint: "Configure WEBCAKE_API_BASE and WEBCAKE_JWT (env), or send the x-webcake-jwt header (remote), then retry.",
        });
      }
      // a real run trusts the cache (no version probe): the write carries the cached version and
      // the backend refuses it if the page moved — then this re-runs once on a fresh read
      const current = await readLiveSource(config, page_id!, !isDry && !fresh ? { trust: true } : {});
      if (!current.ok || current.source == null) {
        return text({
          patched: false,
          reason: "fetch_failed",
          status: current.status,
          error: current.error ?? "Page source not found.",
          hint: "Check the page_id (find_pages/list_pages) and that the account owns it.",
          ...(await notFoundOrgHint(config, current.status, current.error)),
        });
      }
      // This read is by definition current, so it becomes the baseline: a later
      // update_page that still matches it is provably not reverting anything.
      rememberPageVersion(page_id!, sourceFingerprint(current.source), "read");
      liveRead = current;
      base = current.source;
      if (typeof base === "string") {
        try {
          base = JSON.parse(base);
        } catch {
          return text({ patched: false, reason: "bad_source", hint: "The stored page source could not be parsed." });
        }
      }
    }
    // the tree as it was before these ops: a live edit is refused only for errors IT adds
    const before = draft_id ? null : structuredClone(base);
    const treeRoots = [base.page, base.popup].filter((a) => Array.isArray(a)) as any[][];
    const locate = (id: string) => {
      for (const r of treeRoots) {
        const hit = findById(r, id);
        if (hit) return hit;
      }
      return null;
    };

    // Apply every op against the live tree. A missing target aborts the whole
    // patch (we never write a partial edit).
    const applied: any[] = [];
    const notFound: { op: string; id: string }[] = [];
    const badOps: string[] = [];
    const removedIds = new Set<string>();
    for (const p of ops) {
      const op = p.op ?? "update";
      if (op === "add") {
        const pid = p.parent_id ?? p.id;
        if (typeof pid !== "string" || p.element == null) {
          badOps.push(`add needs parent_id + element`);
          continue;
        }
        const hit = locate(pid);
        if (!hit) {
          notFound.push({ op, id: pid });
          continue;
        }
        hit.node.children = Array.isArray(hit.node.children) ? hit.node.children : [];
        hit.node.children.push(p.element);
        applied.push({ op, parent_id: pid, added_id: p.element?.id });
        continue;
      }
      if (op === "move" || op === "duplicate") {
        if (typeof p.id !== "string") {
          badOps.push(`${op} needs a string id`);
          continue;
        }
        const r = op === "move" ? moveNode(base, p) : duplicateNode(base, p);
        if (r.ok) applied.push(r.change);
        else if (r.error.startsWith("not_found:")) notFound.push({ op, id: r.error.slice("not_found:".length) });
        else badOps.push(r.error);
        continue;
      }
      // update / style / remove may target a `match` selector instead of one id.
      let ids: string[];
      const byMatch = typeof p.id !== "string" && p.match != null && typeof p.match === "object" && op !== "replace";
      if (byMatch) {
        const limit = typeof p.limit === "number" ? p.limit : 50;
        const problem = matchProblem(p.match);
        if (problem) {
          badOps.push(`${op}: ${problem}`);
          continue;
        }
        ids = selectIds(base, p.match);
        if (ids.length === 0) {
          notFound.push({ op, id: `match:${JSON.stringify(p.match)}` });
          continue;
        }
        if (ids.length > limit) {
          badOps.push(`${op} match ${JSON.stringify(p.match)} hit ${ids.length} elements (> limit ${limit}) — narrow it or pass a higher limit`);
          continue;
        }
      } else if (typeof p.id === "string") {
        ids = [p.id];
      } else {
        badOps.push(`${op} needs a string id${op === "replace" ? "" : " or a match"}`);
        continue;
      }
      const matchChanged = new Set<string>();
      for (const id of ids) {
        // A matched descendant of a container this match already removed is gone with it.
        if (byMatch && removedIds.has(id)) continue;
        const hit = locate(id);
        if (!hit) {
          notFound.push({ op, id });
          continue;
        }
        if (op === "remove") {
          for (const rid of subtreeIds(hit.node)) removedIds.add(rid);
          hit.parentArr.splice(hit.index, 1);
          if (!byMatch) applied.push({ op, id });
        } else if (op === "replace") {
          if (p.element == null) {
            badOps.push(`replace ${id} needs element`);
            continue;
          }
          const repl = p.element;
          if (repl && typeof repl === "object" && repl.id == null) repl.id = id;
          hit.parentArr[hit.index] = repl;
          applied.push({ op, id });
        } else if (op === "style") {
          const changed = mergeStyleMap(hit.node, "styles", { desktop: p.desktop, mobile: p.mobile });
          dropStaleMeasure(hit.node, null, { desktop: p.desktop, mobile: p.mobile }, null);
          changed.forEach((c) => matchChanged.add(c));
          if (!byMatch) applied.push({ op, id, changed });
        } else {
          // update (default)
          const changed: string[] = [];
          if (typeof p.type === "string" && p.type.trim() !== "") {
            hit.node.type = p.type;
            changed.push("type");
          }
          if (p.specials && typeof p.specials === "object") {
            hit.node.specials = { ...(hit.node.specials ?? {}), ...p.specials };
            changed.push("specials");
          }
          changed.push(...mergeStyleMap(hit.node, "styles", p.styles));
          changed.push(...mergeStyleMap(hit.node, "config", p.config));
          if (Array.isArray(p.events)) {
            hit.node.events = p.events;
            changed.push("events");
          }
          if (p.properties && typeof p.properties === "object") {
            hit.node.properties = { ...(hit.node.properties ?? {}), ...p.properties };
            changed.push("properties");
          }
          dropStaleMeasure(hit.node, p.specials, p.styles, p.config);
          changed.forEach((c) => matchChanged.add(c));
          if (!byMatch) applied.push({ op: "update", id, changed });
        }
      }
      if (byMatch) applied.push({ op, match: p.match, matched_ids: ids, ...(op === "remove" ? {} : { changed: [...matchChanged] }) });
    }
    // Removed elements that other elements' events still target (open_popup, scroll_to, …).
    const dangling = removedIds.size ? refsTo(base, removedIds) : [];
    const integrity = dangling.length
      ? { dangling_events: dangling, dangling_warning: `${dangling.length} event(s) still target removed element(s) and will do nothing — retarget or remove them (patch_page update events).` }
      : {};

    if (badOps.length > 0) {
      return text({ patched: false, reason: "bad_ops", bad_ops: badOps, hint: "Each op needs id (or parent_id for add) and an element where required." });
    }
    if (notFound.length > 0) {
      return text({
        patched: false,
        reason: "target_not_found",
        not_found: notFound,
        hint: "No element with that id exists on the live page. Run get_page to see the current ids; ids are case-sensitive.",
      });
    }

    // Validate the WHOLE merged tree (hydrate sparse replaced/added nodes first).
    const expanded = domain.expand(base);
    const result = domain.validate(expanded);

    // DRAFT path: the source came from a failed/dry-run create_page, add_section,
    // or a timed-out/failed update_page / live-page patch_page.
    // Keep applied fixes cached between rounds; once valid, dispatch based on kind:
    //   'page'    (or absent) → CREATE a new page
    //   'sections'            → APPEND to the live page
    //   'update'              → UPDATE the existing page (updatePageSource)
    if (draft_id && draft) {
      // an update draft refuses only errors beyond what the live page already had
      const blocking = result.valid ? [] : draft.kind === "update" && draft.prior_errors ? addedAgainst(draft.prior_errors, result.errors) : result.errors;
      if (blocking.length) {
        await updateDraft(draft_id, base); // persist partial fixes for the next patch round
        return text({
          patched: false,
          reason: "validation_failed",
          errors: blocking,
          ...(blocking.length < result.errors.length ? { pre_existing_errors: result.errors.length - blocking.length } : {}),
          ...warningsField(result.warnings),
          patches_applied: applied, ...integrity,
          draft_id,
          hint: "Still invalid — fix the remaining errors with another patch_page({ draft_id, patches:[…] }); your applied fixes are kept in the draft. Each error names the offending element id — target THAT id. A stray/extra key ('must NOT have additional properties') needs op:'replace' with a clean node (op:'update' merges; it cannot delete a key). Do NOT rebuild with create_page — the draft already holds everything.",
        });
      }
      const parsed = domain.coerce(expanded);

      // --- Sections draft: APPEND to the live page once valid ---
      if (draft.kind === "sections") {
        const targetPageId = page_id ?? draft.page_id;
        if (!targetPageId) {
          await updateDraft(draft_id, base);
          return text({
            patched: false,
            reason: "no_page_id",
            draft_id,
            hint: "No page_id on this sections draft. Pass page_id explicitly to patch_page to set the append target.",
          });
        }
        if (isDry) {
          await updateDraft(draft_id, base);
          return text({
            dry_run: true,
            draft_id,
            page_id: targetPageId,
            patches_applied: applied, ...integrity,
            validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
            env_ready: missing.length === 0,
            missing_env: missing,
            request: config
              ? buildAppendRequestRedacted(config, targetPageId, (expanded as any).page ?? [])
              : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable the append." },
            hint: `Sections draft is now valid. Re-run patch_page({ draft_id: "${draft_id}", dry_run: false }) with NO patches to append the sections. (the ones just applied are saved in the draft; resending them would apply them twice).`,
          });
        }
        if (!config) {
          await updateDraft(draft_id, base);
          return text({ patched: false, reason: "missing_env", missing_env: missing, hint: `Add WEBCAKE_API_BASE + WEBCAKE_JWT, then retry patch_page({ draft_id: "${draft_id}", dry_run:false }).` });
        }
        const sectionsToAppend = Array.isArray((expanded as any).page) ? (expanded as any).page : [];
        const outcome = await appendSection(config, targetPageId, sectionsToAppend);
        if (outcome.ok) {
          await deleteDraft(draft_id);
          forgetPageVersion(targetPageId);
          invalidateSource(config, targetPageId);
        } else {
          await updateDraft(draft_id, base);
        }
        return text({
          patched: outcome.ok,
          appended: outcome.ok,
          from_draft: draft_id,
          patches_applied: applied, ...integrity,
          page_id: outcome.page_id ?? targetPageId,
          editor_url: outcome.editor_url,
          preview_url: outcome.preview_url,
          status: outcome.status,
          error: outcome.error,
          ...saveExtras(outcome),
          ...warningsField(result.warnings),
          ...(outcome.ok ? {} : { draft_id, hint: `Append failed — fixes kept in draft. Retry patch_page({ draft_id: "${draft_id}", dry_run:false }) after resolving the error.` }),
        });
      }

      // --- Update draft: UPDATE the existing page once valid ---
      if (draft.kind === "update") {
        const targetPageId = page_id ?? draft.page_id;
        if (!targetPageId) {
          await updateDraft(draft_id, base);
          return text({
            patched: false,
            reason: "no_page_id",
            draft_id,
            hint: "No page_id on this update draft. Pass page_id explicitly to patch_page to set the update target.",
          });
        }
        if (isDry) {
          await updateDraft(draft_id, base);
          return text({
            dry_run: true,
            draft_id,
            page_id: targetPageId,
            patches_applied: applied, ...integrity,
            validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
            env_ready: missing.length === 0,
            missing_env: missing,
            request: config
              ? buildUpdateRequestRedacted(config, targetPageId, parsed)
              : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable the update." },
            hint: `Update draft is now valid. Re-run patch_page({ draft_id: "${draft_id}", dry_run: false }) with NO patches to save. (the ones just applied are saved in the draft; resending them would apply them twice).`,
          });
        }
        if (!config) {
          await updateDraft(draft_id, base);
          return text({ patched: false, reason: "missing_env", missing_env: missing, hint: `Add WEBCAKE_API_BASE + WEBCAKE_JWT, then retry patch_page({ draft_id: "${draft_id}", dry_run:false }).` });
        }
        const guard = await guardOverwrite(config, targetPageId, parsed, {
          baseVersion: draft.base_version,
          force,
          retryHint: `patch_page({ draft_id: "${draft_id}", dry_run:false })`,
        });
        if (!guard.ok) {
          await updateDraft(draft_id, base);
          return text({ patched: false, updated: false, ...guard.payload, draft_id, patches_applied: applied, ...integrity });
        }
        const outcome = await updatePageSource(config, targetPageId, parsed, guard.base);
        if (outcome.page_changed) {
          await updateDraft(draft_id, base);
          return text({ patched: false, ...pageChangedPayload(targetPageId, outcome, `patch_page({ draft_id: "${draft_id}", dry_run:false })`), draft_id });
        }
        if (outcome.ok) {
          await deleteDraft(draft_id);
          rememberPageVersion(targetPageId, sourceFingerprint(outcome.rehosted_source ?? parsed), "write");
          invalidateSource(config!, targetPageId);
        } else {
          await updateDraft(draft_id, base);
        }
        return text({
          patched: outcome.ok,
          updated: outcome.ok,
          from_draft: draft_id,
          patches_applied: applied, ...integrity,
          page_id: outcome.page_id ?? targetPageId,
          editor_url: outcome.editor_url,
          preview_url: outcome.preview_url,
          status: outcome.status,
          error: outcome.error,
          ...saveExtras(outcome),
          ...warningsField(result.warnings),
          ...(outcome.ok ? {} : { draft_id, hint: `Update failed — fixes kept in draft. Retry patch_page({ draft_id: "${draft_id}", dry_run:false }) after resolving the error.` }),
        });
      }

      // --- Page draft (kind='page' or absent): CREATE as a new page once valid ---
      if (isDry) {
        await updateDraft(draft_id, base);
        return text({
          dry_run: true,
          draft_id,
          patches_applied: applied, ...integrity,
          validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
          env_ready: missing.length === 0,
          missing_env: missing,
          request: config
            ? buildRequestRedacted(config, draft.name ?? "AI Page", parsed, draft.organization_id)
            : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable creation." },
          hint: `Draft is now valid. Re-run patch_page({ draft_id: "${draft_id}", dry_run: false }) with NO patches to create the page. (the ones just applied are saved in the draft; resending them would apply them twice).`,
        });
      }
      if (!config) {
        await updateDraft(draft_id, base);
        return text({ patched: false, reason: "missing_env", missing_env: missing, hint: `Add WEBCAKE_API_BASE + WEBCAKE_JWT, then retry patch_page({ draft_id: "${draft_id}", dry_run:false }).` });
      }
      // CACHE-FIRST: source is already in the draft; refresh before the network call.
      await updateDraft(draft_id, base);
      const outcome = await createPage(config, draft.name ?? "AI Page", parsed, draft.organization_id);
      if (outcome.ok) {
        await deleteDraft(draft_id);
        rememberPageVersion(outcome.page_id, sourceFingerprint(outcome.rehosted_source ?? parsed), "write");
        invalidateSource(config!, outcome.page_id);
      } else {
        await updateDraft(draft_id, base); // keep for retry
      }
      // A page created via the fix-after-error path gets the same auto-publish
      // as a direct create_page (build + publish_html so the preview renders).
      const publishOutcome = outcome.ok ? await autoPublish(config, outcome.page_id!, outcome.rehosted_source ?? parsed) : undefined;
      if (outcome.ok) await servedAfterCreate(config, outcome.page_id, outcome, (publishOutcome as any)?.published ? outcome.rehosted_source ?? parsed : undefined);
      return text({
        patched: outcome.ok,
        created: outcome.ok,
        from_draft: draft_id,
        patches_applied: applied, ...integrity,
        page_id: outcome.page_id,
        editor_url: outcome.editor_url,
        preview_url: outcome.preview_url,
        status: outcome.status,
        error: outcome.error,
        ...saveExtras(outcome),
        ...(publishOutcome ? { publish: publishOutcome } : {}),
        ...warningsField(result.warnings),
        ...(outcome.ok ? {} : { draft_id, hint: `Create failed — fixes kept in draft. Retry patch_page({ draft_id: "${draft_id}", dry_run:false }) or resolve the error first.` }),
      });
    }

    // LIVE-PAGE path: edit an existing page (page_id) and update it in place.
    // Errors the page already had (an old enum value, an editor-written oddity) don't block an edit
    // that doesn't add any: only errors THIS write introduces are refused.
    const added = result.valid ? [] : addedErrors(domain, before, result.errors);
    if (!result.valid && added.length) {
      return text({
        patched: false,
        reason: "validation_failed",
        errors: added,
        ...(added.length < result.errors.length ? { pre_existing_errors: result.errors.length - added.length } : {}),
        ...warningsField(result.warnings),
        patches_applied: applied, ...integrity,
        hint: "The edit produced an invalid tree — fix the listed errors in your ops, then retry.",
      });
    }
    const parsed = domain.coerce(expanded);

    // CACHE-FIRST: write an 'update' draft BEFORE the network call so a timeout or
    // failure is recoverable via patch_page({ draft_id, dry_run:false }) with no patches.
    const liveDraftId = await putDraft({
      source: expanded,
      kind: "update",
      page_id: page_id!,
      prior_errors: priorErrors(domain, before),
      base_version: lastKnownPageVersion(page_id!)?.fp,
    });

    if (isDry) {
      return text({
        dry_run: true,
        page_id,
        patches_applied: applied, ...integrity,
        validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
        draft_id: liveDraftId,
        request: buildUpdateRequestRedacted(config!, page_id!, parsed),
        hint: `Re-run patch_page({ draft_id: "${liveDraftId}", dry_run: false }) — no need to re-send patches. Or re-run with page_id + dry_run:false.`,
      });
    }

    // against the version just read: only the changed sections travel, and an editor save that
    // landed in between is refused by the backend instead of being overwritten
    const outcome = await updatePageSource(config!, page_id!, parsed, { base: liveRead?.version, before: before && domain.expand(before), verified: !liveRead?.trusted });
    if (outcome.page_changed) {
      await deleteDraft(liveDraftId);
      invalidateSource(config!, page_id!);
      if (!fresh) return runPatch({ page_id, draft_id, patches, force, dry_run, organization_id }, extra, true);
      return text({ patched: false, ...pageChangedPayload(page_id!, outcome, "patch_page"), hint: "The page was saved by someone else between this patch's read and its write — nothing was written. Re-run the SAME patch_page call: it re-reads the live page and applies your ops to it." });
    }
    if (outcome.ok) {
      await deleteDraft(liveDraftId);
      rememberPageVersion(page_id!, sourceFingerprint(outcome.rehosted_source ?? parsed), "write");
      afterWrite(config!, page_id!, outcome, outcome.rehosted_source ?? parsed, before, liveRead);
      return text({
        patched: true,
        patches_applied: applied, ...integrity,
        page_id: outcome.page_id,
        editor_url: outcome.editor_url,
        preview_url: outcome.preview_url,
        status: outcome.status,
        ...saveExtras(outcome),
        ...warningsField(result.warnings),
      });
    }
    // Network failure / timeout: keep the update draft for retry — as it would have been stored.
    await updateDraft(liveDraftId, outcome.rehosted_source ?? expanded);
    return text({
      patched: false,
      patches_applied: applied, ...integrity,
      page_id: outcome.page_id ?? page_id,
      status: outcome.status,
      error: outcome.error,
      ...saveExtras(outcome),
      ...warningsField(result.warnings),
      draft_id: liveDraftId,
      hint: `Save failed — the patched source is cached. Retry via patch_page({ draft_id: "${liveDraftId}", dry_run: false }) with no patches. The draft expires in ~2 h.`,
    });
  };
  server.tool(
    "patch_page",
    "Edits a page by element id without sending the whole source. The target is either a live page (page_id) or a cached draft (draft_id) returned by a failed or dry-run create_page, add_section or update_page call. Ops: {op:'update', id, type?, specials?, styles?:{desktop?,mobile?}, config?:{desktop?,mobile?}, events?, properties?} shallow-merges fields (op defaults to 'update'; it cannot delete existing keys), {op:'replace', id, element} swaps the node, {op:'remove', id} deletes it (events elsewhere that targeted it are reported in dangling_events), {op:'add', parent_id, element} appends a child to a container; `element` may be sparse. {op:'move', id, parent_id?, index?, desktop?:{left?,top?}, mobile?:{left?,top?}} reparents and/or reorders (z-order = child order), keeping the element visually in place unless left/top are given. {op:'duplicate', id, parent_id?, offset?:{desktop?:{x,y},mobile?:{x,y}}, count?} deep-copies with fresh unique ids (internal event targets remapped); copy i is shifted by offset×i. {op:'style', id|match, desktop?:{…}, mobile?:{…}} merges styles. update/style/remove accept match:{type?, text?, section_id?, within?} instead of id (text = case-insensitive substring, tags stripped; within = a container id) and apply to every match, refused above limit (default 50); matched_ids are reported. The server loads the source, applies the ops, validates the whole merged tree (errors block the save) and saves: a live page is updated in place, a create draft becomes a new page, a section draft is appended, and an update draft is re-saved. With a draft_id and no patches, the cached draft is committed as-is (the retry after a timeout). dry_run defaults to true (load, merge, validate, preview; no write); dry_run:false saves. Requires Webcake credentials; a page_id patch reads the live page, so it needs them even on a dry run.",
    {
      page_id: z.string().optional().describe("A live page id to edit (must be owned by the account). Provide page_id OR draft_id; with a sections or update draft_id, page_id overrides the stored target page."),
      draft_id: z.string().optional().describe("Commit or fix a CACHED source: from create_page (failed/timed-out → new page created once valid), add_section (dry_run or failure → sections appended), or update_page/live-page patch (timed-out/failed → updatePageSource retried). The originating tool's error/dry_run response returns draft_id. Provide page_id OR draft_id. Empty/omitted patches = commit the cached draft as-is (the RETRY PATH after a timeout)."),
      patches: objectsOrJson()
        .optional()
        .describe(
          "One op object or an array of them (object/array or JSON string). Each targets an element by id: {op:'update',id,type?,specials?,styles?:{desktop?,mobile?},config?:{desktop?,mobile?},events?,properties?} merges fields into the element (op may be omitted; `type` changes the element type; a merge cannot delete an existing key, so schema 'must NOT have additional properties' errors are fixed with op:'replace' and a clean node); {op:'replace',id,element} swaps the node; {op:'remove',id} deletes it; {op:'add',parent_id,element} appends a child to a container; {op:'move',id,parent_id?,index?,desktop?:{left,top},mobile?:{left,top}}; {op:'duplicate',id,parent_id?,offset?:{desktop?:{x,y},mobile?:{x,y}},count?}; {op:'style',id|match,desktop?,mobile?}. update/style/remove take match:{type?,text?,section_id?,within?} + limit? (default 50) instead of id. `element` may be a sparse node (id/type/styles/specials/events); omitted boilerplate is filled from factory defaults. Empty or omitted with a draft_id: the cached draft is committed as-is."
        ),
      force: z
        .boolean()
        .optional()
        .describe("Default false. Only meaningful when committing an 'update' draft: true saves the cached snapshot even though the page changed outside this session, discarding those changes. A page_id patch never needs it — it merges into the tree it just read."),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default TRUE — load, merge, validate and preview the resulting save WITHOUT writing. Set false to actually save."),
      organization_id: orgArg(),
    },
    { title: "Patch Webcake Page (by element id)", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async (args: any, extra: any) => runPatch(args, extra),
  );

  // 15) Publish page (go live) -------------------------------------------------
  server.tool(
    "publish_page",
    "Publishes an existing page: builds the rendered app on the Webcake build host (POST <buildBase>/render/build; https://build.webcake.io in production, overridable with WEBCAKE_BUILD_BASE / x-webcake-build-base) and then creates or updates the published record that public serving reads. With custom_domain (already pointed at Webcake) the page is served at that domain; when omitted, the page's currently attached domain is reused; with no domain, or custom_domain:'', only the preview link (<previewBase>/preview/<page_id>) is returned, and it renders for about 10 minutes after the publish. Without a build host, or if the build fails, it falls back to a source-only publish that saves a version but serves nothing, and returns a warning. dry_run defaults to true and makes no network calls; dry_run:false builds and publishes. Requires Webcake credentials.",
    {
      page_id: z.string().describe("The page id to publish (must be owned by the account)."),
      custom_domain: z
        .string()
        .optional()
        .describe("Optional custom domain to serve the page at (e.g. 'shop.example.com' — must already point at Webcake). Use it EXACTLY as the account lists it: 'www.example.com' and 'example.com' are DIFFERENT domain records — a www/non-www mismatch is corrected to the stored form, and a domain the account never added is refused (nothing published). OMIT to reuse the page's CURRENTLY-ATTACHED domain (so republishing keeps it live at the same URL, like the editor's publish modal); if the page has none it publishes domain-less (preview-host URL). Pass an empty string '' to force a domain-less publish even when the page has a domain."),
      custom_path: z.string().optional().describe("Optional path under the custom domain (e.g. 'sale')."),
      dry_run: z.boolean().optional().describe("Default TRUE — preview the request without sending. Does NOT call the build host. Set false to actually publish (build + publish)."),
      organization_id: orgArg(),
    },
    { title: "Publish Webcake Page", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ page_id, custom_domain, custom_path, dry_run, organization_id }, extra) => {
      const isDry = dry_run !== false; // default true (safe)
      const { config, missing, refusal } = await scopedCfg(extra, organization_id, page_id, "publish_page");
      if (refusal) return text({ published: false, ...refusal });
      if (!config) return text({ published: false, reason: "missing_env", missing_env: missing });

      // Publish re-saves the page's CURRENT stored source (the publish endpoint
      // requires it in the request), so read it first — even on dry_run, to show
      // the real payload.
      const res = await readLiveSource(config, page_id);
      if (!res.ok || res.source == null) {
        return text({ published: false, reason: "page_not_found", status: res.status, error: res.error ?? "No source on this page.", ...(await notFoundOrgHint(config, res.status, res.error)) });
      }
      // An editor publish may have stored a 404 `sNaN` thumbnail/favicon — don't republish it (#5).
      const source = healBrokenResizeUrls(res.source);
      // Resolve the domain to publish to the way the editor's publish modal does:
      // an explicit arg wins, otherwise reuse the page's CURRENTLY-ATTACHED domain
      // so a plain publish_page({ page_id }) keeps the page live at the same URL
      // instead of silently dropping to an ephemeral /preview. The page record from
      // getPageSource carries it when the backend returns it; if not, fall back to a
      // find_pages lookup by id (custom_path only comes from the record). Passing
      // custom_domain:'' explicitly opts OUT (publish domain-less on purpose).
      let effectiveDomain = custom_domain ?? res.custom_domain ?? undefined;
      let effectivePath = custom_path ?? res.custom_path ?? undefined;
      let domainInherited = false;
      if (custom_domain == null && (effectiveDomain == null || effectiveDomain === "")) {
        const found = await searchPages(config, { id: page_id, limit: 1 });
        const row = found.pages?.find((p) => `${p.id}` === `${page_id}`) ?? found.pages?.[0];
        if (row?.custom_domain) {
          effectiveDomain = row.custom_domain;
          domainInherited = true;
        }
      } else if (custom_domain == null && effectiveDomain) {
        domainInherited = true;
      }
      // Normalize an empty-string domain to "no domain" so downstream !! checks agree.
      if (!effectiveDomain) effectiveDomain = undefined;

      // Publish to the domain EXACTLY as the account stores it (the editor's modal can only pick
      // from that list). A verbatim custom_domain once published `xsummit.vn` for a customer who had
      // added `www.xsummit.vn`: the page lived on a domain record that doesn't exist and Dynamic
      // campaigns on it failed. Explicit domain not in the account → refuse. An INHERITED domain that
      // isn't listed (shared from another member, older record) or a lookup failure → publish as
      // before, with a note — never block a republish on the lookup itself.
      let domainNote: string | undefined;
      if (effectiveDomain) {
        const bare = normalizeDomain(effectiveDomain).replace(/^www\./, "");
        const listed = await listVerifiedDomains(config, { term: bare, orgId: res.organization_id });
        if (listed.ok) {
          const m = matchAccountDomain(effectiveDomain, listed.domains ?? []);
          if (m.ok) {
            if (m.domain !== effectiveDomain) domainNote = `'${effectiveDomain}' is stored in the account as '${m.domain}' — publishing to '${m.domain}' (www and non-www are different domains; campaigns and tracking key on the stored one).`;
            effectiveDomain = m.domain;
          } else if (!domainInherited) {
            return text({
              published: false,
              reason: "domain_not_in_account",
              page_id,
              requested_domain: effectiveDomain,
              account_domains_matching: m.candidates,
              hint: "The domain must be added and verified in the account (Domains) first, and passed EXACTLY as listed — www.example.com and example.com are different. Pick one of account_domains_matching, ask the user which domain to use, or pass custom_domain:'' to publish without a domain.",
            });
          } else {
            domainNote = `The page's attached domain '${effectiveDomain}' is not among the account's verified domains — republished to it unchanged.`;
          }
        } else {
          domainNote = `Could not check '${effectiveDomain}' against the account's domain list (${listed.error ?? `HTTP ${listed.status}`}) — publishing to it as given.`;
        }
      }

      const opts = { customDomain: effectiveDomain, customPath: effectivePath };
      const buildBase = config.buildBase;
      // Only the preview window serves a domain-less publish, and only briefly.
      const previewExpiryNote = effectiveDomain
        ? domainInherited
          ? `Reused the page's attached domain (${effectiveDomain}) — pass custom_domain to override, or custom_domain:'' to publish without one.`
          : undefined
        : "No custom_domain — the page has NO permanent public URL. The preview link only renders for ~10 minutes after the publish, then shows 'Preview page is expired'. Attach a custom_domain (already pointed at Webcake) for a lasting URL.";

      if (isDry) {
        // dry_run is network-free — do NOT call the build host.
        return text({
          dry_run: true,
          page_id,
          name: res.name,
          would_publish_to: effectiveDomain
            ? `https://${effectiveDomain}${effectivePath ? `/${effectivePath}` : ""}`
            : toPreviewUrl(config, `/preview/${page_id}`),
          build_step: buildBase
            ? { would_run: true, build_host: buildBase, note: "Build host will be called on dry_run=false to produce rendered app/app_css, then the page is published live via the editor's publish_html route." }
            : { would_run: false, note: "No build host configured — publish will fall back to the LEGACY source-only route (nothing goes live). Set WEBCAKE_BUILD_BASE env or x-webcake-build-base header (prod preset: https://build.webcake.io) to publish for real." },
          ...(previewExpiryNote ? { note: previewExpiryNote } : {}),
          ...(domainNote ? { domain_note: domainNote } : {}),
          request: buildPublishRequestRedacted(config, page_id, source, opts, !!buildBase),
          hint: "Re-run with dry_run=false to actually publish.",
        });
      }

      // Real publish: build app/app_css first — required for the publish_html
      // (live) route. Without a successful build we fall back to the legacy
      // source-only route rather than publishing a blank PagePublishedV2 record.
      let app: string | undefined;
      let app_css: string | undefined;
      let rendered = false;
      let buildWarning: string | undefined;

      if (buildBase) {
        console.error(`[publish_page] calling build host ${buildBase} for page ${page_id}`);
        const buildResult = await buildPageApp(buildBase, page_id, source);
        if (buildResult.ok) {
          app = buildResult.app;
          app_css = buildResult.app_css;
          rendered = true;
          console.error(`[publish_page] build ok — app ${app?.length ?? 0}B css ${app_css?.length ?? 0}B`);
        } else {
          buildWarning = `Build host failed (${buildResult.error ?? "unknown error"}) — fell back to the legacy source-only publish: a version was saved but NOTHING WENT LIVE (the live publish_html route needs the rendered app). Fix the build host and re-run publish_page.`;
          console.error(`[publish_page] build failed: ${buildResult.error}`);
        }
      } else {
        buildWarning = "No build host configured (WEBCAKE_BUILD_BASE env / x-webcake-build-base header; prod preset has https://build.webcake.io automatically). Fell back to the legacy source-only publish: a version was saved but NOTHING WENT LIVE (the live publish_html route needs the rendered app).";
      }

      const publishOpts = { ...opts, app, app_css };
      const outcome = await publishPage(config, page_id, source, publishOpts);
      // publish_html re-saves the source it was given (same content, the backend's own bytes → a new md5):
      // carry the model's base and the cache over to that version, or an update_page that follows is refused
      if (outcome.ok && res.version) {
        const expected = publishedVersion(source);
        if (expected !== res.version && (await probeIs(config, page_id, expected))) {
          if (servedOf(config, page_id) === res.version) rememberServed(config, page_id, expected);
          cachePageSource(sourceCacheKey(page_id, config.jwt), expected, { ...res, version: expected, source: structuredClone(source), from_cache: undefined, trusted: undefined });
        } else if (expected !== res.version) invalidateSource(config, page_id);
      }
      return text({
        published: outcome.ok,
        // live = the PagePublishedV2 record public serving reads was written
        // (publish_html route). The legacy fallback only saves a version.
        live: outcome.ok && rendered,
        rendered,
        page_id,
        url: outcome.published_url,
        preview_url: outcome.preview_url,
        domain: outcome.domain,
        path: outcome.path,
        status: outcome.status,
        error: outcome.error,
        ...(outcome.ok && previewExpiryNote ? { note: previewExpiryNote } : {}),
        ...(domainNote ? { domain_note: domainNote } : {}),
        ...(buildWarning ? { warning: buildWarning } : {}),
      });
    }
  );
}
