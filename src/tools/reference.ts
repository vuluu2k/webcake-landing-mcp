/**
 * Reference tools (no env needed): the read-only knowledge surface — the
 * generation guide, the element catalog, per-element detail, and the full JSON
 * Schema. All driven by the injected Domain, so they work for any domain.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { sparseTemplate } from "../core/compact.js";
import { text } from "../mcp/response.js";

const SPARSE_NOTE =
  "Skeletons and examples are in the SPARSE authoring shape — emit elements exactly like this (id, type, BOTH breakpoints' styles, specials, real events). OMIT properties/runtime/empty events+children/config: the server hydrates them from factory defaults on validate/persist.";

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
    "Returns usage details for one element type, or for several via `types: [...]`: a summary, when it applies, key `specials` fields, a sparse skeleton node (the server fills omitted boilerplate), and for common types a filled example. `types` returns { elements: { [type]: details } }; `type` returns a single doc.",
    {
      type: z.string().optional().describe("Single element type."),
      types: z
        .array(z.string())
        .optional()
        .describe("Several element types fetched in one call, e.g. ['section','text-block','button','form','input']."),
    },
    { title: "Get Element Details", readOnlyHint: true, openWorldHint: false },
    async ({ type, types }) => {
      const list: string[] = types && types.length ? types : type ? [type] : [];
      if (list.length === 0) {
        return text({ error: "Pass `type` (single) or `types` (non-empty array).", valid_types: domain.elementTypes });
      }
      const elements: Record<string, any> = {};
      const unknown: string[] = [];
      for (const t of list) {
        const doc = domain.catalog[t];
        if (!doc) {
          unknown.push(t);
          continue;
        }
        elements[t] = {
          type: doc.type,
          category: doc.category,
          container: doc.container,
          summary: doc.summary,
          useWhen: doc.useWhen,
          keySpecials: doc.keySpecials,
          skeleton: sparseTemplate(domain.createElement(t)),
          example: doc.example ?? null,
        };
      }
      // Single-`type` mode → return the doc directly (no map wrap), matches the old shape.
      if (!types && type) {
        if (unknown.length) return text({ error: `Unknown element type "${unknown[0]}".`, valid_types: domain.elementTypes });
        return text({ ...elements[type], authoring: SPARSE_NOTE });
      }
      return text({
        authoring: SPARSE_NOTE,
        elements,
        unknown: unknown.length ? unknown : undefined,
        valid_types: unknown.length ? domain.elementTypes : undefined,
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
