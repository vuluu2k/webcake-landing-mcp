// clone_page merge step (no browser): desktop boxes scale onto 960, mobile boxes are used as
// measured, an element missing on mobile is hidden there, a mobile-only one is hidden on desktop,
// rotation survives, and the result saves as a valid page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCaptures } from "../dist/persistence/ingest/browser-capture.js";
import { landingDomain as D } from "../dist/domains/landing/index.js";

const el = (key, kind, box, extra = {}) => ({ key, kind, box, style: { "font-size": "20", "line-height": "1.5", color: "rgb(0, 0, 0)" }, ...extra });
const desk = {
  title: "T", description: "", width: 1200, truncated: false,
  sections: [{ key: "main>section0", top: 0, height: 500, background: { "background-color": "rgb(255, 255, 255)" }, elements: [
    el("h1", "headline", { top: 100, left: 600, width: 400, height: 30 }, { text: "Xin chào", tag: "h1" }),
    el("nav", "paragraph", { top: 10, left: 900, width: 200, height: 30 }, { text: "Menu dài" }),
    el("deco", "box", { top: 0, left: 0, width: 300, height: 300 }, { style: { "background-color": "rgb(1, 2, 3)", transform: "rotate(30deg)" } }),
  ] }],
};
const mob = {
  title: "T", description: "", width: 420, truncated: false,
  sections: [{ key: "main>section0", top: 0, height: 700, background: {}, elements: [
    el("h1", "headline", { top: 300, left: 20, width: 380, height: 60 }, { text: "Xin chào", tag: "h1" }),
    el("deco", "box", { top: 0, left: 0, width: 100, height: 100 }, { style: { "background-color": "rgb(1, 2, 3)" } }),
    el("burger", "shape", { top: 10, left: 370, width: 30, height: 30 }, { svg: "<svg viewBox='0 0 1 1'><rect width='1' height='1'/></svg>" }),
  ] }],
};

test("merge: desktop scaled to 960, mobile measured, hidden / mobile-only flagged", () => {
  const c = mergeCaptures(desk, mob);
  assert.equal(c.measured_mobile, true);
  const [h1, nav, deco, burger] = c.sections[0].elements;
  assert.equal(h1.box.top, 80); // 100 × 960/1200
  assert.equal(h1.box.left, 480);
  assert.equal(h1.style["font-size"], "16");
  assert.deepEqual({ top: h1.mobile.box.top, left: h1.mobile.box.left }, { top: 300, left: 20 });
  assert.equal(nav.mobile, null);
  assert.equal(deco.style.transform, "rotate(30deg)");
  assert.equal(burger.mobile.only, true);
  assert.equal(c.sections[0].mobile.height, 700);
});

test("merge → source: mobile hide / desktop hide / rotation land in the page and it validates", () => {
  const c = mergeCaptures(desk, mob);
  const { source, notes } = D.canvasToSource(c, { title: c.title });
  assert.ok(!notes.some((n) => /420\/960 horizontal scale/.test(n)));
  const saved = D.expand(source);
  D.autofixLayout(saved);
  const v = D.validate(saved);
  assert.ok(v.valid, v.errors.join("\n"));
  const kids = saved.page[0].children;
  const byText = (t) => kids.find((k) => k.specials?.text === t);
  assert.equal(byText("Xin chào").responsive.mobile.styles.top, 300);
  assert.equal(byText("Xin chào").specials.tag, "h1");
  assert.equal(byText("Menu dài").responsive.mobile.config.hide, true);
  assert.ok(kids.some((k) => k.responsive.desktop.config?.hide === true && k.type === "rectangle"));
  assert.ok(kids.some((k) => k.responsive.desktop.styles.transform === "rotate(30deg)"));
  assert.equal(saved.page[0].responsive.mobile.styles.height, 700);
});
