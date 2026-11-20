#!/usr/bin/env node
// Clone fidelity for the landing platform (dev machine: Chrome + ../landing_page_build). For each
// fixture (test/fidelity/fixtures/*.html) or URL argument: capture it in Chrome (browser-capture.ts),
// convert (canvasToPageSource), save it like create_page does (expand → repair → validate), render it
// through the REAL landing renderer (+ settings.bhet in <head> and settings.extra_css, which the
// published page's template / runtime inject; the runtime also hides the #sticky-<id> placeholders on
// load — render_v4/sticky), open it at 1200 and 420 and score it against the source:
//   text found · position error (canvas px) · height ratio. Screenshots → test/fidelity/out/.
//   npm run build && node scripts/clone-check.mjs [url|file …]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const OUT = path.join(ROOT, "test/fidelity/out");
fs.mkdirSync(OUT, { recursive: true });
const BUILD_DIR = path.resolve(process.env.LANDING_BUILD_DIR || path.join(ROOT, "../landing_page_build"));
console.error(`renderer: ${(await import("./source-rev.mjs")).sourceRev(BUILD_DIR, "landing_page_build")}`);
const { captureLayout } = await import(pathToFileURL(path.join(ROOT, "dist/persistence/ingest/browser-capture.js")).href);
const { landingDomain: D } = await import(pathToFileURL(path.join(ROOT, "dist/domains/landing/index.js")).href);
const { chromium } = await import("playwright-core");
const ARGS = process.argv.slice(2).map((a) => (/^https?:/.test(a) ? a : path.resolve(a))); // before chdir
process.chdir(BUILD_DIR);
const { default: build } = await import(pathToFileURL(path.join(BUILD_DIR, "render/build/index.js")).href);

const targets = ARGS.length
  ? ARGS
  : fs.readdirSync(path.join(ROOT, "test/fidelity/fixtures")).filter((f) => f.endsWith(".html")).map((f) => path.join(ROOT, "test/fidelity/fixtures", f));

const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: "chrome" });
/** Visible text lines with their boxes, relative to the page (top) and to the content column (left). */
async function texts(url, width, column) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => undefined);
  // Same as the capture: an app shell scrolling inside a full-height box is unlocked first.
  await page.evaluate(() => {
    const vh = window.innerHeight;
    if (document.documentElement.scrollHeight > vh * 1.5) return;
    const sc = [...document.querySelectorAll("body *")].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 200 && e.clientHeight > vh * 0.6);
    for (let n = sc; n; n = n.parentElement) for (const [k, v] of [["height", "auto"], ["max-height", "none"], ["overflow", "visible"], ["overflow-y", "visible"]]) n.style.setProperty(k, v, "important");
  });
  // The published page paints backgrounds lazily (.lazy) on scroll: scroll through like a visitor.
  await page.evaluate(async () => {
    // as slow as the capture: reveal-on-scroll content must settle the same way on both sides
    document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += Math.max(400, Math.ceil(h / 80))) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(300);
  const name = path.basename(url).replace(/\W+/g, "_");
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true }).catch(() => undefined);
  const res = await page.evaluate((column) => {
    const out = [];
    const colLeft = column ? Math.max(0, (document.documentElement.clientWidth - column) / 2) : 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const t = n.textContent.trim();
      if (t.length < 3) continue;
      const el = n.parentElement;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || el.closest("script,style,noscript")) continue;
      // hidden by an ancestor's opacity / visibility (closed menus, off-state tabs) is not on the page
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
      // the glyphs' own box (a Range), not the parent's — padding would bias the comparison
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // clipped away by an overflow:hidden ancestor (a collapsed menu): not visible either
      let clip = false;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const s2 = getComputedStyle(a);
        if (s2.overflow === "visible") continue;
        const q = a.getBoundingClientRect();
        if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1 || r.right <= q.left + 1 || r.left >= q.right - 1) { clip = true; break; }
      }
      if (clip) continue;
      out.push({ t: t.slice(0, 40), top: r.top + scrollY, left: r.left - colLeft });
    }
    return { out, height: document.documentElement.scrollHeight };
  }, column);
  await page.close();
  return res;
}

const rows = [];
for (const t of targets) {
  const url = /^https?:/.test(t) ? t : pathToFileURL(path.resolve(t)).href;
  const target = /^https?:/.test(t) ? { url } : { html: fs.readFileSync(t, "utf8") };
  const canvas = await captureLayout(target);
  const { source, notes } = D.canvasToSource(canvas, { title: canvas.title });
  const saved = D.expand(source);
  const fixed = D.autofixLayout(saved);
  const v = D.validate(saved);
  const body = { settings: saved.settings, page: saved.page, popups: saved.popup, options: saved.options, pageId: "clone", $cartConfigs: {}, $syncVariations: [], products: [], domain: null, promotions: [], currency: "VND", multiple_currency: [], currency_activated: [], country_code: "VN" };
  const { app, app_css } = await build(body, { _uid: `cc${rows.length}` });
  const name = path.basename(t).replace(/\W+/g, "_");
  const htmlFile = path.join(OUT, `${name}.clone.html`);
  fs.writeFileSync(htmlFile, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${app_css}${saved.settings.bhet || ""}<style>${saved.settings.extra_css || ""}[id^="sticky-"]{display:none}</style></head><body style="margin:0">${app}</body></html>`);
  const row = { name, elements: canvas.element_count, extra_css: (saved.settings.extra_css || "").length, valid: v.valid, errors: v.errors.slice(0, 3), warnings: v.warnings.length, repairs: fixed.length, notes: notes.length };
  for (const [w, cw] of [[1200, 960], [420, 420]]) {
    const src = await texts(url, w, 0);
    const cl = await texts(pathToFileURL(htmlFile).href, w, w === 1200 ? 960 : 0);
    const k = cw / w;
    let found = 0, dx = 0, dy = 0;
    const dys = [];
    const used = new Set();
    for (const s of src.out) {
      const i = cl.out.findIndex((c, j) => !used.has(j) && c.t === s.t);
      if (i < 0) continue;
      used.add(i);
      found++;
      dx += Math.abs(cl.out[i].left - s.left * k);
      dy += Math.abs(cl.out[i].top - s.top * k);
      dys.push(Math.abs(cl.out[i].top - s.top * k));
    }
    row[`text@${w}`] = `${found}/${src.out.length}`;
    row[`dx@${w}`] = found ? Math.round(dx / found) : null;
    row[`dy@${w}`] = found ? Math.round(dy / found) : null;
    // the median: robust to repeated texts ("Xem thêm"…) matched to the wrong occurrence
    row[`dyMed@${w}`] = dys.length ? Math.round(dys.sort((a, b) => a - b)[Math.floor(dys.length / 2)]) : null;
    row[`h@${w}`] = Math.round((cl.height / (src.height * k)) * 100) / 100;
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();
process.exit(0);
