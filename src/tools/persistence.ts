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
import { text } from "../mcp/response.js";
import { readConfig, configFromHeaders } from "../persistence/config.js";
import {
  buildRequestRedacted,
  buildUpdateRequestRedacted,
  buildAppendRequestRedacted,
  createPage,
  listOrganizations,
  listPages,
  searchPages,
  getPageSource,
  updatePageSource,
  appendSection,
} from "../persistence/webcake-client.js";
import { putDraft, getDraft, updateDraft, deleteDraft } from "../persistence/draft-cache.js";

export function registerPersistenceTools(server: McpServer, domain: Domain) {
  // Resolve config from THIS request's headers (remote per-user JWT) first, then env.
  const cfgFor = (extra: any) => readConfig(configFromHeaders(extra?.requestInfo?.headers));

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
    "Persists a page source to the configured Webcake backend: creates a NEW page and saves the source (source-only — opens in the editor where re-saving renders it). Validates first. DEFAULTS to dry_run=true (returns the HTTP request it WOULD send, token masked); dry_run=false to actually create. The page lands in `organization_id` if given; without an org the page is personal (org=null). Real writes need WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      source: z
        .any()
        .describe("Page source { page, popup, settings, options, cartConfigs } (object or JSON string). Author elements SPARSE — only id, type, responsive.<bp>.styles for BOTH breakpoints, specials, and real events; OMIT properties/runtime/empty events+children/per-breakpoint config — the server hydrates them from factory defaults (a full node also works)."),
      name: z.string().optional().describe("Page name (default 'AI Page')."),
      organization_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Organization to create the page in (from list_organizations). Omit for a personal page; falls back to WEBCAKE_ORG_ID env if set."),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default TRUE — preview the request without sending. Set false to actually create."),
    },
    { title: "Create Webcake Page", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ source, name, organization_id, dry_run }, extra) => {
      const pageName = name ?? "AI Page";
      const isDry = dry_run !== false; // default true (safe)
      const orgId = organization_id != null ? `${organization_id}` : undefined;

      // Hydrate sparse nodes (the model may omit boilerplate) into full element
      // nodes BEFORE validating + persisting.
      const expanded = domain.expand(source);
      const result = domain.validate(expanded);
      if (!result.valid) {
        // Cache the failed source so the model can fix ONLY the broken elements via
        // patch_page({ draft_id }) instead of regenerating + re-shipping the whole
        // source (there is no page_id yet, so patch_page can't target a live page).
        const draft_id = putDraft({ source: expanded, name: pageName, organization_id: orgId });
        return text({
          created: false,
          reason: "validation_failed",
          errors: result.errors,
          warnings: result.warnings,
          draft_id,
          hint:
            "Do NOT rebuild the whole source — it is cached as draft_id. Fix ONLY the listed elements with patch_page({ draft_id, patches:[…], dry_run:false }); it re-validates the merged tree and creates the page. A wrong element type → { op:'update', id:'<element id>', type:'<allowed type>' } (run list_elements/get_element if unsure of the exact type name). The draft expires in ~30 min.",
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
        return text({
          dry_run: true,
          validation: { valid: true, warnings: result.warnings, stats: result.stats },
          ...(largePageAdvisory ? { large_page_advisory: largePageAdvisory } : {}),
          env_ready: missing.length === 0,
          missing_env: missing,
          target_organization_id: orgId ?? config?.orgId ?? null,
          request: config
            ? buildRequestRedacted(config, pageName, parsed, orgId)
            : {
                note:
                  "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable real creation. Would POST to {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source.",
              },
          hint: largePageAdvisory
            ? "Large page — consider the skeleton + add_section flow above. Otherwise re-run with dry_run=false to create in one call."
            : "Re-run with dry_run=false to actually create the page.",
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

      const outcome = await createPage(config, pageName, parsed, orgId);
      return text({ created: outcome.ok, ...outcome, warnings: result.warnings });
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
    "Overwrites an EXISTING page's source with an edited tree (source-only; re-render in the editor for preview/publish). Validates first. DEFAULTS to dry_run=true (preview the request, token masked); dry_run=false to actually save. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      page_id: z.string().describe("The page id to update (must be owned by the account)."),
      source: z
        .any()
        .describe("The edited page source { page, popup, settings, options, cartConfigs } (object or JSON string). The compacted tree from get_page can be edited and sent back AS-IS — sparse nodes are re-hydrated from factory defaults (a full tree also works)."),
      dry_run: z.boolean().optional().describe("Default TRUE — preview without sending. Set false to actually save."),
    },
    { title: "Update Webcake Page (Overwrite)", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ page_id, source, dry_run }, extra) => {
      const isDry = dry_run !== false;
      const expanded = domain.expand(source);
      const result = domain.validate(expanded);
      if (!result.valid) {
        return text({
          updated: false,
          reason: "validation_failed",
          errors: result.errors,
          warnings: result.warnings,
          hint: "Fix the errors (run validate_page) before updating.",
        });
      }
      const parsed = domain.coerce(expanded);
      const { config, missing } = cfgFor(extra);

      if (isDry) {
        return text({
          dry_run: true,
          page_id,
          validation: { valid: true, warnings: result.warnings, stats: result.stats },
          env_ready: missing.length === 0,
          missing_env: missing,
          request: config
            ? buildUpdateRequestRedacted(config, page_id, parsed)
            : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable real updates." },
          hint: "Re-run with dry_run=false to actually save the edit.",
        });
      }
      if (!config) return text({ updated: false, reason: "missing_env", missing_env: missing });

      const outcome = await updatePageSource(config, page_id, parsed);
      return text({ updated: outcome.ok, ...outcome, warnings: result.warnings });
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
    "Appends one or more SECTIONS to an existing page WITHOUT re-sending the whole source — the incremental-build path that avoids large create_page payloads. The backend appends section(s) to the END of `page` server-side and rejects duplicate element ids, so the caller sends only the new section(s) (no whole-source get+put). DEFAULTS to dry_run=true (validates the section(s) + previews the request; does NOT write); dry_run=false to actually append. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      page_id: z.string().describe("The page id to append to (from create_page or list_pages; must be owned by the account)."),
      sections: z
        .any()
        .describe(
          "One section node, or an array of section nodes, to append to the END of `page` (object/array or JSON string). Each is a normal section element { id, type:'section', responsive, children, … } with a UNIQUE id; they stack vertically after the existing sections. Author SPARSE nodes — omit properties/runtime/empty events+children/per-breakpoint config; the server hydrates them from factory defaults."
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default TRUE — validate the section(s) and preview the request without writing. Set false to actually append."),
    },
    { title: "Append Section(s) to Webcake Page", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ page_id, sections, dry_run }, extra) => {
      const isDry = dry_run !== false; // default true (safe)
      const rawSections = asSections(sections).filter((s) => s != null);
      if (rawSections.length === 0) {
        return text({ added: false, reason: "no_sections", hint: "Pass a section object or a non-empty array of sections." });
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
      const expandedShell: any = domain.expand(shell);
      const newSections = Array.isArray(expandedShell?.page) ? expandedShell.page : rawSections;
      const labels = newSections.map(sectionLabel);

      // Light validation: the append path does NOT fetch the live tree, so validate
      // the NEW section(s) inside the throwaway page shell — catches per-section
      // structural errors, missing field_name, container rules, and duplicate ids
      // WITHIN this batch. Collisions with EXISTING page ids are caught server-side
      // by the append endpoint. (A section event that targets an id living on the
      // live page — not in this batch — may surface here as an advisory warning.)
      const result = domain.validate(expandedShell);
      if (!result.valid) {
        return text({
          added: false,
          reason: "validation_failed",
          errors: result.errors,
          warnings: result.warnings,
          hint: "Fix the section(s) — duplicate ids within the batch are a common cause — then retry.",
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
        return text({
          dry_run: true,
          page_id,
          sections_added: newSections.length,
          section_labels: labels,
          validation: { valid: true, warnings: result.warnings, stats: result.stats },
          request: buildAppendRequestRedacted(config, page_id, newSections),
          note: "The backend appends these to the END of `page` and rejects duplicate element ids across the live tree.",
          hint: "Re-run with dry_run=false to actually append the section(s).",
        });
      }

      // Real append — light server-side path (one small POST, no get+put).
      const outcome = await appendSection(config, page_id, newSections);
      if (!outcome.endpoint_missing) {
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
          warnings: result.warnings,
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
          warnings: mergedResult.warnings,
          page_section_count: counts,
          hint: "Fix the section(s) — duplicate ids vs existing sections are a common cause — then retry.",
        });
      }
      const parsed = domain.coerce(merged);
      const fbOutcome = await updatePageSource(config, page_id, parsed);
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
        warnings: mergedResult.warnings,
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
    "Edits a page by element id WITHOUT re-sending the whole source — the surgical-edit and fix-after-error path. Targets EITHER a live page (page_id) OR a cached failed-create source (draft_id, returned by a create_page that failed validation). Send only a list of per-element ops; the MCP loads the source, applies them, validates the WHOLE merged tree (blocks on errors), and saves (update for page_id; create for draft_id). Ops: {op:'update',id,type?,specials?,styles?:{desktop?,mobile?},config?:{desktop?,mobile?},events?,properties?} (shallow-merges; op defaults to 'update'; `type` fixes a wrong element type), {op:'replace',id,element}, {op:'remove',id}, {op:'add',parent_id,element}. Use this to fix the elements a failed create_page/update_page/add_section reported (e.g. a bad type → {op:'update',id,type:'button'}) instead of rebuilding the page. DEFAULTS to dry_run=true (loads + merges + validates + previews, no write); dry_run=false to save. Needs WEBCAKE_API_BASE + WEBCAKE_JWT (a draft_id patch only needs creds to actually create; a page_id patch reads the live page so needs creds even on dry_run).",
    {
      page_id: z.string().optional().describe("Edit a LIVE page by id (from create_page, list_pages, or find_pages; must be owned by the account). Provide page_id OR draft_id."),
      draft_id: z.string().optional().describe("Fix a CACHED source from a create_page that failed validation (the create_page error returns draft_id). The patched tree is created as a new page once valid. Provide page_id OR draft_id."),
      patches: z
        .any()
        .describe(
          "One op object or an array of them (object/array or JSON string). Each targets an element by id: {op:'update',id,type?,specials?,styles?:{desktop?,mobile?},config?:{desktop?,mobile?},events?,properties?} merges fields into the element (op may be omitted; set `type` to fix a wrong element type); {op:'replace',id,element} swaps the node; {op:'remove',id} deletes it; {op:'add',parent_id,element} appends a child to a container. `element` may be a SPARSE node (id/type/styles/specials/events only) — the server hydrates omitted boilerplate from factory defaults."
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
      if (ops.length === 0) {
        return text({ patched: false, reason: "no_patches", hint: "Pass an op object or a non-empty array of { op, id, … } ops." });
      }
      if (!page_id && !draft_id) {
        return text({ patched: false, reason: "no_target", hint: "Pass page_id (a live page) or draft_id (the cached source from a failed create_page)." });
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
            hint: "The cached draft is gone (expired after ~30 min or evicted). Re-send the full source via create_page.",
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

      // DRAFT path: the source came from a failed create_page. Keep the applied fixes
      // cached between rounds; once valid, CREATE the page (no page_id yet).
      if (draft_id && draft) {
        if (!result.valid) {
          updateDraft(draft_id, base); // persist the partial fixes for the next patch round
          return text({
            patched: false,
            reason: "validation_failed",
            errors: result.errors,
            warnings: result.warnings,
            patches_applied: applied,
            draft_id,
            hint: "Still invalid — fix the remaining errors with another patch_page({ draft_id, … }). Your applied fixes are kept in the draft.",
          });
        }
        const parsed = domain.coerce(expanded);
        if (isDry) {
          updateDraft(draft_id, base);
          return text({
            dry_run: true,
            draft_id,
            patches_applied: applied,
            validation: { valid: true, warnings: result.warnings, stats: result.stats },
            env_ready: missing.length === 0,
            missing_env: missing,
            request: config
              ? buildRequestRedacted(config, draft.name ?? "AI Page", parsed, draft.organization_id)
              : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable creation." },
            hint: "Draft is now valid. Re-run with dry_run=false to create the page from it.",
          });
        }
        if (!config) {
          updateDraft(draft_id, base); // keep the now-valid draft so a creds-ready retry can persist it
          return text({ patched: false, reason: "missing_env", missing_env: missing, hint: "Add WEBCAKE_API_BASE + WEBCAKE_JWT, then retry patch_page({ draft_id, dry_run:false })." });
        }
        const outcome = await createPage(config, draft.name ?? "AI Page", parsed, draft.organization_id);
        if (outcome.ok) deleteDraft(draft_id); // created — drop the draft
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
          warnings: result.warnings,
        });
      }

      // LIVE-PAGE path: edit an existing page (page_id) and update it in place.
      if (!result.valid) {
        return text({
          patched: false,
          reason: "validation_failed",
          errors: result.errors,
          warnings: result.warnings,
          patches_applied: applied,
          hint: "The edit produced an invalid tree — fix the listed errors in your ops, then retry.",
        });
      }
      const parsed = domain.coerce(expanded);

      if (isDry) {
        return text({
          dry_run: true,
          page_id,
          patches_applied: applied,
          validation: { valid: true, warnings: result.warnings, stats: result.stats },
          request: buildUpdateRequestRedacted(config!, page_id!, parsed),
          hint: "Re-run with dry_run=false to actually save the edit.",
        });
      }

      const outcome = await updatePageSource(config!, page_id!, parsed);
      return text({
        patched: outcome.ok,
        patches_applied: applied,
        page_id: outcome.page_id,
        editor_url: outcome.editor_url,
        preview_url: outcome.preview_url,
        status: outcome.status,
        error: outcome.error,
        warnings: result.warnings,
      });
    }
  );
}
