// Inputs the real landing renderer crashes on (found by scripts/fuzz-render.mjs / render-check.mjs):
// a save repairs the one-answer ones and validate refuses the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { landingDomain as D } from "../dist/domains/landing/index.js";

function pageWith(el, mutateSource) {
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  sec.children = [el];
  src.page = [sec];
  mutateSource?.(src);
  return src;
}
const save = (src) => {
  const s = D.expand(structuredClone(src));
  const fixed = D.autofixLayout(s);
  return { s, fixed, v: D.validate(s) };
};

test("a new grid carries a grid-item (an empty grid fails the whole build)", () => {
  assert.equal(D.createElement("grid").children[0].type, "grid-item");
  const g = D.createElement("grid");
  g.children = [];
  assert.ok(D.validate(pageWith(g)).errors.some((e) => /grid.*no grid-item/.test(e)));
  assert.equal(save(pageWith(g)).s.page[0].children[0].children.length, 1);
});

test("missing width_section / options / popup are filled on save", () => {
  const src = pageWith(D.createElement("text-block"), (s) => {
    delete s.settings.width_section;
    delete s.options;
    s.popup = null;
  });
  const { s, v } = save(src);
  assert.deepEqual(s.settings.width_section, { desktop: 960, mobile: 420 });
  assert.deepEqual(s.options, {});
  assert.deepEqual(s.popup, []);
  assert.ok(v.valid, v.errors.join("\n"));
});

test("fontGeneral is stored as a bare family name (the renderer adds the quotes)", () => {
  assert.equal(D.createPageSource({}).settings.fontGeneral, "Roboto");
  const { s } = save(pageWith(D.createElement("text-block"), (x) => (x.settings.fontGeneral = "'Inter', sans-serif")));
  assert.equal(s.settings.fontGeneral, "Inter");
});

test("countdown language: locale codes map, null is dropped, other non-strings are refused", () => {
  const cd = D.createElement("countdown");
  cd.specials.language = "vi";
  assert.equal(save(pageWith(cd)).s.page[0].children[0].specials.language, "vietnam");
  cd.specials.language = null;
  assert.equal(save(pageWith(cd)).s.page[0].children[0].specials.language, undefined);
  cd.specials.language = 3;
  assert.ok(D.validate(pageWith(cd)).errors.some((e) => /language must be a string/.test(e)));
});

test("spin-wheel code / select placeholder / no-op events / string repeat are repaired", () => {
  const sw = D.createElement("spin-wheel");
  sw.specials.code = null; // (a missing key is re-filled from the seed by expand)
  assert.ok(D.validate(pageWith(sw)).errors.some((e) => /spin-wheel.*code must be a string/.test(e)));
  assert.equal(save(pageWith(sw)).s.page[0].children[0].specials.code, "");

  const sel = D.createElement("select");
  sel.specials.field_placeholder = null;
  sel.specials.placeholder = "Chọn";
  sel.events = [{ id: "e1", type: "click", action: null, target: null }];
  sel.responsive.desktop.config.animation = { name: "fadeIn", repeat: "3" };
  sel.responsive.mobile.styles.borderRadius = 8;
  const out = save(pageWith(sel)).s.page[0].children[0];
  assert.equal(out.specials.field_placeholder, "Chọn");
  assert.deepEqual(out.events, []);
  assert.equal(out.responsive.desktop.config.animation.repeat, 3);
  assert.equal(out.responsive.mobile.styles.borderRadius, "8px");
});

test("editor values are not refused: repeat 'infinite', mobileOnly null", () => {
  const t = D.createElement("text-block");
  t.responsive.desktop.config.animation = { name: "pulse", repeat: "infinite" };
  const src = pageWith(t, (s) => (s.options.mobileOnly = null));
  assert.ok(!D.validate(src).errors.some((e) => /repeat|mobileOnly/.test(e)), D.validate(src).errors.join("\n"));
});

test("crash shapes with no single answer are refused", () => {
  const h = D.createElement("html-box");
  h.specials.html = ["<b>x</b>"];
  assert.ok(D.validate(pageWith(h)).errors.some((e) => /html must be a string/.test(e)));
  const g = D.createElement("gallery");
  g.responsive.desktop.config.thumbnailPosition = "middle";
  assert.ok(D.validate(pageWith(g)).errors.some((e) => /thumbnailPosition/.test(e)));
});
