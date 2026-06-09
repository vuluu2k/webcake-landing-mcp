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
  getPageSource,
  updatePageSource,
  appendSection,
} from "../persistence/webcake-client.js";

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
        .describe("Full page source { page, popup, settings, options, cartConfigs } (object or JSON string)."),
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
        return text({
          created: false,
          reason: "validation_failed",
          errors: result.errors,
          warnings: result.warnings,
          hint: "Fix the errors (run validate_page) before creating.",
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

  // 11) Get page (read source) ------------------------------------------------
  server.tool(
    "get_page",
    "Fetches an existing page's decoded source tree { page, popup, settings, options, cartConfigs } plus name and organization_id. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    { page_id: z.string().describe("The page id (from list_pages or a URL).") },
    { title: "Get Webcake Page Source", readOnlyHint: true, openWorldHint: true },
    async ({ page_id }, extra) => {
      const { config, missing } = cfgFor(extra);
      if (!config) return text({ ok: false, reason: "missing_env", missing_env: missing });
      return text(await getPageSource(config, page_id));
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
        .describe("The full edited page source { page, popup, settings, options, cartConfigs } (object or JSON string)."),
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
          "One section node, or an array of section nodes, to append to the END of `page` (object/array or JSON string). Each is a normal section element { id, type:'section', responsive, children, … } with a UNIQUE id; they stack vertically after the existing sections."
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
}
