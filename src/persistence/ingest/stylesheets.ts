/**
 * Raw-CSS / text extractors + font/color ranking + mojibake repair.
 */

// ─── stylesheet regex helpers ────────────────────────────────────────────────

/** Extract content of all <style> tags from raw HTML (fast, no full parse needed). */
export function extractStyleBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) blocks.push(m[1]);
  }
  return blocks;
}

/** Extract Google Font family names from <link> hrefs. */
export function extractGoogleFonts(html: string): string[] {
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

export const COLOR_RE = /(?:rgba?|hsla?)\([^)]+\)|#[0-9a-fA-F]{3,8}\b/g;
export const FONT_RE = /font-family\s*:\s*([^;}{]+)/gi;
export const CSS_VAR_RE = /--([\w-]+)\s*:\s*([^;}{]+)/g;
export const BG_IMAGE_RE = /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi;
export const GRADIENT_RE = /(?:linear|radial)-gradient\([^)]+(?:\([^)]*\)[^)]*)*\)/gi;

/** Collect CSS custom-property colors from stylesheet text. Returns { name: color }. */
export function extractCssVarPalette(stylesheets: string[]): Record<string, string> {
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
export function extractStylesheetColors(stylesheets: string[]): string[] {
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
export function extractStylesheetFonts(stylesheets: string[]): string[] {
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
export function extractBackgroundImages(sources: string[]): string[] {
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
export function extractGradients(stylesheets: string[]): string[] {
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

// ─── color / font helpers ────────────────────────────────────────────────────

export function topColors(styles: string[], n: number): string[] {
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

export function topFonts(styles: string[], n: number): string[] {
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
export function mergeTopN(ranked: string[], n: number): string[] {
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
export function mergeTopNFonts(ranked: string[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of ranked) {
    const k = f.toLowerCase();
    if (!seen.has(k) && !GENERIC_FONTS.has(k) && !ICON_FONT_RE.test(k)) { seen.add(k); out.push(f); }
    if (out.length >= n) break;
  }
  return out;
}

// ─── mojibake repair ─────────────────────────────────────────────────────────

// UTF-8 bytes mis-decoded as Latin-1 ("Táº¨Y LÃ”NG" instead of "TẨY LÔNG") —
// common in saved-to-disk builder exports. Signature pairs of the double
// decoding; genuine Vietnamese text contains the precomposed letters instead.
const MOJIBAKE_RE = /Ã[-ÿ]|á»|áº|Æ°/g;
const GENUINE_VI_RE = /[ăđơưạảắằẵặẹẻẽềếểễệịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/g;

/** Repair mojibake by re-encoding through Latin-1; null when not mojibake (or not safely repairable). */
export function fixMojibake(html: string): string | null {
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
