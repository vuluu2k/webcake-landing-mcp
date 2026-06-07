/**
 * Generate src/changelog.json from CHANGELOG.md (+ CHANGELOG.vi.md) so the landing
 * page (web-guide.ts) can show a bilingual "What's new" dynamically, without
 * hand-syncing a hardcoded list.
 *
 * Why a build step (not a runtime read of the markdown): the npm package ships
 * only `dist` (package.json "files": ["dist"]), so the CHANGELOG files aren't
 * present at runtime. This emits a small JSON next to the source; copy-assets.mjs
 * then mirrors every src/**\/*.json into dist/, so web-guide reads dist/changelog.json
 * at runtime (same mechanism as page-schema.json).
 *
 * Parses the Keep-a-Changelog headers `## [x.y.z] - YYYY-MM-DD` from BOTH the
 * English and Vietnamese files, keeping the top N releases with their section type
 * (Added/Changed/Fixed/…) and first bullet in each language. The English file
 * drives the version list/order; Vietnamese text falls back to English if missing.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX = 6;

function clean(s) {
  return s
    .replace(/`([^`]*)`/g, "$1") // strip inline code ticks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) -> text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** -> bold
    .replace(/\s+/g, " ")
    .trim();
}
function fmtDate(d) {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d.trim();
}
function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

// Parse one CHANGELOG markdown file -> ordered list of { v, d, type, t }.
function parse(md) {
  const out = [];
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const head = line.match(/^##\s+\[([^\]]+)\]\s*-\s*(.+?)\s*$/);
    if (head) {
      cur = { v: head[1].trim(), d: fmtDate(head[2]), type: "", t: "" };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const type = line.match(/^###\s+(.+?)\s*$/);
    if (type) {
      if (!cur.type) cur.type = type[1].trim();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+?)\s*$/);
    if (bullet && !cur.t) cur.t = truncate(clean(bullet[1]), 150);
  }
  return out.filter((e) => /^\d/.test(e.v) && e.t); // skip "Unreleased" / empty
}

const en = parse(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
const viPath = join(ROOT, "CHANGELOG.vi.md");
const viByVersion = new Map(
  (existsSync(viPath) ? parse(readFileSync(viPath, "utf8")) : []).map((e) => [e.v, e]),
);

// English drives the order; merge the Vietnamese bullet per version (fallback to EN).
const out = en.slice(0, MAX).map((e) => {
  const vi = viByVersion.get(e.v);
  return { v: e.v, d: e.d, type: e.type, en: e.t, vi: vi ? vi.t : e.t };
});

writeFileSync(join(ROOT, "src", "changelog.json"), JSON.stringify(out, null, 2) + "\n");
console.error(
  `[gen-changelog] wrote ${out.length} bilingual entr${out.length === 1 ? "y" : "ies"} -> src/changelog.json`,
);
