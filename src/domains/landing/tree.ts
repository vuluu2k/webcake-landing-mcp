/**
 * Pure helpers over a landing page source { page:[section…], popup:[popup…] } for
 * element-level reads and edits (get_page outline / element_id, patch_page move /
 * duplicate / match). No I/O. Nodes are absolutely positioned per breakpoint with
 * coordinates relative to their parent container; sections stack vertically.
 */
import { randomId } from "../../core/element.js";

const BPS = ["desktop", "mobile"] as const;
type Bp = (typeof BPS)[number];
type XY = { left?: number; top?: number };

export interface Located {
  node: any;
  /** The array holding the node (base.page / base.popup / a parent's children). */
  arr: any[];
  index: number;
  /** Root (section/popup) → … → node. */
  chain: any[];
  root: "page" | "popup";
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const stylesOf = (n: any, bp: Bp) => n?.responsive?.[bp]?.styles ?? {};
const hiddenOn = (n: any, bp: Bp) => !!n?.responsive?.[bp]?.config?.hide;
const rootsOf = (src: any) =>
  [["page", src?.page], ["popup", src?.popup]].filter(([, a]) => Array.isArray(a)) as ["page" | "popup", any[]][];

/** Every node with its location, depth-first in document order. */
export function* walk(src: any): Generator<Located> {
  function* rec(arr: any[], chain: any[], root: "page" | "popup"): Generator<Located> {
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (!n || typeof n !== "object") continue;
      const c = [...chain, n];
      yield { node: n, arr, index: i, chain: c, root };
      if (Array.isArray(n.children)) yield* rec(n.children, c, root);
    }
  }
  for (const [root, arr] of rootsOf(src)) yield* rec(arr, [], root);
}

export function locate(src: any, id: string): Located | null {
  for (const l of walk(src)) if (l.node.id === id) return l;
  return null;
}

export function allIds(src: any): Set<string> {
  const s = new Set<string>();
  for (const { node } of walk(src)) if (typeof node.id === "string") s.add(node.id);
  return s;
}

export function subtreeIds(node: any, out: string[] = []): string[] {
  if (node && typeof node === "object") {
    if (typeof node.id === "string") out.push(node.id);
    if (Array.isArray(node.children)) for (const c of node.children) subtreeIds(c, out);
  }
  return out;
}

/** Plain text of a node: specials.text with tags/entities stripped. */
export function textOf(node: any): string {
  const t = node?.specials?.text;
  if (typeof t !== "string") return "";
  return t.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, "").replace(/\s+/g, " ").trim();
}

/**
 * Canvas origin of the coordinate space a chain's LAST node lays its children in.
 * withRoot adds the section stacking offset (sum of the visible sections above).
 */
function originOf(src: any, chain: any[], bp: Bp, withRoot: boolean): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const [root, ...rest] = chain;
  if (withRoot && Array.isArray(src?.page)) {
    for (const s of src.page) {
      if (s === root) break;
      if (!hiddenOn(s, bp)) y += num(stylesOf(s, bp).height) ?? 0;
    }
  }
  for (const n of rest) {
    x += num(stylesOf(n, bp).left) ?? 0;
    y += num(stylesOf(n, bp).top) ?? 0;
  }
  return { x, y };
}

const box = (n: any, bp: Bp) => {
  const s = stylesOf(n, bp);
  const f = (v: unknown) => (num(v) == null ? "auto" : String(Math.round(num(v)!)));
  return `${f(s.left)},${f(s.top)},${f(s.width)}×${f(s.height)}`;
};

/** One line per node: `id type "text…" d:l,t,w×h m:l,t,w×h [hidden-on-mobile] [events:n]`, indented by depth. */
export function outline(src: any): string {
  const lines: string[] = [];
  for (const { node: n, chain, root } of walk(src)) {
    const depth = chain.length - 1;
    const t = textOf(n);
    const parts = [`${n.id ?? "?"} ${n.type ?? "?"}`];
    if (depth === 0) {
      parts.push(`d:h${f0(stylesOf(n, "desktop").height)} m:h${f0(stylesOf(n, "mobile").height)}`);
      if (root === "popup") parts.push("[popup]");
    } else {
      if (t) parts.push(JSON.stringify(t.length > 40 ? t.slice(0, 40) + "…" : t));
      parts.push(`d:${box(n, "desktop")} m:${box(n, "mobile")}`);
    }
    for (const bp of BPS) if (hiddenOn(n, bp)) parts.push(`[hidden-on-${bp}]`);
    if (Array.isArray(n.events) && n.events.length) parts.push(`[events:${n.events.length}]`);
    lines.push("  ".repeat(depth) + parts.join(" "));
  }
  return lines.join("\n");
}
const f0 = (v: unknown) => (num(v) == null ? "auto" : String(Math.round(num(v)!)));

export interface Match {
  type?: string;
  text?: string;
  section_id?: string;
  within?: string;
}

const MATCH_KEYS = ["type", "text", "section_id", "within"];
/** Why a selector is refused (empty / unknown key would select EVERY node), or null when usable. */
export function matchProblem(m: any): string | null {
  if (!m || typeof m !== "object" || Array.isArray(m)) return "match must be an object";
  const unknown = Object.keys(m).filter((k) => !MATCH_KEYS.includes(k));
  if (unknown.length) return `unknown match key(s) ${unknown.join(", ")} — use ${MATCH_KEYS.join(" / ")}`;
  if (!MATCH_KEYS.some((k) => typeof m[k] === "string" && m[k].trim() !== "")) return `match needs at least one of ${MATCH_KEYS.join(" / ")} with a non-empty value`;
  return null;
}

/** Ids of every node matching ALL given criteria (document order). Sections / popups are only hit
 *  when asked for by type (a text/within selector never removes a whole section). */
export function selectIds(src: any, m: Match): string[] {
  if (matchProblem(m)) return [];
  const text = m.text?.toLowerCase();
  const out: string[] = [];
  for (const { node, chain } of walk(src)) {
    if (typeof node.id !== "string") continue;
    if (chain.length <= 1 && !(m.type && (m.type === "section" || m.type === "popup"))) continue;
    if (m.type && node.type !== m.type) continue;
    if (text && !textOf(node).toLowerCase().includes(text)) continue;
    if (m.section_id && chain[0]?.id !== m.section_id) continue;
    if (m.within && !chain.slice(0, -1).some((a) => a.id === m.within)) continue;
    out.push(node.id);
  }
  return out;
}

type MoveOp = { id: string; parent_id?: string; index?: number; desktop?: XY; mobile?: XY };

/**
 * Reparent and/or reorder (z-order = child order). Without explicit left/top the
 * element keeps its on-canvas position (coordinates converted to the new parent);
 * between page and popup only the in-root position is kept.
 */
export function moveNode(src: any, op: MoveOp): { ok: true; change: any } | { ok: false; error: string } {
  const from = locate(src, op.id);
  if (!from) return { ok: false, error: `not_found:${op.id}` };
  const oldParent = from.chain.length > 1 ? from.chain[from.chain.length - 2] : null;
  let to: { arr: any[]; chain: any[]; root: "page" | "popup"; node: any | null };
  if (op.parent_id == null || op.parent_id === oldParent?.id) {
    to = { arr: from.arr, chain: from.chain.slice(0, -1), root: from.root, node: oldParent };
  } else {
    if (!oldParent) return { ok: false, error: `move ${op.id}: a section/popup cannot be moved into a container (index only)` };
    const p = locate(src, op.parent_id);
    if (!p) return { ok: false, error: `not_found:${op.parent_id}` };
    if (p.chain.includes(from.node)) return { ok: false, error: `move ${op.id}: cannot move into its own subtree (${op.parent_id})` };
    p.node.children = Array.isArray(p.node.children) ? p.node.children : [];
    to = { arr: p.node.children, chain: p.chain, root: p.root, node: p.node };
  }

  const reparent = to.arr !== from.arr;
  const pos: Record<string, XY> = {};
  for (const bp of BPS) {
    const want = op[bp] ?? {};
    const s = (from.node.responsive ??= {})[bp] ??= { config: {}, styles: {} };
    s.styles ??= {};
    let left = num(s.styles.left);
    let top = num(s.styles.top);
    if (reparent && left != null && top != null) {
      const withRoot = from.root === "page" && to.root === "page";
      const a = originOf(src, from.chain.slice(0, -1), bp, withRoot);
      const b = originOf(src, to.chain, bp, withRoot);
      left = Math.round(left + a.x - b.x);
      top = Math.round(top + a.y - b.y);
    }
    if (want.left != null) left = want.left;
    if (want.top != null) top = want.top;
    if (left != null) s.styles.left = left;
    if (top != null) s.styles.top = top;
    pos[bp] = { left, top };
    // kept its place on the canvas, but that is outside the new parent: say so (agents usually mean "into it")
    const ps = to.node?.responsive?.[bp]?.styles;
    const pw = num(ps?.width) ?? (to.node?.type === "section" ? (bp === "desktop" ? 960 : 420) : undefined);
    const ph = num(ps?.height);
    const w = num(s.styles.width) ?? 0, h = num(s.styles.height) ?? 0;
    if (reparent && left != null && top != null && ((pw != null && (left + w < 0 || left > pw)) || (ph != null && (top + h < 0 || top > ph))))
      (pos as any)[`${bp}_warning`] = `kept its canvas position (left ${left}, top ${top}), which lies outside ${to.node?.id ?? to.root} — pass ${bp}:{left,top} to place it inside`;
  }

  from.arr.splice(from.index, 1);
  // No index: a reparent appends (on top); a same-parent move keeps its z-order.
  const idx = op.index == null ? (reparent ? to.arr.length : from.index) : Math.max(0, Math.min(op.index, to.arr.length));
  to.arr.splice(idx, 0, from.node);
  return {
    ok: true,
    change: { op: "move", id: op.id, from_parent: oldParent?.id ?? from.root, to_parent: to.node?.id ?? to.root, index: idx, ...pos },
  };
}

type DupOp = { id: string; parent_id?: string; offset?: { desktop?: { x?: number; y?: number }; mobile?: { x?: number; y?: number } }; count?: number };

/** specials keys that hold another element's id. */
export const REF_SPECIALS = ["connectedForm", "connectedSurvey", "popup_target", "formId", "popupId"];

/** Remap event / option targets inside a copied subtree that point into the copy. */
function remapRefs(node: any, map: Map<string, string>) {
  const re = (t: unknown) => {
    if (typeof t !== "string") return t;
    const m = /^(#?w-)?(.*)$/.exec(t)!;
    return map.has(m[2]) ? (m[1] ?? "") + map.get(m[2]) : t;
  };
  if (Array.isArray(node.events)) for (const ev of node.events) if (ev && typeof ev === "object" && ev.target != null) ev.target = re(ev.target);
  // element references held in specials (a survey ↔ its form, a form's thank-you popup)
  for (const k of REF_SPECIALS) if (node.specials && typeof node.specials[k] === "string") node.specials[k] = re(node.specials[k]);
  for (const opt of Array.isArray(node.specials?.options) ? node.specials.options : []) {
    for (const ev of Array.isArray(opt?.events_option) ? opt.events_option : []) if (ev && typeof ev === "object" && ev.promoId != null) ev.promoId = re(ev.promoId);
  }
  if (Array.isArray(node.children)) for (const c of node.children) remapRefs(c, map);
}

/** Deep copy with fresh ids unique across page AND popups; copy i is shifted by offset×i. */
export function duplicateNode(src: any, op: DupOp): { ok: true; change: any } | { ok: false; error: string } {
  const from = locate(src, op.id);
  if (!from) return { ok: false, error: `not_found:${op.id}` };
  const n = Number(op.count ?? 1);
  if (!Number.isFinite(n)) return { ok: false, error: `duplicate ${op.id}: count must be a number (1–50)` };
  const count = Math.max(1, Math.min(Math.round(n), 50));
  const taken = allIds(src);
  const fresh = () => {
    let id: string;
    do id = randomId(); while (taken.has(id));
    taken.add(id);
    return id;
  };
  const oldParent = from.chain.length > 1 ? from.chain[from.chain.length - 2] : null;
  const newIds: string[] = [];
  let insertAt = from.index + 1;
  for (let i = 1; i <= count; i++) {
    const copy = structuredClone(from.node);
    const map = new Map<string, string>();
    for (const l of walk({ page: [copy] })) if (typeof l.node.id === "string") map.set(l.node.id, (l.node.id = fresh()));
    remapRefs(copy, map);
    // Insert next to the original, then let moveNode reparent (keeps it visually in place).
    from.arr.splice(insertAt++, 0, copy);
    if (op.parent_id != null && op.parent_id !== oldParent?.id) {
      const moved = moveNode(src, { id: copy.id, parent_id: op.parent_id });
      if (!moved.ok) {
        from.arr.splice(from.arr.indexOf(copy), 1);
        return moved;
      }
      insertAt--;
    }
    for (const bp of BPS) {
      const off = op.offset?.[bp];
      const s = copy.responsive?.[bp]?.styles;
      if (!off || !s) continue;
      if (off.x && num(s.left) != null) s.left = num(s.left)! + off.x * i;
      if (off.y && num(s.top) != null) s.top = num(s.top)! + off.y * i;
    }
    newIds.push(copy.id);
  }
  return { ok: true, change: { op: "duplicate", id: op.id, new_ids: newIds, parent_id: op.parent_id ?? oldParent?.id ?? from.root } };
}

/** Events / option events elsewhere in the tree that target one of `ids`. */
export function refsTo(src: any, ids: Set<string>): { from: string; action: string; target: string }[] {
  const hit = (t: unknown) => typeof t === "string" && (ids.has(t) || ids.has(t.replace(/^#?w-/, "")));
  const out: { from: string; action: string; target: string }[] = [];
  for (const { node } of walk(src)) {
    for (const ev of Array.isArray(node.events) ? node.events : []) {
      if (hit(ev?.target)) out.push({ from: node.id, action: ev.action ?? ev.type ?? "?", target: ev.target });
    }
    for (const opt of Array.isArray(node.specials?.options) ? node.specials.options : []) {
      for (const ev of Array.isArray(opt?.events_option) ? opt.events_option : []) {
        if (hit(ev?.promoId)) out.push({ from: node.id, action: `option:${ev.type ?? "?"}`, target: ev.promoId });
      }
    }
    for (const k of REF_SPECIALS) if (hit(node.specials?.[k])) out.push({ from: node.id, action: `specials.${k}`, target: node.specials[k] });
  }
  return out;
}

/**
 * A text-block's config.virtualHeight is its MEASURED height (editor, clone_page) and layout fixes trust
 * it. An edit that changes what it measures (text, font size / family / weight, width, spacing) makes it
 * stale: drop it so the save re-estimates the height (unless the edit sets virtualHeight itself).
 */
const MEASURED_BY = ["fontSize", "fontFamily", "fontWeight", "width", "letterSpacing", "lineHeight", "textTransform"];
export function dropStaleMeasure(node: any, specials: any, styles: any, config: any): void {
  if (node?.type !== "text-block") return;
  const textChanged = specials && typeof specials === "object" && "text" in specials;
  for (const bp of ["desktop", "mobile"] as const) {
    const st = styles && typeof styles === "object" ? styles[bp] : undefined;
    const styleChanged = st && typeof st === "object" && MEASURED_BY.some((k) => k in st);
    const setsVh = config && typeof config === "object" && config[bp] && "virtualHeight" in config[bp];
    if ((textChanged || styleChanged) && !setsVh && node.responsive?.[bp]?.config) delete node.responsive[bp].config.virtualHeight;
  }
}

/** update_page: a text-block whose text / measured styles differ from the live page's node of the same
 *  id gets its stale virtualHeight dropped (the overwrite would otherwise keep the old measure). */
export function dropStaleAgainst(live: any, next: any): number {
  if (!live || !next) return 0;
  const before = new Map<string, any>();
  for (const { node } of walk(live)) if (node.type === "text-block" && typeof node.id === "string") before.set(node.id, node);
  let n = 0;
  for (const { node } of walk(next)) {
    const old = before.get(node.id);
    if (node.type !== "text-block" || !old) continue;
    for (const bp of ["desktop", "mobile"] as const) {
      const cfg = node.responsive?.[bp]?.config;
      if (!cfg || cfg.virtualHeight == null) continue;
      const st = node.responsive?.[bp]?.styles ?? {};
      const os = old.responsive?.[bp]?.styles ?? {};
      const changed = node.specials?.text !== old.specials?.text || MEASURED_BY.some((k) => st[k] !== os[k]);
      if (changed && cfg.virtualHeight === old.responsive?.[bp]?.config?.virtualHeight) {
        delete cfg.virtualHeight;
        n++;
      }
    }
  }
  return n;
}
