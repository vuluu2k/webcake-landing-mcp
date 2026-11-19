#!/usr/bin/env node
// Every element type, built the way the MCP hands it out, rendered by the REAL landing renderer
// (landing_page_build/render/build) and opened in Chrome: does it show?
//   VISIBLE  — the box has size and something in it paints (text, image, background, border, shadow)
//   EMPTY    — in the DOM but 0×0 or nothing paints (usually needs data, children or a real src)
//   MISSING  — no #w-<id> in the HTML
//   CRASH    — the renderer throws on the page
// Two builds per type: `bare` = createElement (the expand seed: what a sparse node the AI writes
// gets), `preset` = presetElement (what new_element / get_element hand out = the editor's drop).
// Each type sits alone in its own section, inside the parent it needs (PARENTS).
//   npm run build && node scripts/render-smoke.mjs [--verbose]   (LANDING_BUILD_DIR, CHROME_BIN)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const BUILD_DIR = path.resolve(process.env.LANDING_BUILD_DIR || path.join(ROOT, "../landing_page_build"));
const verbose = process.argv.includes("--verbose");
const { landingDomain: D } = await import(pathToFileURL(path.join(ROOT, "dist/domains/landing/index.js")).href);
const { PARENTS } = await import(pathToFileURL(path.join(ROOT, "dist/domains/landing/element-schema.js")).href);
const { chromium } = await import("playwright-core");
process.chdir(BUILD_DIR);
const { default: build } = await import(pathToFileURL(path.join(BUILD_DIR, "render/build/index.js")).href);

const SKIP = new Set(["section", "popup", "dynamic_page"]);
const types = D.elementTypes.filter((t) => !SKIP.has(t));

function pageOf(make) {
  const src = D.createPageSource({});
  const ids = {};
  src.page = types.map((t) => {
    const sec = D.createElement("section");
    for (const bp of ["desktop", "mobile"]) sec.responsive[bp].styles.height = 640;
    const el = make(t);
    ids[t] = el.id;
    let top = el;
    const parent = PARENTS[t]?.[0];
    if (parent) {
      top = D.createElement(parent);
      top.children = [el];
    }
    for (const bp of ["desktop", "mobile"]) Object.assign(top.responsive[bp].styles, { top: 20, left: 20 });
    sec.children = [top];
    return sec;
  });
  return { src, ids };
}

const body = (s) => ({ settings: s.settings, page: s.page, popups: s.popup || [], options: s.options || {}, pageId: "smoke", $cartConfigs: {}, $syncVariations: [], products: [], domain: null, promotions: [], currency: "VND", multiple_currency: [], currency_activated: [], country_code: "VN" });

async function renderOne(src, uid) {
  try {
    return await build(body(src), { _uid: uid });
  } catch (e) {
    return { crash: String(e.message || e).slice(0, 100) };
  }
}

const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: "chrome" });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "render-smoke-"));

async function judge(mode, make) {
  const { src, ids } = pageOf(make);
  const saved = D.expand(src);
  D.autofixLayout(saved);
  const v = D.validate(saved);
  const out = {};
  const whole = await renderOne(saved, `rs-${mode}`);
  if (whole.crash) {
    // find the types that blank the page: render each section alone
    for (const [i, t] of types.entries()) {
      const one = await renderOne({ ...saved, page: [saved.page[i]] }, `rs-${mode}-${i}`);
      out[t] = one.crash ? { status: "CRASH", why: one.crash } : null;
    }
  }
  const file = path.join(tmp, `${mode}.html`);
  const rest = whole.crash ? await renderOne({ ...saved, page: saved.page.filter((_, i) => !out[types[i]]) }, `rs-${mode}-ok`) : whole;
  if (rest.crash) throw new Error(`${mode}: the page still fails after removing the crashing sections — ${rest.crash}`);
  const { app = "", app_css = "" } = rest;
  // the runtime removes .lazy as sections scroll into view (render_v4) — do it up front
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${app_css}</head><body style="margin:0">${app}<script>document.querySelectorAll('.lazy').forEach(e=>e.classList.remove('lazy'))</script></body></html>`);
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.waitForTimeout(800);
  const seen = await page.evaluate((ids) => {
    const alpha = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || "");
      if (!m) return c && c !== "transparent" ? 1 : 0;
      const p = m[1].split(/[ ,/]+/).filter(Boolean);
      return p.length > 3 ? parseFloat(p[3]) : 1;
    };
    const paints = (n) => {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return null;
      const r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      if (/^(IMG|VIDEO|IFRAME|CANVAS|svg|INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return n.tagName.toLowerCase();
      if (alpha(s.backgroundColor) > 0) return "background";
      if (s.backgroundImage !== "none") return "background-image";
      if (s.boxShadow !== "none") return "shadow";
      for (const side of ["Top", "Right", "Bottom", "Left"]) if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== "none" && alpha(s[`border${side}Color`]) > 0) return "border";
      for (const c of n.childNodes)
        if (c.nodeType === 3 && c.textContent.trim() && alpha(s.color) > 0 && parseFloat(s.fontSize) > 0) {
          const g = document.createRange();
          g.selectNodeContents(c);
          const b = g.getBoundingClientRect();
          if (b.width >= 1 && b.height >= 1) return "text";
        }
      return null;
    };
    const res = {};
    for (const [t, id] of Object.entries(ids)) {
      const el = document.getElementById(`w-${id}`);
      if (!el) {
        res[t] = { status: "MISSING" };
        continue;
      }
      const r = el.getBoundingClientRect();
      let how = null;
      for (const n of [el, ...el.querySelectorAll("*")]) if ((how = paints(n))) break;
      res[t] = { status: how ? "VISIBLE" : "EMPTY", how, box: `${Math.round(r.width)}×${Math.round(r.height)}` };
    }
    return res;
  }, Object.fromEntries(Object.entries(ids).filter(([t]) => !out[t])));
  await page.close();
  return { res: { ...seen, ...Object.fromEntries(Object.entries(out).filter(([, r]) => r)) }, errors: v.errors };
}

const bare = await judge("bare", (t) => D.createElement(t));
const preset = await judge("preset", (t) => D.presetElement(t));
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });

const count = (r, s) => Object.values(r).filter((x) => x.status === s).length;
for (const [name, r] of [["bare  ", bare], ["preset", preset]])
  console.log(`${name}: ${types.length} types — visible ${count(r.res, "VISIBLE")}, empty ${count(r.res, "EMPTY")}, missing ${count(r.res, "MISSING")}, crash ${count(r.res, "CRASH")}${r.errors.length ? `, validate errors ${r.errors.length}` : ""}`);
for (const t of types) {
  const a = bare.res[t], b = preset.res[t];
  if (!verbose && a.status === "VISIBLE" && b.status === "VISIBLE") continue;
  const f = (x) => `${x.status}${x.how ? `(${x.how})` : ""}${x.box ? ` ${x.box}` : ""}${x.why ? ` ${x.why}` : ""}`;
  console.log(`  ${t.padEnd(22)} bare ${f(a).padEnd(34)} preset ${f(b)}`);
}
for (const e of [...bare.errors, ...preset.errors].slice(0, 5)) console.log(`  validate: ${e}`);
process.exitCode = count(preset.res, "CRASH") || count(bare.res, "CRASH") ? 1 : 0;
