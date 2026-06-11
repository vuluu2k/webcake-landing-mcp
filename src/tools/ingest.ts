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
 * Image references need no tool: when the user attaches a screenshot, Claude
 * analyzes it natively (multimodal). The server's INSTRUCTIONS string already
 * tells the model how to translate an image into the same role taxonomy.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text } from "../mcp/response.js";
import { parseHtml, fetchHtml } from "../persistence/html-ingest.js";

const detailParam = z
  .enum(["compact", "full"])
  .optional()
  .describe(
    "Level of detail in the returned AST. 'compact' (default) — backward-compatible ~2-5 KB shape with top colors/fonts from inline styles. 'full' — richer AST: CSS custom-property palette (design tokens by name), background_images from stylesheets, gradients, per-section blocks (repeating card/tile/step structures with title/body/image/cta), li lists, extended paragraphs, images as { src, alt } objects, and per-section widgets = { hint, html, css? } — the cleaned source HTML + matching CSS of composite visuals (phone/device mockup, chat thread, dashboard, browser frame) to rebuild VERBATIM as ONE html-box (inline the css; don't re-imagine the markup). Use 'full' for clone-faithful rebuilds. Image URLs found in the result (images, background_images, og_image) are the user's assets: re-host them via upload_images and reuse them in the generated page for BOTH intents (never hotlink, never replace them with search_images stock photos)."
  );

export function registerIngestTools(server: McpServer) {
  server.tool(
    "ingest_html",
    "Parses an HTML string into a reference AST: title, description, og_image, language, and sections classified by role (header, hero, features, about, form, cta, gallery, testimonials, pricing, faq, footer, unknown) with headings, subheadings, paragraphs, images, ctas, links, form fields, and a size_hint (desktop section height in px — from the source CSS when explicit, else a content-volume estimate; set the rebuilt section's desktop height from it) — plus top colors, fonts, CSS custom-property palette, and background_images pulled from both inline styles and <style> blocks. Returns ~2-5KB (compact) or up to ~25KB (full). Use detail:'full' for clone-faithful rebuilds — it adds per-section blocks (cards/tiles/steps), li lists, gradients, images as { src, alt } objects, and widgets (the source HTML + CSS of composite mockups, to paste into ONE html-box). Image URLs in the result (images, background_images, og_image) are the user's assets — re-host them via upload_images and reuse them for BOTH intents; use search_images only for slots with no source image.",
    {
      html: z.string().describe("Raw HTML of a page or a section."),
      intent: z
        .enum(["adapt", "clone"])
        .optional()
        .describe("How the caller intends to use the result. 'adapt' (default) — use as a layout reference and rewrite the TEXT for the user's brand (images from the reference are still re-hosted via upload_images and reused). 'clone' — keep text and images close to the original."),
      detail: detailParam,
    },
    { title: "Ingest HTML Reference", readOnlyHint: true, openWorldHint: false },
    async ({ html, intent, detail }) =>
      text({ intent: intent ?? "adapt", ...parseHtml(html, detail ?? "compact") })
  );

  server.tool(
    "ingest_url",
    "Fetches a public webpage (GET, 10s timeout, 2MB cap) and parses it into the same reference AST as ingest_html (including per-section size_hint desktop heights). Returns a warning when the page appears client-rendered (empty <body>) so the caller can fall back to a screenshot — Claude can analyze a screenshot natively without this tool. Does not execute JavaScript; sites built with React/Vue/Next.js may return little content. Use detail:'full' for clone-faithful rebuilds — adds CSS palette, background_images, per-section blocks, lists, images as { src, alt } objects, and widgets (source HTML + CSS of composite mockups for html-box rebuilds). Image URLs in the result are the user's assets — re-host them via upload_images and reuse them for BOTH intents; use search_images only for slots with no source image.",
    {
      url: z.string().describe("Public HTTP(S) URL of the page to fetch."),
      intent: z
        .enum(["adapt", "clone"])
        .optional()
        .describe("How the caller intends to use the result. 'adapt' (default) — use as a layout reference and rewrite the TEXT for the user's brand (images from the reference are still re-hosted via upload_images and reused). 'clone' — keep text and images close to the original."),
      detail: detailParam,
    },
    { title: "Ingest URL Reference", readOnlyHint: true, openWorldHint: true },
    async ({ url, intent, detail }) => {
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
        ...parseHtml(fetched.html!, detail ?? "compact"),
      });
    }
  );
}
