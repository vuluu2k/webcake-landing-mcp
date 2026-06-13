/**
 * DOM role-classification + size hints + composite-widget extraction + brand hints.
 */

import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import type {
  IngestedCta,
  IngestedFormField,
  IngestedSizeHint,
  IngestedWidget,
  IngestedBlock,
  IngestedSection,
} from "./types.js";
import {
  extractStylesheetColors,
  extractStylesheetFonts,
  extractBackgroundImages,
  extractCssVarPalette,
  topColors,
  topFonts,
  mergeTopN,
  mergeTopNFonts,
} from "./stylesheets.js";
import { type TailwindConfig, resolveTailwindColors } from "./tailwind.js";

export const HEADING_TAGS = ["h1", "h2", "h3", "h4"];

// ─── section helpers ─────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set(["div", "main", "section", "article", "header", "footer", "aside", "nav"]);

export function findSections(body: HTMLElement): HTMLElement[] {
  // Collect ALL direct block-level children of body (semantic tags + divs).
  // This keeps <div class="stat-bar"> siblings of <section> tags from being dropped.
  const allTopLevel = elementChildren(body).filter((c) =>
    BLOCK_TAGS.has(c.tagName?.toLowerCase() ?? "")
  );

  // <main> is a semantic WRAPPER, not a content section — expand it into its own
  // block-level children in place. Standard pages (and every Google Stitch
  // export) wrap the content sections in <main> with <header>/<footer> as
  // siblings; without this the whole <main> classifies as ONE section and the
  // hero/features/testimonials/etc. inside it are lost.
  const flattened: HTMLElement[] = [];
  for (const el of allTopLevel) {
    if (el.tagName?.toLowerCase() === "main") {
      const inside = elementChildren(el).filter((c) => BLOCK_TAGS.has(c.tagName?.toLowerCase() ?? ""));
      if (inside.length >= 1) {
        flattened.push(...inside);
        continue;
      }
    }
    flattened.push(el);
  }

  if (flattened.length >= 2) return flattened;

  // Single section — the whole body.
  return [body];
}

export function elementChildren(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const n of el.childNodes as any[]) {
    if (n && n.nodeType === 1) out.push(n as HTMLElement);
  }
  return out;
}

/** True when the element looks like a pricing section. */
function isPricingSection(el: HTMLElement): boolean {
  const idCls = ((el.getAttribute("id") ?? "") + " " + (el.getAttribute("class") ?? "")).toLowerCase();
  if (/pricing|price|plan|tier/.test(idCls)) return true;
  const text = el.textContent;
  // Currency symbol + per-period pattern anywhere in the element.
  return /[$€£¥₫]\s*\d/.test(text) && /\/(month|mo\b|year|yr\b|annual)/i.test(text);
}

export function classifySection(el: HTMLElement, detail: "compact" | "full"): IngestedSection {
  const tag = el.tagName?.toLowerCase();
  if (tag === "header") return classifyHeader(el, detail);
  if (tag === "footer") return classifyFooter(el, detail);

  const form = el.querySelector("form");
  if (form) return classifyForm(el, form, detail);

  const heading = pickHeading(el);
  const paragraphs = pickParagraphs(el, detail);
  const images = pickImages(el, detail);
  const ctas = pickCtas(el);
  const subheading = heading ? pickSubheading(el, heading) : undefined;

  const imgSrcs = detail === "full"
    ? (images as { src: string; alt?: string }[]).map((i) => i.src)
    : (images as string[]);

  if (imgSrcs.length >= 4) {
    return { role: "gallery", heading: elText(heading), images };
  }

  // Pricing: check before features so a card-heavy pricing section isn't mis-classified.
  if (isPricingSection(el)) {
    const sec: IngestedSection = { role: "pricing", heading: elText(heading), subheading, ctas: ctas.length ? ctas : undefined };
    if (detail === "full") {
      const blocks = detectBlocks(el);
      const lists = pickLists(el, blocks);
      if (blocks.length) sec.blocks = blocks;
      if (lists.length) sec.lists = lists;
    }
    return sec;
  }

  if (countFeatureBlocks(el) >= 3) {
    const sec: IngestedSection = { role: "features", heading: elText(heading), subheading, ctas: ctas.length ? ctas : undefined };
    if (detail === "full") {
      const blocks = detectBlocks(el);
      const lists = pickLists(el, blocks);
      if (blocks.length) sec.blocks = blocks;
      if (lists.length) sec.lists = lists;
    }
    return sec;
  }

  if (heading?.tagName?.toLowerCase() === "h1" && (imgSrcs.length > 0 || ctas.length > 0)) {
    const sec: IngestedSection = {
      role: "hero",
      heading: elText(heading),
      subheading,
      paragraphs: paragraphs.slice(0, detail === "full" ? 3 : 1),
      images: detail === "full" ? (images as { src: string; alt?: string }[]).slice(0, 1) : (images as string[]).slice(0, 1),
      ctas: ctas.slice(0, 2),
    };
    return sec;
  }

  if (ctas.length > 0 && paragraphs.length <= 1) {
    return { role: "cta", heading: elText(heading), subheading, ctas };
  }

  const sec: IngestedSection = {
    role: "unknown",
    heading: elText(heading),
    subheading,
    paragraphs: paragraphs.slice(0, detail === "full" ? 6 : 3),
    images: detail === "full" ? (images as { src: string; alt?: string }[]).slice(0, 6) : (images as string[]).slice(0, 3),
    ctas: ctas.length ? ctas : undefined,
  };
  if (detail === "full") {
    const blocks = detectBlocks(el);
    const lists = pickLists(el, blocks);
    if (blocks.length) sec.blocks = blocks;
    if (lists.length) sec.lists = lists;
  }
  return sec;
}

function classifyHeader(el: HTMLElement, _detail: "compact" | "full"): IngestedSection {
  const heading = pickHeading(el);
  const links = el
    .querySelectorAll("a")
    .map((a) => ({ text: a.text.trim(), href: a.getAttribute("href") ?? "" }))
    .filter((l) => l.text)
    .slice(0, 12);
  return { role: "header", heading: elText(heading), links: links.length ? links : undefined };
}

function classifyFooter(el: HTMLElement, detail: "compact" | "full"): IngestedSection {
  const links = el
    .querySelectorAll("a")
    .map((a) => ({ text: a.text.trim(), href: a.getAttribute("href") ?? "" }))
    .filter((l) => l.text)
    .slice(0, 24);
  const paragraphs = pickParagraphs(el, detail).slice(0, 2);
  return { role: "footer", links: links.length ? links : undefined, paragraphs: paragraphs.length ? paragraphs : undefined };
}

function classifyForm(el: HTMLElement, form: HTMLElement, detail: "compact" | "full"): IngestedSection {
  const heading = pickHeading(el);
  const subheading = heading ? pickSubheading(el, heading) : undefined;
  const inputs = form.querySelectorAll("input, textarea, select");
  const form_fields: IngestedFormField[] = inputs
    .map((inp) => {
      const tag = inp.tagName?.toLowerCase();
      const type =
        tag === "input" ? inp.getAttribute("type") ?? "text" : tag === "textarea" ? "textarea" : "select";
      const name = inp.getAttribute("name") || undefined;
      const id = inp.getAttribute("id");
      let label: string | undefined;
      if (id) {
        const lbl = form.querySelector(`label[for="${id}"]`);
        if (lbl) label = lbl.text.trim();
      }
      if (!label) {
        const placeholder = inp.getAttribute("placeholder");
        if (placeholder) label = placeholder;
      }
      return { type, name, required: inp.hasAttribute("required") || undefined, label };
    })
    .filter((f) => f.type !== "hidden" && f.type !== "submit" && f.type !== "button");
  const submit = form.querySelector('button[type="submit"], input[type="submit"]') ?? form.querySelector("button");
  const submitText =
    (submit?.text?.trim() || submit?.getAttribute?.("value") || "").trim() || (form_fields.length ? "Submit" : undefined);
  const ctas: IngestedCta[] = submitText ? [{ text: submitText }] : [];
  const sec: IngestedSection = {
    role: "form",
    heading: elText(heading),
    subheading,
    form_fields: form_fields.length ? form_fields : undefined,
    ctas: ctas.length ? ctas : undefined,
  };
  if (detail === "full") {
    const lists = pickLists(el, []);
    if (lists.length) sec.lists = lists;
  }
  return sec;
}

// ─── element pickers ─────────────────────────────────────────────────────────

function pickHeading(el: HTMLElement): HTMLElement | undefined {
  for (const t of HEADING_TAGS) {
    const h = el.querySelector(t);
    if (h) return h;
  }
  return undefined;
}

function pickSubheading(el: HTMLElement, heading: HTMLElement): string | undefined {
  const headingText = heading.text.trim();
  for (const p of el.querySelectorAll("p")) {
    const t = p.text.trim();
    if (t && t !== headingText && t.length >= 8 && t.length <= 240) return t;
  }
  return undefined;
}

function pickParagraphs(el: HTMLElement, detail: "compact" | "full"): string[] {
  const maxLen = detail === "full" ? 300 : 500;
  return el
    .querySelectorAll("p")
    .map((p) => p.text.trim())
    .filter((t) => t.length > 10 && t.length < maxLen);
}

function pickImages(el: HTMLElement, detail: "compact" | "full"): string[] | { src: string; alt?: string }[] {
  if (detail === "full") {
    const out: { src: string; alt?: string }[] = [];
    for (const img of el.querySelectorAll("img")) {
      const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (!src || src.startsWith("data:")) continue;
      const alt = img.getAttribute("alt")?.trim() || undefined;
      out.push(alt !== undefined ? { src, alt } : { src });
      if (out.length >= 12) break;
    }
    return out;
  }
  return el
    .querySelectorAll("img")
    .map((img) => img.getAttribute("src") || img.getAttribute("data-src") || "")
    .filter((s) => s && !s.startsWith("data:"))
    .slice(0, 12);
}

function pickCtas(el: HTMLElement): IngestedCta[] {
  const out: IngestedCta[] = [];
  el.querySelectorAll("button").forEach((b) => {
    const t = b.text.trim();
    if (t) out.push({ text: t });
  });
  el.querySelectorAll("a").forEach((a) => {
    const cls = (a.getAttribute("class") ?? "").toLowerCase();
    if (/(btn|button|cta)/.test(cls)) {
      const t = a.text.trim();
      const href = a.getAttribute("href") ?? undefined;
      if (t) out.push({ text: t, href });
    }
  });
  // Dedup by text.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.text) ? false : (seen.add(c.text), true))).slice(0, 4);
}

function countFeatureBlocks(el: HTMLElement): number {
  // Direct children with heading+p (classic feature row).
  let count = 0;
  for (const c of elementChildren(el)) {
    if (c.querySelector(HEADING_TAGS.join(",")) && c.querySelector("p")) count++;
  }
  if (count >= 3) return count;
  // Nested grid: find any descendant container whose element-children are
  // repeated similar siblings (same tag + same leading class word).
  const container = findRepeatingContainer(el);
  if (container && container.items.length >= 3) return container.items.length;
  return el.querySelectorAll('ul > li, [class*="card"], [class*="feature"]').length;
}

// ─── full-mode: block detection ──────────────────────────────────────────────

/**
 * Return the first-class of a node (the part before any space), used to
 * identify structurally-similar siblings.
 */
function leadingClass(el: HTMLElement): string {
  return (el.getAttribute("class") ?? "").trim().split(/\s+/)[0];
}

/**
 * Walk descendants up to `maxDepth` levels below `root`, looking for the
 * container whose element-children are the largest group of siblings that
 * share the same tag AND the same leading class.  Returns that container and
 * its matching children, or null if no group of ≥2 is found.
 */
function findRepeatingContainer(
  root: HTMLElement,
  maxDepth = 4
): { container: HTMLElement; items: HTMLElement[] } | null {
  let best: { container: HTMLElement; items: HTMLElement[] } | null = null;

  function walk(el: HTMLElement, depth: number) {
    if (depth > maxDepth) return;
    const kids = elementChildren(el);
    if (kids.length >= 2) {
      // Group by tag+leadingClass.
      const groups = new Map<string, HTMLElement[]>();
      for (const k of kids) {
        const tag = k.tagName?.toLowerCase() ?? "";
        if (!tag || tag === "br" || tag === "script" || tag === "style") continue;
        const key = tag + "." + leadingClass(k);
        const g = groups.get(key) ?? [];
        g.push(k);
        groups.set(key, g);
      }
      for (const [, members] of groups) {
        if (members.length >= 2 && (!best || members.length > best.items.length)) {
          best = { container: el, items: members };
        }
      }
    }
    for (const k of kids) walk(k, depth + 1);
  }

  walk(root, 0);
  return best;
}

/**
 * Detect repeating card-like structures within `el`, searching descendants
 * (not only direct children) for the container with the most structurally-
 * similar siblings (same tag + same leading class).  Extracts each sibling as
 * a block {icon?, title?, body?, image?, cta?}.  Cap at 12 blocks.
 *
 * Title resolution order:
 *   1. First <h1-h6> descendant
 *   2. First child div/span whose class contains title|name|heading|label
 *   3. First <strong>/<b>
 *   4. First child div/span that is NOT the icon slot (class contains icon|emoji|img)
 *      and has short text (≤120 chars)
 * Icon: first child div/span whose class contains icon|emoji or whose entire
 *   text is ≤4 chars (emoji/badge) — surfaced separately so the model can map
 *   it to a Webcake svg-mask rectangle.
 */
function detectBlocks(el: HTMLElement): IngestedBlock[] {
  const found = findRepeatingContainer(el);
  if (!found || found.items.length < 2) return [];

  return found.items.slice(0, 12).map((c): IngestedBlock => {
    const kids = elementChildren(c);

    // ── icon slot ──
    const iconEl = kids.find((k) => {
      const cls = (k.getAttribute("class") ?? "").toLowerCase();
      if (/icon|emoji|badge|img/.test(cls)) return true;
      const t = k.textContent.trim();
      return t.length > 0 && t.length <= 4; // likely a single emoji
    });
    const icon = iconEl?.textContent?.trim() || undefined;

    // ── title ──
    const headingEl = c.querySelector(HEADING_TAGS.join(","));
    const titleClassEl = kids.find((k) => {
      const cls = (k.getAttribute("class") ?? "").toLowerCase();
      return /title|name|heading|label/.test(cls) && k !== iconEl;
    });
    const strongEl = c.querySelector("strong") || c.querySelector("b");
    // fallback: first non-icon short-text child
    const fallbackTitleEl = kids.find((k) => {
      if (k === iconEl) return false;
      const cls = (k.getAttribute("class") ?? "").toLowerCase();
      if (/icon|emoji|badge/.test(cls)) return false;
      const t = k.textContent.trim();
      return t.length > 0 && t.length <= 120;
    });
    const titleEl = headingEl ?? titleClassEl ?? strongEl ?? fallbackTitleEl;
    const title = titleEl?.textContent?.trim().slice(0, 120) || undefined;

    // ── body ──
    // Prefer <p> tags; fall back to div children whose class contains body|desc|text|content
    const titleText = title ?? "";
    const iconText = icon ?? "";
    const bodyFromP = c.querySelectorAll("p")
      .map((p) => p.text.trim())
      .filter((t) => t && t !== titleText && t !== iconText && t.length > 5)
      .join(" ")
      .slice(0, 250);
    const bodyFromDiv = !bodyFromP ? kids
      .filter((k) => {
        if (k === iconEl || k === titleEl) return false;
        const cls = (k.getAttribute("class") ?? "").toLowerCase();
        return /body|desc|text|content|copy/.test(cls);
      })
      .map((k) => k.textContent.trim())
      .filter((t) => t && t !== titleText && t.length > 5)
      .join(" ")
      .slice(0, 250) : "";
    const body = (bodyFromP || bodyFromDiv) || undefined;

    // ── image ──
    const imgEl = c.querySelector("img");
    const imgSrc = (imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "").trim();
    const image = imgSrc && !imgSrc.startsWith("data:") ? imgSrc : undefined;

    // ── cta ──
    const ctaEl = c.querySelector("button") || c.querySelector("a");
    const ctaText = ctaEl?.text?.trim().slice(0, 80) || undefined;
    const ctaHref = ctaEl?.getAttribute("href") ?? undefined;
    const cta = ctaText ? { text: ctaText, href: ctaHref } : undefined;

    return { icon, title, body, image, cta };
  }).filter((b) => b.icon || b.title || b.body || b.image);
}

/**
 * Extract list-item texts not already captured by detected blocks (to avoid
 * double-reporting). Cap at 15.
 */
function pickLists(el: HTMLElement, _blocks: IngestedBlock[]): string[] {
  return el
    .querySelectorAll("li")
    .map((li) => li.text.trim())
    .filter((t) => t.length > 3 && t.length < 200)
    .slice(0, 15);
}

// ─── size hint (desktop section height) ──────────────────────────────────────

const SIZE_DECL_RE = /(?:^|[;{\s])(min-height|height)\s*:\s*([\d.]+)(px|vh|rem|em)\b/gi;
const VH_PX = 8; // 1vh ≈ 8px (~800px viewport), so a 100vh hero lands near the editor's 800px default band

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** lines ≈ ceil(chars × fontSize × glyphFactor / width) — same model as the generation guide's text math. */
function textLines(chars: number, fontSize: number, width: number, factor = 0.55): number {
  if (chars <= 0) return 0;
  return Math.max(1, Math.ceil((chars * fontSize * factor) / width));
}

type SizeDecl = { kind: "height" | "min-height"; px: number; raw: string };

/** Parse height/min-height declarations out of a CSS declaration string. */
function sizeDecls(decl: string): SizeDecl[] {
  const out: SizeDecl[] = [];
  SIZE_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SIZE_DECL_RE.exec(decl)) !== null) {
    const kind = m[1].toLowerCase() as SizeDecl["kind"];
    const v = parseFloat(m[2]);
    const unit = m[3].toLowerCase();
    const px = unit === "px" ? v : unit === "vh" ? v * VH_PX : v * 16; // rem/em ≈ 16px
    if (px >= 40 && px <= 2400) out.push({ kind, px: Math.round(px), raw: `${m[2]}${unit}` });
  }
  return out;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Explicit height/min-height for a section element: its inline style, plus any
 * stylesheet rule whose selector mentions the element's #id or one of its
 * classes (whole-token match — `.hero` doesn't match `.hero-card`). Regex-level
 * on purpose; full selector matching needs a renderer.
 */
function cssSizeDecls(el: HTMLElement, styleBlocks: string[]): SizeDecl[] {
  const out: SizeDecl[] = [];
  const inline = el.getAttribute("style");
  if (inline) out.push(...sizeDecls(inline));

  const id = el.getAttribute("id");
  const classes = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 4);
  const tokens = [...(id ? ["#" + id] : []), ...classes.map((c) => "." + c)];
  if (tokens.length) {
    const matchers = tokens.map((t) => new RegExp(escapeRe(t) + "(?![\\w-])"));
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    for (const css of styleBlocks) {
      ruleRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ruleRe.exec(css)) !== null) {
        if (matchers.some((re) => re.test(m![1]))) out.push(...sizeDecls(m![2]));
      }
    }
  }
  return out;
}

/**
 * Content-volume estimate of the section's desktop height (960px canvas,
 * ~800px content column) so the rebuilt band is proportional to the source
 * instead of a flat 800px default.
 */
function estimateSectionHeight(el: HTMLElement, sec: IngestedSection): number {
  const role = sec.role;
  if (role === "header") return 72;
  if (role === "footer") {
    const linkRows = Math.ceil((sec.links?.length ?? 0) / 4);
    return clamp(120 + linkRows * 32 + (sec.paragraphs?.length ?? 0) * 24, 140, 480);
  }

  let h = 140; // band padding (top + bottom)
  if (sec.heading) {
    const fs = role === "hero" ? 48 : 36;
    h += textLines(sec.heading.length, fs, 800, 0.6) * Math.round(fs * 1.2) + 20;
  }
  if (sec.subheading) h += textLines(sec.subheading.length, 18, 640) * 27 + 16;
  for (const p of sec.paragraphs ?? []) h += textLines(p.length, 16, 640) * 24 + 12;
  if (sec.ctas?.length) h += 76;
  if (sec.form_fields?.length) h += sec.form_fields.length * 64 + 24;

  // Card/tile rows: full mode carries blocks; compact recounts from the DOM.
  let cards = sec.blocks?.length ?? 0;
  if (!cards && (role === "features" || role === "pricing" || role === "testimonials")) {
    cards = Math.min(countFeatureBlocks(el), 12);
  }
  if (cards) h += Math.ceil(cards / 3) * (role === "pricing" ? 420 : 260) + 24;
  else if (sec.lists?.length) h += sec.lists.length * 30;

  const imgCount = sec.images?.length ?? 0;
  if (role === "gallery") h += Math.ceil(imgCount / 3) * 260;
  else if (role === "hero") h = Math.max(h, imgCount ? 560 : 480);
  else if (imgCount) h += 320; // a content image alongside/below the text

  return clamp(Math.round(h / 10) * 10, 160, 1600);
}

export function computeSizeHint(el: HTMLElement, sec: IngestedSection, styleBlocks: string[]): IngestedSizeHint {
  const estimate = estimateSectionHeight(el, sec);
  const decls = cssSizeDecls(el, styleBlocks);
  const fixed = decls.filter((d) => d.kind === "height").sort((a, b) => b.px - a.px)[0];
  // An explicit height pins the band; min-height grows with content, so take the larger.
  if (fixed) return { height: fixed.px, basis: "css", css: fixed.raw };
  const min = decls.filter((d) => d.kind === "min-height").sort((a, b) => b.px - a.px)[0];
  if (min) return { height: Math.max(min.px, estimate), basis: "css", css: min.raw };
  return { height: estimate, basis: "estimate" };
}

// ─── full-mode: composite-widget extraction (html-box source) ────────────────

// Class/id keywords that mark a composite visual the guide rebuilds as ONE
// html-box. Conservative on purpose — generic words (card, window, slider)
// over-match ordinary content.
const WIDGET_HINT_RE = /\b(mockup|phone|device|browser|terminal|console|dashboard|chat|inbox|player)\b/i;
const WIDGET_HTML_CAP = 8000;
const WIDGET_CSS_CAP = 4000;
const MAX_WIDGETS_PER_SECTION = 2;

/** outerHTML cleaned for html-box reuse: scripts/styles stripped, whitespace collapsed. */
function cleanWidgetHtml(el: HTMLElement): string {
  // Re-parse a copy so removals don't mutate the tree other pickers read.
  const frag = parse(el.toString(), { lowerCaseTagName: true });
  frag.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
  return frag
    .toString()
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Stylesheet rules whose selector mentions a class/id used inside the widget HTML. */
function widgetCss(html: string, styleBlocks: string[]): string | undefined {
  const tokens = new Set<string>();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].trim().split(/\s+/)) if (c) tokens.add("." + c);
  }
  for (const m of html.matchAll(/id="([^"]+)"/g)) {
    if (m[1].trim()) tokens.add("#" + m[1].trim());
  }
  if (!tokens.size) return undefined;
  const matchers = [...tokens].map((t) => new RegExp(escapeRe(t) + "(?![\\w-])"));
  const parts: string[] = [];
  let total = 0;
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const css of styleBlocks) {
    ruleRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css)) !== null) {
      const sel = m[1].trim();
      if (!matchers.some((re) => re.test(sel))) continue;
      const rule = `${sel.replace(/\s+/g, " ")}{${m[2].trim().replace(/\s+/g, " ")}}`;
      if (total + rule.length > WIDGET_CSS_CAP) return parts.join("");
      parts.push(rule);
      total += rule.length;
    }
  }
  return parts.length ? parts.join("") : undefined;
}

/**
 * Find composite-widget candidates inside a section: OUTERMOST descendants
 * whose class/id matches WIDGET_HINT_RE and that have real internal structure
 * (≥3 descendant elements). Emits the cleaned HTML + matching CSS so the
 * model's html-box reproduces the source instead of approximating it.
 */
export function detectWidgets(el: HTMLElement, styleBlocks: string[]): IngestedWidget[] {
  const out: IngestedWidget[] = [];
  const walk = (node: HTMLElement) => {
    for (const k of elementChildren(node)) {
      if (out.length >= MAX_WIDGETS_PER_SECTION) return;
      const idCls = (k.getAttribute("id") ?? "") + " " + (k.getAttribute("class") ?? "");
      const m = idCls.match(WIDGET_HINT_RE);
      if (m && k.querySelectorAll("*").length >= 3) {
        const html = cleanWidgetHtml(k);
        if (html && html.length <= WIDGET_HTML_CAP) {
          const css = widgetCss(html, styleBlocks);
          out.push(css ? { hint: m[1].toLowerCase(), html, css } : { hint: m[1].toLowerCase(), html });
          continue; // outermost only — don't descend into an emitted widget
        }
      }
      walk(k);
    }
  };
  walk(el);
  return out;
}

// ─── color / font helpers ────────────────────────────────────────────────────

export function elText(el?: HTMLElement): string | undefined {
  const t = el?.text?.trim();
  return t ? t.slice(0, 240) : undefined;
}

// ─── brand hints (shared by the role path and the canvas path) ───────────────

export function brandHints(body: HTMLElement, styleBlocks: string[], googleFonts: string[], tw?: TailwindConfig | null) {
  const styleAttrs: string[] = [];
  body.querySelectorAll("[style]").forEach((el) => {
    const s = el.getAttribute("style");
    if (s) styleAttrs.push(s);
  });
  const cssColors = [...extractStylesheetColors(styleBlocks), ...topColors(styleAttrs, 20)];
  const paletteRaw = extractCssVarPalette(styleBlocks);
  // When the page carries a Tailwind config (Stitch/Tailwind-CDN), the design
  // system lives there, not in CSS: rank the colors actually used by utility
  // classes FIRST (they reflect real intent), name the palette by token, and
  // surface the spacing/radius/type-scale tokens for a faithful rebuild.
  const twColors = tw ? resolveTailwindColors(body, tw.colors) : [];
  const colors = mergeTopN([...twColors, ...cssColors], 6);
  const twFonts = tw ? Object.values(tw.fontFamily) : [];
  const fonts = mergeTopNFonts([...googleFonts, ...twFonts, ...extractStylesheetFonts(styleBlocks), ...topFonts(styleAttrs, 10)], 4);
  const background_images = extractBackgroundImages([...styleBlocks, ...styleAttrs]);
  const palette = tw ? { ...tw.colors, ...paletteRaw } : paletteRaw;
  const design_tokens = tw
    ? {
        ...(Object.keys(tw.spacing).length ? { spacing: tw.spacing } : {}),
        ...(Object.keys(tw.borderRadius).length ? { radius: tw.borderRadius } : {}),
        ...(Object.keys(tw.fontSize).length ? { font_size: tw.fontSize } : {}),
        ...(Object.keys(tw.fontFamily).length ? { font_family: tw.fontFamily } : {}),
      }
    : undefined;
  return {
    colors,
    fonts,
    background_images,
    palette: Object.keys(palette).length ? palette : undefined,
    design_tokens: design_tokens && Object.keys(design_tokens).length ? design_tokens : undefined,
  };
}
