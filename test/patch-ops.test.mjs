// Pure tree helpers behind get_page outline/element_id and patch_page move/duplicate/match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { outline, locate, selectIds, moveNode, duplicateNode, refsTo, allIds } from "../dist/domains/landing/tree.js";

const el = (id, type, d, m, extra = {}) => ({
  id,
  type,
  responsive: { desktop: { config: {}, styles: d }, mobile: { config: {}, styles: m } },
  ...extra,
});
const page = () => ({
  page: [
    el("s1", "section", { height: 600 }, { height: 500 }, {
      children: [
        el("t1", "text-block", { left: 80, top: 40, width: 800 }, { left: 20, top: 30, width: 380 }, { specials: { text: "<b>Hello</b> World" } }),
        el("g1", "group", { left: 100, top: 200, width: 400, height: 200 }, { left: 10, top: 150, width: 400, height: 200 }, {
          children: [
            el("b1", "button", { left: 20, top: 30, width: 160, height: 48 }, { left: 5, top: 10, width: 160, height: 48 }, {
              specials: { text: "Buy now" },
              events: [{ type: "click", action: "scroll_to", target: "t2" }],
            }),
            el("t2", "text-block", { left: 0, top: 100, width: 300 }, { left: 0, top: 80, width: 300 }, { specials: { text: "Inner" } }),
          ],
        }),
      ],
    }),
    el("s2", "section", { height: 400 }, { height: 300 }, {
      children: [
        el("b2", "button", { left: 10, top: 10, width: 100, height: 40 }, { left: 10, top: 10, width: 100, height: 40 }, {
          specials: { text: "Open" },
          events: [{ type: "click", action: "open_popup", target: "p1" }],
        }),
      ],
    }),
  ],
  popup: [el("p1", "popup", { height: 300 }, { height: 300 }, { responsive: { desktop: { config: {}, styles: { height: 300 } }, mobile: { config: { hide: true }, styles: { height: 300 } } } })],
});
const st = (src, id, bp) => locate(src, id).node.responsive[bp].styles;

test("outline: one line per node, indented, with boxes, text, flags", () => {
  const o = outline(page()).split("\n");
  assert.equal(o[0], "s1 section d:h600 m:h500");
  assert.equal(o[1], '  t1 text-block "Hello World" d:80,40,800×auto m:20,30,380×auto');
  assert.equal(o[3], '    b1 button "Buy now" d:20,30,160×48 m:5,10,160×48 [events:1]');
  assert.equal(o.at(-1), "p1 popup d:h300 m:h300 [popup] [hidden-on-mobile]");
});

test("move: reparent into a container in another section keeps the canvas position", () => {
  const src = page();
  // b2 sits at s2(600 down on desktop) + 10,10 → absolute (10, 610). g1 is at (100, 200).
  const r = moveNode(src, { id: "b2", parent_id: "g1" });
  assert.ok(r.ok);
  assert.deepEqual(st(src, "b2", "desktop"), { left: -90, top: 410, width: 100, height: 40 });
  // mobile: s1 is 500 tall → abs (10, 510); g1 at (10,150) → (0, 360).
  assert.deepEqual([st(src, "b2", "mobile").left, st(src, "b2", "mobile").top], [0, 360]);
  assert.equal(locate(src, "b2").chain[1].id, "g1");
  assert.equal(r.change.from_parent, "s2");
});

test("move: explicit left/top win; index reorders; no index keeps z-order; no cycles", () => {
  const src = page();
  assert.ok(moveNode(src, { id: "b1", parent_id: "s1", desktop: { left: 5, top: 6 } }).ok);
  assert.deepEqual([st(src, "b1", "desktop").left, st(src, "b1", "desktop").top], [5, 6]);
  assert.deepEqual([st(src, "b1", "mobile").left, st(src, "b1", "mobile").top], [15, 160]); // 5+10, 10+150
  assert.ok(moveNode(src, { id: "b1", index: 0 }).ok);
  assert.equal(src.page[0].children[0].id, "b1");
  assert.ok(moveNode(src, { id: "t1", desktop: { top: 1 } }).ok);
  assert.equal(src.page[0].children[1].id, "t1");
  assert.equal(moveNode(src, { id: "g1", parent_id: "t2" }).ok, false);
  assert.equal(moveNode(src, { id: "s1", parent_id: "g1" }).ok, false);
  assert.deepEqual(moveNode(src, { id: "nope" }), { ok: false, error: "not_found:nope" });
});

test("duplicate: fresh unique ids, internal event targets remapped, offset × i", () => {
  const src = page();
  const before = allIds(src);
  const r = duplicateNode(src, { id: "g1", count: 2, offset: { desktop: { x: 0, y: 220 } } });
  assert.ok(r.ok);
  assert.equal(r.change.new_ids.length, 2);
  const ids = [...allIds(src)];
  assert.equal(ids.length, new Set(ids).size, "ids unique");
  assert.equal(ids.length, before.size + 6);
  const [c1, c2] = r.change.new_ids.map((id) => locate(src, id).node);
  assert.deepEqual(src.page[0].children.map((n) => n.id), ["t1", "g1", c1.id, c2.id]);
  assert.equal(c1.responsive.desktop.styles.top, 420);
  assert.equal(c2.responsive.desktop.styles.top, 640);
  assert.equal(c1.responsive.mobile.styles.top, 150);
  // b1 copy scrolls to the t2 copy, not the original.
  assert.equal(c1.children[0].events[0].target, c1.children[1].id);
  assert.notEqual(c1.children[1].id, "t2");
  // external targets untouched
  const b2copy = duplicateNode(src, { id: "b2", parent_id: "g1" });
  assert.equal(locate(src, b2copy.change.new_ids[0]).node.events[0].target, "p1");
  assert.equal(st(src, b2copy.change.new_ids[0], "desktop").top, 410);
});

test("selectIds: type / text (tags stripped, case-insensitive) / section_id / within", () => {
  const src = page();
  assert.deepEqual(selectIds(src, { type: "button" }), ["b1", "b2"]);
  assert.deepEqual(selectIds(src, { text: "hello world" }), ["t1"]);
  assert.deepEqual(selectIds(src, { type: "text-block", section_id: "s1" }), ["t1", "t2"]);
  assert.deepEqual(selectIds(src, { within: "g1" }), ["b1", "t2"]);
  assert.deepEqual(selectIds(src, { within: "g1", text: "buy" }), ["b1"]);
});

test("refsTo: events that target removed ids", () => {
  assert.deepEqual(refsTo(page(), new Set(["p1", "t2"])), [
    { from: "b1", action: "scroll_to", target: "t2" },
    { from: "b2", action: "open_popup", target: "p1" },
  ]);
});

test("duplicate remaps live-comment formId / popupId that point inside the copy", () => {
  const src = { page: [el("s9", "section", { height: 600 }, { height: 600 }, { children: [
    el("g9", "group", { left: 0, top: 0, width: 400, height: 400 }, { left: 0, top: 0, width: 400, height: 400 }, { children: [
      el("f9", "form", { left: 0, top: 0, width: 300, height: 100 }, { left: 0, top: 0, width: 300, height: 100 }, { children: [] }),
      el("lc9", "live-comment", { left: 0, top: 200, width: 300, height: 150 }, { left: 0, top: 200, width: 300, height: 150 }, { specials: { dataSourceType: "data_form", formId: "f9" } }),
    ] }),
  ] })] };
  const r = duplicateNode(src, { id: "g9" });
  assert.ok(r.ok);
  const copy = src.page[0].children[1];
  assert.notEqual(copy.id, "g9");
  const [f, lc] = copy.children;
  assert.notEqual(f.id, "f9");
  assert.equal(lc.specials.formId, f.id);
});
