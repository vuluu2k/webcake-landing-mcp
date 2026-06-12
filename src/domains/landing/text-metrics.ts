/**
 * Real-font text measurement for the validator's wrapped-text checks.
 *
 * Replaces the old flat `chars × fontSize × 0.55 / width` guess (which
 * under-counted UPPERCASE/bold headings — the classic missed hero-title
 * overlap) with per-character advance widths measured from the actual font
 * files (scripts/gen-font-metrics.mjs → font-metrics.json) plus a greedy
 * word-wrap, honoring fontWeight, letterSpacing, textTransform and lineHeight.
 *
 * Still an estimate (no renderer), so callers keep their slack tolerance —
 * but the width model is now the real one, not a constant.
 */
import { readFileSync } from "node:fs";

interface WeightTable {
  avg: number; // per-mille fallback for unmeasured chars
  w: number[]; // advance widths in 1/1000 em, aligned to METRICS.chars (0 = glyph missing)
}
type FamilyTable = Record<string, WeightTable>; // weight → table

const METRICS: { chars: string; families: Record<string, FamilyTable> } = JSON.parse(
  readFileSync(new URL("./font-metrics.json", import.meta.url), "utf8")
);

// char → index into each table's `w` array (shared across all families).
const CHAR_INDEX = new Map<string, number>();
[...METRICS.chars].forEach((ch, i) => CHAR_INDEX.set(ch, i));

const DEFAULT_FAMILY = "roboto";
const DEFAULT_LINE_HEIGHT = 1.4; // matches the renderer default the guide documents
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** First family of a CSS font-family stack: `'Be Vietnam Pro', sans-serif` → `be vietnam pro`. */
function normalizeFamily(stack: unknown): string | undefined {
  if (typeof stack !== "string" || !stack.trim()) return undefined;
  return stack.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase() || undefined;
}

/** Coerce a style value (number or "300px"/"1.4") to a finite number, else undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pickWeightTable(fam: FamilyTable, weight: number): WeightTable {
  let bestKey: string | undefined;
  let bestDist = Infinity;
  for (const k of Object.keys(fam)) {
    const d = Math.abs(Number(k) - weight);
    if (d < bestDist) { bestDist = d; bestKey = k; }
  }
  return fam[bestKey!];
}

function charMille(t: WeightTable, ch: string): number {
  const idx = CHAR_INDEX.get(ch);
  const m = idx == null ? undefined : t.w[idx];
  if (m) return m; // 0 = glyph missing from the font → fall through to avg
  if (EMOJI_RE.test(ch)) return 1000; // emoji render ≈ 1em wide
  return t.avg;
}

function measurePx(text: string, fs: number, t: WeightTable, letterSpacing: number): number {
  let units = 0;
  let count = 0;
  for (const ch of text) { units += charMille(t, ch); count++; }
  return (units / 1000) * fs + letterSpacing * Math.max(0, count - 1);
}

/** Greedy word-wrap: number of rendered lines for one explicit-break segment. */
function wrapLines(seg: string, width: number, fs: number, t: WeightTable, ls: number): number {
  const spaceW = (charMille(t, " ") / 1000) * fs + ls;
  let lines = 1;
  let lineW = 0; // width consumed on the current line; 0 = fresh line
  const placeOnFreshLine = (wordW: number) => {
    // a word wider than the box breaks across lines (≈ break-word; close
    // enough for estimation — it pushes content down either way).
    const extra = Math.max(0, Math.ceil(wordW / width) - 1);
    lines += extra;
    lineW = wordW - extra * width;
  };
  for (const word of seg.split(/\s+/).filter(Boolean)) {
    const wordW = measurePx(word, fs, t, ls);
    if (lineW === 0) placeOnFreshLine(wordW);
    else if (lineW + spaceW + wordW <= width) lineW += spaceW + wordW;
    else {
      lines++;
      placeOnFreshLine(wordW);
    }
  }
  return lines;
}

/**
 * Estimated rendered height (px) of a text-block's specials.text given its
 * breakpoint styles and the page font (settings.fontGeneral). Returns
 * undefined for empty text or template variables ({{…}}) whose rendered
 * length is unknown — same contract as the old heuristic.
 */
export function estTextHeightPx(rawText: string, styles: any, pageFont?: unknown): number | undefined {
  const fs = num(styles?.fontSize) ?? 16;
  const width = num(styles?.width);
  if (rawText.includes("{{") || !(fs > 0) || !width || !(width > 0)) return undefined;

  const segments = rawText
    .split(/<br\s*\/?>/i)
    .map((s) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim())
    .filter((s) => s !== "");
  if (segments.length === 0) return undefined;

  const family =
    normalizeFamily(styles?.fontFamily) ?? normalizeFamily(pageFont) ?? DEFAULT_FAMILY;
  const fam = METRICS.families[family] ?? METRICS.families[DEFAULT_FAMILY];

  // Weight: explicit style, else bold markup in the text itself.
  let weight = num(styles?.fontWeight) ?? (typeof styles?.fontWeight === "string" && /bold/i.test(styles.fontWeight) ? 700 : undefined) ?? 400;
  if (weight < 600 && /<(b|strong)\b|font-weight:\s*[6-9]00|font-weight:\s*bold/i.test(rawText)) weight = 700;
  const table = pickWeightTable(fam, weight);

  const upper = typeof styles?.textTransform === "string" && /uppercase/i.test(styles.textTransform);
  const ls = num(styles?.letterSpacing) ?? 0;

  // lineHeight: px when given with units/≥ fs, multiplier when a small bare number.
  const lhRaw = num(styles?.lineHeight);
  const lineHeightPx =
    lhRaw == null ? fs * DEFAULT_LINE_HEIGHT
    : (typeof styles.lineHeight === "string" && /px/i.test(styles.lineHeight)) || lhRaw > 4 ? lhRaw
    : fs * lhRaw;

  let lines = 0;
  for (const seg of segments) {
    lines += wrapLines(upper ? seg.toUpperCase() : seg, width, fs, table, ls);
  }
  return Math.round(lines * lineHeightPx);
}
