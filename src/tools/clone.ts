/**
 * clone_page: measure ANY page in a real browser (desktop + mobile width) and rebuild it as a landing
 * page source (persistence/ingest/browser-capture.ts → canvasToSource). The source is saved like a
 * write (expand → repair + layout autofix → validate) and parked as a draft, so the model saves it
 * with create_page({ draft_id }) instead of re-sending hundreds of nodes. ingest_html / ingest_url
 * with intent:'clone' take the same path (cloneToDraft) when a browser is available.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { text } from "../mcp/response.js";
import { captureLayout } from "../persistence/ingest/browser-capture.js";
import { putDraft } from "../persistence/draft-cache.js";
import { parseHtml, fetchHtml, fetchStylesheets, applyCloneFonts } from "../persistence/html-ingest.js";

type Target = { url?: string; html?: string; baseUrl?: string };

/** Self-hosted fonts (@font-face in the page + its stylesheets) in the settings.fontGroups shape, via the
 *  static ingest parser; their files are re-hosted on save. Best effort: a failure only skips fonts. */
async function fontGroupsOf(target: Target) {
  try {
    const html = target.html ?? (await fetchHtml(target.url!)).html;
    if (!html) return [];
    const base = target.url ?? target.baseUrl;
    const extraCss = base ? await fetchStylesheets(html, base) : undefined;
    return parseHtml(html, "compact", { baseUrl: base, extraCss }).font_groups ?? [];
  } catch {
    return [];
  }
}

/** A browser-less host (no Playwright / Chrome): the caller falls back to the static AST. */
export const isNoBrowserError = (error: string) => /playwright|chrom|executable|browser/i.test(error);

/** Measure → convert → validate → cache as a draft. Throws when the page cannot be measured. */
export async function cloneToDraft(domain: Domain, target: Target, name?: string) {
  const canvas: any = await captureLayout(target);
  const { source, notes } = domain.canvasToSource!(canvas, { title: canvas.title, description: canvas.description });
  const fonts = applyCloneFonts(source, await fontGroupsOf(target));
  if (fonts.length) notes.push(`self-hosted fonts ${fonts.join(", ")} → settings.fontGroups (files re-hosted on save)`);
  const expanded = domain.expand(source);
  const autoFixed = domain.autofixLayout?.(expanded) ?? [];
  const result = domain.validate(expanded);
  const draft_id = await putDraft({ source: expanded, name: name ?? canvas.title ?? "Cloned page" });
  return {
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
  };
}

export function registerCloneTools(server: McpServer, domain: Domain) {
  server.tool(
    "clone_page",
    "Clones any web page into a Webcake landing page by MEASURING it in a real browser (headless Chrome via Playwright, JavaScript executed — works for React/Vue/Next sites too). The page is loaded at 1200 px and at 420 px; every visible text, image, button, painted box, divider, svg icon and form is recorded with its box, rotation and typography and placed on the landing canvas: desktop boxes scaled onto 960, mobile boxes as measured on 420 (elements the mobile layout hides get config.hide on mobile; mobile-only ones are hidden on desktop). Links become open_link events; fixed elements are pinned; a sticky header becomes the section's native sticky (a-t). Effects, native first: gradients (also gradient text), filters/backdrop blur, rotation and AOS / animate.css / WOW entrance animations map onto native settings; an overflow:hidden box whose content spills out becomes a clipping group (custom_css overflow:hidden); the page's own :hover rules (also ancestor rules like .card:hover img, applied on the element itself) + transitions and its looping CSS animations (@keyframes) become settings.extra_css scoped to #w-<id> (the one thing no native setting covers); icon-font stylesheets go to settings.bhet; self-hosted @font-face fonts to settings.fontGroups. Forms keep every control as its native field (select with options, radio, checkbox-group, textarea, date, file), also forms without a <form> tag. Interactive parts stay interactive, natively: accordions / FAQs (<details>, Bootstrap collapse, aria-expanded panels) become a click→collapse on the question that collapses the answer on load; tab sets ([role=tabpanel], .tab-pane) become a carousel switched by its tab buttons (change_tab); modals hidden on load (.modal, <dialog>, [role=dialog], .popup…) become landing popups, and the buttons/links that open them get open_popup; #anchor links get scroll_to; sliders (Swiper, Slick, Splide, Owl, Bootstrap carousel, Glide, Flickity, Keen, Embla) become a carousel of slides (hidden slides measured too, library clones skipped); YouTube / Vimeo / <video> become the video element. Multi-colour svgs (logos, illustrations, gradients) become images of themselves; single-colour icons stay native svg masks. The source is validated like a save and cached: the result carries `draft_id` — save it with create_page({ draft_id, dry_run:false }). Robust to real sites: app shells that scroll inside a full-height box are unlocked, reveal-on-scroll content is scrolled into its shown state, a tall <main> is split into its sections, overlapping (angled) sections keep their stacking, content clipped by overflow:hidden is cropped (images keep a crop), measured text heights are kept (config.virtualHeight), every colour is rgba(), and desktop/mobile elements are matched by DOM path, else by their text / picture. Approximations: an ancestor :hover fires when the element itself is hovered, other iframes become html-box embeds, content a site renders differently on each load may shift. Needs Playwright on the host (playwright-core + Chrome, or CHROME_BIN). No credentials, no writes.",
    {
      url: z.string().optional().describe("Public http(s) URL of the page to clone."),
      html: z.string().optional().describe("Raw HTML instead of a URL (a saved page / an exported file). Pass base_url so its relative images, stylesheets and fonts load."),
      base_url: z.string().optional().describe("With html: the page's original URL — relative assets (images, CSS, fonts) resolve against it, as if the page were loaded from there."),
      name: z.string().optional().describe("Page name used when the draft is saved with create_page."),
    },
    { title: "Clone Page (browser)", readOnlyHint: true, openWorldHint: true },
    async ({ url, html, base_url, name }) => {
      if (!url === !html) return text({ ok: false, error: "pass exactly one of url or html" });
      try {
        return text(await cloneToDraft(domain, url ? { url } : { html: html!, baseUrl: base_url }, name));
      } catch (e: any) {
        const error = String(e?.message ?? e);
        return text({ ok: false, error, ...(isNoBrowserError(error) ? { hint: "No browser on this host: use ingest_url (static HTML) or ask for a screenshot." } : {}) });
      }
    }
  );
}
