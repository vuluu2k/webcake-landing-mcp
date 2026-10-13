/**
 * Generation tools (no env needed): build a default element node, build the
 * top-level page-source shell, and validate an assembled source. All driven by
 * the injected Domain.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { sparseTemplate } from "../core/compact.js";
import { text, warningsField, autoFixedField } from "../mcp/response.js";
import { objectOrJson } from "../mcp/params.js";

export function registerGenerationTools(server: McpServer, domain: Domain) {
  // 5) New element ------------------------------------------------------------
  server.tool(
    "new_element",
    "Returns a default element node for a type in the sparse authoring shape: a fresh id, seeded styles for both breakpoints, and seeded specials. properties, runtime, empty events and per-breakpoint config are omitted because the server fills them from factory defaults on validate and save.",
    {
      type: z.string().describe("Element type to create."),
      name: z.string().optional().describe("Optional properties.name override (layer label)."),
    },
    { title: "New Element Node", readOnlyHint: true, openWorldHint: false },
    async ({ type, name }) => {
      if (!domain.catalog[type]) {
        return text({ error: `Unknown element type "${type}".`, valid_types: domain.elementTypes });
      }
      const el = sparseTemplate(domain.createElement(type));
      if (name) el.properties = { name };
      return text(el);
    }
  );

  // 6) New page skeleton ------------------------------------------------------
  server.tool(
    "new_page_skeleton",
    "Returns an empty, complete top-level page source { page:[], popup:[], settings, options, cartConfigs } in the Webcake editor's shape. desktopWidth (960 or 1200) and mobileWidth (420 or 360) set settings.width_section, the canvas width that all element coordinates are measured in.",
    {
      mobileOnly: z.boolean().optional().describe("true if the page renders mobile-only."),
      desktopWidth: z.union([z.literal(960), z.literal(1200)]).optional().describe("Desktop canvas width (settings.width_section.desktop). 960 (default, simple/narrow) or 1200 (wide/multi-column/editorial, or cloning a >960 reference)."),
      mobileWidth: z.union([z.literal(420), z.literal(360)]).optional().describe("Mobile canvas width (settings.width_section.mobile). 420 (default) or 360 (to match a ~360–390 mobile design)."),
    },
    { title: "New Page Skeleton", readOnlyHint: true, openWorldHint: false },
    async ({ mobileOnly, desktopWidth, mobileWidth }) =>
      text(
        domain.createPageSource({
          mobileOnly: mobileOnly ?? false,
          settings:
            desktopWidth || mobileWidth
              ? { width_section: { desktop: desktopWidth ?? 960, mobile: mobileWidth ?? 420 } }
              : undefined,
        })
      )
  );

  // 7) Validate page ----------------------------------------------------------
  server.tool(
    "validate_page",
    "Validates a page source against the JSON schema and semantic rules: unique ids, dangling event targets, children only on container types, missing field_name, top-level types, and form-data bindings (duplicate field_name within one form; dangling promoId / connectedSurvey / connectedForm / set_field_value targets). Before validating it applies deterministic layout corrections (off-canvas boxes moved on-canvas, elements below wrapped text moved down) and lists them in auto_fixed. Returns errors (structural problems that block saving) and warnings (visible layout defects such as overlapping text, off-canvas bounds, or empty bands).",
    {
      page: objectOrJson()
        .describe("The page source object { page:[...], settings:{} } OR a JSON string of it."),
    },
    { title: "Validate Page Source", readOnlyHint: true, openWorldHint: false },
    async ({ page }) => {
      // Hydrate sparse nodes (the model may omit boilerplate) before validating,
      // so what we check is the same full tree that create_page/add_section persist.
      const expanded = domain.expand(page);
      // Apply the same deterministic layout auto-fix create_page/add_section run,
      // so validate reflects (and reports) the tree that would actually be saved.
      const autoFixed = domain.autofixLayout?.(expanded) ?? [];
      const result = domain.validate(expanded);
      return text({ ...result, ...autoFixedField(autoFixed), ...warningsField(result.warnings) });
    }
  );

  // 7b) Layout coordinates -----------------------------------------------------
  server.tool(
    "layout",
    "Computes on-canvas coordinates (top/left/width/height) for a group of elements on both breakpoints. Modes: 'center' (one box centered on the canvas), 'row' (N boxes in a centered horizontal row on desktop, stacked into one column on mobile), 'grid' (N uniform cells in `cols` columns, stacked on mobile), 'stack' (a vertical list down the content column). Respects the page margins (content column 80–880 on desktop and 20–400 on mobile by default). Returns one box per item in input order, plus `notes` for off-canvas or over-wide inputs. Pure computation: no credentials, no network.",
    {
      mode: z.enum(["center", "row", "grid", "stack"]).describe("Layout pattern. center=one box; row=horizontal row (stacks on mobile); grid=cols×rows (stacks on mobile); stack=vertical list."),
      items: z
        .array(z.object({ width: z.number(), height: z.number() }))
        .optional()
        .describe("Explicit per-item sizes in order (row/stack may vary sizes). Provide this OR count+itemWidth+itemHeight."),
      count: z.number().int().positive().optional().describe("Uniform shortcut: number of identical boxes (use with itemWidth/itemHeight)."),
      itemWidth: z.number().optional().describe("Uniform item width (with count)."),
      itemHeight: z.number().optional().describe("Uniform item height (with count)."),
      gap: z.number().optional().describe("Horizontal gap between row/grid items (px). Default 24."),
      rowGap: z.number().optional().describe("Vertical gap between grid rows / stacked items (px). Default = gap."),
      cols: z.number().int().positive().optional().describe("Grid columns. Default min(itemCount, 3)."),
      top: z.number().optional().describe("Desktop start y inside the section (px). Default 0."),
      mobileTop: z.number().optional().describe("Mobile start y (px). Default = top."),
      canvasDesktop: z.number().optional().describe("Desktop canvas width. Default 960 (use 1200 for wide pages)."),
      canvasMobile: z.number().optional().describe("Mobile canvas width. Default 420 (use 360 to match a narrow design)."),
      marginDesktop: z.number().optional().describe("Desktop page margin / content inset. Default 80."),
      marginMobile: z.number().optional().describe("Mobile page margin / content inset. Default 20."),
      align: z.enum(["center", "left", "right"]).optional().describe("Horizontal alignment of the block within the canvas. Default center."),
      mobileItemWidth: z.number().optional().describe("Stacked-mobile item width (row/grid). Default = mobile content width."),
    },
    { title: "Compute Layout Coordinates", readOnlyHint: true, openWorldHint: false },
    async (opts) => {
      if (!domain.computeLayout) {
        return text({ error: "This domain does not provide layout coordinates." });
      }
      if (!opts.items?.length && !(opts.count && (opts.itemWidth != null || opts.itemHeight != null))) {
        return text({
          error: "Provide either `items` (an array of {width,height}) or `count` + `itemWidth` + `itemHeight`.",
        });
      }
      return text(domain.computeLayout(opts));
    }
  );
}
