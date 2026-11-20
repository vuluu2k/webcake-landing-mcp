#!/usr/bin/env node
// Find the inputs that crash the REAL landing renderer, per element type and key: start from the
// node the MCP builds for the type (createElement), mutate ONE key at a time (delete it / null /
// "" / 0 / [] / {}) in specials, per-breakpoint config and properties, render, and record every
// mutation that throws — with the renderer frame it threw in. The output is the evidence a
// validator rule needs ("specials.x missing → crash at renderX (index.js:N)"). A trailing "!" in
// the summary marks a crash the validator still calls valid.
//   npm run build && node scripts/fuzz-render.mjs [--out scratch/fuzz.json] [--types a,b]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const OUT = path.resolve(arg("out", "scratch/fuzz.json"));
const ONLY = arg("types") ? new Set(arg("types").split(",")) : null;
const BUILD_DIR = path.resolve(process.env.LANDING_BUILD_DIR || "../landing_page_build");
console.error(`renderer: ${(await import("./source-rev.mjs")).sourceRev(BUILD_DIR, "landing_page_build")}`);
const { landingDomain: D } = await import(new URL("../dist/domains/landing/index.js", import.meta.url).href);
process.chdir(BUILD_DIR);
const { default: build } = await import(pathToFileURL(path.join(BUILD_DIR, "render/build/index.js")).href);

const bodyOf = (src, id) => ({
  settings: src.settings || {}, page: src.page || [], popups: src.popup || [], options: src.options || {}, pageId: id,
  $cartConfigs: src.cartConfigs || {}, $syncVariations: src.svariations || [], products: [], domain: null,
  promotions: [], currency: "VND", multiple_currency: [], currency_activated: [], country_code: "VN",
});
let n = 0;
let lastValid = true;
async function crashOf(el) {
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  sec.children = [el];
  src.page = [sec];
  lastValid = D.validate(structuredClone(src)).valid;
  try {
    await build(bodyOf(src, `f${++n}`), { _uid: `fz${n}` });
    return null;
  } catch (e) {
    const at = String(e.stack || "").split("\n").find((l) => l.includes("render/build")) || "";
    return `${String(e.message || e).slice(0, 90)} @ ${at.trim().replace(/^at /, "").replace(/\(?file:\/\/.*render\/build\//, "").replace(/\)$/, "")}`;
  }
}

const MUTATIONS = { delete: undefined, null: null, empty: "", zero: 0, array: [], object: {} };
const out = {};
for (const type of D.elementTypes) {
  if (["section", "popup", "dynamic_page"].includes(type) || (ONLY && !ONLY.has(type))) continue;
  const base = D.createElement(type);
  const baseCrash = await crashOf(structuredClone(base));
  const rows = [];
  const targets = [
    ...Object.keys(base.specials || {}).map((k) => ["specials", k]),
    ...Object.keys(base.properties || {}).map((k) => ["properties", k]),
    ...Object.keys(base.responsive?.desktop?.config || {}).map((k) => ["config", k]),
  ];
  for (const [bucket, key] of targets)
    for (const [mname, mval] of Object.entries(MUTATIONS)) {
      const el = structuredClone(base);
      const objs = bucket === "config" ? [el.responsive.desktop.config, el.responsive.mobile.config] : [el[bucket]];
      for (const o of objs) {
        if (mname === "delete") delete o[key];
        else o[key] = structuredClone(mval);
      }
      const c = await crashOf(el);
      if (c && c !== baseCrash) rows.push({ at: `${bucket}.${key}`, mutation: mname, crash: c, validator_says_valid: lastValid });
    }
  // also: no children for containers that render children[0]
  if (Array.isArray(base.children) && base.children.length) {
    const el = structuredClone(base);
    el.children = [];
    const c = await crashOf(el);
    if (c) rows.push({ at: "children", mutation: "empty", crash: c, validator_says_valid: lastValid });
  }
  out[type] = { base_crash: baseCrash, crashes: rows };
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const total = Object.values(out).reduce((s, r) => s + r.crashes.length, 0);
const missed = Object.values(out).reduce((s, r) => s + r.crashes.filter((c) => c.validator_says_valid).length, 0);
console.log(`${Object.keys(out).length} types, ${n} renders, ${total} crashing mutations (validator misses ${missed}) → ${OUT}`);
for (const [t, r] of Object.entries(out)) {
  if (r.base_crash) console.log(`  ${t}: CRASHES AS BUILT — ${r.base_crash}`);
  const keys = [...new Set(r.crashes.map((c) => `${c.at}(${c.mutation})${c.validator_says_valid ? "!" : ""}`))];
  if (keys.length) console.log(`  ${t}: ${keys.slice(0, 12).join(" ")}${keys.length > 12 ? ` …+${keys.length - 12}` : ""}`);
}
