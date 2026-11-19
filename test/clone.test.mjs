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

test("browser effects: clip group, hover, gradient text, sticky header, icon fonts → native first, scoped css", () => {
  const card = {
    key: "card~clip", kind: "group", box: { top: 10, left: 100, width: 400, height: 300 },
    style: { overflow: "hidden", "border-radius": "20px", "box-shadow": "rgba(0,0,0,.2) 0px 4px 8px" },
    hover: "transform: translateY(-6px); box-shadow: rgba(0,0,0,.3) 0px 16px 32px", transition: "transform 0.3s",
    animation: { name: "zoomIn", duration: "0.6" },
    children: [
      el("card~bg", "box", { top: 0, left: 0, width: 400, height: 300 }, { style: { "background-color": "rgb(245, 243, 255)" }, hover: "background-color: red" }),
      el("blob", "box", { top: -80, left: 300, width: 200, height: 200 }, { style: { "background-color": "rgb(196, 181, 253)", transform: "rotate(25deg)" } }),
    ],
  };
  const title = el("title", "headline", { top: 20, left: 100, width: 600, height: 60 }, { text: 'Ánh sáng <span style="background:linear-gradient(90deg, red, blue);-webkit-background-clip:text;background-clip:text;color:transparent">mới</span>', tag: "h1" });
  const page = {
    title: "E", description: "", width: 1200, truncated: false, headLinks: ["https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"],
    sections: [
      { key: "header", top: 0, height: 64, sticky: true, background: { "background-color": "rgb(255, 255, 255)" }, elements: [] },
      { key: "hero", top: 64, height: 400, background: { "background-color": "rgb(0,0,0)", "background-image": "linear-gradient(135deg, rgb(124, 58, 237), rgb(236, 72, 153))" }, elements: [title, card] },
    ],
  };
  const { source } = D.canvasToSource(mergeCaptures(page, null), { title: "E" });
  const saved = D.expand(source);
  D.autofixLayout(saved);
  const v = D.validate(saved);
  assert.ok(v.valid, v.errors.join("\n"));
  const [header, hero] = saved.page;
  assert.deepEqual([header.responsive.desktop.config.sticky, header.responsive.desktop.config.stickyPosition], [true, "a-t"]);
  assert.match(hero.responsive.desktop.styles.background, /^linear-gradient/);
  const group = hero.children.find((c) => c.type === "group");
  assert.equal(group.specials.customAdvance, true);
  assert.match(group.specials.custom_css, /overflow:hidden;border-radius:16px;box-shadow:/);
  const blob = group.children.find((c) => c.responsive.desktop.styles.transform === "rotate(25deg)");
  assert.ok(blob.responsive.desktop.styles.top < 0, "a clip group's child keeps hanging over its edge (no clamp)");
  assert.equal(group.responsive.desktop.config.animation.name, "zoomIn");
  assert.match(hero.children.find((c) => c.type === "text-block").specials.text, /background-clip:text/);
  const css = saved.settings.extra_css;
  assert.match(css, new RegExp(`#w-${group.id}:hover\\{transform: translateY\\(-6px\\);box-shadow`));
  assert.ok(!/(^|\})\s*(body|div|\.)/.test(css), "every rule is scoped to #w-<id>");
  assert.match(saved.settings.bhet, /font-awesome/);
  assert.ok(!v.warnings.some((w) => /UNSCOPED/.test(w)), v.warnings.join("\n"));
});

test("extra_css rules of deleted elements are dropped on save", () => {
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  const t = D.createElement("text-block");
  sec.children = [t];
  src.page = [sec];
  src.settings.extra_css = `#w-${t.id}:hover .text-block-css{color:red}\n#w-gone1:hover{transform:scale(1.1)}`;
  const s = D.expand(src);
  const fixed = D.autofixLayout(s);
  assert.equal(s.settings.extra_css, `#w-${t.id}:hover .text-block-css{color:red}`);
  assert.ok(fixed.some((f) => /dropped 1 rule/.test(f)));
});
