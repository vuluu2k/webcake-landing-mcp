/**
 * Clone font fidelity — PURE (no network).
 *
 *  - `extractFontFaces` reads the crawled page's `@font-face` rules (inline <style>
 *    AND fetched external stylesheets) into the families the platform does NOT
 *    have, i.e. self-hosted font files.
 *  - `toFontGroups` turns them into the editor's `settings.fontGroups` shape, which
 *    the build host renders as `@font-face` (landing_page_build load-font.js). The
 *    file URLs are external on purpose: every real save re-hosts them to the
 *    Webcake media collection (rehost.ts treats .woff2/.woff/.ttf/.otf like images),
 *    so the font is downloaded + uploaded with no extra tool call.
 *  - `parseCssRules` + `extractTypography` / `makeTypeResolver` compute the type
 *    scale (cascade, @media desktop-vs-mobile, var(), clamp(), Tailwind classes,
 *    inheritance) so a hand-rebuilt clone copies exact font-size/font-weight.
 *  - `withGoogleWeightLinks` patches a build gap: the build only requests Google
 *    weights 100/300/400/700/900, so a 500/600/800 heading silently renders 700.
 *
 * Input CSS is untrusted (any website): every scan here is linear — no regex with
 * nested/adjacent unbounded quantifiers runs over a whole stylesheet.
 */

/** `ext` = the file format (woff2/woff/ttf/otf), from the URL or its format() hint. */
export type FontFace = { family: string; weight: number; style: "normal" | "italic"; url: string; ext?: string };
export type FontGroup = { name: string; fonts: { name: string; url: string; font_weight: string; font_style: string }[] };
/** Typography of a text role. font_size = desktop px; mobile_font_size only when the mobile canvas differs. */
export type TypeSpec = { font_family?: string; font_size?: number; mobile_font_size?: number; font_weight?: string; line_height?: string; letter_spacing?: string };

// Icon webfonts are never content fonts (Material Symbols, Font Awesome, …).
export const ICON_FONT_RE = /^material (symbols|icons)\b|\bfont ?awesome\b|^(bootstrap|remix) ?icons?\b|\bicon(s|font)?\b|icons$|^icomoon\b|^fa-|^glyphicons/i;

const FORMAT_RANK: Record<string, number> = { woff2: 4, woff: 3, ttf: 2, truetype: 2, otf: 1, opentype: 1 };
const FONT_FILE_RE = /\.(woff2?|ttf|otf)(?:[?#]|$)/i;

/** Build-host weight keys (load-font.js `list_font_weight`). 200 has no key of its own → "light". */
const WEIGHT_KEY: Record<number, string> = {
  100: "thin", 200: "light", 300: "light", 400: "normal", 500: "medium",
  600: "semibold", 700: "bold", 800: "extrabold", 900: "black",
};
/** The weight each key renders as — a face whose weight IS that wins a key collision (300 over 200). */
const KEY_WEIGHT: Record<string, number> = { thin: 100, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };

function firstFamily(v: string): string {
  return v.split(",")[0].replace(/["']/g, "").trim();
}

// ─── linear CSS text helpers ─────────────────────────────────────────────────

/** Remove `/* … *\/` comments in one pass; an unterminated comment swallows the rest (as in CSS). */
export function stripComments(css: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const open = css.indexOf("/*", i);
    if (open < 0) return out + css.slice(i);
    out += css.slice(i, open);
    const close = css.indexOf("*/", open + 2);
    if (close < 0) return out;
    i = close + 2;
  }
}

/**
 * Declarations of one rule body → { lowercased property: last value } (`!important`
 * dropped). Splits on `;` only outside quotes/parens, so a `data:` URI or a
 * `url("a;b")` stays one value.
 */
function splitDecls(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let quote = "";
  let start = 0;
  const flush = (end: number) => {
    const d = body.slice(start, end);
    const colon = d.indexOf(":");
    if (colon > 0) {
      const v = d.slice(colon + 1).replace(/!\s*important\s*$/i, "").trim();
      if (v) out.set(d.slice(0, colon).trim().toLowerCase(), v);
    }
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === quote && body[i - 1] !== "\\") quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) { flush(i); start = i + 1; }
  }
  flush(body.length);
  return out;
}

// ─── @font-face → fontGroups ─────────────────────────────────────────────────

function parseWeight(v: string | undefined): number[] {
  const t = (v ?? "400").trim().toLowerCase();
  if (t === "normal") return [400];
  if (t === "bold") return [700];
  const nums = t.split(/\s+/).map((n) => parseInt(n, 10)).filter(Number.isFinite);
  if (nums.length === 2) {
    // Variable font range ("100 900"): one entry per standard weight in range, same file.
    return Object.keys(WEIGHT_KEY).map(Number).filter((w) => w >= nums[0] && w <= nums[1]);
  }
  return nums.length ? [Math.round(nums[0] / 100) * 100] : [400];
}

function resolveUrl(u: string, base?: string): string | undefined {
  try {
    return base ? new URL(u, base).href : /^https?:\/\//i.test(u) ? u : undefined;
  } catch {
    return undefined;
  }
}

const FORMAT_EXT: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "ttf", truetype: "ttf", otf: "otf", opentype: "otf" };

/** Best `src` of one @font-face (woff2 > woff > ttf > otf; eot/svg/local/data: ignored). */
function bestSrc(src: string, base?: string): { url: string; ext: string } | undefined {
  let best: { url: string; ext: string; rank: number } | undefined;
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*['"]?([\w-]+)['"]?\s*\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (/^data:/i.test(m[2])) continue;
    const fmt = (m[3] ?? FONT_FILE_RE.exec(m[2])?.[1] ?? "").toLowerCase();
    const rank = FORMAT_RANK[fmt] ?? 0;
    const url = rank ? resolveUrl(m[2].trim(), base) : undefined;
    if (url && /^https?:/i.test(url) && (!best || rank > best.rank)) best = { url, ext: FORMAT_EXT[fmt], rank };
  }
  return best && { url: best.url, ext: best.ext };
}

/**
 * `@font-face` rules → self-hosted faces. Faces split by `unicode-range` (Google's
 * subset CSS, self-hosted or not) and fonts.gstatic.com files are skipped: the
 * build can't express unicode-range, and those families load from Google by name.
 */
export function extractFontFaces(blocks: { css: string; base?: string }[]): FontFace[] {
  const out = new Map<string, FontFace>();
  for (const { css, base } of blocks) {
    const text = stripComments(css);
    const re = /@font-face\s*\{/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const end = text.indexOf("}", re.lastIndex);
      if (end < 0) break;
      const d = splitDecls(text.slice(re.lastIndex, end));
      re.lastIndex = end + 1;
      const family = d.get("font-family") && firstFamily(d.get("font-family")!);
      const src = d.get("src");
      if (!family || !src || ICON_FONT_RE.test(family) || d.has("unicode-range")) continue;
      const best = bestSrc(src, base);
      if (!best || /fonts\.gstatic\.com/i.test(best.url)) continue;
      const { url, ext } = best;
      const style = /italic|oblique/i.test(d.get("font-style") ?? "") ? "italic" : "normal";
      for (const weight of parseWeight(d.get("font-weight"))) {
        out.set(`${family.toLowerCase()}|${weight}|${style}`, { family, weight, style, url, ext });
      }
    }
  }
  return [...out.values()];
}

/** File name the build/editor sniff the @font-face `format()` from (must keep the extension). */
function fileName(url: string, ext = "woff2"): string {
  let base = "";
  try {
    const p = new URL(url).pathname;
    base = decodeURIComponent(p.slice(p.lastIndexOf("/") + 1));
  } catch { /* fall through */ }
  if (!base) base = "font";
  return FONT_FILE_RE.test(base) ? base : `${base.replace(/\.[^.]*$/, "")}.${ext}`;
}

/**
 * A font URL with no extension (`/font?id=7`, served by format() hint) gets a
 * `#wc.<ext>` fragment: never sent to the server, but it lets the save-time
 * re-host recognise and correctly type the file.
 */
function withExt(url: string, ext = "woff2"): string {
  try {
    const u = new URL(url);
    return FONT_FILE_RE.test(u.pathname) || u.hash ? url : `${url}#wc.${ext}`;
  } catch {
    return url;
  }
}

/**
 * Faces → `settings.fontGroups` (one group per family; group name = the CSS family
 * elements use). Two faces landing on the same build key (200 and 300 both → "light")
 * would emit colliding @font-face rules, so the face whose weight IS the key wins.
 */
export function toFontGroups(faces: FontFace[]): FontGroup[] {
  const groups = new Map<string, Map<string, FontFace>>();
  for (const f of faces) {
    const slots = groups.get(f.family) ?? new Map<string, FontFace>();
    const key = `${WEIGHT_KEY[f.weight] ?? "normal"}|${f.style}`;
    const prev = slots.get(key);
    if (!prev || (prev.weight !== KEY_WEIGHT[key.split("|")[0]] && f.weight === KEY_WEIGHT[key.split("|")[0]])) slots.set(key, f);
    groups.set(f.family, slots);
  }
  return [...groups].map(([name, slots]) => ({
    name,
    fonts: [...slots].map(([key, f]) => ({ name: fileName(f.url, f.ext), url: withExt(f.url, f.ext), font_weight: key.split("|")[0], font_style: f.style })),
  }));
}

// ─── CSS cascade (typography) ────────────────────────────────────────────────

/** Which canvas a rule applies to: base rules hit both; @media splits desktop/mobile. */
type Media = "all" | "desktop" | "mobile";
export type CssRule = { selector: string; decls: string; media: Media };

/** Viewport widths a rule / fluid size (vw, clamp()) is evaluated at for each Webcake canvas. */
const VIEWPORT = { desktop: 1280, mobile: 420 };

/**
 * `@media` prelude → canvas: does the query hold at the 1280 (desktop) and 420
 * (mobile) viewports? Both → all, one → that canvas, neither → dropped (as is print).
 */
function mediaOf(prelude: string): Media | undefined {
  if (/\bprint\b/i.test(prelude) && !/\bscreen\b/i.test(prelude)) return undefined;
  const px = (m: RegExpExecArray | null) => (m ? parseFloat(m[1]) * (m[2].toLowerCase() === "px" ? 1 : 16) : undefined);
  const min = px(/min-width\s*:\s*([\d.]+)(px|em|rem)/i.exec(prelude)) ?? 0;
  const max = px(/max-width\s*:\s*([\d.]+)(px|em|rem)/i.exec(prelude)) ?? Infinity;
  if (/orientation|hover|pointer|prefers-/i.test(prelude)) return undefined;
  const holds = (vw: number) => vw >= min && vw <= max;
  const d = holds(VIEWPORT.desktop);
  const m = holds(VIEWPORT.mobile);
  return d && m ? "all" : d ? "desktop" : m ? "mobile" : undefined;
}

function closingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  return css.length;
}

/** Flat style rules in source order, tagged by canvas; @layer/@supports are unwrapped, other at-rule blocks skipped. */
export function parseCssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const walk = (text: string, media: Media) => {
    let i = 0;
    while (i < text.length) {
      const brace = text.indexOf("{", i);
      if (brace < 0) return;
      const head = text.slice(i, brace).trim();
      if (head.startsWith("@")) {
        const semi = text.indexOf(";", i);
        if (semi >= 0 && semi < brace) { i = semi + 1; continue; } // @import / @charset / @layer a, b;
        const end = closingBrace(text, brace);
        const inner = text.slice(brace + 1, end);
        if (/^@(layer|supports)\b/i.test(head)) walk(inner, media); // transparent wrappers (Bootstrap 6 is all @layer)
        else if (/^@media\b/i.test(head) && media === "all") {
          const m = mediaOf(head);
          if (m) walk(inner, m);
        }
        i = end + 1;
        continue;
      }
      const end = text.indexOf("}", brace);
      if (end < 0) return;
      out.push({ selector: head, decls: text.slice(brace + 1, end), media });
      i = end + 1;
    }
  };
  walk(stripComments(css), "all");
  return out;
}

/**
 * A CSS length → px at viewport `vw`: plain px/rem/em/%, or calc()/clamp()/min()/max()
 * over px/rem/em/vw (fluid headings). rem/em/% are taken against the root size `rem`.
 */
function evalLength(v: string | undefined, vw: number, rem: number): number | undefined {
  const raw = (v ?? "").trim().toLowerCase();
  if (!raw || raw.length > 200) return undefined;
  const expr = raw
    .replace(/([\d.]+)(px|rem|em|vw|%)?/g, (_, n, u) => `${parseFloat(n) * (u === "rem" || u === "em" ? rem : u === "vw" ? vw / 100 : u === "%" ? rem / 100 : 1)}`)
    .replace(/\bcalc\(/g, "(")
    .replace(/\b(clamp|min|max)\(/g, (_, f) => (f === "clamp" ? "C(" : f === "min" ? "Math.min(" : "Math.max("));
  // Strict whitelist: numbers, arithmetic, parens, commas and the three helpers — no identifier,
  // quote or bracket can reach the evaluator, so untrusted CSS can't execute anything.
  if (!/^(?:[\d.\s+\-*/(),]|C\(|Math\.min\(|Math\.max\()*$/.test(expr)) return undefined;
  try {
    const n = Function("C", `"use strict";return (${expr});`)((lo: number, x: number, hi: number) => Math.min(Math.max(x, lo), hi));
    return typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1000 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A CSS length → px at viewport `vw`: plain px/rem/em/%, or calc()/clamp()/min()/max()
 * over px/rem/em/vw (fluid headings). rem/em/% are taken against the root size `rem`.
 */
function toPx(v: string | undefined, vw = VIEWPORT.desktop, rem = 16): number | undefined {
  const n = evalLength(v, vw, rem);
  return n === undefined ? undefined : Math.round(n);
}

/** line-height: a unitless calc() (Tailwind v4 emits `calc(2.5 / 2.25)`) → its number; anything else verbatim. */
function lineHeightOf(v: string, rem: number): string {
  if (!/^(calc|clamp|min|max)\(/i.test(v)) return v;
  const n = evalLength(v, VIEWPORT.desktop, rem);
  return n === undefined ? v : String(Math.round(n * 100) / 100);
}

/** Raw typography declarations of one rule body (later declaration wins). */
type Decls = { family?: string; size?: number; msize?: number; weight?: string; lh?: string; ls?: string };
function readDecls(body: string, rem = 16): Decls {
  if (body.length > 20_000) return {};
  const d = splitDecls(body);
  const out: Decls = {};
  const fam = d.get("font-family");
  if (fam && !/^(inherit|initial|unset|var\()/i.test(fam)) out.family = firstFamily(fam);
  const fs = d.get("font-size");
  const size = toPx(fs, VIEWPORT.desktop, rem);
  if (size) { out.size = size; out.msize = toPx(fs, VIEWPORT.mobile, rem) ?? size; }
  const w = d.get("font-weight");
  if (w && /^(\d{3}|bold|normal|bolder|lighter)$/i.test(w)) out.weight = w;
  const lh = d.get("line-height");
  if (lh && !/^(inherit|normal|initial|unset)$/i.test(lh)) out.lh = lineHeightOf(lh, rem);
  const ls = d.get("letter-spacing");
  if (ls && !/^(inherit|normal|initial|unset)$/i.test(ls)) out.ls = ls;
  return out;
}

/** Resolved desktop + mobile decls → the AST TypeSpec (mobile_font_size only when it differs). */
function toSpec(desk: Decls, mob: Decls): TypeSpec | undefined {
  const spec: TypeSpec = {
    ...(desk.family ? { font_family: desk.family } : {}),
    ...(desk.size ? { font_size: desk.size } : {}),
    ...(mob.msize && mob.msize !== desk.size ? { mobile_font_size: mob.msize } : {}),
    ...(desk.weight ? { font_weight: desk.weight } : {}),
    ...(desk.lh ? { line_height: desk.lh } : {}),
    ...(desk.ls ? { letter_spacing: desk.ls } : {}),
  };
  return Object.keys(spec).length ? spec : undefined;
}

const isRootSel = (sel: string) => sel.split(",").some((x) => /^(:root|html)$/i.test(x.trim()));

/** Root font-size (px) that rem resolves against — `html { font-size: 62.5% }` makes 1rem = 10px. */
export function rootFontPx(rules: CssRule[]): number {
  let px = 16;
  for (const r of rules) {
    if (r.media !== "all" || !isRootSel(r.selector)) continue;
    const fs = splitDecls(r.decls).get("font-size");
    const v = toPx(fs, VIEWPORT.desktop, 16);
    if (v) px = /%$/.test(fs!.trim()) ? (16 * parseFloat(fs!)) / 100 : v;
  }
  return px;
}

/** Replace `var(--x[, fallback])` by hand-scanning parens (linear; no backtracking regex). */
function substVars(v: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 4 || !v.includes("var(")) return v;
  let out = "";
  let i = 0;
  for (;;) {
    const at = v.indexOf("var(", i);
    if (at < 0) return out + v.slice(i);
    out += v.slice(i, at);
    let d = 0;
    let comma = -1;
    let j = at + 3;
    for (; j < v.length; j++) {
      if (v[j] === "(") d++;
      else if (v[j] === ")" && --d === 0) break;
      else if (v[j] === "," && d === 1 && comma < 0) comma = j;
    }
    const inner = v.slice(at + 4, j);
    const name = (comma < 0 ? inner : v.slice(at + 4, comma)).trim();
    const fallback = comma < 0 ? "" : v.slice(comma + 1, j).trim();
    out += substVars(vars.get(name) ?? fallback, vars, depth + 1);
    i = j + 1;
  }
}

/**
 * Inline `var(--x[, fallback])` with the page's global custom properties
 * (`:root` / `html` / `body` base rules — Bootstrap/WordPress themes keep their
 * whole type scale there), so `font-size: var(--bs-body-font-size)` resolves.
 */
export function resolveCssVars(rules: CssRule[]): CssRule[] {
  const vars = new Map<string, string>();
  for (const r of rules) {
    if (r.media !== "all" || !r.selector.split(",").some((x) => /^(:root|html|body)$/i.test(x.trim()))) continue;
    for (const [k, val] of splitDecls(r.decls)) if (k.startsWith("--")) vars.set(k, val);
  }
  if (!vars.size) return rules;
  return rules.map((r) => (r.decls.includes("var(") && r.decls.length <= 20_000 ? { ...r, decls: substVars(r.decls, vars) } : r));
}

const TYPO_TAGS = ["body", "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button"];

/** Tag-level type scale (h1…h6, p, body, a, button), cascade order, split per canvas. */
export function extractTypography(rules: CssRule[], rem = 16): Record<string, TypeSpec> | undefined {
  const out: Record<string, TypeSpec> = {};
  for (const tag of TYPO_TAGS) {
    const desk: Decls = {};
    const mob: Decls = {};
    for (const r of rules) {
      if (!r.selector.split(",").some((s) => s.trim().toLowerCase() === tag)) continue;
      const d = readDecls(r.decls, rem);
      if (r.media !== "mobile") Object.assign(desk, d);
      if (r.media !== "desktop") Object.assign(mob, d);
    }
    const spec = toSpec(desk, mob);
    if (spec) out[tag] = spec;
  }
  return Object.keys(out).length ? out : undefined;
}

// ─── per-element resolution (CSS selectors + inline style + Tailwind classes) ─

/** Minimal DOM surface (node-html-parser HTMLElement satisfies it). */
type Node = { tagName?: string; classList?: { value: string[] }; getAttribute(n: string): string | undefined; parentNode: any };

type Compound = { tag?: string; id?: string; classes: string[] };
type Selector = { parts: Compound[]; spec: number };

const COMPOUND_RE = /^([a-z][a-z0-9-]*)?((?:[.#][\w-]+)*)$/i;

/** Simple descendant selectors only (tag/.class/#id compounds, ` ` or `>`); anything fancier → null. */
function parseSelector(sel: string): Selector | null {
  if (!sel || sel.length > 300 || /[:\[*+~\\]/.test(sel)) return null;
  const parts: Compound[] = [];
  let spec = 0;
  for (const raw of sel.replace(/>/g, " ").trim().split(/\s+/)) {
    const m = COMPOUND_RE.exec(raw);
    if (!m || !raw) return null;
    const c: Compound = { classes: [] };
    if (m[1]) { c.tag = m[1].toLowerCase(); spec += 1; }
    for (const t of m[2].match(/[.#][\w-]+/g) ?? []) {
      if (t[0] === "#") { c.id = t.slice(1); spec += 100; } else { c.classes.push(t.slice(1)); spec += 10; }
    }
    parts.push(c);
  }
  return parts.length ? { parts, spec } : null;
}

function classesOf(n: Node): string[] {
  return n.classList?.value ?? (n.getAttribute?.("class") ?? "").split(/\s+/).filter(Boolean);
}

function matchCompound(n: Node, c: Compound): boolean {
  if (!n?.tagName) return false;
  if (c.tag && n.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && n.getAttribute("id") !== c.id) return false;
  if (!c.classes.length) return true;
  const cls = classesOf(n);
  return c.classes.every((k) => cls.includes(k));
}

function matches(n: Node, s: Selector): boolean {
  if (!matchCompound(n, s.parts[s.parts.length - 1])) return false;
  let anc: Node | undefined = n.parentNode;
  for (let i = s.parts.length - 2; i >= 0; i--) {
    while (anc?.tagName && !matchCompound(anc, s.parts[i])) anc = anc.parentNode;
    if (!anc?.tagName) return false;
    anc = anc.parentNode;
  }
  return true;
}

const TW_SIZE: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128,
};
const TW_WEIGHT: Record<string, string> = {
  thin: "100", extralight: "200", light: "300", normal: "400", medium: "500", semibold: "600", bold: "700", extrabold: "800", black: "900",
};
/** Tailwind breakpoints by min-width order — all of them hold at the 1280 desktop canvas, none at 420. */
const TW_BREAKPOINT_RANK: Record<string, number> = { sm: 1, md: 2, lg: 3, xl: 4 };

export type TwTokens = { fontSize?: Record<string, string>; fontFamily?: Record<string, string> };

/** Tailwind utility classes → decls for base (mobile-first) and desktop overrides (applied smallest breakpoint first). */
function tailwindDecls(cls: string[], tw?: TwTokens, rem = 16): { base: Decls; desk: Decls } {
  const base: Decls = {};
  const byRank: Decls[] = [];
  for (const c of cls) {
    const colon = c.lastIndexOf(":");
    const prefix = colon < 0 ? "" : c.slice(0, colon);
    const util = colon < 0 ? c : c.slice(colon + 1);
    const rank = prefix === "" ? 0 : TW_BREAKPOINT_RANK[prefix];
    if (rank === undefined) continue;
    const target = rank === 0 ? base : (byRank[rank] ??= {});
    let m: RegExpExecArray | null;
    if ((m = /^text-\[([\d.]+(?:px|rem))\]$/.exec(util))) target.size = target.msize = toPx(m[1], VIEWPORT.desktop, rem);
    else if ((m = /^text-(.+)$/.exec(util)) && (TW_SIZE[m[1]] || tw?.fontSize?.[m[1]])) target.size = target.msize = TW_SIZE[m[1]] ?? toPx(tw!.fontSize![m[1]], VIEWPORT.desktop, rem);
    else if ((m = /^font-(.+)$/.exec(util)) && TW_WEIGHT[m[1]]) target.weight = TW_WEIGHT[m[1]];
    else if ((m = /^font-\[(\d{3})\]$/.exec(util))) target.weight = m[1];
    else if ((m = /^font-(.+)$/.exec(util)) && tw?.fontFamily?.[m[1]]) target.family = tw.fontFamily[m[1]];
  }
  return { base, desk: Object.assign({}, ...byRank.filter(Boolean)) };
}

/** Browser defaults for headings (lowest precedence — any author rule beats them). */
const UA_HEADING: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };

/**
 * Resolves the computed typography of DOM elements against the page's CSS +
 * Tailwind tokens. Inherited properties (family/size/weight/line-height/
 * letter-spacing) fall back up the ancestor chain, like the browser. Each node's
 * own cascade is memoized — html/body/section wrappers are shared by every lookup.
 */
export function makeTypeResolver(rules: CssRule[], tw?: TwTokens, rem = 16) {
  const parsed = rules.flatMap((r, order) => {
    const decls = readDecls(r.decls, rem);
    if (!Object.keys(decls).length) return [];
    return r.selector.split(",").flatMap((s) => {
      const sel = parseSelector(s.trim());
      return sel ? [{ sel, order, media: r.media, decls }] : [];
    });
  });
  const memo = new Map<Node, { desk: Decls; mob: Decls }>();
  const own = (n: Node): { desk: Decls; mob: Decls } => {
    const cached = memo.get(n);
    if (cached) return cached;
    const desk: Decls = {};
    const mob: Decls = {};
    const ua = UA_HEADING[n.tagName?.toLowerCase() ?? ""];
    if (ua) {
      const px = Math.round(ua * rem);
      Object.assign(desk, { size: px, weight: "bold" });
      Object.assign(mob, { msize: px, weight: "bold" });
    }
    const hits = parsed.filter((p) => matches(n, p.sel)).sort((a, b) => a.sel.spec - b.sel.spec || a.order - b.order);
    for (const h of hits) {
      if (h.media !== "mobile") Object.assign(desk, h.decls);
      if (h.media !== "desktop") Object.assign(mob, h.decls);
    }
    const twd = tailwindDecls(classesOf(n), tw, rem);
    Object.assign(desk, twd.base, twd.desk);
    Object.assign(mob, twd.base);
    const inline = readDecls(n.getAttribute?.("style") ?? "", rem);
    Object.assign(desk, inline);
    Object.assign(mob, inline);
    const res = { desk, mob };
    memo.set(n, res);
    return res;
  };
  return (el: Node | undefined): TypeSpec | undefined => {
    if (!el) return undefined;
    const desk: Decls = {};
    const mob: Decls = {};
    for (let n: Node | undefined = el; n?.tagName; n = n.parentNode) {
      const o = own(n);
      for (const k of Object.keys(o.desk) as (keyof Decls)[]) if (desk[k] === undefined) (desk as any)[k] = o.desk[k];
      for (const k of Object.keys(o.mob) as (keyof Decls)[]) if (mob[k] === undefined) (mob as any)[k] = o.mob[k];
    }
    return toSpec(desk, mob);
  };
}

// ─── Google weight links (build gap) ─────────────────────────────────────────

/** Local/system families — never on Google Fonts, so never worth a css2 link. */
const SYSTEM_FONT_RE = /^(arial|helvetica( neue)?|times( new roman)?|georgia|verdana|tahoma|trebuchet ms|courier( new)?|segoe ui|system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|inherit)$/i;

/** Weights the build already requests from Google for every family. */
const BUILD_GOOGLE_WEIGHTS = new Set([100, 300, 400, 700, 900]);

/** Marker on the links WE generate, so a re-save replaces them instead of piling up. */
const WEIGHT_LINK_RE = /<link data-wc-weights[^>]*>/g;

function numericWeight(w: unknown): number | undefined {
  if (w === "bold") return 700;
  if (w === "normal") return 400;
  const n = typeof w === "number" ? w : parseInt(String(w ?? ""), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `<link>` tags for Google families the page uses at a weight the build skips
 * (500/600/800/200). One link per family: css2 rejects the WHOLE request when a
 * family lacks one weight, so a bad family must not take the others down.
 * Families in `settings.fontGroups`, icon fonts and system fonts are skipped.
 */
export function googleWeightLinks(source: any): string {
  const groups = Array.isArray(source?.settings?.fontGroups) ? source.settings.fontGroups : [];
  const custom = new Set<string>(groups.map((g: any) => String(g?.name ?? "").toLowerCase()));
  const pageFont = typeof source?.settings?.fontGeneral === "string" ? firstFamily(source.settings.fontGeneral) : "Roboto";
  const need = new Map<string, Set<number>>();
  const visit = (el: any) => {
    for (const bp of ["desktop", "mobile"]) {
      const st = el?.responsive?.[bp]?.styles;
      const w = numericWeight(st?.fontWeight);
      if (w === undefined || BUILD_GOOGLE_WEIGHTS.has(w)) continue;
      const fam = typeof st?.fontFamily === "string" && st.fontFamily ? firstFamily(st.fontFamily) : pageFont;
      if (!fam || custom.has(fam.toLowerCase()) || ICON_FONT_RE.test(fam) || SYSTEM_FONT_RE.test(fam)) continue;
      need.set(fam, (need.get(fam) ?? new Set()).add(w));
    }
    for (const c of Array.isArray(el?.children) ? el.children : []) visit(c);
  };
  for (const s of [...(Array.isArray(source?.page) ? source.page : []), ...(Array.isArray(source?.popup) ? source.popup : [])]) visit(s);
  return [...need]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fam, ws]) => `<link data-wc-weights rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}:wght@${[...ws].sort((a, b) => a - b).join(";")}&display=swap">`)
    .join("");
}

/**
 * `source` with its generated weight links in settings.bhet brought up to date: the
 * previously generated (marked) links are dropped and the current set appended. A
 * copy when it changes; the SAME object when nothing changes (callers compare by identity).
 */
export function withGoogleWeightLinks<T>(source: T): T {
  const s = source as any;
  if (!s || typeof s !== "object") return source;
  const bhet = typeof s.settings?.bhet === "string" ? s.settings.bhet : "";
  const kept = bhet.replace(WEIGHT_LINK_RE, "");
  const next = `${kept}${googleWeightLinks(s)}`;
  if (next === bhet) return source;
  return { ...s, settings: { ...s.settings, bhet: next } };
}

/**
 * Fold the crawled fonts into a clone `source` in place: `settings.fontGroups` for
 * the self-hosted families the page actually uses (Google weight links are added at
 * save — `withGoogleWeightLinks`). Returns the family names it registered (for the clone notes).
 */
export function applyCloneFonts(source: any, fontGroups: FontGroup[]): string[] {
  if (!source || typeof source !== "object") return [];
  source.settings ??= {};
  const used = new Set<string>();
  if (typeof source.settings.fontGeneral === "string") used.add(firstFamily(source.settings.fontGeneral).toLowerCase());
  const visit = (el: any) => {
    for (const bp of ["desktop", "mobile"]) {
      const f = el?.responsive?.[bp]?.styles?.fontFamily;
      if (typeof f === "string") used.add(firstFamily(f).toLowerCase());
    }
    for (const c of el?.children ?? []) visit(c);
  };
  for (const s of [...(source.page ?? []), ...(source.popup ?? [])]) visit(s);
  const groups = fontGroups.filter((g) => used.has(g.name.toLowerCase()));
  if (groups.length) {
    const prev = Array.isArray(source.settings.fontGroups) ? source.settings.fontGroups : [];
    const have = new Set(prev.map((g: any) => g?.name));
    source.settings.fontGroups = [...prev, ...groups.filter((g) => !have.has(g.name))];
  }
  return groups.map((g) => g.name);
}
