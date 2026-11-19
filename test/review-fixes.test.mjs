// Regressions for review findings: empty / misspelled match, stale virtualHeight, per-child spill,
// cloned CSS breaking out of <style>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectIds, matchProblem } from "../dist/domains/landing/tree.js";
import { landingDomain as D } from "../dist/domains/landing/index.js";
import { mergeCaptures } from "../dist/persistence/ingest/browser-capture.js";

function page(children, h = 600) {
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  sec.responsive.desktop.styles.height = h;
  sec.children = children;
  src.page = [sec];
  return src;
}
const LONG = "Một đoạn văn bản rất dài được AI viết lại để thay cho câu ngắn ban đầu, dài hơn nhiều dòng so với hộp đã đo trước đó ".repeat(3);

test("an empty or misspelled match selects nothing; text/within never hit a whole section", () => {
  const t = D.createElement("text-block");
  t.specials.text = "Sale";
  const src = page([t]);
  assert.deepEqual(selectIds(src, {}), []);
  assert.match(matchProblem({ tpye: "text-block" }), /unknown match key/);
  assert.match(matchProblem({ type: "" }), /at least one/);
  assert.deepEqual(selectIds(src, { text: "sale" }), [t.id]);
  assert.deepEqual(selectIds(src, { type: "section" }), [src.page[0].id]);
});

test("an edit that changes a measured text drops its virtualHeight; the save then re-estimates and pushes", () => {
  const mk = () => {
    const t = D.createElement("text-block");
    t.specials.text = "Ngắn";
    t.responsive.desktop.styles = { ...t.responsive.desktop.styles, top: 20, left: 20, width: 300, height: 40, fontSize: 16 };
    t.responsive.desktop.config.virtualHeight = 40;
    const below = D.createElement("rectangle");
    below.responsive.desktop.styles = { ...below.responsive.desktop.styles, top: 70, left: 20, width: 300, height: 40 };
    return { t, below };
  };
  // patch_page path
  const a = mk();
  dropStaleMeasure(a.t, { text: LONG }, null, null);
  assert.equal(a.t.responsive.desktop.config.virtualHeight, undefined);
  a.t.specials.text = LONG;
  const src = D.expand(page([a.t, a.below]));
  D.autofixLayout(src);
  const [tt, bb] = src.page[0].children;
  assert.ok(tt.responsive.desktop.styles.height > 100, "re-estimated");
  assert.ok(bb.responsive.desktop.styles.top > 100, "the sibling below is pushed");
  // update_page path: compared with the live node of the same id
  const live = page([mk().t]);
  const next = structuredClone(live);
  next.page[0].children[0].id = live.page[0].children[0].id;
  next.page[0].children[0].specials.text = LONG;
  assert.equal(dropStaleAgainst(live, next), 1);
  assert.equal(next.page[0].children[0].responsive.desktop.config.virtualHeight, undefined);
  // an untouched measured text keeps it (and is trusted)
  const same = structuredClone(live);
  assert.equal(dropStaleAgainst(live, same), 0);
});

test("a hanging decoration does not hide another child's real spill", () => {
  const deco = D.createElement("rectangle");
  deco.responsive.desktop.styles = { ...deco.responsive.desktop.styles, top: 500, left: 600, width: 200, height: 250 };
  const t = D.createElement("text-block");
  t.specials.text = LONG;
  t.responsive.desktop.styles = { ...t.responsive.desktop.styles, top: 540, left: 20, width: 300, height: 40, fontSize: 16 };
  const src = D.expand(page([deco, t], 600));
  D.autofixLayout(src);
  const tt = src.page[0].children[1];
  const bottom = tt.responsive.desktop.styles.top + tt.responsive.desktop.styles.height;
  assert.ok(src.page[0].responsive.desktop.styles.height >= bottom, `section ${src.page[0].responsive.desktop.styles.height} < text bottom ${bottom}`);
});

test("cloned hover CSS cannot break out of <style>; markup in extra_css is refused", () => {
  const box = { key: "b", kind: "box", box: { top: 0, left: 0, width: 100, height: 100 }, style: { "background-color": "rgb(0,0,0)" }, hover: 'background: url("</style><script>alert(1)</script>"); color: red' };
  const cap = { title: "X", description: "", width: 1200, truncated: false, headLinks: ["https://evil.test/icons.css", "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"], sections: [{ key: "a", top: 0, height: 200, background: {}, elements: [box] }] };
  const { source } = D.canvasToSource(mergeCaptures(cap, null), {});
  assert.ok(!/<|script/i.test(source.settings.extra_css), source.settings.extra_css);
  assert.match(source.settings.extra_css, /color: red/);
  assert.ok(!source.settings.bhet.includes("evil.test") && source.settings.bhet.includes("cdnjs"));
  const bad = page([D.createElement("text-block")]);
  bad.settings.extra_css = "#w-x{color:red}</style><script>x()</script>";
  assert.ok(D.validate(bad).errors.some((e) => /extra_css contains HTML/.test(e)));
});

import { duplicateNode, moveNode, refsTo, dropStaleMeasure, dropStaleAgainst } from "../dist/domains/landing/tree.js";

test("duplicate remaps survey↔form links inside the copy; remove reports them; count must be a number", () => {
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  const form = D.createElement("form");
  const survey = D.createElement("survey");
  survey.specials.connectedForm = form.id;
  sec.children = [form, survey];
  src.page = [sec];
  const r = duplicateNode(src, { id: sec.id });
  assert.ok(r.ok);
  const copy = src.page[1];
  const [f2, s2] = copy.children;
  assert.notEqual(f2.id, form.id);
  assert.equal(s2.specials.connectedForm, f2.id);
  assert.deepEqual(refsTo(src, new Set([form.id])).map((x) => x.action), ["specials.connectedForm"]);
  assert.equal(duplicateNode(src, { id: form.id, count: "x" }).ok, false);
});

test("a move that keeps the canvas position outside the new parent warns", () => {
  const src = D.createPageSource({});
  const a = D.createElement("section");
  const b = D.createElement("section");
  a.responsive.desktop.styles.height = 400;
  b.responsive.desktop.styles.height = 300;
  const t = D.createElement("text-block");
  t.responsive.desktop.styles.top = 10;
  a.children = [t];
  src.page = [a, b];
  const r = moveNode(src, { id: t.id, parent_id: b.id });
  assert.ok(r.ok);
  assert.match(r.change.desktop_warning, /outside/);
});
