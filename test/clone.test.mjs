// clone_page merge step (no browser): desktop boxes scale onto 960, mobile boxes are used as
// measured, an element missing on mobile is hidden there, a mobile-only one is hidden on desktop,
// rotation survives, and the result saves as a valid page.
import { test, after } from "node:test";
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

test("popups, popup/anchor events, sliders → native popup + open_popup / scroll_to + carousel", () => {
  const btn = el("btn", "button", { top: 100, left: 400, width: 200, height: 48 }, { text: "Nhận mã", style: { "background-color": "rgb(220, 38, 38)", color: "rgb(255,255,255)", "font-size": "18" }, target: { type: "popup", action: "POPUP1" } });
  const nav = el("nav", "paragraph", { top: 10, left: 20, width: 100, height: 20 }, { text: "Tính năng", target: { type: "section", action: "SECTION2" } });
  const slide = (n) => ({ key: `s${n}`, kind: "slide", box: { top: 0, left: 0, width: 300, height: 200 }, style: {}, children: [el(`t${n}`, "paragraph", { top: 20, left: 20, width: 200, height: 24 }, { text: `Slide ${n}` })] });
  const slider = { key: "sl~slider", kind: "slider", box: { top: 40, left: 100, width: 900, height: 200 }, style: {}, nav: true, children: [1, 2, 3, 4].map(slide) };
  const page = {
    title: "P", description: "", width: 1200, truncated: false, headLinks: [],
    sections: [
      { key: "a", top: 0, height: 300, background: { "background-color": "rgb(255,255,255)" }, elements: [nav, btn] },
      { key: "b", top: 300, height: 300, background: { "background-color": "rgb(255,255,255)" }, elements: [slider] },
    ],
    popups: [{ key: "POPUP1", top: 0, height: 300, width: 420, background: {}, style: { "background-color": "rgb(255,255,255)" }, elements: [el("ph", "headline", { top: 20, left: 20, width: 300, height: 30 }, { text: "Đăng ký" })] }],
  };
  const { source } = D.canvasToSource(mergeCaptures(page, null), { title: "P" });
  const saved = D.expand(source);
  D.autofixLayout(saved);
  const v = D.validate(saved);
  assert.ok(v.valid, v.errors.join("\n"));
  assert.equal(saved.popup.length, 1);
  const ev = saved.page[0].children.flatMap((c) => c.events ?? []);
  assert.ok(ev.some((e) => e.action === "open_popup" && e.target === saved.popup[0].id));
  assert.ok(ev.some((e) => e.action === "scroll_to" && e.target === saved.page[1].id));
  const car = saved.page[1].children.find((c) => c.type === "carousel");
  assert.equal(car.children.length, 4);
  assert.deepEqual([car.responsive.desktop.config.slideWidth, car.responsive.desktop.config.slideToShow, car.responsive.desktop.styles.width], [240, 3, 720]);
  assert.ok(car.children.every((s) => s.type === "slide" && s.children.some((k) => k.type === "text-block")));
});

test("measured text keeps its height (virtualHeight) and tight gaps; containers grow only by real spill", () => {
  const lines = [0, 1, 2].map((i) => el(`l${i}`, "paragraph", { top: 10 + i * 22, left: 20, width: 300, height: 20 }, { text: `Dòng số ${i} của một đoạn văn bản dài` }));
  const tilted = el("pic", "image", { top: 200, left: 400, width: 300, height: 400 }, { src: "https://x.test/a.jpg", style: { transform: "rotate(10deg)" } });
  const page = { title: "M", description: "", width: 1200, truncated: false, headLinks: [], sections: [{ key: "a", top: 0, height: 375, background: {}, elements: [...lines, tilted] }] };
  const { source } = D.canvasToSource(mergeCaptures(page, null), { title: "M" });
  const saved = D.expand(source);
  const fixed = D.autofixLayout(saved);
  const texts = saved.page[0].children.filter((c) => c.type === "text-block");
  assert.deepEqual(texts.map((t) => t.responsive.desktop.styles.top), [8, 26, 43]);
  assert.ok(texts.every((t) => t.responsive.desktop.config.virtualHeight === t.responsive.desktop.styles.height));
  assert.equal(saved.page[0].responsive.desktop.styles.height, 300, fixed.join("\n"));
});

// In Chrome (skipped on a host without Playwright + Chrome): a store-like page — fixed header over a
// spacer, <main> with ONE wrapper around its sections, a cookie bar with its dim backdrop, a chat bubble.
const { playwrightInstalled } = await import("../dist/persistence/screenshot-playwright.js");
const { captureLayout } = await import("../dist/persistence/ingest/browser-capture.js");
after(() => setTimeout(() => process.exit(), 100).unref()); // the shared Chrome stays open otherwise
test("browser: overlays dismissed, fixed header = sticky section, a wrapped <main> split into its sections", { skip: !(await playwrightInstalled()) }, async () => {
  const block = (i) => `<section style="height:700px;padding:40px;background:${i % 2 ? "#f4f4f4" : "transparent"}"><h2>Khối ${i}</h2><p>Nội dung ${i}</p></section>`;
  const html = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
    <header style="position:fixed;top:0;left:0;right:0;height:80px;background:#fff;font-family:Pangea, 'Pangea Fallback'"><nav style="padding-top:30px"><a href="/a">Nam</a> <a href="/b">Nữ</a> <a href="/c">Hỗ trợ</a>
      <span style="display:inline-block"><a href="/bf" style="position:relative;padding:20px">BLACK FRIDAY<span style="position:absolute;right:0;top:0;background:#d9ff00;font-size:10px">MUA 1 TẶNG 1</span></a></span>
      <input placeholder="Tìm kiếm..." style="border:1px solid #ccc;border-radius:99px;padding:8px;width:200px">
      <span style="position:relative;display:inline-block;width:300px;height:20px"><a href="/t"><span style="position:absolute;left:0;top:0">MIỄN PHÍ VẬN CHUYỂN</span></a></span></nav></header>
    <div style="height:80px"></div>
    <main><div style="background:#fafafa">${[1, 2, 3, 4].map(block).join("")}</div></main>
    <div id="bd" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"></div>
    <div id="cb" style="position:fixed;bottom:0;left:0;right:0;padding:12px;background:#fff">Chúng tôi dùng cookie để cải thiện trải nghiệm
      <button onclick="document.getElementById('cb').remove();document.getElementById('bd').remove()">Chấp nhận tất cả</button></div>
    <div id="contact-fab" style="position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#22f"><button>Hỗ trợ</button></div>
  </body></html>`;
  const c = await captureLayout({ html });
  const texts = JSON.stringify(c.sections);
  assert.ok(!/cookie|Chấp nhận/.test(texts), "the cookie bar is left out");
  assert.equal((texts.match(/Hỗ trợ/g) ?? []).length, 1, "the chat bubble is left out, the header's own link stays");
  assert.equal(c.sections[0].sticky, true, "the fixed header is the sticky first section");
  const head = c.sections[0].elements;
  const textOf = (t) => head.find((e) => e.text?.includes(t));
  assert.notEqual(textOf("BLACK FRIDAY"), textOf("MUA 1 TẶNG 1"), "an absolute badge over a link is its own element");
  assert.ok(head.some((e) => e.type === "box" && e.style["background-color"] === "rgba(217, 255, 0, 1)"), "…with its paint");
  assert.ok(textOf("Tìm kiếm...") && head.some((e) => e.type === "box" && e.style["border-radius"]), "a search field outside a form keeps its box + placeholder");
  assert.ok(textOf("MIỄN PHÍ VẬN CHUYỂN"), "an absolute item inside a 0×0 link is measured");
  assert.equal(textOf("Nam").style["font-family"], "'Pangea', sans-serif", "a custom family keeps a sans-serif fallback");
  assert.equal(c.sections[0].height, 64); // 80 × 960/1200: the spacer's room
  assert.equal(c.sections.length, 5, "header + the 4 sections inside main > div");
  assert.ok(c.sections.slice(1).every((s) => /Khối/.test(JSON.stringify(s.elements))));
  assert.equal(c.sections[2].background["background-color"], "rgba(250, 250, 250, 1)", "a transparent section shows its wrapper's background");
});
