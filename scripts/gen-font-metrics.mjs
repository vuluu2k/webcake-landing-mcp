/**
 * Generates src/domains/landing/font-metrics.json — per-character advance
 * widths (per-mille of em) for the fonts a Webcake page can actually use, so
 * the validator's text-height estimate measures REAL glyph widths instead of
 * guessing 0.55em per char (which under-counts UPPERCASE/bold headings and
 * lets wrapped-text overlaps slip through).
 *
 * The family list IS the editor's canonical font picker
 * (landing_page_backend assets/editor/statics/fontFamily.js) plus a couple of
 * popular extras. Weights are 400 + 700 ONLY because that's what published
 * pages load: the build host requests `:100,300,400,700,900` per family
 * (landing_page_build render/build/load-font.js), so styles.fontWeight 500/600
 * renders with the nearest loaded face (400/700) — measuring 600 would model a
 * face that never ships. Custom uploaded fonts (@font-face via FontManage)
 * can't be measured here; the runtime falls back to the avg width.
 *
 * Run MANUALLY when the editor's font list changes:
 *   node scripts/gen-font-metrics.mjs
 * (needs network + the `fontkit` devDependency). The JSON output is committed;
 * runtime only reads it (copy-assets mirrors it into dist/).
 *
 * Output format v2 (compact): a shared `chars` string; each family/weight
 * stores `w` as an array of per-mille widths aligned to `chars` (0 = glyph
 * missing → runtime uses `avg`).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
const fontkit = createRequire(import.meta.url)("fontkit"); // CJS, no default export under ESM

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/domains/landing/font-metrics.json"
);

// The editor's font picker list (assets/editor/statics/fontFamily.js in
// landing_page_backend) — KEEP IN SYNC when the editor adds fonts.
const EDITOR_FONTS = [
  "Alegreya Sans", "Alegreya Sans SC", "Arial", "Barlow", "Barlow Semi Condensed",
  "Catamaran", "Encode Sans", "Encode Sans Condensed", "Encode Sans Expanded",
  "Encode Sans Semi Condensed", "Encode Sans Semi Expanded", "Epilogue", "Exo",
  "Exo 2", "Fira Sans", "Fira Sans Condensed", "Fira Sans Extra Condensed",
  "Gothic A1", "Heebo", "Inter", "Jost", "Kanit", "Lato", "Libre Franklin",
  "Livvic", "Montserrat", "Montserrat Alternates", "Overpass", "Poppins",
  "Prompt", "Public Sans", "Raleway", "Roboto", "Roboto Slab", "Saira",
  "Saira Condensed", "Saira Extra Condensed", "Saira Semi Condensed", "Spartan",
  "Tomorrow", "Work Sans", "Alfa Slab One", "Anton", "Arima Madurai", "Athiti",
  "Bahianita", "Baloo Bhaina 2", "Bungee", "Bungee Inline", "Bungee Outline",
  "Bungee Shade", "Chonburi", "Cormorant Upright", "Crimson Pro", "Dancing Script",
  "Dosis", "EB Garamond", "Hepta Slab", "Itim", "Josefin Sans", "Judson", "Jura",
  "K2D", "Literata", "Lobster", "Maven Pro", "Merriweather", "Muli", "Niramit",
  "Noto Serif", "Open Sans", "Oswald", "Pattaya", "Paytone One", "Philosopher",
  "Play", "Playfair Display", "Prata", "Quicksand", "Rokkitt", "Source Sans Pro",
  "Sriracha", "Taviraj", "Thasadith", "Tinos", "Trirong", "VT323", "Yeseva One",
];

// Popular with Vietnamese landing pages; usable as fontGeneral even though the
// picker doesn't list them (the renderer loads any Google family by name).
const EXTRA_FONTS = ["Be Vietnam Pro", "Nunito"];

// Families Google renamed/retired, or system fonts with a metric-compatible
// Google twin: measure the alias, store under the original key.
const ALIASES = {
  Arial: "Arimo", // metric-compatible by design
  Muli: "Mulish",
  Spartan: "League Spartan",
  "Source Sans Pro": "Source Sans 3",
};

const WEIGHTS = [400, 700];

// ASCII printable + full Vietnamese alphabet (both cases) + common punctuation.
function charset() {
  const chars = [];
  for (let c = 0x20; c <= 0x7e; c++) chars.push(String.fromCharCode(c));
  const viet =
    "àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ";
  for (const ch of viet) chars.push(ch, ch.toUpperCase());
  for (const ch of "–—‘’“”…·•₫°") chars.push(ch);
  return [...new Set(chars)];
}

/** css2 served to a non-browser UA returns plain TTF @font-face blocks. */
async function fetchTtfUrl(family, weight) {
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`;
  const res = await fetch(url, { headers: { "User-Agent": "node" } });
  if (!res.ok) return undefined;
  const css = await res.text();
  return css.match(/src:\s*url\((https:[^)]+)\)/)?.[1];
}

const CHARS = charset();
const families = {};
const skipped = [];

for (const display of [...EDITOR_FONTS, ...EXTRA_FONTS]) {
  const fetchName = ALIASES[display] ?? display;
  const key = display.toLowerCase();
  const tables = {};
  for (const weight of WEIGHTS) {
    let ttf = await fetchTtfUrl(fetchName, weight);
    if (!ttf && ALIASES[display]) ttf = await fetchTtfUrl(display, weight); // alias gone? try original
    if (!ttf) continue; // weight not offered (e.g. display fonts are 400-only)
    const buf = Buffer.from(await (await fetch(ttf)).arrayBuffer());
    const font = fontkit.create(buf);
    const upm = font.unitsPerEm;
    let sum = 0, n = 0;
    const w = CHARS.map((ch) => {
      const cp = ch.codePointAt(0);
      if (!font.hasGlyphForCodePoint(cp)) return 0;
      const mille = Math.round((font.glyphForCodePoint(cp).advanceWidth / upm) * 1000);
      if (ch >= "a" && ch <= "z") { sum += mille; n++; }
      return mille;
    });
    tables[weight] = { avg: n ? Math.round(sum / n) : 550, w };
  }
  if (Object.keys(tables).length === 0) {
    skipped.push(display);
    continue;
  }
  families[key] = tables;
  console.error(`  measured ${display}${ALIASES[display] ? ` (as ${ALIASES[display]})` : ""}: weights ${Object.keys(tables).join("/")}`);
}

if (skipped.length) console.error(`  SKIPPED (not on Google Fonts): ${skipped.join(", ")}`);

writeFileSync(OUT, JSON.stringify({ version: 2, chars: CHARS.join(""), families }));
console.error(`[gen-font-metrics] wrote ${OUT} (${Object.keys(families).length} families)`);
