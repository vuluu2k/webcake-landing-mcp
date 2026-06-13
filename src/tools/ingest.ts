/**
 * Ingest tools: turn an existing page (HTML string or URL) into a compact or
 * full reference AST the model uses as a LAYOUT REFERENCE when generating a
 * Webcake page. The caller maps the AST's sections (hero/features/form/cta/footer…)
 * to Webcake elements and generates fresh content for the user's brand —
 * intent='clone' keeps the original text/assets closer when explicitly asked.
 *
 * detail:'compact' (default) — backward-compatible ~2-5 KB AST.
 * detail:'full'   — richer AST: CSS palette, background_images, gradients,
 *                   per-section blocks (cards/tiles/steps), lists, extended
 *                   paragraphs, images as { src, alt } objects. Use for
 *                   clone-faithful rebuilds. Image URLs found in the result
 *                   (images, background_images, og_image) are the user's
 *                   assets: re-host them via the upload_images tool and reuse
 *                   them for BOTH intents — adapt rewrites text, not imagery.
 *
 * ABSOLUTE-CANVAS shortcut: when the page is a builder export laid out on a
 * fixed canvas (LadiPage-family / Webcake-published HTML), the same fixed
 * canvas Webcake uses, the domain's `canvasToSource` converts the parsed
 * geometry straight into a ready-to-save `source` (folded into the response as
 * `source` + `clone_notes`) — a deterministic 1:1 clone, no hand-rebuild. The
 * heavy per-element `canvas` is then summarized to `canvas_summary`.
 *
 * Image references need no tool: when the user attaches a screenshot, Claude
 * analyzes it natively (multimodal). The server's INSTRUCTIONS string already
 * tells the model how to translate an image into the same role taxonomy.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import type { IngestedAst, IngestedCanvas } from "../persistence/html-ingest.js";
import { text } from "../mcp/response.js";
import { parseHtml, fetchHtml } from "../persistence/html-ingest.js";

const sectionsParam = z
  .array(z.string())
  .optional()
  .describe(
    "Absolute-canvas mode only: return ONLY these canvas section ids (use the ids from a previous call's canvas_summary.sections[].id; 'SECTION_POPUP' selects the popups). When a full-page call comes back canvas_summary.truncated:true (styles pruned to fit the size cap), re-call per section to get each section's `source` in FULL untrimmed detail — pairs naturally with building the page incrementally via add_section (pass that call's source.page[0] to add_section)."
  );

const detailParam = z
  .enum(["compact", "full"])
  .optional()
  .describe(
    "Level of detail in the returned AST. 'compact' (default) — backward-compatible ~2-5 KB shape with top colors/fonts from inline styles. 'full' — richer AST: CSS custom-property palette (design tokens by name), background_images from stylesheets, gradients, per-section blocks (repeating card/tile/step structures with title/body/image/cta), li lists, extended paragraphs, images as { src, alt } objects, and per-section widgets = { hint, html, css? } — the cleaned source HTML + matching CSS of composite visuals (phone/device mockup, chat thread, dashboard, browser frame) to rebuild VERBATIM as ONE html-box (inline the css; don't re-imagine the markup). Use 'full' for clone-faithful rebuilds. Image URLs found in the result (images, background_images, og_image) are the user's assets: re-host them via upload_images and reuse them in the generated page for BOTH intents (never hotlink, never replace them with search_images stock photos). NOTE: for absolute-canvas builder exports the deterministic `source` is returned regardless of detail."
  );

/** Folded into the response when a clone `source` is produced from an absolute-canvas export. */
const CLONE_NOTICE =
  "ABSOLUTE-CANVAS DETECTED → a deterministic clone `source` is included. It is a faithful 1:1 rebuild of the original page (exact boxes/styles/images/behaviors on the matching 420/960 canvas), NOT a layout reference — do NOT hand-rebuild from canvas_summary. SAVE IT DIRECTLY: call create_page with this `source` (dry_run:true first to validate + preview; then dry_run:false). External images in it are AUTO-HOSTED to the Webcake CDN on save — do NOT pre-run upload_images for them. Review `clone_notes` for the few lossy approximations (fixed/floating elements, svg-less shapes, skipped social-proof toasts) and patch_page them after the page exists. If a `sections` filter was used, this `source` holds only those sections — pass source.page[0] to add_section instead.";

/** Slim the heavy per-element canvas to a navigable summary (the `source` supersedes it). */
function summarizeCanvas(canvas: IngestedCanvas) {
  return {
    builder: canvas.builder,
    width: canvas.width,
    ...(canvas.mobile_only ? { mobile_only: true } : {}),
    element_count: canvas.element_count,
    ...(canvas.truncated ? { truncated: true, hint: canvas.hint } : {}),
    sections: canvas.sections.map((s) => ({ id: s.id, height: s.height, elements: s.elements.length })),
    popups: canvas.popups?.length ?? 0,
  };
}

/**
 * When the parse produced an absolute-canvas `canvas` and the domain can convert
 * it, fold a ready-to-save `source` (+ clone_notes + notice) into the response and
 * replace the heavy per-element canvas with a summary. Otherwise return as-is.
 */
function withCloneSource(domain: Domain, parsed: IngestedAst): Record<string, unknown> {
  if (!parsed.canvas || !domain.canvasToSource) return parsed as unknown as Record<string, unknown>;
  const { source, notes } = domain.canvasToSource(parsed.canvas, { title: parsed.title });
  const { canvas, ...rest } = parsed;
  return {
    ...rest,
    canvas_summary: summarizeCanvas(canvas),
    source,
    clone_notes: notes,
    clone_notice: CLONE_NOTICE,
  };
}

export function registerIngestTools(server: McpServer, domain: Domain) {
  server.tool(
    "ingest_html",
    "Parses an HTML string into a reference AST: title, description, og_image, language, and sections classified by role (header, hero, features, about, form, cta, gallery, testimonials, pricing, faq, footer, unknown) with headings, subheadings, paragraphs, images, ctas, links, form fields, and a size_hint (desktop section height in px — from the source CSS when explicit, else a content-volume estimate; set the rebuilt section's desktop height from it) — plus top colors, fonts, CSS custom-property palette, and background_images pulled from both inline styles and <style> blocks. Returns ~2-5KB (compact) or up to ~25KB (full). Use detail:'full' for clone-faithful rebuilds — it adds per-section blocks (cards/tiles/steps), li lists, gradients, images as { src, alt } objects, and widgets (the source HTML + CSS of composite mockups, to paste into ONE html-box). ABSOLUTE-CANVAS builder exports (LadiPage-family pages / Webcake-published HTML — bare positioned divs whose layout lives in per-id CSS rules) are AUTO-DETECTED and converted DETERMINISTICALLY into a ready-to-save Webcake `source` (folded into the response as `source` + `clone_notes` + `clone_notice`): a faithful 1:1 clone on the matching 420/960 canvas — save it straight to create_page instead of hand-rebuilding. The heavy per-element geometry is summarized to `canvas_summary` { builder, width, mobile_only, element_count, sections:[{id,height,elements}], popups }. External images in `source` are auto-hosted on save (no upload_images needed); `clone_notes` lists the few lossy approximations to patch_page afterward. Garbled Vietnamese mojibake (UTF-8 mis-read as Latin-1) is auto-repaired with a warning.",
    {
      html: z.string().describe("Raw HTML of a page or a section."),
      intent: z
        .enum(["adapt", "clone"])
        .optional()
        .describe("How the caller intends to use the result. 'adapt' (default) — use as a layout reference and rewrite the TEXT for the user's brand (images from the reference are still re-hosted via upload_images and reused). 'clone' — keep text and images close to the original. For absolute-canvas exports the deterministic `source` is a clone either way."),
      detail: detailParam,
      sections: sectionsParam,
    },
    { title: "Ingest HTML Reference", readOnlyHint: true, openWorldHint: false },
    async ({ html, intent, detail, sections }) =>
      text({ intent: intent ?? "adapt", ...withCloneSource(domain, parseHtml(html, detail ?? "compact", { sections })) })
  );

  server.tool(
    "ingest_url",
    "Fetches a public webpage (GET, 10s timeout, 2MB cap) and parses it into the same reference AST as ingest_html (including per-section size_hint desktop heights). Returns a warning when the page appears client-rendered (empty <body>) so the caller can fall back to a screenshot — Claude can analyze a screenshot natively without this tool. Does not execute JavaScript; sites built with React/Vue/Next.js may return little content. Use detail:'full' for clone-faithful rebuilds — adds CSS palette, background_images, per-section blocks, lists, images as { src, alt } objects, and widgets (source HTML + CSS of composite mockups for html-box rebuilds). ABSOLUTE-CANVAS builder exports (LadiPage-family / Webcake-published pages) are auto-detected the same way as ingest_html and converted DETERMINISTICALLY into a ready-to-save `source` (+ `clone_notes` + `clone_notice`, with the per-element geometry summarized to `canvas_summary`) — save it straight to create_page; external images auto-host on save. Image URLs in the result are the user's assets — re-host them via upload_images and reuse them for BOTH intents; use search_images only for slots with no source image.",
    {
      url: z.string().describe("Public HTTP(S) URL of the page to fetch."),
      intent: z
        .enum(["adapt", "clone"])
        .optional()
        .describe("How the caller intends to use the result. 'adapt' (default) — use as a layout reference and rewrite the TEXT for the user's brand (images from the reference are still re-hosted via upload_images and reused). 'clone' — keep text and images close to the original. For absolute-canvas exports the deterministic `source` is a clone either way."),
      detail: detailParam,
      sections: sectionsParam,
    },
    { title: "Ingest URL Reference", readOnlyHint: true, openWorldHint: true },
    async ({ url, intent, detail, sections }) => {
      const fetched = await fetchHtml(url);
      if (!fetched.ok) {
        return text({
          ok: false,
          url,
          status: fetched.status,
          error: fetched.error,
          hint: "If the page is client-rendered, ask the user for a screenshot — Claude can analyze it natively.",
        });
      }
      return text({
        ok: true,
        url,
        status: fetched.status,
        intent: intent ?? "adapt",
        ...withCloneSource(domain, parseHtml(fetched.html!, detail ?? "compact", { sections })),
      });
    }
  );
}
