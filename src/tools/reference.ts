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
    "Read this FIRST. Conventions for building a Webcake page source: output shape, the absolute-positioning coordinate system, event vocabulary, and the recommended workflow.",
    async () => text(domain.guide)
  );

  // 2) List elements ----------------------------------------------------------
  server.tool(
    "list_elements",
    "List every supported element type, grouped by category, with a one-line summary and whether it is a container (can hold children).",
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
    "Get detailed usage for one element type: when to use it, its key `specials` fields, a default skeleton node, and (for common types) a filled example. Call before emitting an element of an unfamiliar type.",
    { type: z.string().describe("Element type, e.g. 'section', 'text-block', 'button', 'form', 'input', 'countdown'.") },
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
    "Return the full JSON Schema (Draft 2020-12) of a Webcake page source object { page: [...], settings: {...} }. Use it to understand the exact structure or for your own validation.",
    async () => text(domain.schema)
  );
}
