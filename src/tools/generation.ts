/**
 * Generation tools (no env needed): build a default element node, build the
 * top-level page-source shell, and validate an assembled source. All driven by
 * the injected Domain.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { text } from "../mcp/response.js";

export function registerGenerationTools(server: McpServer, domain: Domain) {
  // 5) New element ------------------------------------------------------------
  server.tool(
    "new_element",
    "Returns a structurally-valid default element node for a type (correct properties/responsive/specials/sizes), with a fresh id. The caller fills in specials + top/left coordinates.",
    {
      type: z.string().describe("Element type to create."),
      name: z.string().optional().describe("Optional properties.name override (layer label)."),
    },
    { title: "New Element Node", readOnlyHint: true, openWorldHint: false },
    async ({ type, name }) => {
      if (!domain.catalog[type]) {
        return text({ error: `Unknown element type "${type}".`, valid_types: domain.elementTypes });
      }
      return text(domain.createElement(type, name ? { name } : {}));
    }
  );

  // 6) New page skeleton ------------------------------------------------------
  server.tool(
    "new_page_skeleton",
    "Returns an empty but complete top-level page source { page:[], popup:[], settings:{...defaults}, options:{...}, cartConfigs:{} } matching the real editor shape.",
    { mobileOnly: z.boolean().optional().describe("true if the page renders mobile-only.") },
    { title: "New Page Skeleton", readOnlyHint: true, openWorldHint: false },
    async ({ mobileOnly }) => text(domain.createPageSource({ mobileOnly: mobileOnly ?? false }))
  );

  // 7) Validate page ----------------------------------------------------------
  server.tool(
    "validate_page",
    "Validates a page source against the schema + semantic rules (unique ids, dangling event targets, children only on containers, missing field_name, top-level types) plus form-data bindings (duplicate field_name within one form, dangling option-event promoId / connectedSurvey / connectedForm / set_field_value targets). Returns errors (blocking) and warnings (advisory).",
    {
      page: z
        .any()
        .describe("The page source object { page:[...], settings:{} } OR a JSON string of it."),
    },
    { title: "Validate Page Source", readOnlyHint: true, openWorldHint: false },
    async ({ page }) => {
      // Hydrate sparse nodes (the model may omit boilerplate) before validating,
      // so what we check is the same full tree that create_page/add_section persist.
      const result = domain.validate(domain.expand(page));
      return text(result);
    }
  );
}
