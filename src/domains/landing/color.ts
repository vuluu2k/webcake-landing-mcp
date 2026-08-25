/**
 * Colour canonicalisation — pure helpers, no I/O, no domain imports.
 *
 * WHY THIS EXISTS. The live renderer emits colour values RAW into CSS, so a hex
 * / `rgb()` / `hsl()` / named colour renders perfectly on the published page.
 * The Webcake EDITOR does not: its colour traits re-parse the stored string with
 * hand-rolled parsers that only understand the legacy comma `rgba(r,g,b,a)`
 * form, and every one of them falls back to BLACK when the parse fails.
 * Confirmed read paths in landing_page_backend/assets/editor:
 *
 *   • common.js:128 `parseBackground` scans for `url|linear-gradient|
 *     radial-gradient|rgba` ONLY. Note the literal "rgba" — `rgb(...)` without
 *     the `a` does not match either.
 *   • traits/Background.vue:163 — for a text-block the background trait shows
 *     `styles.color` (that IS the text-colour swatch: traitGroup.js:2 gives
 *     text-block no 'color' trait). Background.vue:264-277 `makeBg()` runs the
 *     value through `parseBackground` and, when nothing parses, pushes a
 *     hard-coded `rgba(0, 0, 0, 1)` for a text-block.
 *   • traits/Colour.vue:62-67 (button / form / countdown / …) — falls back to
 *     `'#000000'` when `mixStyle.color` is falsy, and common.js:186
 *     `rgbaToArray` does a blind `rgba.substr(5)`, so anything not starting with
 *     `rgba(` decodes to NaN.
 *
 * So an MCP-authored page whose text colour is `#ffffff` renders white but shows
 * BLACK in the editor's trait panel — and the moment a user touches that trait
 * the black is written back and the page really does turn black.
 *
 * Fix: canonicalise every colour-bearing style/config value to `rgba(r,g,b,a)`
 * during expand (see normalizeColors in ./index.ts). Values already in the
 * legacy comma-`rgba()` form are returned BYTE-IDENTICAL so a save never
 * rewrites colours the editor itself wrote.
 */

/** Split a CSS value into top-level (paren-aware) comma-separated layers. */
export function splitCssLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      layers.push(cur);
      cur = "";
    } else cur += ch;
  }
  layers.push(cur);
  return layers.map((l) => l.trim()).filter((l) => l !== "");
}

/**
 * The exact shape the editor's parsers can read: `rgba(` + three comma-separated
 * numbers + an alpha. A value matching this is left untouched.
 * (`rgb(…)`, the modern `rgba(255 255 255 / .5)` space syntax, hex, hsl and
 * named colours all FAIL the editor's parsers and must be converted.)
 */
export const EDITOR_RGBA = /^rgba\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+%?\s*\)$/i;

/**
 * CSS-wide keywords and `transparent` — never rewritten. `transparent` in
 * particular is load-bearing: the editor's Colour trait pairs it with
 * `config.colorHidden` to implement its hide/show toggle (Colour.vue:126-133),
 * so converting it to `rgba(0,0,0,0)` would break that toggle.
 */
const PASS_THROUGH = new Set([
  "transparent", "inherit", "currentcolor", "initial", "unset", "revert", "none", "auto",
]);

/** The CSS named colours a model realistically writes. */
const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], lime: [0, 255, 0],
  blue: [0, 0, 255], yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255],
  magenta: [255, 0, 255], fuchsia: [255, 0, 255], silver: [192, 192, 192],
  gray: [128, 128, 128], grey: [128, 128, 128], maroon: [128, 0, 0], olive: [128, 128, 0],
  green: [0, 128, 0], purple: [128, 0, 128], teal: [0, 128, 128], navy: [0, 0, 128],
  orange: [255, 165, 0], gold: [255, 215, 0], pink: [255, 192, 203],
  hotpink: [255, 105, 180], crimson: [220, 20, 60], salmon: [250, 128, 114],
  coral: [255, 127, 80], tomato: [255, 99, 71], orangered: [255, 69, 0],
  brown: [165, 42, 42], chocolate: [210, 105, 30], tan: [210, 180, 140],
  beige: [245, 245, 220], ivory: [255, 255, 240], khaki: [240, 230, 140],
  indigo: [75, 0, 130], violet: [238, 130, 238], orchid: [218, 112, 214],
  plum: [221, 160, 221], lavender: [230, 230, 250], turquoise: [64, 224, 208],
  skyblue: [135, 206, 235], steelblue: [70, 130, 180], royalblue: [65, 105, 225],
  dodgerblue: [30, 144, 255], midnightblue: [25, 25, 112], seagreen: [46, 139, 87],
  forestgreen: [34, 139, 34], darkgreen: [0, 100, 0], darkred: [139, 0, 0],
  darkblue: [0, 0, 139], darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
  lightgray: [211, 211, 211], lightgrey: [211, 211, 211], dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105], slategray: [112, 128, 144], slategrey: [112, 128, 144],
  whitesmoke: [245, 245, 245], snow: [255, 250, 250], linen: [250, 240, 230],
  wheat: [245, 222, 179], mintcream: [245, 255, 250], aliceblue: [240, 248, 255],
  ghostwhite: [248, 248, 255],
};

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** 1 → "1", 0.5 → "0.5", 0.88 → "0.88" (never "1.000" — matches the guide's shape). */
function fmtAlpha(a: number): string {
  if (!Number.isFinite(a)) return "1";
  const clamped = Math.max(0, Math.min(1, a));
  const s = clamped.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
}

const rgba = (r: number, g: number, b: number, a: number) =>
  `rgba(${clampByte(r)},${clampByte(g)},${clampByte(b)},${fmtAlpha(a)})`;

/** One channel of an rgb() function: a 0–255 number or a percentage. */
function channel(tok: string): number {
  return tok.endsWith("%") ? (parseFloat(tok) / 100) * 255 : parseFloat(tok);
}

/** An rgb()/hsl() alpha argument: a 0–1 number or a percentage. */
function alphaArg(tok: string | undefined): number {
  if (tok === undefined) return 1;
  return tok.endsWith("%") ? parseFloat(tok) / 100 : parseFloat(tok);
}

/** hsl → rgb (h in degrees, s/l as 0–1 fractions). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x]
    : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Canonicalise ONE colour token to the editor-readable `rgba(r,g,b,a)`.
 * Returns null when the token needs no change (already editor-readable, a
 * CSS-wide keyword) or cannot be understood (`var(--x)`, `color-mix(…)`, …) —
 * so a caller can leave the original string exactly as it found it.
 */
export function toRgba(input: string): string | null {
  const s = input.trim();
  if (s === "") return null;
  if (EDITOR_RGBA.test(s)) return null; // already the shape every editor trait parses
  const lower = s.toLowerCase();
  if (PASS_THROUGH.has(lower)) return null;

  const hex = lower.match(/^#([0-9a-f]+)$/);
  if (hex) {
    const h = hex[1];
    const dup = (c: string) => parseInt(c + c, 16);
    const pair = (i: number) => parseInt(h.slice(i, i + 2), 16);
    if (h.length === 3) return rgba(dup(h[0]), dup(h[1]), dup(h[2]), 1);
    if (h.length === 4) return rgba(dup(h[0]), dup(h[1]), dup(h[2]), dup(h[3]) / 255);
    if (h.length === 6) return rgba(pair(0), pair(2), pair(4), 1);
    if (h.length === 8) return rgba(pair(0), pair(2), pair(4), pair(6) / 255);
    return null; // 5/7-digit hex is not valid CSS — leave it for the validator to flag
  }

  // rgb()/rgba() in ANY separator syntax (comma, space, slash alpha).
  const rgbFn = lower.match(/^rgba?\(([^()]*)\)$/);
  if (rgbFn) {
    const parts = rgbFn[1].split(/[\s,/]+/).filter((p) => p !== "");
    if (parts.length < 3) return null;
    const [r, g, b] = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
    const a = alphaArg(parts[3]);
    if (![r, g, b, a].every(Number.isFinite)) return null;
    return rgba(r, g, b, a);
  }

  const hslFn = lower.match(/^hsla?\(([^()]*)\)$/);
  if (hslFn) {
    const parts = hslFn[1].split(/[\s,/]+/).filter((p) => p !== "");
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]); // deg/turn/rad suffixes: parseFloat takes the number, deg is the default
    const sat = parseFloat(parts[1]) / 100;
    const lig = parseFloat(parts[2]) / 100;
    const a = alphaArg(parts[3]);
    if (![h, sat, lig, a].every(Number.isFinite)) return null;
    const [r, g, b] = hslToRgb(h, Math.max(0, Math.min(1, sat)), Math.max(0, Math.min(1, lig)));
    return rgba(r, g, b, a);
  }

  const named = NAMED_COLORS[lower];
  return named ? rgba(named[0], named[1], named[2], 1) : null;
}

/**
 * Colour tokens INSIDE a gradient layer. The bare-word alternative catches named
 * colours (`linear-gradient(180deg, white 0%, black 100%)`); gradient keywords
 * (`to`, `deg`, `circle`, `closest-side`…) are not colour names, so toRgba
 * returns null for them and they pass through untouched.
 */
const COLOR_TOKEN =
  /#[0-9a-fA-F]+\b|\b(?:rgba?|hsla?)\([^()]*\)|\b[a-zA-Z]{3,20}\b/g;

/**
 * Canonicalise every colour in a full style value — a bare colour, a
 * comma-separated layer list, or the colour stops inside a gradient. `url()`
 * layers are left alone (normalizeBackgrounds in ./index.ts owns those).
 * Returns the ORIGINAL string when nothing needed changing, so the pass is
 * byte-stable and idempotent.
 */
export function normalizeColorValue(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  let changed = false;
  const out = splitCssLayers(value).map((layer) => {
    if (layer.includes("url(")) return layer;
    const next = /gradient\(/i.test(layer)
      ? layer.replace(COLOR_TOKEN, (tok) => toRgba(tok) ?? tok)
      : toRgba(layer) ?? layer;
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? out.join(", ") : value;
}

/**
 * True for a style/config key whose value is a colour the editor's traits parse:
 * anything named `*color*` (color, borderColor, colorBtn, iconColor, …) plus the
 * three colour-bearing keys that are not spelled "color".
 */
export function isColorKey(key: string): boolean {
  return /colou?r/i.test(key) || key === "background" || key === "backgroundTxt" || key === "overlay";
}

/**
 * True when a colour value will render BLACK in the editor's trait panel: not a
 * gradient/url, not a CSS-wide keyword, and not the legacy `rgba()` form the
 * traits can parse. Used by the validator to warn about the values
 * normalizeColorValue could not rescue (`var(--x)`, `color-mix(…)`, …).
 */
export function isUnparseableByEditor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (s === "" || PASS_THROUGH.has(s.toLowerCase())) return false;
  if (s.includes("url(") || /gradient\(/i.test(s)) return false;
  return splitCssLayers(s).some((layer) => !EDITOR_RGBA.test(layer));
}
