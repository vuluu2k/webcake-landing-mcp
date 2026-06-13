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
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { text, warningsField } from "../mcp/response.js";
import { readConfig, configFromHeaders } from "../persistence/config.js";
import {
  buildRequestRedacted,
  buildUpdateRequestRedacted,
  buildAppendRequestRedacted,
  buildPublishRequestRedacted,
  buildPageApp,
  createPage,
  listOrganizations,
  listPages,
  searchPages,
  getPageSource,
  updatePageSource,
  appendSection,
  publishPage,
  toPreviewUrl,
} from "../persistence/webcake-client.js";
import { putDraft, getDraft, updateDraft, deleteDraft } from "../persistence/draft-cache.js";
import type { WebcakeConfig } from "../persistence/types.js";

export function registerPersistenceTools(server: McpServer, domain: Domain) {
  // Resolve config from THIS request's headers (remote per-user JWT) first, then env.
  const cfgFor = (extra: any) => readConfig(configFromHeaders(extra?.requestInfo?.headers));

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
    { title: "List Webcake Organizations", readOnlyHint: true, openWorldHint: true },
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
    "Persists a page source to the configured Webcake backend: creates a NEW page, saves the source, then AUTO-PUBLISHES it (builds the rendered app on the build host + publishes via the editor's publish_html route) so the preview renders immediately — set publish:false to skip, and note the no-domain preview link still expires ~10 minutes after each publish (publish_page with custom_domain gives a permanent URL). A failed auto-publish never fails the create (result.publish says how to retry). Validates first. DEFAULTS to dry_run=true (validates, caches the source as draft_id, returns the HTTP request it WOULD send, token masked); dry_run=false to actually create. Accepts draft_id from a previous call (validation failure, dry_run, or a timed-out create) — re-runs from the cached source without re-sending the full JSON. Organization resolution on the real run (dry_run=false): (1) explicit organization_id wins; pass the string 'personal' to save without any org. (2) WEBCAKE_ORG_ID env / x-webcake-org-id header wins. (3) Otherwise list_organizations is called: 0 orgs or lookup fails → personal (no org); exactly 1 org → used automatically (result includes organization_auto_selected:true); 2+ orgs → returns ok:false with the org list and asks the caller to re-call with organization_id. Real writes need WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      source: z
        .any()
        .optional()
        .describe("Page source { page, popup, settings, options, cartConfigs } (object or JSON string). Required unless draft_id is given. Author elements SPARSE — only id, type, responsive.<bp>.styles for BOTH breakpoints, specials, and real events; OMIT properties/runtime/empty events+children/per-breakpoint config — the server hydrates them from factory defaults (a full node also works)."),
      draft_id: z
        .string()
        .optional()
        .describe("A draft_id from a previous create_page call (validation failure, dry_run=true, or a timed-out/failed create). Loads the cached source — no need to re-send the full JSON. Use for dry-run → real call transitions, fix-after-error rounds, and retrying after a timeout."),
      name: z.string().optional().describe("Page name (default 'AI Page')."),
      organization_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Organization to create the page in (id from list_organizations). Pass the string 'personal' to explicitly save without any organization (skips auto-resolution). Omit to fall back to WEBCAKE_ORG_ID env; if that is also unset, the server calls list_organizations: 1 org → auto-selected; 2+ orgs → returns the list and asks you to pick; 0 orgs → personal."),
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
        const cached = getDraft(draft_id);
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
      const cachedDraft = existingDraftId ? getDraft(existingDraftId) : null;
      const pageName = name ?? cachedDraft?.name ?? "AI Page";

      // 'personal' is a sentinel meaning "no org, skip auto-resolution".
      const isExplicitPersonal = organization_id != null && `${organization_id}`.toLowerCase() === "personal";
      const explicitOrgId = (organization_id != null && !isExplicitPersonal) ? `${organization_id}` : undefined;
      // On dry_run, use the explicit arg or the draft's stored org (if any).
      const draftOrgId = cachedDraft?.organization_id;
      const orgId = explicitOrgId ?? draftOrgId;

      const result = domain.validate(expanded);
      if (!result.valid) {
        // Cache the failed source so the model can fix ONLY the broken elements via
        // patch_page({ draft_id }) instead of regenerating + re-shipping the whole
        // source (there is no page_id yet, so patch_page can't target a live page).
        if (existingDraftId) {
          updateDraft(existingDraftId, expanded);
        } else {
          existingDraftId = putDraft({ source: expanded, name: pageName, organization_id: orgId });
        }
        return text({
          created: false,
          reason: "validation_failed",
          errors: result.errors,
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
          updateDraft(existingDraftId, expanded);
        } else {
          existingDraftId = putDraft({ source: expanded, name: pageName, organization_id: orgId });
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
              updateDraft(existingDraftId, expanded);
            } else {
              existingDraftId = putDraft({ source: expanded, name: pageName, organization_id: undefined });
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
        updateDraft(existingDraftId, expanded);
      } else {
        existingDraftId = putDraft({ source: expanded, name: pageName, organization_id: resolvedOrgId });
      }

      const outcome = await createPage(config, pageName, parsed, resolvedOrgId);
      if (outcome.ok) {
        deleteDraft(existingDraftId); // created — drop the draft
        // Auto-publish (default): build + publish_html so the preview renders
        // immediately. Never fails the create — result.publish carries the state.
        const publishOutcome =
          publish === false
            ? { published: false, skipped: true, note: "publish:false — created source-only; the preview stays blank until publish_page runs." }
            : await autoPublish(config, outcome.page_id!, outcome.rehosted_source ?? parsed);
        return text({
          created: true,
          ...outcome,
          publish: publishOutcome,
          ...warningsField(result.warnings),
          ...(organizationAutoSelected ? { organization_auto_selected: true } : {}),
          ...(organizationNote ? { note: organizationNote } : {}),
        });
      }
      // Failure (including timeout): keep the draft so the model can retry.
      updateDraft(existingDraftId, expanded);
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
    "Lists the pages owned by the account (id, name, organization_id, updated_at), most-recent first. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {},
    { title: "List Webcake Pages", readOnlyHint: true, openWorldHint: true },
    async (_args, extra) => {
      const { config, missing } = cfgFor(extra);
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
    "Searches the account's pages by name, domain, and/or page id so you can locate the page to edit, then pass its id to get_page → update_page/add_section. Filters are AND-combined (e.g. name='sale' + domain='shop.com'). Each result includes id, name, organization_id, custom_domain, default_domain, updated_at. With no filters it returns the most-recent pages (like list_pages). Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      name: z.string().optional().describe("Case-insensitive substring of the page name to match."),
      domain: z
        .string()
        .optional()
        .describe("Case-insensitive substring of the page's domain (matches custom_domain OR default_domain)."),
      page_id: z.string().optional().describe("Exact page id — narrows to that single page (useful to confirm it exists/owned)."),
      limit: z.number().int().positive().max(100).optional().describe("Max results (default 50, capped at 100)."),
    },
    { title: "Find Webcake Pages", readOnlyHint: true, openWorldHint: true },
    async ({ name, domain, page_id, limit }, extra) => {
      const { config, missing } = cfgFor(extra);
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
    "Fetches an existing page's decoded source tree { page, popup, settings, options, cartConfigs } plus name and organization_id. By DEFAULT the source is COMPACTED: boilerplate every element shares (properties/runtime/empty events+children/per-breakpoint config + factory-default style keys) is stripped, leaving the sparse authoring shape — edit it and send it back as-is; update_page/patch_page re-hydrate from factory defaults. Pass compact:false for the raw stored tree. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      page_id: z.string().describe("The page id (from list_pages or a URL)."),
      compact: z
        .boolean()
        .optional()
        .describe("Default TRUE — strip factory-default boilerplate from every element (sparse shape, far fewer tokens). false returns the raw stored tree."),
    },
    { title: "Get Webcake Page Source", readOnlyHint: true, openWorldHint: true },
    async ({ page_id, compact }, extra) => {
      const { config, missing } = cfgFor(extra);
      if (!config) return text({ ok: false, reason: "missing_env", missing_env: missing });
      const res = await getPageSource(config, page_id);
      if (!res.ok || compact === false || res.source == null) return text(res);
      return text({
        ...res,
        source: domain.compact(res.source),
        compacted: true,
        note: "Source is COMPACTED (factory-default boilerplate stripped). Edit elements in this same sparse shape — keep ids — and send the edited tree back to update_page (or use patch_page for small edits); the server re-hydrates omitted boilerplate.",
      });
    }
  );

  // 12) Update page (edit existing) -------------------------------------------
  server.tool(
    "update_page",
    "Overwrites an EXISTING page's source with an edited tree (source-only; re-render in the editor for preview/publish). Validates first. DEFAULTS to dry_run=true (validates, caches the source as draft_id, previews the request, token masked); dry_run=false to actually save. Accepts draft_id from a previous call (dry_run, or a timed-out/failed update) — re-runs from the cached source without re-sending the full JSON. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      page_id: z.string().optional().describe("The page id to update (must be owned by the account). Required unless draft_id is given (the page_id is stored in the draft)."),
      source: z
        .any()
        .optional()
        .describe("The edited page source { page, popup, settings, options, cartConfigs } (object or JSON string). Required unless draft_id is given. The compacted tree from get_page can be edited and sent back AS-IS — sparse nodes are re-hydrated from factory defaults (a full tree also works)."),
      draft_id: z
        .string()
        .optional()
        .describe("A draft_id from a previous update_page call (dry_run=true or a timed-out/failed update). Loads the cached source — no need to re-send the full JSON. Use for dry-run → real call transitions and retrying after a timeout."),
      dry_run: z.boolean().optional().describe("Default TRUE — validate, cache the source as draft_id, and preview without sending. Set false to actually save."),
    },
    { title: "Update Webcake Page (Overwrite)", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ page_id, source, draft_id, dry_run }, extra) => {
      const isDry = dry_run !== false;

      // --- Resolve source: from cache (draft_id) or from the argument ---
      let expanded: any;
      let existingDraftId: string | undefined = draft_id;
      let resolvedPageId: string | undefined = page_id;

      if (draft_id) {
        const cached = getDraft(draft_id);
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
        resolvedPageId = page_id ?? cached.page_id;
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

      const result = domain.validate(expanded);
      if (!result.valid) {
        if (existingDraftId) {
          updateDraft(existingDraftId, expanded);
        } else {
          existingDraftId = putDraft({ source: expanded, kind: "update", page_id: resolvedPageId });
        }
        return text({
          updated: false,
          reason: "validation_failed",
          errors: result.errors,
          ...warningsField(result.warnings),
          draft_id: existingDraftId,
          hint: `Fix the errors, then retry update_page({ draft_id: "${existingDraftId}", dry_run:false }) — no need to re-send source. Or use patch_page({ page_id: "${resolvedPageId}", patches:[…] }) for surgical fixes.`,
        });
      }
      const parsed = domain.coerce(expanded);
      const { config, missing } = cfgFor(extra);

      if (isDry) {
        // Cache (or refresh) the validated source so the model can confirm with
        // dry_run=false without re-sending the full payload.
        if (existingDraftId) {
          updateDraft(existingDraftId, expanded);
        } else {
          existingDraftId = putDraft({ source: expanded, kind: "update", page_id: resolvedPageId });
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
        updateDraft(existingDraftId, expanded);
      } else {
        existingDraftId = putDraft({ source: expanded, kind: "update", page_id: resolvedPageId });
      }

      const outcome = await updatePageSource(config, resolvedPageId, parsed);
      if (outcome.ok) {
        deleteDraft(existingDraftId);
        return text({ updated: true, ...outcome, ...warningsField(result.warnings) });
      }
      updateDraft(existingDraftId, expanded);
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
    "Appends one or more SECTIONS to an existing page WITHOUT re-sending the whole source — the incremental-build path that avoids large create_page payloads. The backend appends section(s) to the END of `page` server-side and rejects duplicate element ids, so the caller sends only the new section(s) (no whole-source get+put). DEFAULTS to dry_run=true (validates the section(s) + previews the request; caches the payload as draft_id so you never have to re-send sections between dry-run → real call); dry_run=false to actually append. On validation failure also returns a draft_id — call patch_page({ draft_id, patches, dry_run:false }) to fix ONLY the bad elements without rebuilding the batch. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      page_id: z.string().describe("The page id to append to (from create_page or list_pages; must be owned by the account)."),
      sections: z
        .any()
        .optional()
        .describe(
          "One section node, or an array of section nodes, to append to the END of `page` (object/array or JSON string). Each is a normal section element { id, type:'section', responsive, children, … } with a UNIQUE id; they stack vertically after the existing sections. Author SPARSE nodes — omit properties/runtime/empty events+children/per-breakpoint config; the server hydrates them from factory defaults. Required unless draft_id is supplied."
        ),
      draft_id: z
        .string()
        .optional()
        .describe(
          "A draft id returned by a previous add_section call (dry_run=true or validation failure). Loads the cached section payload — no need to re-send the sections JSON. Use for dry-run → real call transitions and fix-after-error rounds."
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default TRUE — validate the section(s) and preview the request without writing. Set false to actually append."),
    },
    { title: "Append Section(s) to Webcake Page", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ page_id, sections, draft_id, dry_run }, extra) => {
      const isDry = dry_run !== false; // default true (safe)

      // --- Resolve section payload: from cache (draft_id) or from the argument ---
      let expandedShell: any;
      let existingDraftId: string | undefined = draft_id;

      if (draft_id) {
        // Load cached shell from a previous add_section dry_run or failure round.
        const cached = getDraft(draft_id);
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
          updateDraft(existingDraftId, expandedShell);
        } else {
          existingDraftId = putDraft({ source: expandedShell, kind: "sections", page_id });
        }
        return text({
          added: false,
          reason: "validation_failed",
          errors: result.errors,
          ...warningsField(result.warnings),
          draft_id: existingDraftId,
          hint:
            "Do NOT rebuild the section batch — it is cached as draft_id. Each error names the offending element id — fix ONLY those elements with patch_page({ draft_id, patches:[…], dry_run:false }); it re-validates the merged shell and appends the sections. A wrong element type → { op:'update', id:'<element id>', type:'<allowed type>' }. A stray/extra key ('must NOT have additional properties') → { op:'replace', id, element:<clean node> } — op:'update' MERGES and cannot delete a key. The draft expires in ~2 h.",
        });
      }

      const { config, missing } = cfgFor(extra);
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
          updateDraft(existingDraftId, expandedShell);
        } else {
          existingDraftId = putDraft({ source: expandedShell, kind: "sections", page_id });
        }
        return text({
          dry_run: true,
          page_id,
          sections_added: newSections.length,
          section_labels: labels,
          validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
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
          if (existingDraftId) deleteDraft(existingDraftId);
        } else {
          // Server-side failure (duplicate id vs live tree, etc.): keep the draft so
          // the model can retry/fix without re-shipping the payload.
          if (existingDraftId) {
            updateDraft(existingDraftId, expandedShell);
          } else {
            existingDraftId = putDraft({ source: expandedShell, kind: "sections", page_id });
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
          ...(outcome.rehost ? { rehost: outcome.rehost } : {}),
          ...warningsField(result.warnings),
          ...(outcome.ok ? {} : {
            draft_id: existingDraftId,
            hint: "Append failed — the section batch is still cached. Fix the listed error (e.g. a duplicate id vs the live tree can be changed via patch_page({ draft_id, patches:[{op:'replace',id:'<old-id>',element:{…,id:'<new-id>'}}] })) then retry add_section({ page_id, draft_id, dry_run:false }).",
          }),
        });
      }

      // Fallback for an older backend WITHOUT /append_section (404): the original
      // heavier path — get the live source → merge → validate the WHOLE tree → put.
      const current = await getPageSource(config, page_id);
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
      if (!mergedResult.valid) {
        return text({
          added: false,
          reason: "validation_failed",
          errors: mergedResult.errors,
          ...warningsField(mergedResult.warnings),
          page_section_count: counts,
          hint: "Fix the section(s) — duplicate ids vs existing sections are a common cause — then retry.",
        });
      }
      const parsed = domain.coerce(merged);
      const fbOutcome = await updatePageSource(config, page_id, parsed);
      if (fbOutcome.ok && existingDraftId) deleteDraft(existingDraftId);
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

  server.tool(
    "patch_page",
    "Edits a page by element id WITHOUT re-sending the whole source — the surgical-edit and fix-after-error path. Targets EITHER a live page (page_id) OR a cached draft source (draft_id). Draft sources come from: (a) create_page — failed validation or timed-out network call → patched/committed tree is CREATED as a new page once valid; (b) add_section dry_run or validation/network failure → patched/committed shell is APPENDED to the stored page once valid; (c) update_page or live-page patch_page — timed-out/failed network call → re-committed via updatePageSource. Send only a list of per-element ops; the MCP loads the source, applies them, validates the WHOLE merged tree (blocks on errors), and saves. Ops: {op:'update',id,type?,specials?,styles?:{desktop?,mobile?},config?:{desktop?,mobile?},events?,properties?} (shallow-merges; op defaults to 'update'; `type` fixes a wrong element type; update CANNOT delete an existing/stray key — schema 'additional properties' errors need op:'replace'), {op:'replace',id,element}, {op:'remove',id}, {op:'add',parent_id,element}. EMPTY/OMITTED patches with a draft_id = commit the cached draft as-is (skip apply, still validate, then honor dry_run) — this is the RETRY PATH after a timeout. Use this to fix the elements a failed create_page/update_page/add_section reported instead of rebuilding. DEFAULTS to dry_run=true (loads + merges + validates + previews, no write); dry_run=false to save. Needs WEBCAKE_API_BASE + WEBCAKE_JWT (a draft_id sections-patch only needs creds to actually append; a page_id patch reads the live page so needs creds even on dry_run).",
    {
      page_id: z.string().optional().describe("Edit a LIVE page by id (from create_page, list_pages, or find_pages; must be owned by the account). Provide page_id OR draft_id. For a sections or update draft_id you may also pass page_id here to override the stored page target."),
      draft_id: z.string().optional().describe("Commit or fix a CACHED source: from create_page (failed/timed-out → new page created once valid), add_section (dry_run or failure → sections appended), or update_page/live-page patch (timed-out/failed → updatePageSource retried). The originating tool's error/dry_run response returns draft_id. Provide page_id OR draft_id. Empty/omitted patches = commit the cached draft as-is (the RETRY PATH after a timeout)."),
      patches: z
        .any()
        .optional()
        .describe(
          "One op object or an array of them (object/array or JSON string). Each targets an element by id: {op:'update',id,type?,specials?,styles?:{desktop?,mobile?},config?:{desktop?,mobile?},events?,properties?} merges fields into the element (op may be omitted; set `type` to fix a wrong element type; update MERGES — it cannot DELETE an existing/stray key, so 'must NOT have additional properties' errors need op:'replace' with a clean node); {op:'replace',id,element} swaps the node; {op:'remove',id} deletes it; {op:'add',parent_id,element} appends a child to a container. `element` may be a SPARSE node (id/type/styles/specials/events only) — the server hydrates omitted boilerplate from factory defaults. OMIT (or pass empty array) when draft_id is given and you just want to commit/retry the cached draft as-is."
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default TRUE — load, merge, validate and preview the resulting save WITHOUT writing. Set false to actually save."),
    },
    { title: "Patch Webcake Page (by element id)", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ page_id, draft_id, patches, dry_run }, extra) => {
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

      const { config, missing } = cfgFor(extra);

      // Resolve the base source: a cached draft (create-before-save), else a live page.
      let base: any;
      const draft = draft_id ? getDraft(draft_id) : null;
      if (draft_id) {
        if (!draft) {
          return text({
            patched: false,
            reason: "draft_expired",
            hint: "The cached draft is gone (expired after ~2 h or evicted). Re-send the full source via create_page.",
          });
        }
        base = draft.source; // already an expanded full tree
      } else {
        if (!config) {
          return text({
            patched: false,
            reason: "missing_env",
            missing_env: missing,
            hint: "Configure WEBCAKE_API_BASE and WEBCAKE_JWT (env), or send the x-webcake-jwt header (remote), then retry.",
          });
        }
        const current = await getPageSource(config, page_id!);
        if (!current.ok || current.source == null) {
          return text({
            patched: false,
            reason: "fetch_failed",
            status: current.status,
            error: current.error ?? "Page source not found.",
            hint: "Check the page_id (find_pages/list_pages) and that the account owns it.",
          });
        }
        base = current.source;
        if (typeof base === "string") {
          try {
            base = JSON.parse(base);
          } catch {
            return text({ patched: false, reason: "bad_source", hint: "The stored page source could not be parsed." });
          }
        }
      }
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
        if (typeof p.id !== "string") {
          badOps.push(`${op} needs a string id`);
          continue;
        }
        const hit = locate(p.id);
        if (!hit) {
          notFound.push({ op, id: p.id });
          continue;
        }
        if (op === "remove") {
          hit.parentArr.splice(hit.index, 1);
          applied.push({ op, id: p.id });
        } else if (op === "replace") {
          if (p.element == null) {
            badOps.push(`replace ${p.id} needs element`);
            continue;
          }
          const repl = p.element;
          if (repl && typeof repl === "object" && repl.id == null) repl.id = p.id;
          hit.parentArr[hit.index] = repl;
          applied.push({ op, id: p.id });
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
          applied.push({ op: "update", id: p.id, changed });
        }
      }

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
        if (!result.valid) {
          updateDraft(draft_id, base); // persist partial fixes for the next patch round
          return text({
            patched: false,
            reason: "validation_failed",
            errors: result.errors,
            ...warningsField(result.warnings),
            patches_applied: applied,
            draft_id,
            hint: "Still invalid — fix the remaining errors with another patch_page({ draft_id, patches:[…] }); your applied fixes are kept in the draft. Each error names the offending element id — target THAT id. A stray/extra key ('must NOT have additional properties') needs op:'replace' with a clean node (op:'update' merges; it cannot delete a key). Do NOT rebuild with create_page — the draft already holds everything.",
          });
        }
        const parsed = domain.coerce(expanded);

        // --- Sections draft: APPEND to the live page once valid ---
        if (draft.kind === "sections") {
          const targetPageId = page_id ?? draft.page_id;
          if (!targetPageId) {
            updateDraft(draft_id, base);
            return text({
              patched: false,
              reason: "no_page_id",
              draft_id,
              hint: "No page_id on this sections draft. Pass page_id explicitly to patch_page to set the append target.",
            });
          }
          if (isDry) {
            updateDraft(draft_id, base);
            return text({
              dry_run: true,
              draft_id,
              page_id: targetPageId,
              patches_applied: applied,
              validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
              env_ready: missing.length === 0,
              missing_env: missing,
              request: config
                ? buildAppendRequestRedacted(config, targetPageId, (expanded as any).page ?? [])
                : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable the append." },
              hint: `Sections draft is now valid. Re-run patch_page({ draft_id: "${draft_id}", dry_run: false }) to append the sections.`,
            });
          }
          if (!config) {
            updateDraft(draft_id, base);
            return text({ patched: false, reason: "missing_env", missing_env: missing, hint: `Add WEBCAKE_API_BASE + WEBCAKE_JWT, then retry patch_page({ draft_id: "${draft_id}", dry_run:false }).` });
          }
          const sectionsToAppend = Array.isArray((expanded as any).page) ? (expanded as any).page : [];
          const outcome = await appendSection(config, targetPageId, sectionsToAppend);
          if (outcome.ok) {
            deleteDraft(draft_id);
          } else {
            updateDraft(draft_id, base);
          }
          return text({
            patched: outcome.ok,
            appended: outcome.ok,
            from_draft: draft_id,
            patches_applied: applied,
            page_id: outcome.page_id ?? targetPageId,
            editor_url: outcome.editor_url,
            preview_url: outcome.preview_url,
            status: outcome.status,
            error: outcome.error,
            ...warningsField(result.warnings),
            ...(outcome.ok ? {} : { draft_id, hint: `Append failed — fixes kept in draft. Retry patch_page({ draft_id: "${draft_id}", dry_run:false }) after resolving the error.` }),
          });
        }

        // --- Update draft: UPDATE the existing page once valid ---
        if (draft.kind === "update") {
          const targetPageId = page_id ?? draft.page_id;
          if (!targetPageId) {
            updateDraft(draft_id, base);
            return text({
              patched: false,
              reason: "no_page_id",
              draft_id,
              hint: "No page_id on this update draft. Pass page_id explicitly to patch_page to set the update target.",
            });
          }
          if (isDry) {
            updateDraft(draft_id, base);
            return text({
              dry_run: true,
              draft_id,
              page_id: targetPageId,
              patches_applied: applied,
              validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
              env_ready: missing.length === 0,
              missing_env: missing,
              request: config
                ? buildUpdateRequestRedacted(config, targetPageId, parsed)
                : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable the update." },
              hint: `Update draft is now valid. Re-run patch_page({ draft_id: "${draft_id}", dry_run: false }) to save.`,
            });
          }
          if (!config) {
            updateDraft(draft_id, base);
            return text({ patched: false, reason: "missing_env", missing_env: missing, hint: `Add WEBCAKE_API_BASE + WEBCAKE_JWT, then retry patch_page({ draft_id: "${draft_id}", dry_run:false }).` });
          }
          const outcome = await updatePageSource(config, targetPageId, parsed);
          if (outcome.ok) {
            deleteDraft(draft_id);
          } else {
            updateDraft(draft_id, base);
          }
          return text({
            patched: outcome.ok,
            updated: outcome.ok,
            from_draft: draft_id,
            patches_applied: applied,
            page_id: outcome.page_id ?? targetPageId,
            editor_url: outcome.editor_url,
            preview_url: outcome.preview_url,
            status: outcome.status,
            error: outcome.error,
            ...warningsField(result.warnings),
            ...(outcome.ok ? {} : { draft_id, hint: `Update failed — fixes kept in draft. Retry patch_page({ draft_id: "${draft_id}", dry_run:false }) after resolving the error.` }),
          });
        }

        // --- Page draft (kind='page' or absent): CREATE as a new page once valid ---
        if (isDry) {
          updateDraft(draft_id, base);
          return text({
            dry_run: true,
            draft_id,
            patches_applied: applied,
            validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
            env_ready: missing.length === 0,
            missing_env: missing,
            request: config
              ? buildRequestRedacted(config, draft.name ?? "AI Page", parsed, draft.organization_id)
              : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable creation." },
            hint: `Draft is now valid. Re-run patch_page({ draft_id: "${draft_id}", dry_run: false }) to create the page.`,
          });
        }
        if (!config) {
          updateDraft(draft_id, base);
          return text({ patched: false, reason: "missing_env", missing_env: missing, hint: `Add WEBCAKE_API_BASE + WEBCAKE_JWT, then retry patch_page({ draft_id: "${draft_id}", dry_run:false }).` });
        }
        // CACHE-FIRST: source is already in the draft; refresh before the network call.
        updateDraft(draft_id, base);
        const outcome = await createPage(config, draft.name ?? "AI Page", parsed, draft.organization_id);
        if (outcome.ok) {
          deleteDraft(draft_id);
        } else {
          updateDraft(draft_id, base); // keep for retry
        }
        // A page created via the fix-after-error path gets the same auto-publish
        // as a direct create_page (build + publish_html so the preview renders).
        const publishOutcome = outcome.ok ? await autoPublish(config, outcome.page_id!, outcome.rehosted_source ?? parsed) : undefined;
        return text({
          patched: outcome.ok,
          created: outcome.ok,
          from_draft: draft_id,
          patches_applied: applied,
          page_id: outcome.page_id,
          editor_url: outcome.editor_url,
          preview_url: outcome.preview_url,
          status: outcome.status,
          error: outcome.error,
          ...(publishOutcome ? { publish: publishOutcome } : {}),
          ...warningsField(result.warnings),
          ...(outcome.ok ? {} : { draft_id, hint: `Create failed — fixes kept in draft. Retry patch_page({ draft_id: "${draft_id}", dry_run:false }) or resolve the error first.` }),
        });
      }

      // LIVE-PAGE path: edit an existing page (page_id) and update it in place.
      if (!result.valid) {
        return text({
          patched: false,
          reason: "validation_failed",
          errors: result.errors,
          ...warningsField(result.warnings),
          patches_applied: applied,
          hint: "The edit produced an invalid tree — fix the listed errors in your ops, then retry.",
        });
      }
      const parsed = domain.coerce(expanded);

      // CACHE-FIRST: write an 'update' draft BEFORE the network call so a timeout or
      // failure is recoverable via patch_page({ draft_id, dry_run:false }) with no patches.
      const liveDraftId = putDraft({ source: expanded, kind: "update", page_id: page_id! });

      if (isDry) {
        return text({
          dry_run: true,
          page_id,
          patches_applied: applied,
          validation: { valid: true, ...warningsField(result.warnings), stats: result.stats },
          draft_id: liveDraftId,
          request: buildUpdateRequestRedacted(config!, page_id!, parsed),
          hint: `Re-run patch_page({ draft_id: "${liveDraftId}", dry_run: false }) — no need to re-send patches. Or re-run with page_id + dry_run:false.`,
        });
      }

      const outcome = await updatePageSource(config!, page_id!, parsed);
      if (outcome.ok) {
        deleteDraft(liveDraftId);
        return text({
          patched: true,
          patches_applied: applied,
          page_id: outcome.page_id,
          editor_url: outcome.editor_url,
          preview_url: outcome.preview_url,
          status: outcome.status,
          ...warningsField(result.warnings),
        });
      }
      // Network failure / timeout: keep the update draft for retry.
      updateDraft(liveDraftId, expanded);
      return text({
        patched: false,
        patches_applied: applied,
        page_id: outcome.page_id ?? page_id,
        status: outcome.status,
        error: outcome.error,
        ...warningsField(result.warnings),
        draft_id: liveDraftId,
        hint: `Save failed — the patched source is cached. Retry via patch_page({ draft_id: "${liveDraftId}", dry_run: false }) with no patches. The draft expires in ~2 h.`,
      });
    }
  );

  // 15) Publish page (go live) -------------------------------------------------
  server.tool(
    "publish_page",
    "Publishes an EXISTING page LIVE via the editor's publish_html route: builds the rendered app on the Webcake build host (POST <buildBase>/render/build; prod default https://build.webcake.io, override with WEBCAKE_BUILD_BASE env / x-webcake-build-base header), then creates/updates the PagePublishedV2 record — the record ALL public serving reads. With custom_domain the page goes live at that domain (it must already point at Webcake). WITHOUT a domain there is NO permanent public URL: the returned preview link (<previewBase>/preview/<page_id>) only renders for ~10 minutes after the publish, then shows 'Preview page is expired' — tell the user to attach a domain for a lasting URL. If no build host is configured or the build fails, falls back to the LEGACY source-only publish route with a warning (saves a version; nothing goes live; the page stays blank). DEFAULTS to dry_run=true (network-free: does NOT call the build host on dry_run). Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      page_id: z.string().describe("The page id to publish (must be owned by the account)."),
      custom_domain: z
        .string()
        .optional()
        .describe("Optional custom domain to serve the page at (e.g. 'shop.example.com' — must already point at Webcake). Omit to publish without a domain (served at the preview-host URL)."),
      custom_path: z.string().optional().describe("Optional path under the custom domain (e.g. 'sale')."),
      dry_run: z.boolean().optional().describe("Default TRUE — preview the request without sending. Does NOT call the build host. Set false to actually publish (build + publish)."),
    },
    { title: "Publish Webcake Page", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ page_id, custom_domain, custom_path, dry_run }, extra) => {
      const isDry = dry_run !== false; // default true (safe)
      const { config, missing } = cfgFor(extra);
      if (!config) return text({ published: false, reason: "missing_env", missing_env: missing });

      // Publish re-saves the page's CURRENT stored source (the publish endpoint
      // requires it in the request), so read it first — even on dry_run, to show
      // the real payload.
      const res = await getPageSource(config, page_id);
      if (!res.ok || res.source == null) {
        return text({ published: false, reason: "page_not_found", status: res.status, error: res.error ?? "No source on this page." });
      }
      const opts = { customDomain: custom_domain, customPath: custom_path };
      const buildBase = config.buildBase;
      // Only the preview window serves a domain-less publish, and only briefly.
      const previewExpiryNote = custom_domain
        ? undefined
        : "No custom_domain — the page has NO permanent public URL. The preview link only renders for ~10 minutes after the publish, then shows 'Preview page is expired'. Attach a custom_domain (already pointed at Webcake) for a lasting URL.";

      if (isDry) {
        // dry_run is network-free — do NOT call the build host.
        return text({
          dry_run: true,
          page_id,
          name: res.name,
          would_publish_to: custom_domain
            ? `https://${custom_domain}${custom_path ? `/${custom_path}` : ""}`
            : toPreviewUrl(config, `/preview/${page_id}`),
          build_step: buildBase
            ? { would_run: true, build_host: buildBase, note: "Build host will be called on dry_run=false to produce rendered app/app_css, then the page is published live via the editor's publish_html route." }
            : { would_run: false, note: "No build host configured — publish will fall back to the LEGACY source-only route (nothing goes live). Set WEBCAKE_BUILD_BASE env or x-webcake-build-base header (prod preset: https://build.webcake.io) to publish for real." },
          ...(previewExpiryNote ? { note: previewExpiryNote } : {}),
          request: buildPublishRequestRedacted(config, page_id, res.source, opts, !!buildBase),
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
        const buildResult = await buildPageApp(buildBase, page_id, res.source);
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
      const outcome = await publishPage(config, page_id, res.source, publishOpts);
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
        ...(buildWarning ? { warning: buildWarning } : {}),
      });
    }
  );
}
