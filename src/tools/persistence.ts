/**
 * Persistence tools (need WEBCAKE_API_BASE + WEBCAKE_JWT): list organizations,
 * create a page, list/read existing pages, and update a page. Mutating tools
 * default to dry_run=true and return a JWT-redacted request preview; they only
 * hit the network when dry_run===false. Validation uses the injected Domain;
 * the HTTP calls go through the Webcake client.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { text } from "../mcp/response.js";
import { readConfig } from "../persistence/config.js";
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
  // 8) List organizations -----------------------------------------------------
  server.tool(
    "list_organizations",
    "List the account's Webcake organizations (id, name, is_default). The default org (type===1, usually the personal workspace) is where pages normally go. Call this BEFORE create_page, show the options to the user and ask which org to use — defaulting to the is_default one. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    {},
    async () => {
      const { config, missing } = readConfig();
      if (!config) {
        return text({
          ok: false,
          reason: "missing_env",
          missing_env: missing,
          hint: "Configure WEBCAKE_API_BASE and WEBCAKE_JWT in the MCP server env.",
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
    async ({ source, name, organization_id, dry_run }) => {
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
      const { config, missing } = readConfig();

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
                  "Set WEBCAKE_API_BASE + WEBCAKE_JWT to enable real creation. Would POST to {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source.",
              },
          hint: "Re-run with dry_run=false to actually create the page.",
        });
      }

      if (!config) {
        return text({
          created: false,
          reason: "missing_env",
          missing_env: missing,
          hint: "Configure WEBCAKE_API_BASE and WEBCAKE_JWT in the MCP server env, then retry.",
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
    async () => {
      const { config, missing } = readConfig();
      if (!config) return text({ ok: false, reason: "missing_env", missing_env: missing });
      return text(await listPages(config));
    }
  );

  // 11) Get page (read source) ------------------------------------------------
  server.tool(
    "get_page",
    "Fetch an existing page's decoded source tree { page, popup, settings, options, cartConfigs } so you can EDIT it. Returns name + organization_id too. Edit the returned `source`, then validate_page and update_page. Needs WEBCAKE_API_BASE + WEBCAKE_JWT.",
    { page_id: z.string().describe("The page id (from list_pages or a URL).") },
    async ({ page_id }) => {
      const { config, missing } = readConfig();
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
    async ({ page_id, source, dry_run }) => {
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
      const { config, missing } = readConfig();

      if (isDry) {
        return text({
          dry_run: true,
          page_id,
          validation: { valid: true, warnings: result.warnings, stats: result.stats },
          env_ready: missing.length === 0,
          missing_env: missing,
          request: config
            ? buildUpdateRequestRedacted(config, page_id, parsed)
            : { note: "Set WEBCAKE_API_BASE + WEBCAKE_JWT to enable real updates." },
          hint: "Re-run with dry_run=false to actually save the edit.",
        });
      }
      if (!config) return text({ updated: false, reason: "missing_env", missing_env: missing });

      const outcome = await updatePageSource(config, page_id, parsed);
      return text({ updated: outcome.ok, ...outcome, warnings: result.warnings });
    }
  );
}
