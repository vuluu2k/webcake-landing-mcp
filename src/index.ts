#!/usr/bin/env node
/**
 * Webcake Elements MCP server (stdio).
 *
 * Gives Claude the knowledge to build a complete Webcake landing-page source
 * JSON from a requirement: element catalog, per-element usage hints + specials,
 * the full page JSON Schema, valid element skeletons, and a page validator.
 *
 * Tools:
 *   - get_generation_guide : conventions, coordinate system, event vocab, workflow
 *   - list_elements        : catalog of all element types (by category)
 *   - get_element          : hints + key specials + default skeleton + example for one type
 *   - new_element          : a structurally-valid default node for a type (optionally renamed)
 *   - get_page_schema      : the full JSON Schema of a page source
 *   - validate_page        : structural + semantic validation of a generated page
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createElement, createPageSource } from "./factory.js";
import {
  LIBRARY,
  GENERATION_GUIDE,
  CANVAS,
  CLICK_ACTIONS,
  HOVER_ACTIONS,
  SUCCESS_ACTIONS,
  ERROR_ACTIONS,
  DELAY_ACTIONS,
  EVENT_TRIGGERS,
} from "./library.js";
import { validatePage, coercePage, pageSchema } from "./validate.js";
import {
  readConfig,
  buildRequestRedacted,
  createPage,
  listOrganizations,
  listPages,
  getPageSource,
  updatePageSource,
  buildUpdateRequestRedacted,
} from "./webcake.js";

const ALL_TYPES = Object.keys(LIBRARY);

function text(value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: body }] };
}

const INSTRUCTIONS = `webcake-landing builds and edits Webcake landing pages (the editor "page_source" JSON).

RULES (follow for every request):
- INTAKE FIRST: before generating a new page, ask the user 3–6 concrete questions (goal/page type, brand + tone + language, sections in order, primary CTA + destination, form fields, colors/logo URLs, desktop+mobile or mobile-only, which organization) and confirm a short outline. Do not assume.
- Never invent prices, phone numbers, addresses, or statistics — ask or leave a placeholder.
- ALWAYS call validate_page and fix every error before create_page / update_page.
- create_page and update_page DEFAULT to dry_run=true. Show the dry-run, then only send dry_run=false after the user confirms.
- EDIT existing pages surgically: get_page → change ONLY what was asked → keep every other element, its id, and coordinates → validate_page → update_page. Never regenerate the whole tree for a small change.
- Organizations: call list_organizations and ask which to use; default to the is_default org. Endpoints are owner-scoped (only the account's own pages).

MODEL (essentials):
- Top-level: { page:[sections], popup:[popups], settings:{}, options:{currency,mobileOnly,versionID}, cartConfigs:{} }. Popups are a SEPARATE top-level array, NOT inside page.
- Element: { id, type, properties, responsive:{desktop,mobile:{config,styles}}, specials, children, runtime, events }. Absolute canvas: children carry numeric top/left/width/height (px) per breakpoint (canvas width desktop=960, mobile=420); sections own a height.
- CENTERING (the #1 layout defect — do the math, don't eyeball): to center a box compute left = round((canvas - width)/2) — 960 desktop, 420 mobile. textAlign:center only centers text inside the box, not the box itself. For a row of N items, center the whole row block (startLeft = round((canvas - (N*item + (N-1)*gap))/2)). Keep 0 ≤ left and left+width ≤ canvas on each breakpoint.
- Visible content lives in specials (text, src, field_name…), never in styles. Colors as rgba(). Animation in config.animation={name,delay,duration,repeat}. Form inputs need a unique specials.field_name (use canonical keys: full_name, phone_number, email, address, quantity).
- IMAGES: include them (hero/product, feature icons, about photo). No image API yet → set image-block specials.src to a PLACEHOLDER sized to the box: https://placehold.co/<width>x<height> (gallery.media = array of these; video.specials.img = poster). NEVER leave src empty (renders blank). Ensure text contrasts with its section background.

Start by calling get_generation_guide. Tools: get_generation_guide, list_elements, get_element, new_element, new_page_skeleton, get_page_schema, validate_page, list_organizations, create_page, list_pages, get_page, update_page.`;

const server = new McpServer({ name: "webcake-landing", version: "1.0.0" }, { instructions: INSTRUCTIONS });

// 1) Generation guide ---------------------------------------------------------
server.tool(
  "get_generation_guide",
  "Read this FIRST. Conventions for building a Webcake page source: output shape, the absolute-positioning coordinate system, event vocabulary, and the recommended workflow.",
  async () =>
    text({
      guide: GENERATION_GUIDE,
      canvas: CANVAS,
      event_triggers: EVENT_TRIGGERS,
      click_actions: CLICK_ACTIONS,
      hover_actions: HOVER_ACTIONS,
      success_actions: SUCCESS_ACTIONS,
      error_actions: ERROR_ACTIONS,
      delay_actions: DELAY_ACTIONS,
    })
);

// 2) List elements ------------------------------------------------------------
server.tool(
  "list_elements",
  "List every supported element type, grouped by category, with a one-line summary and whether it is a container (can hold children).",
  async () => {
    const byCategory: Record<string, any[]> = {};
    for (const t of ALL_TYPES) {
      const d = LIBRARY[t];
      (byCategory[d.category] ||= []).push({
        type: d.type,
        container: d.container,
        summary: d.summary,
        useWhen: d.useWhen,
      });
    }
    return text({ total: ALL_TYPES.length, categories: byCategory });
  }
);

// 3) Get element --------------------------------------------------------------
server.tool(
  "get_element",
  "Get detailed usage for one element type: when to use it, its key `specials` fields, a default skeleton node, and (for common types) a filled example. Call before emitting an element of an unfamiliar type.",
  { type: z.string().describe("Element type, e.g. 'section', 'text-block', 'button', 'form', 'input', 'countdown'.") },
  async ({ type }) => {
    const doc = LIBRARY[type];
    if (!doc) {
      return text({
        error: `Unknown element type "${type}".`,
        valid_types: ALL_TYPES,
      });
    }
    return text({
      type: doc.type,
      category: doc.category,
      container: doc.container,
      summary: doc.summary,
      useWhen: doc.useWhen,
      keySpecials: doc.keySpecials,
      skeleton: createElement(type),
      example: doc.example ?? null,
    });
  }
);

// 4) New element --------------------------------------------------------------
server.tool(
  "new_element",
  "Return a structurally-valid default element node for a type (correct properties/responsive/specials/sizes), with a fresh id. Fill in specials + top/left coordinates afterwards.",
  {
    type: z.string().describe("Element type to create."),
    name: z.string().optional().describe("Optional properties.name override (layer label)."),
  },
  async ({ type, name }) => {
    if (!LIBRARY[type]) {
      return text({ error: `Unknown element type "${type}".`, valid_types: ALL_TYPES });
    }
    return text(createElement(type, name ? { name } : {}));
  }
);

// 5) Page schema --------------------------------------------------------------
server.tool(
  "get_page_schema",
  "Return the full JSON Schema (Draft 2020-12) of a Webcake page source object { page: [...], settings: {...} }. Use it to understand the exact structure or for your own validation.",
  async () => text(pageSchema)
);

// 6) Validate page ------------------------------------------------------------
server.tool(
  "validate_page",
  "Validate a generated page source against the schema + semantic rules (unique ids, dangling event targets, children only on containers, missing field_name, top-level types) plus form-data bindings (duplicate field_name within one form, dangling option-event promoId / connectedSurvey / connectedForm / set_field_value targets). Returns errors (must fix) and warnings. ALWAYS run before returning the final page.",
  {
    page: z
      .any()
      .describe("The page source object { page:[...], settings:{} } OR a JSON string of it."),
  },
  async ({ page }) => {
    const result = validatePage(page);
    return text(result);
  }
);

// 7) New page skeleton --------------------------------------------------------
server.tool(
  "new_page_skeleton",
  "Return an empty but complete top-level page source { page:[], popup:[], settings:{...defaults}, options:{...}, cartConfigs:{} } matching the real editor shape. Fill `page` with sections (and `popup` with popups), then validate_page and create_page.",
  { mobileOnly: z.boolean().optional().describe("true if the page renders mobile-only.") },
  async ({ mobileOnly }) => text(createPageSource({ mobileOnly: mobileOnly ?? false }))
);

// 8) List organizations ------------------------------------------------------
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

// 9) Create page (persist) ----------------------------------------------------
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

    const result = validatePage(source);
    if (!result.valid) {
      return text({
        created: false,
        reason: "validation_failed",
        errors: result.errors,
        warnings: result.warnings,
        hint: "Fix the errors (run validate_page) before creating.",
      });
    }
    const parsed = coercePage(source);
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

// 10) List pages --------------------------------------------------------------
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

// 11) Get page (read source) --------------------------------------------------
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

// 12) Update page (edit existing) ---------------------------------------------
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
    const result = validatePage(source);
    if (!result.valid) {
      return text({
        updated: false,
        reason: "validation_failed",
        errors: result.errors,
        warnings: result.warnings,
        hint: "Fix the errors (run validate_page) before updating.",
      });
    }
    const parsed = coercePage(source);
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

async function main() {
  // Subcommand dispatch: `webcake-landing-mcp install|uninstall` runs the
  // bundled IDE installer instead of starting the MCP server. Default (no
  // subcommand) starts the stdio server as usual.
  const sub = process.argv[2];
  if (sub === "install" || sub === "uninstall" || sub === "--help" || sub === "-h") {
    const { runInstaller } = await import("./install.js");
    const rest =
      sub === "uninstall"
        ? ["--uninstall", ...process.argv.slice(3)]
        : sub === "--help" || sub === "-h"
          ? ["--help"]
          : process.argv.slice(3);
    await runInstaller(rest);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP channel.
  console.error("[webcake-elements] MCP server ready on stdio.");
}

main().catch((err) => {
  console.error("[webcake-elements] fatal:", err);
  process.exit(1);
});
