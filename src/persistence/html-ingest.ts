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

/**
 * Desktop section-height hint (px on the 960px canvas) so the rebuilt page's
 * vertical rhythm tracks the source instead of defaulting every band to 800.
 * basis:'css' — an explicit height/min-height was found for the section
 * (inline style or a stylesheet rule matching its id/class); `css` keeps the
 * raw value (e.g. "100vh"). basis:'estimate' — content-volume math.
 */
export type IngestedSizeHint = { height: number; basis: "css" | "estimate"; css?: string };

/**
 * full mode only: a composite-widget candidate (phone/device mockup, chat
 * thread, mini dashboard, browser frame…) — its raw HTML plus the stylesheet
 * rules that style it, so the model can rebuild it FAITHFULLY as ONE html-box
 * (inline the css into the html) instead of re-imagining it from a summary.
 */
export type IngestedWidget = { hint: string; html: string; css?: string };

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
  /** full mode only: composite widgets to rebuild as ONE html-box each */
  widgets?: IngestedWidget[];
  /** both modes: desktop height hint for the rebuilt Webcake section */
  size_hint?: IngestedSizeHint;
};

export type IngestedAst = {
  title?: string;
  description?: string;
  og_image?: string;
  language?: string;
  sections: IngestedSection[];
  colors?: string[];
  fonts?: string[];
  /** full & compact: named design-palette colors by token name — from CSS custom-properties AND, when the page is built on the Tailwind CDN with a `tailwind.config` (Google Stitch / Pancake-style output), the config's resolved `colors` map (e.g. primary→#a43b38, surface-container-low→#f3f3f3). Map utility classes (text-primary, bg-surface-container-low) back to these. */
  palette?: Record<string, string>;
  /**
   * full & compact: the design system lifted from a `tailwind.config` block when
   * present (Google Stitch / Tailwind-CDN pages put the WHOLE design system here,
   * not in CSS). Reproduce the page from these tokens — they're the spacing grid,
   * corner radii, and TYPE SCALE the original was laid out on. `font_size`/`spacing`
   * values are concrete px/rem (e.g. display-lg→48px, xl→80px), so a class like
   * `text-display-lg`/`py-xl` resolves to a real size.
   */
  design_tokens?: {
    spacing?: Record<string, string>;
    radius?: Record<string, string>;
    font_size?: Record<string, string>;
    font_family?: Record<string, string>;
  };
  /** full & compact: background-image URLs found in stylesheets + inline styles */
  background_images?: string[];
  /** full mode only */
  gradients?: string[];
  /**
   * Absolute-canvas builder exports only (LadiPage-family / Webcake-published
   * HTML, auto-detected): the machine-readable geometry payload — when present,
   * rebuild from THIS, element by element, instead of the role `sections`.
   */
  canvas?: IngestedCanvas;
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

// ─── Tailwind-config design system (Google Stitch / Tailwind-CDN pages) ──────
//
// Stitch (and Pancake-style) exports load the Tailwind CDN and put the ENTIRE
// design system in a `tailwind.config = { theme: { extend: { colors, spacing,
// borderRadius, fontFamily, fontSize } } }` <script> — NOTHING in CSS. So the
// stylesheet-based color/font extractors above see almost nothing (just a body
// bg + a hero gradient), and every `text-primary` / `py-xl` / `text-display-lg`
// utility class is meaningless without the config. This lifts that config so the
// model rebuilds from the real palette + spacing grid + type scale.

export type TailwindConfig = {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  fontFamily: Record<string, string>;
  fontSize: Record<string, string>;
};

/** Brace-match the object literal assigned to `key:` inside `text` (from the first `{` after the key). */
function sliceObjectLiteral(text: string, key: string): string | undefined {
  const re = new RegExp(`(?:["']${key}["']|\\b${key})\\s*:\\s*\\{`);
  const m = re.exec(text);
  if (!m) return undefined;
  let i = m.index + m[0].length - 1; // at the opening '{'
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(i + 1, j);
    }
  }
  return undefined;
}

/** name → first quoted value. arrayValued=true requires `[` before the quote (skips nested {lineHeight} keys). */
function parseTokenPairs(objText: string, arrayValued: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const re = arrayValued
    ? /(?:"([\w-]+)"|'([\w-]+)'|([\w-]+))\s*:\s*\[\s*["']([^"']+)["']/g
    : /(?:"([\w-]+)"|'([\w-]+)'|([\w-]+))\s*:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(objText)) !== null) {
    const name = (m[1] ?? m[2] ?? m[3])?.trim();
    const val = m[4]?.trim();
    if (name && val) out[name] = val;
  }
  return out;
}

/** Lift the Tailwind config design system from a Stitch/Tailwind-CDN page; null when there's no config. */
function extractTailwindConfig(html: string): TailwindConfig | null {
  if (!/tailwind\.config\s*=/.test(html) && !/id=["']tailwind-config["']/.test(html)) return null;
  // Narrow to the config script for accuracy; fall back to the whole document.
  const scriptRe = /<script[^>]*>([\s\S]*?tailwind\.config[\s\S]*?)<\/script>/i;
  const scope = scriptRe.exec(html)?.[1] ?? html;
  const colors = parseTokenPairs(sliceObjectLiteral(scope, "colors") ?? "", false);
  const spacing = parseTokenPairs(sliceObjectLiteral(scope, "spacing") ?? "", false);
  const borderRadius = parseTokenPairs(sliceObjectLiteral(scope, "borderRadius") ?? "", false);
  const fontFamily = parseTokenPairs(sliceObjectLiteral(scope, "fontFamily") ?? "", true);
  const fontSize = parseTokenPairs(sliceObjectLiteral(scope, "fontSize") ?? "", true);
  if (!Object.keys(colors).length && !Object.keys(fontSize).length && !Object.keys(spacing).length) return null;
  return { colors, spacing, borderRadius, fontFamily, fontSize };
}

// Tailwind color-utility prefixes whose token after the dash names a color.
const TW_COLOR_PREFIXES = ["text", "bg", "border", "from", "to", "via", "ring", "decoration", "divide", "fill", "stroke", "outline", "accent", "caret", "placeholder"];
const TW_PREFIX_RE = new RegExp(`^(?:${TW_COLOR_PREFIXES.join("|")})-(.+)$`);
const TW_KNOWN = { white: "#ffffff", black: "#000000" };

/** Rank the config colors ACTUALLY used by utility classes in the body → resolved hex list (usage-weighted). */
function resolveTailwindColors(body: HTMLElement, colors: Record<string, string>): string[] {
  const counts = new Map<string, number>();
  body.querySelectorAll("[class]").forEach((el) => {
    const cls = el.getAttribute("class");
    if (!cls) return;
    for (const raw of cls.split(/\s+/)) {
      if (!raw) continue;
      const util = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw; // drop md:/dark:/hover: variants
      const pm = TW_PREFIX_RE.exec(util);
      if (!pm) continue;
      const token = pm[1].split("/")[0]; // drop /80 opacity modifier
      const hex = colors[token] ?? (TW_KNOWN as Record<string, string>)[token];
      if (hex) counts.set(hex.toLowerCase(), (counts.get(hex.toLowerCase()) ?? 0) + 1);
    }
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

// ─── main parse entry point ──────────────────────────────────────────────────

export type ParseHtmlOptions = {
  /**
   * Absolute-canvas mode only: return ONLY these canvas section ids (from a
   * previous call's canvas.sections[].id; "SECTION_POPUP" selects the popups).
   * Lets the caller re-fetch a truncated page section-by-section in full detail.
   */
  sections?: string[];
};

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

// ─── section helpers ─────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set(["div", "main", "section", "article", "header", "footer", "aside", "nav"]);

function findSections(body: HTMLElement): HTMLElement[] {
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

function escapeRe(s: string): string {
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

function computeSizeHint(el: HTMLElement, sec: IngestedSection, styleBlocks: string[]): IngestedSizeHint {
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
function detectWidgets(el: HTMLElement, styleBlocks: string[]): IngestedWidget[] {
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

/** Deduplicate font names (case-insensitive), take top n, skip generic + icon-font family names. */
const GENERIC_FONTS = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "inherit", "initial", "unset"]);
// Icon webfonts (Stitch always links Material Symbols) — never a content font.
const ICON_FONT_RE = /^material (symbols|icons)\b|\bfont ?awesome\b|^(bootstrap|remix) ?icons?\b/i;
function mergeTopNFonts(ranked: string[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of ranked) {
    const k = f.toLowerCase();
    if (!seen.has(k) && !GENERIC_FONTS.has(k) && !ICON_FONT_RE.test(k)) { seen.add(k); out.push(f); }
    if (out.length >= n) break;
  }
  return out;
}

// ─── brand hints (shared by the role path and the canvas path) ───────────────

function brandHints(body: HTMLElement, styleBlocks: string[], googleFonts: string[], tw?: TailwindConfig | null) {
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

// ─── mojibake repair ─────────────────────────────────────────────────────────

// UTF-8 bytes mis-decoded as Latin-1 ("Táº¨Y LÃ”NG" instead of "TẨY LÔNG") —
// common in saved-to-disk builder exports. Signature pairs of the double
// decoding; genuine Vietnamese text contains the precomposed letters instead.
const MOJIBAKE_RE = /Ã[-ÿ]|á»|áº|Æ°/g;
const GENUINE_VI_RE = /[ăđơưạảắằẵặẹẻẽềếểễệịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/g;

/** Repair mojibake by re-encoding through Latin-1; null when not mojibake (or not safely repairable). */
function fixMojibake(html: string): string | null {
  const hits = (html.match(MOJIBAKE_RE) ?? []).length;
  if (hits < 8) return null;
  const genuine = (html.match(GENUINE_VI_RE) ?? []).length;
  if (genuine > hits) return null; // mixed/legit text — don't touch
  try {
    const decoded = Buffer.from(html, "latin1").toString("utf8");
    // Invalid UTF-8 sequences mean the input wasn't pure Latin-1 mojibake
    // (e.g. cp1252) — repairing would corrupt it, so keep the original.
    if (decoded.includes("�")) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ─── absolute-canvas (LadiPage-family) mode ──────────────────────────────────
//
// Builders like LadiPage — and Webcake's own published HTML — emit the page as
// bare positioned nodes (<div id="HEADLINE123" class="ladi-element">); ALL the
// layout + styling lives in per-id stylesheet rules (`#HEADLINE123 { top/left/
// width/height }`, `#HEADLINE123 > .ladi-headline { font… }`) and behaviors in
// a JSON <script id="script_event_data"> blob. The semantic classifier sees
// nothing there — but the geometry is exact, and the source canvas widths
// (mobile 420 / desktop 960) MATCH the Webcake canvas, so boxes transfer 1:1.

export type CanvasElement = {
  id: string;
  /** decoded from the id prefix: HEADLINE123 → headline, SPINLUCKY1 → spin_wheel… */
  type: string;
  /** px on the source canvas. fixed:true = position:fixed (floating/sticky element). */
  box?: { top?: number; left?: number; width?: number; height?: number; bottom?: number; right?: number; fixed?: boolean };
  text?: string;
  /** image URL from the element's background rule — CDN size prefix stripped (full-size original); re-host via upload_images. */
  src?: string;
  /**
   * image: the inner image-layer geometry when it differs from the element box —
   * the visible window into the full image (offset/zoom crop). Emulate with
   * background-position/size when the target element can't crop natively.
   */
  crop?: { top?: number; left?: number; width?: number; height?: number };
  /** entrance/attention animation from the builder's `.ladi-animation` rules: { name, duration?, delay?, "iteration-count"? }. */
  animation?: Record<string, string>;
  /** shape: the inline SVG markup (capped; the fill may also appear in style). */
  svg?: string;
  /** html_code / notify: raw embed HTML (capped). */
  html?: string;
  /** the element is an <a> in the source. */
  href?: string;
  /** whitelisted declarations from the element's stylesheet rules (typography, colors, borders, background…). */
  style?: Record<string, string>;
  /** form_item: the real <input>/<select>/<textarea> facts. */
  input?: { name?: string; placeholder?: string; input_type?: string; required?: boolean; pattern?: string };
  /** simplified builder events: { type: 'popup'|'section'|'link'|'phone', action: target }. */
  events?: { type: string; action: string }[];
  /** builder sticky-position keyword (bottom_left…) when the element is pinned. */
  sticky?: string;
  /** widget config from the event-data JSON (countdown_minute, thankyou_value, delay_popup_welcome_page, autoplay…). */
  config?: Record<string, unknown>;
  children?: CanvasElement[];
};

export type CanvasSection = {
  id: string;
  /** band height in px on the source canvas. */
  height?: number;
  /** background-* declarations of the band (background-image already a bare full-size URL). */
  background?: Record<string, string>;
  elements: CanvasElement[];
};

export type IngestedCanvas = {
  builder: "ladi";
  /** source canvas width: 420 (mobile) or 960 (desktop) — same as the Webcake canvas. */
  width: number;
  mobile_only?: boolean;
  sections: CanvasSection[];
  /** popup overlays — top-level in the Webcake model too (never nest them in page sections). */
  popups?: CanvasElement[];
  element_count: number;
  truncated?: boolean;
  /** present when truncated: how to re-fetch sections in full detail. */
  hint?: string;
};

const LADI_TYPE_BY_PREFIX: Record<string, string> = {
  SECTION: "section",
  HEADLINE: "headline",
  PARAGRAPH: "paragraph",
  LIST_PARAGRAPH: "list",
  IMAGE: "image",
  BOX: "box",
  BUTTON: "button",
  BUTTON_TEXT: "button_text",
  FORM: "form",
  FORM_ITEM: "form_item",
  GROUP: "group",
  LINE: "line",
  SHAPE: "shape",
  COUNTDOWN: "countdown",
  COUNTDOWN_ITEM: "countdown_item",
  CAROUSEL: "carousel",
  GALLERY: "gallery",
  SPINLUCKY: "spin_wheel",
  POPUP: "popup",
  HTML_CODE: "html_code",
  NOTIFY: "notify",
  VIDEO: "video",
  TABS: "tabs",
  FRAME: "frame",
  BANNER: "banner",
  SURVEY: "survey",
  COLLECTION: "collection",
  COMBOBOX: "combobox",
  CART: "cart",
};

const LADI_TEXT_TYPES = new Set(["headline", "paragraph", "button_text"]);

const LADI_STYLE_KEYS = new Set([
  "font-family", "font-size", "font-weight", "font-style", "color", "text-align",
  "line-height", "letter-spacing", "text-transform", "text-shadow", "text-decoration-line",
  "background", "background-color", "background-image", "background-size", "background-position",
  "border", "border-style", "border-color", "border-width", "border-radius",
  "border-top", "border-right", "border-bottom", "border-left",
  "opacity", "transform", "box-shadow", "fill",
]);

const LADI_CONFIG_KEY_RE =
  /countdown_type|countdown_minute|thankyou_value|form_config_id|show_popup_welcome_page|delay_popup_welcome_page|autoplay|max_turn|time_show|time_delay/;

const MAX_CANVAS_ELEMENTS = 1000;
const CANVAS_SIZE_CAP = 1_000_000;
/** Shedding step 1 keeps only these style keys — the look-defining minimum for a rebuild. */
const CANVAS_CORE_STYLE_KEYS = ["font-family", "font-size", "font-weight", "color", "text-align", "background-color", "border-radius", "fill"];
const CANVAS_SVG_CAP = 1200;
const CANVAS_EMBED_CAP = 1200;

type LadiEventInfo = Pick<CanvasElement, "events" | "sticky" | "config">;

type LadiRules = {
  own: Map<string, Record<string, string>>;
  child: Map<string, Record<string, string>>;
  /** `#ID.ladi-animation …` rules — the builder's entrance/attention animations. */
  anim: Map<string, Record<string, string>>;
  /**
   * Spin-wheel artwork, kept SEPARATE because both live in `#ID <descendant>`
   * rules and would otherwise collide on `background-image` in `child`:
   * `wheel` = `.ladi-spin-lucky-screen:before` (the wheel face),
   * `button` = `.ladi-spin-lucky-start` (the center spin button).
   */
  spin: Map<string, { wheel?: string; button?: string }>;
};

type LadiCtx = { rules: LadiRules; events: Map<string, LadiEventInfo>; count: number; truncated: boolean };

function ladiTypeFromId(id: string): string {
  const m = /^([A-Z][A-Z_]*?)(\d+)$/.exec(id);
  const prefix = m ? m[1].replace(/_$/, "") : id;
  return LADI_TYPE_BY_PREFIX[prefix] ?? prefix.toLowerCase();
}

/** Split a CSS declaration block on semicolons NOT inside parens (data-URI urls contain `;`). */
function splitDeclarations(block: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of block) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function mergeLadiDecls(map: Map<string, Record<string, string>>, id: string, declsRaw: string): void {
  const rec = map.get(id) ?? {};
  for (const d of splitDeclarations(declsRaw)) {
    const i = d.indexOf(":");
    if (i <= 0) continue;
    const k = d.slice(0, i).trim().toLowerCase();
    const v = d.slice(i + 1).trim().replace(/\s*!important\s*$/i, "");
    if (!k || !v) continue;
    // data-URI artwork (arrow/list-bullet icons) is noise AND would overwrite a
    // real background-image URL merged from an earlier rule — never store it.
    if (v.includes("data:")) continue;
    rec[k] = v;
  }
  map.set(id, rec);
}

/**
 * Index the per-id stylesheet rules: `own` = the `#ID { … }` rule (geometry),
 * `child` = every `#ID <descendant> { … }` rule merged (visual styling).
 * Pseudo/state variants like `#ID.ladi-animation > …` are skipped on purpose.
 */
/** First http(s) background-image url in a raw declaration block, or undefined. */
function bgUrlFromDecls(declsRaw: string): string | undefined {
  for (const d of splitDeclarations(declsRaw)) {
    const i = d.indexOf(":");
    if (i <= 0) continue;
    if (d.slice(0, i).trim().toLowerCase() === "background-image") return urlFromCss(d.slice(i + 1));
  }
  return undefined;
}

function buildLadiRules(styleBlocks: string[]): LadiRules {
  const own = new Map<string, Record<string, string>>();
  const child = new Map<string, Record<string, string>>();
  const anim = new Map<string, Record<string, string>>();
  const spin = new Map<string, { wheel?: string; button?: string }>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const css of styleBlocks) {
    ruleRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css)) !== null) {
      const declsRaw = m[2].trim();
      if (!declsRaw) continue;
      for (const selRaw of m[1].split(",")) {
        const sel = selRaw.trim().replace(/\s*>\s*/g, " ").replace(/\s+/g, " ");
        if (!sel.startsWith("#")) continue;
        const animSel = /^#([\w-]+)\.ladi-animation( .+)?$/.exec(sel);
        if (animSel) {
          mergeLadiDecls(anim, animSel[1], declsRaw);
          continue;
        }
        const lead = /^#([\w-]+)( .+)?$/.exec(sel);
        if (!lead) continue;
        // Spin-wheel face + button images live in distinct descendant rules that
        // both set background-image — capture them separately before they collide.
        const rest = lead[2] ?? "";
        if (/ladi-spin-lucky-screen|ladi-spin-lucky-start/.test(rest)) {
          const u = bgUrlFromDecls(declsRaw);
          if (u) {
            const rec = spin.get(lead[1]) ?? {};
            if (/ladi-spin-lucky-screen/.test(rest)) rec.wheel = u;
            else rec.button = u;
            spin.set(lead[1], rec);
          }
        }
        mergeLadiDecls(lead[2] ? child : own, lead[1], declsRaw);
      }
    }
  }
  return { own, child, anim, spin };
}

function pxValue(v?: string): number | undefined {
  if (!v) return undefined;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  return m ? Math.round(parseFloat(m[1])) : undefined;
}

function urlFromCss(v?: string): string | undefined {
  if (!v) return undefined;
  const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(v);
  const u = m?.[1]?.trim();
  return u && /^https?:\/\//i.test(u) ? u : undefined;
}

/** `…ladicdn.com/s768x703/path.jpg` → `…ladicdn.com/path.jpg` (the full-size original). */
function stripCdnSizePrefix(url: string): string {
  return url.replace(/^(https?:\/\/[^/]*ladicdn\.com)\/s\d+x\d+\//i, "$1/");
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function pickCanvasStyle(decls: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!decls) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(decls)) {
    if (!LADI_STYLE_KEYS.has(k)) continue;
    if (k === "background-image" && v === "none") continue;
    out[k] = v.length > 160 ? v.slice(0, 160) : v;
  }
  return Object.keys(out).length ? out : undefined;
}

function sectionBackground(bag: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!bag) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(bag)) {
    if (!/^background/.test(k) && k !== "opacity") continue;
    if (k === "background-image") {
      const u = urlFromCss(v);
      if (u) out[k] = stripCdnSizePrefix(u);
      continue;
    }
    if (v === "none") continue;
    out[k] = v.slice(0, 160);
  }
  return Object.keys(out).length ? out : undefined;
}

function parseLadiEventData(root: HTMLElement): Map<string, LadiEventInfo> {
  const map = new Map<string, LadiEventInfo>();
  const script = root.querySelector("#script_event_data");
  if (!script) return map;
  let data: Record<string, Record<string, unknown>>;
  try {
    data = JSON.parse(script.text || script.innerHTML || "");
  } catch {
    return map;
  }
  for (const [id, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object") continue;
    const info: LadiEventInfo = {};
    const de = entry["option.data_event"];
    if (Array.isArray(de)) {
      const events = de
        .map((x: any) => ({ type: String(x?.type ?? ""), action: String(x?.action ?? "") }))
        .filter((x) => x.type && x.action)
        .slice(0, 4);
      if (events.length) info.events = events;
    }
    if (entry["mobile.option.sticky"] === true || entry["option.sticky"] === true) {
      info.sticky = String(entry["mobile.option.sticky_position"] ?? entry["option.sticky_position"] ?? "bottom_left");
    }
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
      if (LADI_CONFIG_KEY_RE.test(k)) config[k.replace(/^.*option\./, "")] = v;
      // Spin-wheel prize list ships as base64("label|message|chance") entries — decode it.
      if (k.endsWith("spinlucky_setting.list_value") && Array.isArray(v)) {
        const prizes = v
          .map((x) => {
            try {
              const parts = Buffer.from(String(x), "base64").toString("utf8").split("|").map((p) => p.trim());
              return parts[0] ? { label: parts[0], chance: parts[2] ?? "" } : null;
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        if (prizes.length) config["prizes"] = prizes;
      }
    }
    if (Object.keys(config).length) info.config = config;
    if (info.events || info.sticky || info.config) map.set(id, info);
  }
  return map;
}

/** Direct + nested `.ladi-element` nodes under `node`, preserving the builder's parent→child tree. */
function collectCanvasElements(node: HTMLElement, ctx: LadiCtx): CanvasElement[] {
  const out: CanvasElement[] = [];
  for (const child of elementChildren(node)) {
    const tag = child.tagName?.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "svg") continue;
    const cls = child.getAttribute("class") ?? "";
    const id = child.getAttribute("id") ?? "";
    if (id && /(^|\s)ladi-element(\s|$)/.test(cls)) {
      if (ctx.count >= MAX_CANVAS_ELEMENTS) {
        ctx.truncated = true;
        return out;
      }
      ctx.count++;
      out.push(buildCanvasElement(child, id, ctx));
    } else {
      out.push(...collectCanvasElements(child, ctx));
    }
  }
  return out;
}

function buildCanvasElement(el: HTMLElement, id: string, ctx: LadiCtx): CanvasElement {
  const type = ladiTypeFromId(id);
  const node: CanvasElement = { id, type };

  const own = ctx.rules.own.get(id);
  if (own) {
    const box: NonNullable<CanvasElement["box"]> = {};
    for (const k of ["top", "left", "width", "height", "bottom", "right"] as const) {
      const v = pxValue(own[k]);
      if (v !== undefined) box[k] = v;
    }
    if ((own["position"] ?? "").includes("fixed")) box.fixed = true;
    if (Object.keys(box).length) node.box = box;
  }

  const bag = ctx.rules.child.get(id);
  if (bag) {
    const bgUrl = urlFromCss(bag["background-image"]);
    if (bgUrl && (type === "image" || type === "video" || type === "popup")) node.src = stripCdnSizePrefix(bgUrl);
    const style = pickCanvasStyle(bag);
    if (style) {
      if (node.src) delete style["background-image"];
      if (Object.keys(style).length) node.style = style;
    }
    // Inner image-layer geometry ≠ element box ⇒ an offset/zoom crop.
    if (type === "image") {
      const crop: NonNullable<CanvasElement["crop"]> = {};
      for (const k of ["top", "left", "width", "height"] as const) {
        const v = pxValue(bag[k]);
        if (v !== undefined) crop[k] = v;
      }
      const offset = (crop.top !== undefined && crop.top !== 0) || (crop.left !== undefined && crop.left !== 0);
      const zoomed =
        (crop.width !== undefined && node.box?.width !== undefined && crop.width !== node.box.width) ||
        (crop.height !== undefined && node.box?.height !== undefined && crop.height !== node.box.height);
      if (Object.keys(crop).length && (offset || zoomed)) node.crop = crop;
    }
  }

  const animBag = ctx.rules.anim.get(id);
  if (animBag) {
    const animation: Record<string, string> = {};
    for (const k of ["animation-name", "animation-duration", "animation-delay", "animation-iteration-count"]) {
      if (animBag[k]) animation[k.replace("animation-", "")] = animBag[k];
    }
    if (animation["name"]) node.animation = animation;
  }

  if (LADI_TEXT_TYPES.has(type)) {
    const t = collapseWs(el.textContent ?? "");
    if (t) node.text = t.slice(0, 300);
  } else if (type === "list") {
    const items = el
      .querySelectorAll("li")
      .map((li) => collapseWs(li.text))
      .filter(Boolean)
      .slice(0, 15);
    if (items.length) node.text = items.join("\n");
  } else if (type === "shape") {
    const svg = el.querySelector("svg");
    if (svg) {
      const markup = svg.toString().replace(/\s{2,}/g, " ").trim();
      if (markup.length <= CANVAS_SVG_CAP) node.svg = markup;
    }
  } else if (type === "html_code" || type === "notify") {
    const inner = collapseWs(el.innerHTML ?? "");
    if (inner) node.html = inner.slice(0, CANVAS_EMBED_CAP);
  } else if (type === "form_item") {
    const inp = el.querySelector("input, textarea, select");
    if (inp) {
      const tag = inp.tagName?.toLowerCase();
      node.input = {
        name: inp.getAttribute("name") || undefined,
        placeholder: inp.getAttribute("placeholder") || undefined,
        input_type: tag === "input" ? inp.getAttribute("type") ?? "text" : tag,
        required: inp.hasAttribute("required") || undefined,
        pattern: inp.getAttribute("pattern") || undefined,
      };
    }
  }

  if (el.tagName?.toLowerCase() === "a") {
    const href = el.getAttribute("href");
    if (href) node.href = href;
  }

  const evt = ctx.events.get(id);
  if (evt) Object.assign(node, evt);

  // spin-wheel: carry the original wheel-face + center-button images (kept separate
  // in rules.spin so they don't collide) so the clone uses the real art, not a default.
  const spinImgs = ctx.rules.spin.get(id);
  if (spinImgs && (spinImgs.wheel || spinImgs.button)) {
    const cfg: Record<string, unknown> = { ...(node.config ?? {}) };
    if (spinImgs.wheel) cfg["wheelImage"] = stripCdnSizePrefix(spinImgs.wheel);
    if (spinImgs.button) cfg["buttonImage"] = stripCdnSizePrefix(spinImgs.button);
    node.config = cfg;
  }

  const children = collectCanvasElements(el, ctx);
  if (children.length) node.children = children;
  return node;
}

function parseAbsoluteCanvas(html: string, root: HTMLElement, styleBlocks: string[], only?: string[]): IngestedCanvas | null {
  const sectionEls = root.querySelectorAll(".ladi-section");
  if (!sectionEls.length) return null;
  const rules = buildLadiRules(styleBlocks);
  if (!rules.own.size) return null; // ladi-ish classes but no per-id geometry — let the role path handle it

  const wrapWidth = /\.ladi-wraper\s*\{[^}]*width:\s*(\d+)px/.exec(styleBlocks.join("\n"));
  const width = wrapWidth ? parseInt(wrapWidth[1], 10) : 960;
  const mobileOnly = /is_mobile_only\s*=\s*true/.test(html) || width <= 480;

  const ctx: LadiCtx = { rules, events: parseLadiEventData(root), count: 0, truncated: false };

  const sections: CanvasSection[] = [];
  const popups: CanvasElement[] = [];
  for (const secEl of sectionEls) {
    const id = secEl.getAttribute("id") ?? `SECTION_${sections.length + 1}`;
    if (only?.length && !only.includes(id)) continue; // section filter: full-detail re-fetch
    const elements = collectCanvasElements(secEl, ctx);
    if (id === "SECTION_POPUP") {
      popups.push(...elements.filter((e) => e.type === "popup"));
      continue;
    }
    const sec: CanvasSection = { id, elements };
    const h = pxValue((rules.own.get(id) ?? {})["height"]);
    if (h !== undefined) sec.height = h;
    const bg = sectionBackground(rules.child.get(id));
    if (bg) sec.background = bg;
    sections.push(sec);
  }
  if (!sections.length && !popups.length) return null;

  const canvas: IngestedCanvas = {
    builder: "ladi",
    width,
    ...(mobileOnly ? { mobile_only: true } : {}),
    sections,
    ...(popups.length ? { popups } : {}),
    element_count: ctx.count,
    ...(ctx.truncated ? { truncated: true } : {}),
  };
  shedCanvas(canvas);
  return canvas;
}

/** Keep the canvas payload under the size cap: prune styles to the core keys → svg/embeds → all styles → long text. */
function shedCanvas(canvas: IngestedCanvas): void {
  const walk = (els: CanvasElement[], fn: (e: CanvasElement) => void): void => {
    for (const e of els) {
      fn(e);
      if (e.children) walk(e.children, fn);
    }
  };
  const all = (fn: (e: CanvasElement) => void): void => {
    for (const s of canvas.sections) walk(s.elements, fn);
    if (canvas.popups) walk(canvas.popups, fn);
  };
  if (JSON.stringify(canvas).length <= CANVAS_SIZE_CAP) return;
  all((e) => {
    if (!e.style) return;
    const pruned: Record<string, string> = {};
    for (const k of CANVAS_CORE_STYLE_KEYS) if (e.style[k] !== undefined) pruned[k] = e.style[k];
    if (Object.keys(pruned).length) e.style = pruned;
    else delete e.style;
  });
  if (JSON.stringify(canvas).length > CANVAS_SIZE_CAP) {
    all((e) => {
      delete e.svg;
      delete e.html;
    });
  }
  if (JSON.stringify(canvas).length > CANVAS_SIZE_CAP) {
    all((e) => delete e.style);
  }
  if (JSON.stringify(canvas).length > CANVAS_SIZE_CAP) {
    all((e) => {
      if (e.text && e.text.length > 80) e.text = e.text.slice(0, 80);
    });
  }
  canvas.truncated = true;
  canvas.hint =
    "payload exceeded the size cap, so per-element styles were pruned/dropped — re-call the ingest tool with sections:[<id>] (one or a few ids from sections[].id; 'SECTION_POPUP' selects the popups) to get those sections in full untrimmed detail.";
}

/** Minimal role-section view of the canvas so existing consumers keep working. */
function canvasRoleSections(canvas: IngestedCanvas): IngestedSection[] {
  return canvas.sections.map((s) => {
    const headings: string[] = [];
    const imgs: string[] = [];
    let hasForm = false;
    const walk = (els: CanvasElement[]): void => {
      for (const e of els) {
        if (e.type === "headline" && e.text) headings.push(e.text);
        if (e.src) imgs.push(e.src);
        if (e.type === "form") hasForm = true;
        if (e.children) walk(e.children);
      }
    };
    walk(s.elements);
    const sec: IngestedSection = { role: hasForm ? "form" : "unknown" };
    if (headings.length) sec.heading = headings[0].slice(0, 240);
    if (imgs.length) sec.images = imgs.slice(0, 12);
    if (s.height) sec.size_hint = { height: s.height, basis: "css", css: `${s.height}px` };
    return sec;
  });
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
