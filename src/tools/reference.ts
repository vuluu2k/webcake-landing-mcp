/**
 * Reference tools (no env needed): the read-only knowledge surface — the
 * generation guide, the element catalog, per-element detail, and the full JSON
 * Schema. All driven by the injected Domain, so they work for any domain.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { text } from "../mcp/response.js";

export function registerReferenceTools(server: McpServer, domain: Domain) {
  // 1) Generation guide -------------------------------------------------------
  server.tool(
    "get_generation_guide",
    "Returns the page-building conventions reference: output shape, the absolute-positioning coordinate system, event vocabulary, and the recommended workflow.",
    { title: "Get Generation Guide", readOnlyHint: true, openWorldHint: false },
    async () => text(domain.guide)
  );

  // 2) List elements ----------------------------------------------------------
  server.tool(
    "list_elements",
    "List every supported element type, grouped by category, with a one-line summary and whether it is a container (can hold children).",
    { title: "List Element Types", readOnlyHint: true, openWorldHint: false },
    async () => {
      const byCategory: Record<string, any[]> = {};
      for (const t of domain.elementTypes) {
        const d = domain.catalog[t];
        (byCategory[d.category] ||= []).push({
          type: d.type,
          container: d.container,
          summary: d.summary,
          useWhen: d.useWhen,
        });
      }
      return text({ total: domain.elementTypes.length, categories: byCategory });
    }
  );

  // 3) Get element ------------------------------------------------------------
  server.tool(
    "get_element",
    "Returns detailed usage for one element type: when to use it, its key `specials` fields, a default skeleton node, and (for common types) a filled example.",
    { type: z.string().describe("Element type, e.g. 'section', 'text-block', 'button', 'form', 'input', 'countdown'.") },
    { title: "Get Element Details", readOnlyHint: true, openWorldHint: false },
    async ({ type }) => {
      const doc = domain.catalog[type];
      if (!doc) {
        return text({
          error: `Unknown element type "${type}".`,
          valid_types: domain.elementTypes,
        });
      }
      return text({
        type: doc.type,
        category: doc.category,
        container: doc.container,
        summary: doc.summary,
        useWhen: doc.useWhen,
        keySpecials: doc.keySpecials,
        skeleton: domain.createElement(type),
        example: doc.example ?? null,
      });
    }
  );

  // 4) Page schema ------------------------------------------------------------
  server.tool(
    "get_page_schema",
    "Returns the full JSON Schema (Draft 2020-12) of a Webcake page source object { page: [...], settings: {...} } for structural reference and validation.",
    { title: "Get Page JSON Schema", readOnlyHint: true, openWorldHint: false },
    async () => text(domain.schema)
  );
}
