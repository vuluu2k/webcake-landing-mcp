/**
 * HTML → compact reference AST.
 *
 * Used by the `ingest_html` and `ingest_url` tools so a model can use an existing
 * page (HTML string or URL) as a LAYOUT REFERENCE when building a Webcake page,
 * without having to read the full HTML token-by-token. The AST groups the page
 * into sections classified by role (hero/features/form/cta/footer/…) and
 * extracts headings, ctas, images, form fields, and a few brand hints
 * (top colors + fonts). The full text is NOT preserved — the model is meant to
 * use this as an anchor and generate fresh content for the user's brand.
 */
import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000; // 2MB

export type IngestedCta = { text: string; href?: string };
export type IngestedFormField = { label?: string; type: string; name?: string; required?: boolean };
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
  images?: string[];
  ctas?: IngestedCta[];
  links?: { text: string; href: string }[];
  form_fields?: IngestedFormField[];
};

export type IngestedAst = {
  title?: string;
  description?: string;
  og_image?: string;
  language?: string;
  sections: IngestedSection[];
  colors?: string[];
  fonts?: string[];
  warnings?: string[];
};

const SECTION_TAGS = ["section", "main", "article", "header", "footer", "aside"];
const HEADING_TAGS = ["h1", "h2", "h3", "h4"];

export function parseHtml(html: string): IngestedAst {
  if (!html || typeof html !== "string" || html.trim().length === 0) {
    return { sections: [], warnings: ["empty input"] };
  }

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
  const sections = sectionEls.map(classifySection);

  // Brand hints from inline styles
  const styleAttrs: string[] = [];
  body.querySelectorAll("[style]").forEach((el) => {
    const s = el.getAttribute("style");
    if (s) styleAttrs.push(s);
  });
  const colors = topColors(styleAttrs, 5);
  const fonts = topFonts(styleAttrs, 3);

  return {
    title,
    description,
    og_image,
    language,
    sections,
    colors: colors.length ? colors : undefined,
    fonts: fonts.length ? fonts : undefined,
  };
}

function findSections(body: HTMLElement): HTMLElement[] {
  // 1) Prefer explicit semantic tags.
  const explicit = body.querySelectorAll(SECTION_TAGS.join(","));
  if (explicit.length >= 2) return explicit;

  // 2) If body has a single <main>, look inside it.
  const main = body.querySelector("main");
  if (main) {
    const inside = main.querySelectorAll(SECTION_TAGS.join(","));
    if (inside.length >= 2) return inside;
    const directDivs = elementChildren(main).filter((c) => ["div", "section", "article"].includes(c.tagName?.toLowerCase() ?? ""));
    if (directDivs.length >= 2) return directDivs;
  }

  // 3) Fallback to top-level block children of body.
  const bodyBlocks = elementChildren(body).filter((c) => ["div", "main", "section", "article"].includes(c.tagName?.toLowerCase() ?? ""));
  if (bodyBlocks.length >= 2) return bodyBlocks;

  // 4) Single section — the whole body.
  return [body];
}

function elementChildren(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const n of el.childNodes as any[]) {
    if (n && n.nodeType === 1) out.push(n as HTMLElement);
  }
  return out;
}

function classifySection(el: HTMLElement): IngestedSection {
  const tag = el.tagName?.toLowerCase();
  if (tag === "header") return classifyHeader(el);
  if (tag === "footer") return classifyFooter(el);

  const form = el.querySelector("form");
  if (form) return classifyForm(el, form);

  const heading = pickHeading(el);
  const paragraphs = pickParagraphs(el);
  const images = pickImages(el);
  const ctas = pickCtas(el);
  const subheading = heading ? pickSubheading(el, heading) : undefined;

  if (images.length >= 4) {
    return { role: "gallery", heading: text(heading), images };
  }

  if (countFeatureBlocks(el) >= 3) {
    return { role: "features", heading: text(heading), subheading, ctas: ctas.length ? ctas : undefined };
  }

  if (heading?.tagName?.toLowerCase() === "h1" && (images.length > 0 || ctas.length > 0)) {
    return {
      role: "hero",
      heading: text(heading),
      subheading,
      paragraphs: paragraphs.slice(0, 1),
      images: images.slice(0, 1),
      ctas: ctas.slice(0, 2),
    };
  }

  if (ctas.length > 0 && paragraphs.length <= 1) {
    return { role: "cta", heading: text(heading), subheading, ctas };
  }

  return {
    role: "unknown",
    heading: text(heading),
    subheading,
    paragraphs: paragraphs.slice(0, 3),
    images: images.slice(0, 3),
    ctas: ctas.length ? ctas : undefined,
  };
}

function classifyHeader(el: HTMLElement): IngestedSection {
  const heading = pickHeading(el);
  const links = el
    .querySelectorAll("a")
    .map((a) => ({ text: a.text.trim(), href: a.getAttribute("href") ?? "" }))
    .filter((l) => l.text)
    .slice(0, 12);
  return { role: "header", heading: text(heading), links: links.length ? links : undefined };
}

function classifyFooter(el: HTMLElement): IngestedSection {
  const links = el
    .querySelectorAll("a")
    .map((a) => ({ text: a.text.trim(), href: a.getAttribute("href") ?? "" }))
    .filter((l) => l.text)
    .slice(0, 24);
  const paragraphs = pickParagraphs(el).slice(0, 2);
  return { role: "footer", links: links.length ? links : undefined, paragraphs: paragraphs.length ? paragraphs : undefined };
}

function classifyForm(el: HTMLElement, form: HTMLElement): IngestedSection {
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
  return {
    role: "form",
    heading: text(heading),
    subheading,
    form_fields: form_fields.length ? form_fields : undefined,
    ctas: ctas.length ? ctas : undefined,
  };
}

function pickHeading(el: HTMLElement): HTMLElement | undefined {
  for (const t of HEADING_TAGS) {
    const h = el.querySelector(t);
    if (h) return h;
  }
  return undefined;
}

function pickSubheading(el: HTMLElement, heading: HTMLElement): string | undefined {
  // Use the first paragraph that doesn't equal the heading text.
  const headingText = heading.text.trim();
  for (const p of el.querySelectorAll("p")) {
    const t = p.text.trim();
    if (t && t !== headingText && t.length >= 8 && t.length <= 240) return t;
  }
  return undefined;
}

function pickParagraphs(el: HTMLElement): string[] {
  return el
    .querySelectorAll("p")
    .map((p) => p.text.trim())
    .filter((t) => t.length > 10 && t.length < 500);
}

function pickImages(el: HTMLElement): string[] {
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
  let count = 0;
  for (const c of elementChildren(el)) {
    if (c.querySelector(HEADING_TAGS.join(",")) && c.querySelector("p")) count++;
  }
  if (count >= 3) return count;
  // Fallback: cards or list items that look like feature blocks.
  return el.querySelectorAll('ul > li, [class*="card"], [class*="feature"]').length;
}

function text(el?: HTMLElement): string | undefined {
  const t = el?.text?.trim();
  return t ? t.slice(0, 240) : undefined;
}

const COLOR_RE = /(?:rgba?|hsla?)\([^)]+\)|#[0-9a-fA-F]{3,8}\b/g;
function topColors(styles: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const s of styles) {
    const matches = s.match(COLOR_RE);
    if (matches) for (const c of matches) {
      const k = c.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

const FONT_RE = /font-family\s*:\s*([^;]+)/gi;
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
