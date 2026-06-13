/**
 * HTML → compact or full reference AST.
 *
 * Used by the `ingest_html` and `ingest_url` tools so a model can use an existing
 * page (HTML string or URL) as a LAYOUT REFERENCE when building a Webcake page,
 * without having to read the full HTML token-by-token. The AST groups the page
 * into sections classified by role (hero/features/form/cta/footer/…) and
 * extracts headings, ctas, images, form fields, and brand hints (colors + fonts
 * from inline styles AND stylesheet blocks). The full text is NOT preserved — the
 * model is meant to use this as an anchor and generate fresh content for the user's brand.
 *
 * detail:'compact' (default) — backward-compatible ~2-5 KB shape.
 * detail:'full'   — richer AST: palette, background_images, gradients, blocks per
 *                   section, extended paragraphs + images-as-objects + li lists.
 */
import { parse } from "node-html-parser";
import type { IngestedAst, ParseHtmlOptions, FetchHtmlResult } from "./ingest/types.js";
import { extractStyleBlocks, extractGoogleFonts, extractGradients, fixMojibake } from "./ingest/stylesheets.js";
import { extractTailwindConfig } from "./ingest/tailwind.js";
import { findSections, classifySection, computeSizeHint, detectWidgets, brandHints } from "./ingest/semantic.js";
import { parseAbsoluteCanvas, canvasRoleSections, stripCdnSizePrefix } from "./ingest/canvas.js";

// Re-export the public surface so existing imports of "./persistence/html-ingest.js"
// (parseHtml, fetchHtml, and the IngestedAst/IngestedCanvas/CanvasElement/CanvasSection
// types) keep resolving unchanged.
export * from "./ingest/types.js";
export * from "./ingest/stylesheets.js";
export * from "./ingest/tailwind.js";
export * from "./ingest/semantic.js";
export * from "./ingest/canvas.js";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000; // 2MB
const FULL_SIZE_CAP = 25_000; // ~25 KB serialized cap for full mode

// ─── main parse entry point ──────────────────────────────────────────────────

export function parseHtml(html: string, detail: "compact" | "full" = "compact", opts: ParseHtmlOptions = {}): IngestedAst {
  if (!html || typeof html !== "string" || html.trim().length === 0) {
    return { sections: [], warnings: ["empty input"] };
  }

  const warnings: string[] = [];
  const repaired = fixMojibake(html);
  if (repaired) {
    html = repaired;
    warnings.push("text encoding repaired (UTF-8 bytes were mis-decoded as Latin-1 mojibake)");
  }

  // Stylesheet extraction (fast, regex-level, done on raw HTML before DOM parse).
  const styleBlocks = extractStyleBlocks(html);
  const googleFonts = extractGoogleFonts(html);
  const tw = extractTailwindConfig(html);

  const root = parse(html, { lowerCaseTagName: true });

  const head = root.querySelector("head");
  const title = head?.querySelector("title")?.text?.trim() || undefined;
  const description = head?.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || undefined;
  const og_image = head?.querySelector('meta[property="og:image"]')?.getAttribute("content") || undefined;
  const language = root.querySelector("html")?.getAttribute("lang") || undefined;

  const body = root.querySelector("body") ?? root;
  if (!body) return { title, description, og_image, language, sections: [], warnings: ["no <body>"] };

  // Absolute-canvas builders (LadiPage-family exports / Webcake-published pages):
  // the body is bare positioned divs — ALL layout lives in per-id stylesheet
  // rules — so role classification sees nothing useful, but the geometry is
  // machine-readable, and the source canvas widths (mobile 420 / desktop 960)
  // match the Webcake canvas. Return a `canvas` payload that transfers 1:1.
  const canvas = parseAbsoluteCanvas(html, root, styleBlocks, opts.sections);
  if (canvas) {
    const hints = brandHints(body, styleBlocks, googleFonts, tw);
    const bg = [...new Set(hints.background_images.map(stripCdnSizePrefix))];
    return {
      title,
      description,
      og_image,
      language,
      sections: canvasRoleSections(canvas),
      canvas,
      colors: hints.colors.length ? hints.colors : undefined,
      fonts: hints.fonts.length ? hints.fonts : undefined,
      palette: hints.palette,
      design_tokens: hints.design_tokens,
      background_images: bg.length ? bg : undefined,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  // CSR heuristic — empty body usually means React/Vue/Next that hasn't rendered.
  const bodyText = body.textContent.trim();
  if (bodyText.length < 50) {
    return {
      title,
      description,
      og_image,
      language,
      sections: [],
      warnings: [
        "page appears client-rendered (<body> is essentially empty); ask the user for a screenshot — Claude can analyze it natively without this tool",
      ],
    };
  }

  const sectionEls = findSections(body);
  const sections = sectionEls.map((el) => {
    const sec = classifySection(el, detail);
    sec.size_hint = computeSizeHint(el, sec, styleBlocks);
    if (detail === "full") {
      const widgets = detectWidgets(el, styleBlocks);
      if (widgets.length) sec.widgets = widgets;
    }
    return sec;
  });

  // Brand hints from stylesheets + inline styles + Tailwind config (both modes).
  const hints = brandHints(body, styleBlocks, googleFonts, tw);

  const base: IngestedAst = {
    title,
    description,
    og_image,
    language,
    sections,
    colors: hints.colors.length ? hints.colors : undefined,
    fonts: hints.fonts.length ? hints.fonts : undefined,
    palette: hints.palette,
    design_tokens: hints.design_tokens,
    background_images: hints.background_images.length ? hints.background_images : undefined,
    warnings: warnings.length ? warnings : undefined,
  };

  if (detail !== "full") return base;

  // Full mode extras.
  const gradients = extractGradients(styleBlocks);

  const result: IngestedAst = {
    ...base,
    gradients: gradients.length ? gradients : undefined,
  };

  // Size-cap shedding order: blocks[].body → widgets[].css → lists → widgets
  // (widget html goes last — it's the clone-fidelity payload of full mode).
  if (JSON.stringify(result).length > FULL_SIZE_CAP) {
    for (const sec of result.sections) {
      if (sec.blocks) for (const blk of sec.blocks) delete blk.body;
    }
    if (JSON.stringify(result).length > FULL_SIZE_CAP) {
      for (const sec of result.sections) {
        if (sec.widgets) for (const w of sec.widgets) delete w.css;
      }
    }
    if (JSON.stringify(result).length > FULL_SIZE_CAP) {
      for (const sec of result.sections) {
        if (sec.lists && sec.lists.length > 5) sec.lists = sec.lists.slice(0, 5);
      }
      result.truncated = true;
    }
    if (JSON.stringify(result).length > FULL_SIZE_CAP) {
      for (const sec of result.sections) delete sec.widgets;
      result.truncated = true;
    }
  }

  return result;
}

// ─── fetch ───────────────────────────────────────────────────────────────────

export async function fetchHtml(
  url: string,
  opts: { timeoutMs?: number; userAgent?: string } = {}
): Promise<FetchHtmlResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "URL must start with http:// or https://" };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": opts.userAgent ?? "Mozilla/5.0 (compatible; webcake-landing-mcp/ingest_url)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, status: res.status, error: `Server returned ${res.status}` };
    const ctype = res.headers.get("content-type") ?? "";
    if (!/html|xml|text/i.test(ctype)) {
      return { ok: false, status: res.status, error: `Content-Type ${ctype} is not HTML` };
    }
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, status: res.status, error: "no response body" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: res.status, error: `Response exceeded ${MAX_HTML_BYTES} bytes` };
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { ok: true, status: res.status, html: buf.toString("utf-8") };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "Request timed out" : e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}
