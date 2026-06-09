/**
 * Ingest tools: turn an existing page (HTML string or URL) into a compact AST
 * the model uses as a LAYOUT REFERENCE when generating a Webcake page. The
 * caller is expected to map the AST's sections (hero/features/form/cta/footer…)
 * to Webcake elements and generate fresh content for the user's brand —
 * intent='clone' keeps the original text/assets closer when explicitly asked.
 *
 * Image references need no tool: when the user attaches a screenshot, Claude
 * analyzes it natively (multimodal). The server's INSTRUCTIONS string already
 * tells the model how to translate an image into the same role taxonomy.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text } from "../mcp/response.js";
import { parseHtml, fetchHtml } from "../persistence/html-ingest.js";

export function registerIngestTools(server: McpServer) {
  server.tool(
    "ingest_html",
    "Parses an HTML string into a compact reference AST: title, description, og_image, language, and an array of sections classified by role (header, hero, features, about, form, cta, gallery, testimonials, pricing, faq, footer, unknown) with headings, subheadings, paragraphs, images, ctas, links, form fields — plus top colors and fonts pulled from inline styles. Returns ~2-5KB so the model uses it as a layout anchor instead of reading the full HTML token-by-token. Full original text is not preserved; the model is expected to write fresh content for the user's brand (intent='clone' keeps closer to the original when explicitly asked).",
    {
      html: z.string().describe("Raw HTML of a page or a section."),
      intent: z
        .enum(["adapt", "clone"])
        .optional()
        .describe("How the caller intends to use the result. 'adapt' (default) — use as a layout reference and rewrite content for the user's brand. 'clone' — keep text and images close to the original."),
    },
    { title: "Ingest HTML Reference", readOnlyHint: true, openWorldHint: false },
    async ({ html, intent }) => text({ intent: intent ?? "adapt", ...parseHtml(html) })
  );

  server.tool(
    "ingest_url",
    "Fetches a public webpage (GET, 10s timeout, 2MB cap) and parses it into the same compact reference AST as ingest_html. Returns a warning when the page appears client-rendered (empty <body>) so the caller can fall back to a screenshot — Claude can analyze a screenshot natively without this tool. Does not execute JavaScript; sites built with React/Vue/Next.js may return little content.",
    {
      url: z.string().describe("Public HTTP(S) URL of the page to fetch."),
      intent: z
        .enum(["adapt", "clone"])
        .optional()
        .describe("How the caller intends to use the result. 'adapt' (default) — use as a layout reference and rewrite content for the user's brand. 'clone' — keep text and images close to the original."),
    },
    { title: "Ingest URL Reference", readOnlyHint: true, openWorldHint: true },
    async ({ url, intent }) => {
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
      return text({ ok: true, url, status: fetched.status, intent: intent ?? "adapt", ...parseHtml(fetched.html!) });
    }
  );
}
