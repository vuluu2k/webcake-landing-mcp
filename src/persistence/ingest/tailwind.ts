/**
 * Google-Stitch / Tailwind-config design-system support.
 */

import type { HTMLElement } from "node-html-parser";

// ─── Tailwind-config design system (Google Stitch / Tailwind-CDN pages) ──────
//
// Stitch (and Pancake-style) exports load the Tailwind CDN and put the ENTIRE
// design system in a `tailwind.config = { theme: { extend: { colors, spacing,
// borderRadius, fontFamily, fontSize } } }` <script> — NOTHING in CSS. So the
// stylesheet-based color/font extractors above see almost nothing (just a body
// bg + a hero gradient), and every `text-primary` / `py-xl` / `text-display-lg`
// utility class is meaningless without the config. This lifts that config so the
// model rebuilds from the real palette + spacing grid + type scale.
//
// The parser handles every shape the Tailwind theme config can take (per the v3
// docs), so it works on ANY Stitch page, not just flat Material-token configs:
//   • colors NESTED to any depth — { gray: { 100: '#…', 900: '#…' } } → gray-100,
//     gray-900; a `DEFAULT` key collapses to the parent name ({ primary: {
//     DEFAULT:'#…', 500:'#…' } } → primary, primary-500) — mirroring how Tailwind
//     turns them into bg-gray-100 / bg-primary classes.
//   • fontSize as a plain string '14px', a [size, lineHeight] pair, or
//     [size, { lineHeight, letterSpacing, fontWeight }] — we keep the size.
//   • fontFamily as an array ['Inter','sans-serif'] OR a string 'Inter, sans-serif'
//     — we keep the first family.
//   • spacing / borderRadius string maps (borderRadius may carry a DEFAULT key).
//   • theme.extend (merge) AND theme.colors (full override): we search within the
//     whole `theme` object, so either placement is found.

export type TailwindConfig = {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  fontFamily: Record<string, string>;
  fontSize: Record<string, string>;
};

/** Advance past a quoted string starting at `i` (the opening quote); returns the index AFTER the closing quote. */
function skipString(text: string, i: number): number {
  const q = text[i++];
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") { i += 2; continue; } // escaped char
    if (c === q) return i + 1;
    i++;
  }
  return i;
}

/** The content of the first quoted string in `s` (single, double, or backtick), or undefined. */
function firstQuoted(s: string): string | undefined {
  const m = /(['"`])((?:\\.|(?!\1).)*)\1/.exec(s);
  return m ? m[2].trim() : undefined;
}

/** Brace-match the object literal assigned to `key:` inside `text` (the body between its braces), or undefined. */
function sliceObjectLiteral(text: string, key: string): string | undefined {
  const re = new RegExp(`(?:["']${key}["']|\\b${key})\\s*:\\s*\\{`);
  const m = re.exec(text);
  if (!m) return undefined;
  const open = m.index + m[0].length - 1; // at the opening '{'
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    const c = text[j];
    if (c === '"' || c === "'" || c === "`") { j = skipString(text, j) - 1; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, j);
    }
  }
  return undefined;
}

type Entry = { key: string; value: string };

/**
 * Split the TOP-LEVEL `key: value` entries of an object body (the text between
 * its outer braces), respecting nested braces/brackets/parens and quoted/template
 * strings — so a nested `{ … }` or a `[size, { … }]` value stays intact as one
 * entry instead of being torn apart by a flat regex.
 */
function objectEntries(body: string): Entry[] {
  const out: Entry[] = [];
  const n = body.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(body[i])) i++; // skip separators
    if (i >= n) break;

    // key — quoted or a bare identifier/number (hyphenated keys are always quoted in JS)
    let key = "";
    if (body[i] === '"' || body[i] === "'") {
      const end = skipString(body, i);
      key = body.slice(i + 1, end - 1);
      i = end;
    } else {
      const start = i;
      while (i < n && !/[\s:]/.test(body[i])) i++;
      key = body.slice(start, i);
    }

    while (i < n && /\s/.test(body[i])) i++;
    if (body[i] !== ":") continue; // not a normal entry (spread/comment) — resync at next separator
    i++;
    while (i < n && /\s/.test(body[i])) i++;

    // value — read to the next top-level comma, tracking nesting + strings
    const start = i;
    let depth = 0;
    while (i < n) {
      const c = body[i];
      if (c === '"' || c === "'" || c === "`") { i = skipString(body, i); continue; }
      if (c === "{" || c === "[" || c === "(") { depth++; i++; continue; }
      if (c === "}" || c === "]" || c === ")") { if (depth === 0) break; depth--; i++; continue; }
      if (c === "," && depth === 0) break;
      i++;
    }
    const value = body.slice(start, i).trim();
    if (key) out.push({ key, value });
  }
  return out;
}

const COLOR_VALUE_RE = /^(#|rgb|hsl|hwb|lab|lch|oklch|oklab|color\(|var\(|transparent$|current|inherit$|[a-z]+$)/i;

/** Flatten a colors object (nested to any depth) into token→value; DEFAULT collapses to the parent name. */
function flattenColors(body: string, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const { key, value } of objectEntries(body)) {
    const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (value.startsWith("{")) {
      const inner = value.slice(1, value.lastIndexOf("}"));
      flattenColors(inner, name, out);
    } else {
      const v = firstQuoted(value) ?? (/^[a-z]/i.test(value) ? value.trim() : undefined);
      if (name && v && COLOR_VALUE_RE.test(v)) out[name] = v;
    }
  }
  return out;
}

/** A string→string map (spacing, borderRadius): keep entries whose value is a plain string. */
function stringMap(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of objectEntries(body)) {
    const v = firstQuoted(value);
    if (key && v !== undefined) out[key] = v;
  }
  return out;
}

/** fontSize map: value may be '14px', ['14px','20px'], or ['14px', {…}] — keep the size (first quoted string). */
function sizeMap(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of objectEntries(body)) {
    const v = firstQuoted(value); // works for both the bare string and the array's first element
    if (key && v !== undefined) out[key] = v;
  }
  return out;
}

/** fontFamily map: value is ['Inter','sans-serif'] or 'Inter, sans-serif' — keep the first family. */
function familyMap(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of objectEntries(body)) {
    const first = firstQuoted(value);
    if (key && first) out[key] = first.split(",")[0].replace(/['"]/g, "").trim();
  }
  return out;
}

/** Lift the Tailwind config design system from a Stitch/Tailwind-CDN page; null when there's no config. */
export function extractTailwindConfig(html: string): TailwindConfig | null {
  if (!/tailwind\.config\s*=/.test(html) && !/id=["']tailwind-config["']/.test(html)) return null;
  // Narrow to the config script for accuracy; fall back to the whole document.
  const scriptRe = /<script[^>]*>([\s\S]*?tailwind\.config[\s\S]*?)<\/script>/i;
  const scope = scriptRe.exec(html)?.[1] ?? html;
  // Search inside `theme` so we catch BOTH theme.extend.* and a theme.* override;
  // fall back to the whole scope if the object isn't wrapped in `theme`.
  const theme = sliceObjectLiteral(scope, "theme") ?? scope;

  const colors = flattenColors(sliceObjectLiteral(theme, "colors") ?? "");
  const spacing = stringMap(sliceObjectLiteral(theme, "spacing") ?? "");
  const borderRadius = stringMap(sliceObjectLiteral(theme, "borderRadius") ?? "");
  const fontFamily = familyMap(sliceObjectLiteral(theme, "fontFamily") ?? "");
  const fontSize = sizeMap(sliceObjectLiteral(theme, "fontSize") ?? "");

  if (![colors, spacing, borderRadius, fontFamily, fontSize].some((m) => Object.keys(m).length)) return null;
  return { colors, spacing, borderRadius, fontFamily, fontSize };
}

// Tailwind color-utility prefixes whose token after the dash names a color.
// Directional border-color prefixes (border-t/r/b/l/x/y/s/e) and ring-offset are
// listed so `border-t-primary` resolves; sorted longest-first so the longer
// prefix wins the match before the bare `border`.
const TW_COLOR_PREFIXES = [
  "text", "bg", "border-t", "border-r", "border-b", "border-l", "border-x", "border-y", "border-s", "border-e",
  "border", "from", "via", "to", "ring-offset", "ring", "decoration", "divide", "fill", "stroke", "outline",
  "accent", "caret", "placeholder", "shadow",
].sort((a, b) => b.length - a.length);
const TW_PREFIX_RE = new RegExp(`^(?:${TW_COLOR_PREFIXES.join("|")})-(.+)$`);
// Tailwind's always-available keyword colors (present even without a config entry).
const TW_KNOWN: Record<string, string> = { white: "#ffffff", black: "#000000" };

/** Rank the config colors ACTUALLY used by utility classes in the body → resolved value list (usage-weighted). */
export function resolveTailwindColors(body: HTMLElement, colors: Record<string, string>): string[] {
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
      const val = colors[token] ?? TW_KNOWN[token];
      if (val) {
        const k = val.toLowerCase();
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
