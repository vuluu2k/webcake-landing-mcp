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

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000; // 2MB
const FULL_SIZE_CAP = 25_000; // ~25 KB serialized cap for full mode

export type IngestedCta = { text: string; href?: string };
export type IngestedFormField = { label?: string; type: string; name?: string; required?: boolean };

/** A repeating card-like block detected in full mode. */
export type IngestedBlock = {
  icon?: string;   // emoji or short badge text from an icon slot (maps to a Webcake svg-mask rectangle)
  title?: string;
  body?: string;
  image?: string;
  cta?: { text: string; href?: string };
};

export type IngestedSection = {
  role:
    | "header"
    | "hero"
    | "features"
    | "about"
    | "form"
    | "cta"
    | "gallery"
    | "testimonials"
    | "pricing"
    | "faq"
    | "footer"
    | "unknown";
  heading?: string;
  subheading?: string;
  paragraphs?: string[];
  /** compact: string[]; full: { src: string; alt?: string }[] */
  images?: string[] | { src: string; alt?: string }[];
  ctas?: IngestedCta[];
  links?: { text: string; href: string }[];
  form_fields?: IngestedFormField[];
  /** full mode only */
  blocks?: IngestedBlock[];
  /** full mode only */
  lists?: string[];
};

export type IngestedAst = {
  title?: string;
  description?: string;
  og_image?: string;
  language?: string;
  sections: IngestedSection[];
  colors?: string[];
  fonts?: string[];
  /** full & compact: named CSS custom-property colors (design palette by name) */
  palette?: Record<string, string>;
  /** full & compact: background-image URLs found in stylesheets + inline styles */
  background_images?: string[];
  /** full mode only */
  gradients?: string[];
  truncated?: boolean;
  warnings?: string[];
};

const HEADING_TAGS = ["h1", "h2", "h3", "h4"];

// ─── stylesheet regex helpers ────────────────────────────────────────────────

/** Extract content of all <style> tags from raw HTML (fast, no full parse needed). */
function extractStyleBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) blocks.push(m[1]);
  }
  return blocks;
}

/** Extract Google Font family names from <link> hrefs. */
function extractGoogleFonts(html: string): string[] {
  const names: string[] = [];
  const re = /href=["'][^"']*fonts\.googleapis\.com\/css[^"']*family=([^"'&]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // family=Poppins:wght@400;700|Playfair+Display  or  family=Poppins&family=Open+Sans
    const segment = decodeURIComponent(m[1]);
    // split on | or &family=
    const parts = segment.split(/[|]|&family=/i);
    for (const p of parts) {
      const name = p.split(":")[0].replace(/\+/g, " ").trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const COLOR_RE = /(?:rgba?|hsla?)\([^)]+\)|#[0-9a-fA-F]{3,8}\b/g;
const FONT_RE = /font-family\s*:\s*([^;}{]+)/gi;
const CSS_VAR_RE = /--([\w-]+)\s*:\s*([^;}{]+)/g;
const BG_IMAGE_RE = /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi;
const GRADIENT_RE = /(?:linear|radial)-gradient\([^)]+(?:\([^)]*\)[^)]*)*\)/gi;

/** Collect CSS custom-property colors from stylesheet text. Returns { name: color }. */
function extractCssVarPalette(stylesheets: string[]): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const css of stylesheets) {
    CSS_VAR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CSS_VAR_RE.exec(css)) !== null) {
      const name = m[1].trim();
      const val = m[2].trim();
      // only keep if the value looks like a color
      if (COLOR_RE.test(val) || /^#[0-9a-fA-F]{3,8}$/.test(val)) {
        palette[name] = val;
      }
      COLOR_RE.lastIndex = 0;
    }
  }
  return palette;
}

/** Collect hex/rgb(a) colors from stylesheet text. */
function extractStylesheetColors(stylesheets: string[]): string[] {
  const counts = new Map<string, number>();
  for (const css of stylesheets) {
    COLOR_RE.lastIndex = 0;
    const matches = css.match(COLOR_RE);
    if (matches) for (const c of matches) {
      const k = c.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Collect font-family values from stylesheet text. */
function extractStylesheetFonts(stylesheets: string[]): string[] {
  const counts = new Map<string, number>();
  for (const css of stylesheets) {
    FONT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FONT_RE.exec(css)) !== null) {
      const k = m[1].trim().replace(/['"]/g, "").split(",")[0].trim();
      if (k && k !== "inherit" && k !== "initial" && k !== "unset") {
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Collect background-image URLs from stylesheets + inline style strings. */
function extractBackgroundImages(sources: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of sources) {
    BG_IMAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BG_IMAGE_RE.exec(src)) !== null) {
      const url = m[1].trim();
      if (!seen.has(url)) { seen.add(url); out.push(url); }
    }
  }
  return out;
}

/** Collect gradient strings from stylesheets (cap 10, deduped). */
function extractGradients(stylesheets: string[]): string[] {
  const seen = new Set<string>();
  for (const css of stylesheets) {
    GRADIENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GRADIENT_RE.exec(css)) !== null) {
      const g = m[0].trim();
      if (!seen.has(g)) seen.add(g);
      if (seen.size >= 10) return [...seen];
    }
  }
  return [...seen];
}

// ─── main parse entry point ──────────────────────────────────────────────────

export function parseHtml(html: string, detail: "compact" | "full" = "compact"): IngestedAst {
  if (!html || typeof html !== "string" || html.trim().length === 0) {
    return { sections: [], warnings: ["empty input"] };
  }

  // Stylesheet extraction (fast, regex-level, done on raw HTML before DOM parse).
  const styleBlocks = extractStyleBlocks(html);
  const googleFonts = extractGoogleFonts(html);

  const root = parse(html, { lowerCaseTagName: true });

  const head = root.querySelector("head");
  const title = head?.querySelector("title")?.text?.trim() || undefined;
  const description = head?.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || undefined;
  const og_image = head?.querySelector('meta[property="og:image"]')?.getAttribute("content") || undefined;
  const language = root.querySelector("html")?.getAttribute("lang") || undefined;

  const body = root.querySelector("body") ?? root;
  if (!body) return { title, description, og_image, language, sections: [], warnings: ["no <body>"] };

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
  const sections = sectionEls.map((el) => classifySection(el, detail));

  // Brand hints from inline styles (both modes).
  const styleAttrs: string[] = [];
  body.querySelectorAll("[style]").forEach((el) => {
    const s = el.getAttribute("style");
    if (s) styleAttrs.push(s);
  });

  // Merge stylesheet + inline colors/fonts.
  const ssColors = extractStylesheetColors(styleBlocks);
  const inlineColors = topColors(styleAttrs, 20);
  const mergedColors = mergeTopN([...ssColors, ...inlineColors], 5);

  const ssFonts = extractStylesheetFonts(styleBlocks);
  const inlineFonts = topFonts(styleAttrs, 10);
  const mergedFonts = mergeTopNFonts([...googleFonts, ...ssFonts, ...inlineFonts], 4);

  // Background images (both modes).
  const bgImages = extractBackgroundImages([...styleBlocks, ...styleAttrs]);

  // CSS var palette (both modes — cheap, very useful for clone flows).
  const paletteRaw = extractCssVarPalette(styleBlocks);
  const palette = Object.keys(paletteRaw).length ? paletteRaw : undefined;

  const base: IngestedAst = {
    title,
    description,
    og_image,
    language,
    sections,
    colors: mergedColors.length ? mergedColors : undefined,
    fonts: mergedFonts.length ? mergedFonts : undefined,
    palette,
    background_images: bgImages.length ? bgImages : undefined,
  };

  if (detail !== "full") return base;

  // Full mode extras.
  const gradients = extractGradients(styleBlocks);

  const result: IngestedAst = {
    ...base,
    gradients: gradients.length ? gradients : undefined,
  };

  // Size-cap: drop blocks[].body first, then truncate lists.
  const serialized = JSON.stringify(result);
  if (serialized.length > FULL_SIZE_CAP) {
    // Strip block bodies.
    for (const sec of result.sections) {
      if (sec.blocks) {
        for (const blk of sec.blocks) delete blk.body;
      }
    }
    const s2 = JSON.stringify(result);
    if (s2.length > FULL_SIZE_CAP) {
      // Truncate lists.
      for (const sec of result.sections) {
        if (sec.lists && sec.lists.length > 5) sec.lists = sec.lists.slice(0, 5);
      }
      result.truncated = true;
    }
  }

  return result;
}

// ─── section helpers ─────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set(["div", "main", "section", "article", "header", "footer", "aside", "nav"]);

function findSections(body: HTMLElement): HTMLElement[] {
  // Collect ALL direct block-level children of body (semantic tags + divs).
  // This keeps <div class="stat-bar"> siblings of <section> tags from being dropped.
  const allTopLevel = elementChildren(body).filter((c) =>
    BLOCK_TAGS.has(c.tagName?.toLowerCase() ?? "")
  );

  if (allTopLevel.length >= 2) return allTopLevel;

  // If body has a single <main>, look inside it.
  const main = body.querySelector("main");
  if (main) {
    const inside = elementChildren(main).filter((c) =>
      BLOCK_TAGS.has(c.tagName?.toLowerCase() ?? "")
    );
    if (inside.length >= 2) return inside;
  }

  // Single section — the whole body.
  return [body];
}

function elementChildren(el: HTMLElement): HTMLElement[] {
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

function classifySection(el: HTMLElement, detail: "compact" | "full"): IngestedSection {
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

// ─── color / font helpers ────────────────────────────────────────────────────

function elText(el?: HTMLElement): string | undefined {
  const t = el?.text?.trim();
  return t ? t.slice(0, 240) : undefined;
}

function topColors(styles: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const s of styles) {
    COLOR_RE.lastIndex = 0;
    const matches = s.match(COLOR_RE);
    if (matches) for (const c of matches) {
      const k = c.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function topFonts(styles: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const s of styles) {
    FONT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FONT_RE.exec(s)) !== null) {
      const k = m[1].trim().replace(/['"]/g, "").split(",")[0].trim();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/** Deduplicate a pre-ranked list of color strings (case-insensitive), take top n. */
function mergeTopN(ranked: string[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of ranked) {
    const k = c.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(k); }
    if (out.length >= n) break;
  }
  return out;
}

/** Deduplicate font names (case-insensitive), take top n, skip generic family names. */
const GENERIC_FONTS = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "inherit", "initial", "unset"]);
function mergeTopNFonts(ranked: string[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of ranked) {
    const k = f.toLowerCase();
    if (!seen.has(k) && !GENERIC_FONTS.has(k)) { seen.add(k); out.push(f); }
    if (out.length >= n) break;
  }
  return out;
}

// ─── fetch ───────────────────────────────────────────────────────────────────

export type FetchHtmlResult = { ok: boolean; html?: string; status?: number; error?: string };

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
