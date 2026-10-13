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
import { parseHtml, fetchHtml, fetchStylesheets, applyCloneFonts } from "../persistence/html-ingest.js";

const sectionsParam = z
  .array(z.string())
  .optional()
  .describe(
    "Absolute-canvas mode only: return only these canvas section ids (from a previous result's canvas_summary.sections[].id; 'SECTION_POPUP' selects the popups). A full-page result marked canvas_summary.truncated:true has its styles pruned to fit the size cap; per-section results carry each section's `source` untrimmed, and `source.page[0]` is a single section node."
  );

const detailParam = z
  .enum(["compact", "full"])
  .optional()
  .describe(
    "Level of detail in the returned AST. 'compact' (default, ~2–5 KB): sections, top colors and fonts. 'full': adds the CSS custom-property palette (design tokens by name), background_images from stylesheets, gradients, per-section blocks (repeating card/tile/step structures with title/body/image/cta), li lists, extended paragraphs, images as { src, alt }, and per-section widgets = { hint, html, css? } — the cleaned source HTML + matching CSS of composite visuals (device mockup, chat thread, dashboard, browser frame). Both levels lift the design system from a `tailwind.config` block when present (Google Stitch / Tailwind-CDN pages): `palette` named by token (e.g. primary → #a43b38), `colors` ranked by usage, and `design_tokens` with the resolved spacing grid, corner radii and type scale (e.g. display-lg → 48px). Image URLs in the result (images, background_images, og_image) belong to the source page. Absolute-canvas builder exports return the deterministic `source` at either level."
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
  const fonts = applyCloneFonts(source, parsed.font_groups ?? []);
  if (fonts.length) notes.push(`custom fonts ${fonts.join(", ")} → settings.fontGroups; their files are uploaded to the media collection on save`);
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
    "Parses an HTML string into a reference AST for rebuilding the page in Webcake: title, description, og_image, language, and sections classified by role (header, hero, features, about, form, cta, gallery, testimonials, pricing, faq, footer, unknown), each with headings, paragraphs, images, CTAs, links, form fields and a size_hint (desktop section height in px — from CSS when explicit, else estimated). Also returns top colors, fonts, palette and background_images; for Tailwind-CDN pages (e.g. Google Stitch) the palette and `design_tokens` (spacing grid, corner radii, type scale) come from the page's tailwind.config. detail:'compact' (default, ~2–5 KB) or 'full' (up to ~25 KB: per-section blocks such as cards and steps, lists, gradients, images as { src, alt }, and `widgets` — the cleaned HTML + CSS of composite visuals such as device mockups). Fonts: `font_groups` lists self-hosted fonts from @font-face rules in the settings.fontGroups shape; `typography` and per-section `text_styles` give the computed font size (desktop and mobile), weight, family, line height and letter spacing. Absolute-canvas builder exports (LadiPage-family or Webcake-published HTML) are detected and converted deterministically into a complete Webcake page `source`, with `clone_notes` listing approximations and `canvas_summary` summarizing per-section geometry; external images in that source are re-hosted automatically when it is saved. Garbled Vietnamese text (UTF-8 read as Latin-1) is repaired, with a warning. No credentials, no writes.",
    {
      html: z.string().describe("Raw HTML of a page or a section."),
      intent: z
        .enum(["adapt", "clone"])
        .optional()
        .describe("How the result will be used. 'adapt' (default): the reference provides layout and imagery while the text is rewritten for the user's brand. 'clone': text and images stay close to the original. Absolute-canvas exports return a clone `source` either way."),
      detail: detailParam,
      sections: sectionsParam,
      base_url: z
        .string()
        .optional()
        .describe("The page's original URL, when the HTML was saved or copied from a live site. Resolves relative font and image URLs and fetches the page's external stylesheets (+ @imports), so self-hosted fonts (`font_groups`) and computed type (`typography` / `text_styles`) defined outside the HTML are included."),
    },
    { title: "Ingest HTML Reference", readOnlyHint: true, openWorldHint: true },
    async ({ html, intent, detail, sections, base_url }) => {
      const baseUrl = base_url && /^https?:\/\//i.test(base_url) ? base_url : undefined;
      const extraCss = baseUrl ? await fetchStylesheets(html, baseUrl) : undefined;
      return text({ intent: intent ?? "adapt", ...withCloneSource(domain, parseHtml(html, detail ?? "compact", { sections, baseUrl, extraCss })) });
    }
  );

  server.tool(
    "ingest_url",
    "Fetches a public webpage (GET, 10 s timeout, 2 MB cap) together with its external stylesheets and @imports, and parses it into the same reference AST as ingest_html: role-classified sections with size_hint heights, palette, design tokens, self-hosted fonts (`font_groups`), computed typography, images, and — with detail:'full' — per-section blocks, lists and widgets. Absolute-canvas builder exports (LadiPage-family or Webcake-published pages) are detected and converted deterministically into a complete Webcake page `source` with `clone_notes` and `canvas_summary`. JavaScript is not executed, so client-rendered sites (React/Vue/Next.js) may return little content; the result then carries a warning that the body was empty. Fetches are restricted to public hosts (private and link-local addresses are blocked). No credentials, no writes. Docs: https://github.com/vuluu2k/webcake-landing-mcp/blob/main/docs/tools.md",
    {
      url: z.string().describe("Public HTTP(S) URL of the page to fetch."),
      intent: z
        .enum(["adapt", "clone"])
        .optional()
        .describe("How the result will be used. 'adapt' (default): the reference provides layout and imagery while the text is rewritten for the user's brand. 'clone': text and images stay close to the original. Absolute-canvas exports return a clone `source` either way."),
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
      const extraCss = await fetchStylesheets(fetched.html!, url);
      return text({
        ok: true,
        url,
        status: fetched.status,
        intent: intent ?? "adapt",
        ...withCloneSource(domain, parseHtml(fetched.html!, detail ?? "compact", { sections, baseUrl: url, extraCss })),
      });
    }
  );
}
