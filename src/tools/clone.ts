/**
 * clone_page: measure ANY page in a real browser (desktop + mobile width) and rebuild it as a landing
 * page source (persistence/ingest/browser-capture.ts → canvasToSource). The source is saved like a
 * write (expand → repair + layout autofix → validate) and parked as a draft, so the model saves it
 * with create_page({ draft_id }) instead of re-sending hundreds of nodes.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { text } from "../mcp/response.js";
import { captureLayout } from "../persistence/ingest/browser-capture.js";
import { putDraft } from "../persistence/draft-cache.js";

export function registerCloneTools(server: McpServer, domain: Domain) {
  server.tool(
    "clone_page",
    "Clones any web page into a Webcake landing page by MEASURING it in a real browser (headless Chrome via Playwright, JavaScript executed — works for React/Vue/Next sites too). The page is loaded at 1200 px and at 420 px; every visible text, image, button, painted box, divider, svg icon and form is recorded with its box, rotation and typography and placed on the landing canvas: desktop boxes scaled onto 960, mobile boxes as measured on 420 (elements the mobile layout hides get config.hide on mobile; mobile-only ones are hidden on desktop). Links become open_link events; fixed elements are pinned. The source is validated like a save and cached: the result carries `draft_id` — save it with create_page({ draft_id, dry_run:false }). Approximations: overflow clipping and CSS animations are not reproduced, svg icons are single-colour masks, iframes become html-box embeds. Needs Playwright on the host (playwright-core + Chrome, or CHROME_BIN). No credentials, no writes.",
    {
      url: z.string().optional().describe("Public http(s) URL of the page to clone."),
      html: z.string().optional().describe("Raw HTML instead of a URL (relative assets will not load)."),
      name: z.string().optional().describe("Page name used when the draft is saved with create_page."),
    },
    { title: "Clone Page (browser)", readOnlyHint: true, openWorldHint: true },
    async ({ url, html, name }) => {
      if (!url === !html) return text({ ok: false, error: "pass exactly one of url or html" });
      let canvas: any;
      try {
        canvas = await captureLayout(url ? { url } : { html: html! });
      } catch (e: any) {
        const error = String(e?.message ?? e);
        return text({ ok: false, error, ...(/playwright|chrom/i.test(error) ? { hint: "No browser on this host: use ingest_url (static HTML) or ask for a screenshot." } : {}) });
      }
      const { source, notes } = domain.canvasToSource!(canvas, { title: canvas.title, description: canvas.description });
      const expanded = domain.expand(source);
      const autoFixed = domain.autofixLayout?.(expanded) ?? [];
      const result = domain.validate(expanded);
      const draft_id = await putDraft({ source: expanded, name: name ?? canvas.title ?? "Cloned page" });
      return text({
        ok: true,
        draft_id,
        valid: result.valid,
        ...(result.valid ? {} : { errors: result.errors.slice(0, 20) }),
        warnings: result.warnings.length,
        auto_fixed: autoFixed.length,
        summary: {
          title: canvas.title,
          elements: canvas.element_count,
          sections: canvas.sections.map((s: any) => ({ id: s.id, height: s.height, mobile_height: s.mobile?.height, elements: s.elements.length })),
          ...(canvas.truncated ? { truncated: true, hint: canvas.hint } : {}),
        },
        clone_notes: notes,
        next: result.valid
          ? "create_page({ draft_id, dry_run:false }) saves it (images are re-hosted on save); then render_preview to compare with the original."
          : "patch_page({ draft_id, patches }) fixes the listed errors and creates the page.",
      });
    }
  );
}
