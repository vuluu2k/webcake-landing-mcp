#!/usr/bin/env node
// Mine real landing pages (READ-ONLY GETs with the token saved by `login`) into
// src/domains/landing/element-keys.generated.json: per element type, how often it is used, the
// specials / config / styles / properties keys seen, their value types, code-like values (few
// distinct identifiers used on 2+ pages — never text, URLs, colours, ids or one-off names), and
// parent / child type counts.
// The page sources themselves are NOT written to the repo; pass --cache <dir> to keep a local copy
// for validator false-positive checks.
//   npm run build && node scripts/mine-pages.mjs [--pages 400] [--cache /tmp/lp-pages]
import fs from "node:fs";
import path from "node:path";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const MAX = Number(arg("pages", 400));
const CACHE = arg("cache");
const OUT = path.resolve("src/domains/landing/element-keys.generated.json");
const { readConfig } = await import("../dist/persistence/config.js");
const client = await import("../dist/persistence/webcake-client.js");
const FROM = arg("from"); // a directory of page-source JSON files instead of the API
const { config, missing } = readConfig({});
if (!config && !FROM) {
  console.error(`No landing credentials (${missing.join(", ")}). Run \`node dist/index.js login\` first.`);
  process.exit(2);
}

const CODE = /^[a-zA-Z][a-zA-Z0-9_-]{0,30}$/;
const ID_LIKE = /^[a-z0-9]{8}$|^[0-9a-f-]{20,}$/;
const CONTENT_KEY = /label|placeholder|text|title|name|content|desc|alt|message|msg|link|url|src|href|class|css|html|code|icon|note|caption|email|phone|svg|image|formula|font/i;
const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
const db = {};
let pageNo = 0; // the page being walked: a value is kept only when 2+ pages use it (no one-off names / ids)
const values = {};
const entry = (t) => (db[t] ??= { seen: 0, specials: {}, config: {}, styles: {}, properties: {}, types: {}, parents: {}, children: {}, events: 0 });

function note(t, bucket, obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  const e = entry(t);
  for (const [k, v] of Object.entries(obj)) {
    e[bucket][k] = (e[bucket][k] || 0) + 1;
    const tk = `${bucket}.${k}`;
    if (v !== null && v !== undefined) (e.types[tk] ??= {})[typeOf(v)] = 1;
    if (bucket === "styles" || CONTENT_KEY.test(k)) continue;
    const vk = `${t}|${tk}`;
    if (values[vk] === null || v === null || v === undefined || v === "" || typeof v !== "string") continue;
    if (!CODE.test(v) || ID_LIKE.test(v)) values[vk] = null;
    else ((values[vk] ??= new Map()).get(v) ?? values[vk].set(v, new Set()).get(v)).add(pageNo);
  }
}
function walk(n, parent) {
  if (!n || typeof n !== "object" || typeof n.type !== "string") return;
  const e = entry(n.type);
  e.seen++;
  e.parents[parent] = (e.parents[parent] || 0) + 1;
  if (parent !== "(page)" && parent !== "(popup)") entry(parent).children[n.type] = (entry(parent).children[n.type] || 0) + 1;
  note(n.type, "specials", n.specials);
  note(n.type, "properties", n.properties);
  for (const bp of ["desktop", "mobile"]) {
    note(n.type, "config", n.responsive?.[bp]?.config);
    note(n.type, "styles", n.responsive?.[bp]?.styles);
  }
  if (Array.isArray(n.events) && n.events.length) e.events++;
  for (const c of Array.isArray(n.children) ? n.children : []) walk(c, n.type);
}

// /ai/pages returns only the 50 most recent; /ai/search_pages honours a limit (every page).
async function listAll() {
  const r = await client.searchPages(config, { limit: 1000 });
  return r.ok && r.pages?.length ? r : client.listPages(config);
}
const list = FROM
  ? { ok: true, pages: fs.readdirSync(FROM).filter((f) => f.endsWith(".json")).map((f) => ({ id: f.replace(/\.json$/, ""), file: path.join(FROM, f) })) }
  : await listAll();
if (!list.ok) {
  console.error(`listPages failed (${list.status}): ${list.error}`);
  process.exit(1);
}
if (CACHE) fs.mkdirSync(CACHE, { recursive: true });
let pages = 0;
for (const p of (list.pages || []).slice(0, MAX)) {
  const r = p.file ? { ok: true, source: fs.readFileSync(p.file, "utf8") } : await client.getPageSource(config, p.id);
  if (!r.ok || !r.source) continue;
  const src = typeof r.source === "string" ? JSON.parse(r.source) : r.source;
  pages++;
  pageNo = pages;
  for (const s of src.page || []) walk(s, "(page)");
  for (const s of src.popup || []) walk(s, "(popup)");
  if (CACHE && !p.file) fs.writeFileSync(path.join(CACHE, `${p.id}.json`), JSON.stringify(src));
}

const byCount = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
for (const [vk, byValue] of Object.entries(values)) {
  if (!byValue || byValue.size > 12) continue;
  const shared = [...byValue].filter(([, pagesUsing]) => pagesUsing.size >= 2).map(([v]) => v);
  if (!shared.length) continue;
  const [t, tk] = vk.split("|");
  (db[t].values ??= {})[tk] = shared.sort();
}
const out = {};
for (const t of Object.keys(db).sort()) {
  const e = db[t];
  out[t] = {
    seen: e.seen, events: e.events,
    specials: byCount(e.specials), config: byCount(e.config), styles: byCount(e.styles), properties: byCount(e.properties),
    types: Object.fromEntries(Object.entries(e.types).map(([k, v]) => [k, Object.keys(v).sort()])),
    ...(e.values ? { values: e.values } : {}),
    parents: byCount(e.parents), children: byCount(e.children),
  };
}
fs.writeFileSync(OUT, `{\n${Object.entries(out).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",\n")}\n}\n`);
console.error(`mined ${pages} pages (of ${list.pages?.length ?? 0}) → ${Object.keys(out).length} element types → ${path.relative(process.cwd(), OUT)}`);
