// What the build tools hand out (presetElement = the editor's drop, element-presets.json) and the
// render-smoke findings validate now reports (NOT_RENDERED, EMPTY_RENDER).
import { test } from "node:test";
import assert from "node:assert/strict";
import { landingDomain as D } from "../dist/domains/landing/index.js";
import { PARENTS } from "../dist/domains/landing/element-schema.js";

const pageWith = (...els) => {
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  sec.children = els;
  src.page = [sec];
  const s = D.expand(src);
  D.autofixLayout(s);
  return D.validate(s);
};
const ids = (n, out = []) => (out.push(n.id), (n.children || []).forEach((c) => ids(c, out)), out);

test("preset: the editor's look, position from the seed, fresh ids for every child", () => {
  const b = D.presetElement("button");
  assert.match(b.responsive.desktop.styles.background, /^rgba\(38, 38, 38/);
  assert.deepEqual([b.responsive.desktop.styles.top, b.responsive.desktop.styles.left], [0, 0]);
  const f = D.presetElement("form");
  assert.deepEqual(f.children.map((c) => c.type), ["input", "input", "button"]);
  assert.deepEqual(f.children.slice(0, 2).map((c) => c.specials.field_name), ["full_name", "phone_number"]);
  const all = [...ids(f), ...ids(D.presetElement("form"))];
  assert.equal(new Set(all).size, all.length, "two forms share no id");
  const car = D.presetElement("carousel");
  assert.ok(car.children.length >= 2 && car.children.every((s) => s.type === "slide"));
  const img = car.children[0].children.find((c) => c.type === "image-block");
  assert.match(img.specials.src, /placehold\.co/, "sample photos become sized placeholders");
  assert.equal(car.specials.editingSlide, undefined);
});

test("preset: options get ids (radio DOM ids, survey field names); dead editor keys are dropped", () => {
  const r = D.presetElement("radio");
  assert.ok(r.specials.options.length && r.specials.options.every((o) => typeof o.id === "string" && o.name));
  const s = D.presetElement("survey");
  assert.deepEqual(s.specials.options.map((o) => o.field_name), s.specials.options.map((_, i) => `sv_${s.id}_${i + 1}`));
  assert.equal(D.presetElement("grid").responsive.desktop.styles.background, undefined, "grid ignores styles.background on the live page");
  assert.equal(typeof D.presetElement("auto-number").specials.startNumber, "number");
});

test("every preset validates with no schema findings (only the test's own nesting can be off)", () => {
  for (const t of D.elementTypes) {
    if (["section", "popup", "dynamic_page"].includes(t)) continue;
    const el = D.presetElement(t);
    const parent = PARENTS[t]?.[0];
    let top = el;
    if (parent) {
      top = D.createElement(parent);
      top.children = [el];
    }
    const v = pageWith(top);
    const ms = [...v.errors, ...v.warnings].filter((m) => /^\[(UNKNOWN_KEY|NO_EFFECT|BAD_VALUE)\]/.test(m));
    assert.deepEqual(ms, [], t);
    assert.deepEqual(v.errors.filter((e) => !/NOT_RENDERED/.test(e)), [], t);
  }
});

test("the expand seed stays structural: a stored node without paint does not gain the preset's", () => {
  const live = D.expand({ page: [{ id: "sec1", type: "section", children: [{ id: "btn1", type: "button", specials: { text: "Go" }, responsive: { desktop: { styles: { top: 0, left: 0, width: 100, height: 40 } }, mobile: { styles: { top: 0, left: 0, width: 100, height: 40 } } } }] }] });
  const round = D.expand(D.compact(live));
  assert.equal(round.page[0].children[0].responsive.desktop.styles.background, undefined);
});

test("NOT_RENDERED: a catalog type with no renderer case is refused; EMPTY_RENDER warns on nothing to paint", () => {
  const cb = D.createElement("checkbox");
  const form = D.createElement("form");
  form.children = [cb];
  assert.ok(pageWith(form).errors.some((e) => e.startsWith("[NOT_RENDERED]") && /checkbox-group/.test(e)));
  const w = (el) => pageWith(el).warnings.filter((x) => x.startsWith("[EMPTY_RENDER]"));
  assert.equal(w(D.createElement("rectangle")).length, 1);
  assert.equal(w(D.presetElement("rectangle")).length, 0);
  const hotspot = D.createElement("rectangle");
  hotspot.events = [{ type: "click", action: "open_link", target: "https://example.com" }];
  assert.equal(w(hotspot).length, 0, "a transparent click area is deliberate");
  assert.match(w(D.createElement("form"))[0], /no input fields/);
  assert.match(w(D.createElement("html-box"))[0], /html is empty/);
  const radio = D.createElement("radio");
  const f2 = D.createElement("form");
  f2.children = [radio];
  assert.ok(pageWith(f2).warnings.some((x) => /\(radio\): specials.options is empty/.test(x)));
});

test("random-number from the seed is valid (no NaN)", () => {
  assert.equal(pageWith(D.createElement("random-number")).errors.length, 0);
});
