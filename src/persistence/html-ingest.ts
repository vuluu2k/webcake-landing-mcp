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
import type { HTMLElement } from "node-html-parser";
import type { IngestedAst, ParseHtmlOptions, FetchHtmlResult } from "./ingest/types.js";
import { extractStyleBlocks, extractGoogleFonts, extractGradients, fixMojibake } from "./ingest/stylesheets.js";
import { extractTailwindConfig } from "./ingest/tailwind.js";
import { findSections, classifySection, computeSizeHint, detectWidgets, detectHoverEffects, brandHints, pickHeading } from "./ingest/semantic.js";
import { parseAbsoluteCanvas, canvasRoleSections, stripCdnSizePrefix } from "./ingest/canvas.js";
import { extractFontFaces, toFontGroups, extractTypography, parseCssRules, makeTypeResolver, resolveCssVars, rootFontPx, stripComments } from "./ingest/fonts.js";
import { isAllowedScreenshotUrl } from "./screenshot-playwright.js";

// Re-export the public surface so existing imports of "./persistence/html-ingest.js"
// (parseHtml, fetchHtml, and the IngestedAst/IngestedCanvas/CanvasElement/CanvasSection
// types) keep resolving unchanged.
export * from "./ingest/types.js";
export * from "./ingest/stylesheets.js";
export * from "./ingest/tailwind.js";
export * from "./ingest/semantic.js";
export * from "./ingest/canvas.js";
export * from "./ingest/fonts.js";

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
  const cssSources = orderedCss(html, opts.baseUrl, opts.extraCss ?? []);
  const fontGroups = toFontGroups(extractFontFaces(cssSources));
  const cssRules = resolveCssVars(cssSources.flatMap((c) => parseCssRules(c.css)));
  const remPx = rootFontPx(cssRules);
  const typography = extractTypography(cssRules, remPx);
  const fontFields = { ...(fontGroups.length ? { font_groups: fontGroups } : {}), ...(typography ? { typography } : {}) };

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
      ...fontFields,
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

  // Computed type per text role, so a hand-rebuild copies exact sizes/weights.
  const resolveType = makeTypeResolver(cssRules, tw ?? undefined, remPx);
  const textStyles = (el: HTMLElement) => {
    const heading = resolveType(pickHeading(el));
    const bodyText = resolveType(el.querySelector("p") ?? undefined);
    const cta = resolveType(el.querySelector("button") ?? el.querySelector('a[class*="btn"], a[class*="button"]') ?? undefined);
    const out = { ...(heading ? { heading } : {}), ...(bodyText ? { body: bodyText } : {}), ...(cta ? { cta } : {}) };
    return Object.keys(out).length ? out : undefined;
  };

  const sectionEls = findSections(body);
  const sections = sectionEls.map((el) => {
    const sec = classifySection(el, detail);
    sec.size_hint = computeSizeHint(el, sec, styleBlocks);
    const styles = textStyles(el);
    if (styles) sec.text_styles = styles;
    const hover = detectHoverEffects(el);
    if (hover.length) sec.hover_effects = hover;
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
    // Tailwind gradient utilities (Stitch CTA/hero backgrounds) reconstructed as
    // linear-gradient strings — surfaced in BOTH modes since they're design-critical
    // and the Play CDN never emits the resolved CSS.
    gradients: hints.tailwind_gradients.length ? hints.tailwind_gradients : undefined,
    background_images: hints.background_images.length ? hints.background_images : undefined,
    ...fontFields,
    warnings: warnings.length ? warnings : undefined,
  };

  if (detail !== "full") return base;

  // Full mode extras: merge stylesheet gradients with the Tailwind ones (deduped).
  const styleGradients = extractGradients(styleBlocks);
  const gradients = [...new Set([...hints.tailwind_gradients, ...styleGradients])];

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
    const buf = await readCapped(res, MAX_HTML_BYTES);
    if (buf === "too-large") return { ok: false, status: res.status, error: `Response exceeded ${MAX_HTML_BYTES} bytes` };
    if (!buf) return { ok: false, status: res.status, error: "no response body" };
    return { ok: true, status: res.status, html: buf.toString("utf-8") };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "Request timed out" : e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Stream a response body, giving up past `max` bytes (never buffers an unbounded body). */
async function readCapped(res: Response, max: number): Promise<Buffer | "too-large" | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return "too-large";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

const MAX_STYLESHEETS = 12;
const MAX_CSS_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

/** One attribute of a raw tag (quoted or bare); `data-href` never matches `href`. */
function tagAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`[\\s"']${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/**
 * The page's stylesheet sources in DOCUMENT order (the cascade order): each
 * `<link rel=stylesheet>` (or `rel=preload as=style`, the async-CSS pattern) by
 * href, each `<style>` by index. Print-only links are dropped.
 */
export function stylesheetTags(html: string): ({ kind: "link"; href: string } | { kind: "style"; index: number; css: string })[] {
  const out: ({ kind: "link"; href: string } | { kind: "style"; index: number; css: string })[] = [];
  let styleIndex = 0;
  for (const m of html.matchAll(/<link\b[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (m[0][1].toLowerCase() === "s") { out.push({ kind: "style", index: styleIndex++, css: m[1] ?? "" }); continue; }
    const rel = (tagAttr(m[0], "rel") ?? "").toLowerCase();
    const isCss = /\bstylesheet\b/.test(rel) || (/\bpreload\b/.test(rel) && (tagAttr(m[0], "as") ?? "").toLowerCase() === "style");
    const media = (tagAttr(m[0], "media") ?? "").toLowerCase();
    const href = tagAttr(m[0], "href");
    if (isCss && href && !(media.includes("print") && !media.includes("screen"))) out.push({ kind: "link", href: href.replace(/&amp;/g, "&") });
  }
  return out;
}

/** `@import url(x)` / `@import "x"` targets of a CSS text (comments stripped; print-only imports skipped). */
function cssImports(css: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(css).matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);/gi)) {
    if (!/\bprint\b/i.test(m[2]) || /\bscreen\b/i.test(m[2])) out.push(m[1]);
  }
  return out;
}

/**
 * GET a stylesheet the crawled page pointed us at — that URL is chosen by a
 * third-party page, so: http(s) only, no private/loopback/link-local host (SSRF;
 * same policy + RENDER_ALLOW_PRIVATE opt-out as the screenshot route), redirects
 * followed MANUALLY so each hop is re-checked, CSS/text content-type only, and the
 * body streamed with a byte cap.
 */
async function fetchCss(url: string): Promise<string | null> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedScreenshotUrl(target).ok) return null;
    let res: Response;
    try {
      res = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; webcake-landing-mcp/ingest_url)", Accept: "text/css,*/*;q=0.1" },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try { target = new URL(loc, target).href; } catch { return null; }
      continue;
    }
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!res.ok || (ctype && !/css|text\/plain|octet-stream/.test(ctype))) return null;
    try {
      const buf = await readCapped(res, MAX_CSS_BYTES);
      return buf && buf !== "too-large" ? buf.toString("utf-8") : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** A fetched sheet; `owner` = the absolute <link> href, or "style:<n>" for an inline <style>'s imports. */
export type FetchedSheet = { owner: string; css: string; base: string };

/**
 * Fetch the page's external stylesheets — and what they (or inline <style> blocks)
 * `@import`, two levels deep — so `@font-face` + type rules outside the HTML are
 * seen. Each owner's list is ordered imports-first, like the cascade. Google Fonts
 * CSS is skipped (those families load by name). Best-effort: a failed sheet is skipped.
 */
export async function fetchStylesheets(html: string, pageUrl: string): Promise<FetchedSheet[]> {
  const seen = new Set<string>();
  const claim = (href: string, base: string): string | undefined => {
    if (/fonts\.googleapis\.com/i.test(href) || seen.size >= MAX_STYLESHEETS) return undefined;
    try {
      const abs = new URL(href, base).href;
      if (!/^https?:/i.test(abs) || seen.has(abs)) return undefined;
      seen.add(abs);
      return abs;
    } catch {
      return undefined;
    }
  };
  // One sheet → [its imports' sheets (recursively, in order)…, itself].
  const load = async (abs: string, owner: string, depth: number): Promise<FetchedSheet[]> => {
    const css = await fetchCss(abs);
    if (css === null) return [];
    const imports = depth < 2 ? cssImports(css).map((h) => claim(h, abs)).filter((h): h is string => !!h) : [];
    const nested = await Promise.all(imports.map((h) => load(h, owner, depth + 1)));
    return [...nested.flat(), { owner, css, base: abs }];
  };
  const jobs: Promise<FetchedSheet[]>[] = [];
  for (const t of stylesheetTags(html)) {
    if (t.kind === "link") {
      const abs = claim(t.href, pageUrl);
      if (abs) jobs.push(load(abs, abs, 0));
    } else {
      for (const h of cssImports(t.css)) {
        const abs = claim(h, pageUrl);
        if (abs) jobs.push(load(abs, `style:${t.index}`, 1));
      }
    }
  }
  return (await Promise.all(jobs)).flat();
}

/**
 * All CSS of the page in cascade (document) order: for each <link> its fetched
 * sheets, for each <style> its fetched @imports then the block itself; anything
 * fetched but unplaced goes last.
 */
function orderedCss(html: string, baseUrl: string | undefined, extra: { owner?: string; css: string; base?: string }[]): { css: string; base?: string }[] {
  const out: { css: string; base?: string }[] = [];
  const used = new Set<object>();
  const take = (owner: string) => {
    for (const e of extra) if (e.owner === owner && !used.has(e)) { used.add(e); out.push(e); }
  };
  for (const t of stylesheetTags(html)) {
    if (t.kind === "link") {
      try { take(new URL(t.href, baseUrl).href); } catch { /* relative href without a base (ingest_html) */ }
    } else {
      take(`style:${t.index}`);
      out.push({ css: t.css, base: baseUrl });
    }
  }
  for (const e of extra) if (!used.has(e)) out.push(e);
  return out;
}
