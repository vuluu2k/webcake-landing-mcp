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
  createPage,
  listOrganizations,
  listPages,
  getPageSource,
  updatePageSource,
} from "../persistence/webcake-client.js";

export function registerPersistenceTools(server: McpServer, domain: Domain) {
  // Resolve config from THIS request's headers (remote per-user JWT) first, then env.
  const cfgFor = (extra: any) => readConfig(configFromHeaders(extra?.requestInfo?.headers));

  // 8) List organizations -----------------------------------------------------
  server.tool(
    "list_organizations",
    "List the account's Webcake organizations (id, name, is_default). The default org (type===1, usually the personal workspace) is where pages normally go. Call this BEFORE create_page, show the options to the user and ask which org to use — defaulting to the is_default one. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {},
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
    "Persist a generated page source to the configured Webcake backend: creates a NEW page and saves the source (source-only — opens in the editor where re-saving renders it). Validates first. DEFAULTS to dry_run=true (returns the HTTP request it WOULD send, token masked). Set dry_run=false to actually create — that needs WEBCAKE_API_BASE + WEBCAKE_JWT env vars. The page lands in `organization_id` if given (call list_organizations and ask the user; default to the is_default org). Without an org the page is personal (org=null).",
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
    async ({ source, name, organization_id, dry_run }, extra) => {
      const pageName = name ?? "AI Page";
      const isDry = dry_run !== false; // default true (safe)
      const orgId = organization_id != null ? `${organization_id}` : undefined;

      const result = domain.validate(source);
      if (!result.valid) {
        return text({
          created: false,
          reason: "validation_failed",
          errors: result.errors,
          warnings: result.warnings,
          hint: "Fix the errors (run validate_page) before creating.",
        });
      }
      const parsed = domain.coerce(source);
      const { config, missing } = cfgFor(extra);

      if (isDry) {
        return text({
          dry_run: true,
          validation: { valid: true, warnings: result.warnings, stats: result.stats },
          env_ready: missing.length === 0,
          missing_env: missing,
          target_organization_id: orgId ?? config?.orgId ?? null,
          request: config
            ? buildRequestRedacted(config, pageName, parsed, orgId)
            : {
                note:
                  "Set WEBCAKE_API_BASE + WEBCAKE_JWT (env) or send the x-webcake-jwt header to enable real creation. Would POST to {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source.",
              },
          hint: "Re-run with dry_run=false to actually create the page.",
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
    "List the pages owned by the account (id, name, organization_id, updated_at), most-recent first. Use it to let the user pick a page to edit (then get_page → modify → update_page). Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {},
    async (_args, extra) => {
      const { config, missing } = cfgFor(extra);
      if (!config) return text({ ok: false, reason: "missing_env", missing_env: missing });
      return text(await listPages(config));
    }
  );

  // 11) Get page (read source) ------------------------------------------------
  server.tool(
    "get_page",
    "Fetch an existing page's decoded source tree { page, popup, settings, options, cartConfigs } so you can EDIT it. Returns name + organization_id too. Edit the returned `source`, then validate_page and update_page. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    { page_id: z.string().describe("The page id (from list_pages or a URL).") },
    async ({ page_id }, extra) => {
      const { config, missing } = cfgFor(extra);
      if (!config) return text({ ok: false, reason: "missing_env", missing_env: missing });
      return text(await getPageSource(config, page_id));
    }
  );

  // 12) Update page (edit existing) -------------------------------------------
  server.tool(
    "update_page",
    "Overwrite an EXISTING page's source with an edited tree (source-only; re-render in the editor for preview/publish). Validates first. DEFAULTS to dry_run=true (preview the request, token masked). Set dry_run=false to actually save. Typical flow: get_page → edit the source → validate_page → update_page. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {
      page_id: z.string().describe("The page id to update (must be owned by the account)."),
      source: z
        .any()
        .describe("The full edited page source { page, popup, settings, options, cartConfigs } (object or JSON string)."),
      dry_run: z.boolean().optional().describe("Default TRUE — preview without sending. Set false to actually save."),
    },
    async ({ page_id, source, dry_run }, extra) => {
      const isDry = dry_run !== false;
      const result = domain.validate(source);
      if (!result.valid) {
        return text({
          updated: false,
          reason: "validation_failed",
          errors: result.errors,
          warnings: result.warnings,
          hint: "Fix the errors (run validate_page) before updating.",
        });
      }
      const parsed = domain.coerce(source);
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
  // add_section keeps each call small: the model sends only the new section(s);
  // the server fetches the page's current source, appends, validates the WHOLE
  // tree, and saves. Build a large page as: create_page(small skeleton) → repeat
  // add_section per section. The big merge lives server↔backend, never in a tool
  // argument the model has to stream.
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
    "Append one or more SECTIONS to an existing page WITHOUT re-sending the whole source — the way to build a large page incrementally and avoid the giant single create_page payload that can drop the connection. Flow: create_page with a small/empty skeleton → call add_section once per section. The server fetches the page's current source, appends your section(s) to the END of `page`, validates the WHOLE merged tree (errors block), then saves. You send ONLY the new section(s), so each call stays small. DEFAULTS to dry_run=true (reads the page + previews the save; does NOT write). Set dry_run=false to actually append. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
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
        .describe("Default TRUE — read the page and preview the merged save without writing. Set false to actually append."),
    },
    async ({ page_id, sections, dry_run }, extra) => {
      const isDry = dry_run !== false; // default true (safe)
      const newSections = asSections(sections).filter((s) => s != null);
      if (newSections.length === 0) {
        return text({ added: false, reason: "no_sections", hint: "Pass a section object or a non-empty array of sections." });
      }

      const { config, missing } = cfgFor(extra);
      if (!config) {
        // add_section always operates on a LIVE page, so it needs creds even to
        // preview (it reads the page to validate the merge).
        return text({
          added: false,
          reason: "missing_env",
          missing_env: missing,
          hint: "Configure WEBCAKE_API_BASE and WEBCAKE_JWT (env), or send the x-webcake-jwt header (remote), then retry.",
        });
      }

      // Fetch the page's current source so we append rather than overwrite.
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
      const labels = newSections.map(sectionLabel);

      // Validate the WHOLE merged tree — catches id collisions with existing
      // sections, missing field_names, container rules, etc. Errors block.
      const result = domain.validate(merged);
      if (!result.valid) {
        return text({
          added: false,
          reason: "validation_failed",
          errors: result.errors,
          warnings: result.warnings,
          page_section_count: counts,
          hint: "Fix the section(s) — duplicate ids vs existing sections are a common cause — then retry.",
        });
      }
      const parsed = domain.coerce(merged);

      if (isDry) {
        return text({
          dry_run: true,
          page_id,
          sections_added: newSections.length,
          section_labels: labels,
          page_section_count: counts,
          validation: { valid: true, warnings: result.warnings, stats: result.stats },
          request: buildUpdateRequestRedacted(config, page_id, parsed),
          hint: "Re-run with dry_run=false to actually append the section(s).",
        });
      }

      const outcome = await updatePageSource(config, page_id, parsed);
      return text({
        added: outcome.ok,
        sections_added: newSections.length,
        section_labels: labels,
        page_section_count: counts,
        ...outcome,
        warnings: result.warnings,
      });
    }
  );
}
