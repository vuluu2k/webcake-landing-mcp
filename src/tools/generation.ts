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
    "Return a structurally-valid default element node for a type (correct properties/responsive/specials/sizes), with a fresh id. Fill in specials + top/left coordinates afterwards.",
    {
      type: z.string().describe("Element type to create."),
      name: z.string().optional().describe("Optional properties.name override (layer label)."),
    },
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
    "Return an empty but complete top-level page source { page:[], popup:[], settings:{...defaults}, options:{...}, cartConfigs:{} } matching the real editor shape. Fill `page` with sections (and `popup` with popups), then validate_page and create_page.",
    { mobileOnly: z.boolean().optional().describe("true if the page renders mobile-only.") },
    async ({ mobileOnly }) => text(domain.createPageSource({ mobileOnly: mobileOnly ?? false }))
  );

  // 7) Validate page ----------------------------------------------------------
  server.tool(
    "validate_page",
    "Validate a generated page source against the schema + semantic rules (unique ids, dangling event targets, children only on containers, missing field_name, top-level types) plus form-data bindings (duplicate field_name within one form, dangling option-event promoId / connectedSurvey / connectedForm / set_field_value targets). Returns errors (must fix) and warnings. ALWAYS run before returning the final page.",
    {
      page: z
        .any()
        .describe("The page source object { page:[...], settings:{} } OR a JSON string of it."),
    },
    async ({ page }) => {
      const result = domain.validate(page);
      return text(result);
    }
  );
}
