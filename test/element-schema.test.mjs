// The evidence-based key schema (element-schema.ts) and the codes validate reports from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { landingDomain as D } from "../dist/domains/landing/index.js";
import { elementSchema, PARENTS } from "../dist/domains/landing/element-schema.js";

function validateWith(el, parentType) {
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  if (parentType) {
    const p = D.createElement(parentType);
    p.children = [el];
    sec.children = [p];
  } else sec.children = [el];
  src.page = [sec];
  const s = D.expand(src);
  D.autofixLayout(s);
  return D.validate(s);
}
const lines = (v, code) => [...v.errors, ...v.warnings].filter((m) => m.startsWith(`[${code}]`));

test("UNKNOWN_KEY: a misspelled specials key names the real one", () => {
  const b = D.createElement("button");
  b.specials.textt = "Mua ngay";
  const [m] = lines(validateWith(b), "UNKNOWN_KEY");
  assert.ok(m, "expected an UNKNOWN_KEY warning");
  assert.match(m, /specials\.textt/);
  assert.match(m, /did you mean "text"\?/);
});

test("UNKNOWN_KEY: a real key of another type passes; an invented HTML-habit key names the real place", () => {
  const t = D.createElement("text-block");
  t.specials.fontSize = 20; // real specials key on other types → not unknown
  t.specials.letterSpacng = 2;
  t.specials.href = "https://example.com";
  const ms = lines(validateWith(t), "UNKNOWN_KEY");
  assert.ok(ms.some((m) => /letterSpacng.*did you mean "responsive\.<bp>\.styles\.letterSpacing"/.test(m)), ms.join("\n"));
  assert.ok(ms.some((m) => /specials\.href.*open_link/.test(m)), ms.join("\n"));
  assert.ok(!ms.some((m) => /specials\.fontSize/.test(m)));
});

test("BAD_VALUE: an enforced enum (editor options cover every real value) is an error", () => {
  assert.deepEqual(elementSchema("popup").keys.specials.position.enum.includes("center"), true);
  const v = validateWith(D.createElement("text-block"));
  assert.equal(lines(v, "BAD_VALUE").length, 0);
  const src = D.createPageSource({});
  const sec = D.createElement("section");
  sec.children = [D.createElement("text-block")];
  const pop = D.createElement("popup");
  pop.specials.position = "middle";
  src.page = [sec];
  src.popup = [pop];
  const r = D.validate(D.expand(src));
  const [m] = r.errors.filter((e) => e.startsWith("[BAD_VALUE]"));
  assert.ok(m, r.errors.join("\n"));
  assert.match(m, /specials\.position: "middle" is not one of/);
  assert.equal(r.valid, false);
});

test("BAD_VALUE: a mistyped value is only a warning with the fix", () => {
  const i = D.createElement("input");
  i.specials.field_name = "email";
  i.specials.required = "true";
  const v = validateWith(i, "form");
  const [m] = v.warnings.filter((w) => w.startsWith("[BAD_VALUE]") && /specials\.required/.test(w));
  assert.ok(m, v.warnings.join("\n"));
  assert.match(m, /use true \(boolean\)/);
});

test("NO_EFFECT: a key the type's renderer never reads; the wrong-bucket case says where it goes", () => {
  const s = D.createElement("section");
  s.responsive.desktop.styles.borderRadius = 24; // cssSection emits a fixed list (background, opacity, filter)
  const l = D.createElement("list-paragraph");
  l.specials.iconSize = 30; // cssListParagraph reads config.iconSize
  const src = D.createPageSource({});
  s.children = [l];
  src.page = [s];
  const v = D.validate(D.expand(src));
  const ms = lines(v, "NO_EFFECT");
  assert.ok(ms.some((m) => /\(section\) styles\.borderRadius/.test(m)), ms.join("\n"));
  assert.ok(ms.some((m) => /specials\.iconSize.*move it to responsive\.<bp>\.config/.test(m)), ms.join("\n"));
  assert.equal(elementSchema("section").keys.styles.background.rendered, true);
});

test("NO_EFFECT: a parent key its child reads counts as rendered (carousel config.slideToShow)", () => {
  assert.equal(elementSchema("carousel").keys.config.slideToShow.rendered, true);
  assert.equal(elementSchema("carousel").keys.config.slideToShow.via, "child");
});

test("BAD_PARENT: slide outside a carousel, select outside a form", () => {
  assert.deepEqual(PARENTS.slide, ["carousel"]);
  assert.deepEqual(PARENTS.select, ["form"]);
  const [m] = lines(validateWith(D.createElement("slide")), "BAD_PARENT");
  assert.match(m, /\(slide\).*directly inside carousel/);
  const sel = D.createElement("select");
  sel.specials.field_name = "size";
  assert.equal(lines(validateWith(sel, "form"), "BAD_PARENT").length, 0);
});

test("every element the MCP builds validates without schema findings", () => {
  for (const t of D.elementTypes) {
    if (["section", "popup", "dynamic_page"].includes(t)) continue;
    const el = D.createElement(t);
    const v = validateWith(el, PARENTS[t]?.[0]);
    const ms = [...v.errors, ...v.warnings].filter((m) => /^\[(UNKNOWN_KEY|NO_EFFECT|BAD_VALUE)\]/.test(m));
    assert.deepEqual(ms, [], t);
  }
});

test("get_element carries the key reference and relations", () => {
  const k = D.elementKeys("slide");
  assert.ok(k.keys.config.some((l) => l.startsWith("delayTime")));
  assert.deepEqual(k.relations.must_be_inside, ["carousel"]);
  assert.ok(D.elementKeys("countdown").keys.specials.some((l) => /^language: .*english/.test(l)));
});

test("a MEASURED text-block (config.virtualHeight ≥ height − 2) skips the wrap / spill estimates", () => {
  // the estimate for this text in a 120px box: the measured height is trusted up to 1.6× below it
  const mk = (measuredH, h = measuredH ?? 20) => {
    const t = D.createElement("text-block");
    t.specials.text = "A LONG UPPERCASE HEADLINE THAT WRAPS ON A NARROW BOX FOR SURE";
    for (const bp of ["desktop", "mobile"]) {
      Object.assign(t.responsive[bp].styles, { width: 120, height: h, fontSize: 28, fontWeight: 700 });
      if (measuredH != null) t.responsive[bp].config.virtualHeight = measuredH;
    }
    const src = D.createPageSource({});
    const sec = D.createElement("section");
    sec.responsive.desktop.styles.height = sec.responsive.mobile.styles.height = 1000;
    sec.children = [t];
    src.page = [sec];
    return D.validate(src).warnings.filter((w) => /text wraps to|wrapped text renders/.test(w));
  };
  assert.ok(mk(undefined).length > 0, "unmeasured text should be estimated");
  assert.deepEqual(mk(20), [], "a measured height is trusted (an edit that makes it stale drops it — tree.dropStaleMeasure)");
});
