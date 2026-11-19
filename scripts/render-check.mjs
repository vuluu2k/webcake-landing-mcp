#!/usr/bin/env node
// Run page sources through the REAL landing renderer (landing_page_build/render/build — the
// service landing_page_backend posts to /render/build) and compare with validatePage:
//   1. every element type the MCP builds (createElement), alone in a section;
//   2. every *.json page source in --pages <dir> (e.g. real pages dumped for a false-positive check).
// A renderer crash the validator calls valid is a MISSED rule; an invalid page that renders is a
// candidate false positive. Dev machine only; no backend, no browser, no token.
//   npm run build && node scripts/render-check.mjs [--pages <dir>] [--verbose]
//   LANDING_BUILD_DIR=../landing_page_build (default)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const verbose = process.argv.includes("--verbose");
const BUILD_DIR = path.resolve(process.env.LANDING_BUILD_DIR || "../landing_page_build");
const entry = path.join(BUILD_DIR, "render/build/index.js");
if (!fs.existsSync(entry)) {
  console.error(`No landing renderer at ${entry} — set LANDING_BUILD_DIR (and npm ci there).`);
  process.exit(2);
}
// The renderer resolves its own deps from its repo: run it from there.
process.chdir(BUILD_DIR);
const { default: build } = await import(pathToFileURL(entry).href);
const { landingDomain: D } = await import(new URL("../dist/domains/landing/index.js", import.meta.url).href);

/** The body landing_page_backend posts to /render/build (lib/landing_page/pages/pages.ex). */
const bodyOf = (src, id) => ({
  settings: src.settings || {}, page: src.page || [], popups: src.popup || [], options: src.options || {}, pageId: id,
  $cartConfigs: src.cartConfigs || {}, $syncVariations: src.svariations || [], products: [], domain: null,
  promotions: [], currency: "VND", multiple_currency: [], currency_activated: [], country_code: "VN",
});
async function render(src, id) {
  try {
    const out = await build(bodyOf(src, id), { _uid: `rc-${id}` });
    return { ok: true, html: out.app || "" };
  } catch (e) {
    const at = String(e.stack || "").split("\n").find((l) => l.includes("render/build")) || "";
    // A dataset/sheet fetch to a host this machine cannot reach is the environment, not the source.
    if (/ENOTFOUND|ECONNREFUSED|getaddrinfo/.test(String(e.message))) return { ok: true, html: "", env: String(e.message).slice(0, 80) };
    return { ok: false, err: `${e.message || e}`.slice(0, 120), at: at.trim().replace(/^at /, "").replace(/file:\/\/.*render\/build\//, "") };
  }
}

const report = { types: {}, pages: {} };
// 1. element types
for (const type of D.elementTypes) {
  if (["section", "popup", "dynamic_page"].includes(type)) continue;
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  const el = D.createElement(type);
  sec.children = [el];
  src.page = [sec];
  const v = D.validate(src);
  const r = await render(src, type);
  report.types[type] = { crash: r.ok ? null : `${r.err} @ ${r.at}`, inHtml: r.ok ? r.html.includes(el.id) : false, valid: v.valid };
}
// 2. page sources
const dir = arg("pages");
if (dir)
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const v = D.validate(raw);
    const r = await render(raw, f.replace(/\.json$/, ""));
    // What a save stores: expand → repair + layout autofix → validate.
    const saved = D.expand(structuredClone(raw));
    const fixed = D.autofixLayout(saved);
    const sv = D.validate(saved);
    const sr = await render(saved, `${f.replace(/\.json$/, "")}-saved`);
    report.pages[f] = {
      crash: r.ok ? null : `${r.err} @ ${r.at}`, valid: v.valid, firstError: v.errors[0]?.slice(0, 120),
      saved: { crash: sr.ok ? null : `${sr.err} @ ${sr.at}`, valid: sv.valid, firstError: sv.errors[0]?.slice(0, 120), repairs: fixed.length },
    };
  }

const t = Object.entries(report.types);
const p = Object.entries(report.pages);
const missed = (rows) => rows.filter(([, r]) => r.crash && r.valid);
console.log(`types ${t.length}: crash ${t.filter(([, r]) => r.crash).length} (missed by validator ${missed(t).length}), not in HTML ${t.filter(([, r]) => !r.crash && !r.inHtml).length}`);
for (const [k, r] of t) if (r.crash || !r.inHtml || verbose) console.log(`  ${k.padEnd(22)} ${r.crash ? `CRASH ${r.crash}` : r.inHtml ? "ok" : "not in HTML"}${r.crash && r.valid ? "  ← validator says valid" : ""}`);
if (p.length) {
  console.log(`pages as stored ${p.length}: crash ${p.filter(([, r]) => r.crash).length} (missed by validator ${missed(p).length}), invalid but renders ${p.filter(([, r]) => !r.crash && !r.valid).length}`);
  for (const [k, r] of p) if (r.crash || !r.valid) console.log(`  ${r.valid ? "VALID  " : "INVALID"} ${r.crash ? `CRASH ${r.crash}` : "renders"}${r.firstError ? ` | ${r.firstError}` : ""}`);
  const s = p.map(([k, r]) => [k, r.saved]);
  console.log(`after a save (expand + repair): crash ${s.filter(([, r]) => r.crash).length} (missed ${missed(s).length}), refused ${s.filter(([, r]) => !r.valid).length} of which render fine ${s.filter(([, r]) => !r.crash && !r.valid).length}; repairs applied on ${s.filter(([, r]) => r.repairs).length} pages`);
  for (const [k, r] of s) if (r.crash || !r.valid) console.log(`  ${r.valid ? "VALID  " : "INVALID"} ${r.crash ? `CRASH ${r.crash}` : "renders"}${r.firstError ? ` | ${r.firstError}` : ""}`);
}
// A stored page that crashes but is valid is fine if a save repairs it: judge pages after the save.
process.exitCode = missed(t).length || p.some(([, r]) => r.saved.crash && r.saved.valid) ? 1 : 0;
