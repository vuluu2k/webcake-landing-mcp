/**
 * Per-element key schema + the key checks validate runs against it. Nothing invented — each type's
 * key surface is the union of what is known to be real:
 *   - real pages (element-keys.generated.json, scripts/mine-pages.mjs): keys used per bucket, value
 *     types, code-like values, parent / child type counts;
 *   - the published renderer (renderer-keys.generated.json, scripts/mine-renderer.mjs): which keys
 *     the HTML / CSS / event-data builders READ per type, fallback defaults, compared values,
 *     whether the CSS builder emits every styles key, whether specials ship to the client runtime;
 *   - the editor panels (editor-keys.generated.json, scripts/mine-editor.mjs): label, control and
 *     select options per type;
 *   - the element descriptors (keySpecials meanings) and the factory skeleton (createElement).
 * A key is `rendered` when render code reads it for that type; one nobody renders is stored only
 * (NO_EFFECT). An enum is ENFORCED only where the editor's options cover every value real pages use.
 */
import { readFileSync } from "node:fs";
import { BY_TYPE, createElement } from "./elements/index.js";

const load = (name: string): any => {
  try {
    return JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
  } catch {
    return {};
  }
};
export type Bucket = "specials" | "config" | "styles" | "properties";
export const BUCKETS: Bucket[] = ["specials", "config", "styles", "properties"];
type Seen = Record<string, any>;
const MINED: Record<string, Seen> = load("./element-keys.generated.json");
const RENDERER: any = load("./renderer-keys.generated.json");
const EDITOR: any = load("./editor-keys.generated.json");
const RTYPES: Record<string, any> = RENDERER.types || {};
const SHARED: Record<string, Record<string, any>> = RENDERER.shared || {};
const CLIENT = new Set<string>(RENDERER.client_mentioned || []);
/** Types the HTML builder has a case for (anything else renders an empty wrapper). */
export const RENDERED_TYPES = new Set<string>(RENDERER.dispatched_html || []);

export interface KeySpec {
  /** Value types seen on real pages ∪ the factory default. */
  types?: string[];
  /** Allowed values, ENFORCED (editor options that cover every value real pages use). */
  enum?: string[];
  /** Values the renderer compares / the editor offers / real pages use (informative). */
  values?: (string | number)[];
  /** What the renderer falls back to when absent (else the factory value). */
  default?: unknown;
  /** true: render code reads it for this type; false: stored only. */
  rendered: boolean;
  /** How it is rendered: html | css | data (event_data → client) | client | css-loop | shared. */
  via?: string;
  /** Uses on real pages (elements × breakpoints for config/styles). */
  seen?: number;
  label?: string;
  control?: string;
  desc?: string;
  /** file:line of the render code that reads it. */
  at?: string;
}
export interface ElementSchema {
  type: string;
  /** The HTML builder has a case for it. */
  rendered: boolean;
  /** The CSS builder emits every styles key (minus a dropped list). */
  stylesOpen: boolean;
  keys: Record<Bucket, Record<string, KeySpec>>;
  /** Must sit directly inside one of these (from real pages + renderer parent reads). */
  parents?: string[];
  relations: { parents?: Record<string, number>; children?: Record<string, number>; reads_parent?: string[] };
}

const typeOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Parent type → keys its CHILD's renderer reads from it (a slide reads its carousel's
 *  config.slideToShow): those keys render for the parent even though its own builder ignores them. */
const CHILD_READS: Record<string, Set<string>> = (() => {
  const out: Record<string, Set<string>> = {};
  for (const [child, r] of Object.entries(RTYPES))
    for (const k of (r as any).parent_reads || [])
      for (const p of Object.keys(MINED[child]?.parents || {})) (out[p] ||= new Set()).add(k);
  return out;
})();

/** Does render code read `bucket.key` for `type`? Works for any key (not only the type's own). */
export function renderedVia(type: string, bucket: Bucket, key: string): string | undefined {
  const r = RTYPES[type];
  if (!r) return undefined;
  if (CHILD_READS[type]?.has(`${bucket}.${key}`)) return "child";
  const own = r[bucket]?.[key];
  if (own) return /exportCss/.test(own.at) ? "css" : /event-data/.test(own.at) ? "data" : "html";
  if (SHARED[bucket]?.[key]) return "shared";
  if (bucket === "styles" && r.styles_open && !(r.styles_dropped || []).includes(key)) return "css-loop";
  if (bucket === "specials" && r.client_specials && CLIENT.has(key)) return "client";
  return undefined;
}

/** One-line meaning from the descriptor (first clause). keySpecials entries tagged "(styles key)" /
 *  "(config …)" document another bucket. */
function descriptorKeys(type: string): Record<Bucket, Record<string, string>> {
  const out: Record<Bucket, Record<string, string>> = { specials: {}, config: {}, styles: {}, properties: {} };
  for (const [k, raw] of Object.entries(BY_TYPE[type]?.keySpecials || {})) {
    const b: Bucket = /^\(styles/.test(raw) ? "styles" : /^\(config/.test(raw) ? "config" : "specials";
    const text = raw.replace(/^\([^)]*\)\s*[—-]?\s*/, "");
    const one = text.split(/(?<=[.;])\s|\s—\s/)[0].replace(/\s+/g, " ").trim();
    out[b][k] = one.length > 110 ? `${one.slice(0, 107)}…` : one;
  }
  return out;
}

const cache = new Map<string, ElementSchema | undefined>();
/** bucket.key the factory skeleton (the editor's createElement) puts on a fresh node of a type. */
const FACTORY_KEYS = new Map<string, Set<string>>();
export function elementSchema(type: string): ElementSchema | undefined {
  if (cache.has(type)) return cache.get(type);
  const mined = MINED[type];
  const r = RTYPES[type];
  const ed = EDITOR.types?.[type];
  if (!mined && !r && !ed && !BY_TYPE[type]) {
    cache.set(type, undefined);
    return undefined;
  }
  const factory = BY_TYPE[type] ? createElement(type) : undefined;
  const fvals: Record<Bucket, Record<string, unknown>> = {
    specials: factory?.specials || {},
    config: { ...(factory?.responsive?.mobile?.config || {}), ...(factory?.responsive?.desktop?.config || {}) },
    styles: { ...(factory?.responsive?.mobile?.styles || {}), ...(factory?.responsive?.desktop?.styles || {}) },
    properties: factory?.properties || {},
  };
  FACTORY_KEYS.set(type, new Set(BUCKETS.flatMap((b) => Object.keys(fvals[b]).map((k) => `${b}.${k}`))));
  const desc = descriptorKeys(type);
  const keys = { specials: {}, config: {}, styles: {}, properties: {} } as Record<Bucket, Record<string, KeySpec>>;
  for (const b of BUCKETS) {
    const names = new Set<string>([
      ...Object.keys(mined?.[b] || {}),
      ...Object.keys(r?.[b] || {}),
      ...Object.keys(ed?.[b] || {}),
      ...Object.keys(desc[b]),
      ...Object.keys(fvals[b]),
    ]);
    for (const k of names) {
      // A shared helper's default / compared values hold for every type only for config (sticky*,
      // animation); a shared specials read (checkLoadProduct's specials.type…) is another type's context.
      const rr = r?.[b]?.[k] || (b === "config" ? SHARED[b]?.[k] : SHARED[b]?.[k] && { at: SHARED[b][k].at });
      const e = ed?.[b]?.[k];
      const via = renderedVia(type, b, k);
      const types = new Set<string>(mined?.types?.[`${b}.${k}`] || []);
      if (k in fvals[b] && fvals[b][k] !== undefined && fvals[b][k] !== null) types.add(typeOf(fvals[b][k]));
      const realVals: string[] = mined?.values?.[`${b}.${k}`] || [];
      const values = [...new Set<string | number>([...(rr?.values || []), ...realVals, ...(e?.options || [])])];
      const spec: KeySpec = { rendered: !!via };
      if (via) spec.via = via;
      if (types.size) spec.types = [...types].sort();
      // Enforced: a select whose options cover every value real pages use, on a key render code reads.
      if (via && b !== "styles" && e?.control === "select" && (e.options?.length ?? 0) >= 2 && realVals.length && realVals.every((v) => e.options.includes(v)))
        spec.enum = [...e.options];
      if (values.length && !spec.enum) spec.values = values.slice(0, 16);
      const dflt = rr?.default !== undefined ? rr.default : fvals[b][k];
      if (dflt !== undefined && dflt !== "" && !isObj(dflt) && !Array.isArray(dflt)) spec.default = dflt;
      if (mined?.[b]?.[k]) spec.seen = mined[b][k];
      if (e?.label) spec.label = e.label;
      if (e?.control) spec.control = e.control;
      if (desc[b][k]) spec.desc = desc[b][k];
      if (rr?.at) spec.at = rr.at;
      keys[b][k] = spec;
    }
  }
  const schema: ElementSchema = {
    type,
    rendered: RENDERED_TYPES.has(type),
    stylesOpen: !!r?.styles_open,
    keys,
    relations: {
      ...(mined?.parents && Object.keys(mined.parents).length ? { parents: mined.parents } : {}),
      ...(mined?.children && Object.keys(mined.children).length ? { children: mined.children } : {}),
      ...(r?.parent_reads ? { reads_parent: r.parent_reads } : {}),
    },
  };
  if (PARENTS[type]) schema.parents = PARENTS[type];
  cache.set(type, schema);
  return schema;
}

/** Where a node must sit, derived from data: a type seen ≥10 times whose uses sit ≥99% inside ONE
 *  non-generic parent (slide ⊂ carousel, group-select-item ⊂ group-select, select ⊂ form…), or a type
 *  whose renderer reads its parent's keys and real pages only ever put it in one parent type. */
const GENERIC_PARENTS = new Set(["(page)", "(popup)", "section", "popup", "group"]);
export const PARENTS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [type, o] of Object.entries(MINED)) {
    const ps = Object.entries((o.parents || {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
    const total = ps.reduce((n, [, c]) => n + c, 0);
    if (!ps.length || GENERIC_PARENTS.has(ps[0][0])) continue;
    const byData = (o.seen ?? 0) >= 10 && ps[0][1] / total >= 0.99;
    const byRenderer = !!RTYPES[type]?.parent_reads?.length && ps.length === 1;
    if (byData || byRenderer) out[type] = [ps[0][0]];
  }
  return out;
})();

/** Stored by the editor on purpose — never a NO_EFFECT: a key the editor's panel writes for this
 *  type (form styles reach the fields through the editor's store), a key the factory seeds on a
 *  fresh node (image-block specials.imageCompression), or editor UI state no type's
 *  render code reads (bgHidden / borderColorHidden / hiddenEffect remember a toggled-off panel). */
const EDITOR_ANY: Record<Bucket, Set<string>> = { specials: new Set(), config: new Set(), styles: new Set(), properties: new Set() };
for (const t of Object.values(EDITOR.types || {}) as any[]) for (const b of BUCKETS) for (const k of Object.keys(t[b] || {})) EDITOR_ANY[b].add(k);
const editorState = (type: string, bucket: Bucket, key: string) =>
  !!EDITOR.types?.[type]?.[bucket]?.[key] ||
  !!FACTORY_KEYS.get(type)?.has(`${bucket}.${key}`) || (EDITOR_ANY[bucket].has(key) && !Object.keys(RTYPES).some((t) => renderedVia(t, bucket, key)));

// ── Universe per bucket (any type) — a key here is real, not a typo ───────────────────────
const ANY: Record<Bucket, Set<string>> = { specials: new Set(), config: new Set(), styles: new Set(), properties: new Set() };
for (const t of new Set([...Object.keys(MINED), ...Object.keys(RTYPES), ...Object.keys(EDITOR.types || {}), ...Object.keys(BY_TYPE)])) {
  const s = elementSchema(t);
  if (s) for (const b of BUCKETS) for (const k of Object.keys(s.keys[b])) ANY[b].add(k);
}
for (const b of BUCKETS) for (const k of Object.keys(SHARED[b] || {})) ANY[b].add(k);

// CSS property names, camelCase (styles keys of an open-style type are emitted as CSS).
// ponytail: a fixed list + every styles key real pages use; add a property here if a real one gets flagged.
const CSS_PROPS = new Set(
  `alignContent alignItems alignSelf animation animationDelay animationDuration animationName aspectRatio
backdropFilter backfaceVisibility background backgroundAttachment backgroundBlendMode backgroundClip backgroundColor
backgroundImage backgroundOrigin backgroundPosition backgroundRepeat backgroundSize border borderBottom borderBottomColor
borderBottomLeftRadius borderBottomRightRadius borderBottomStyle borderBottomWidth borderColor borderImage borderLeft borderLeftColor
borderLeftStyle borderLeftWidth borderRadius borderRight borderRightColor borderRightStyle borderRightWidth borderSpacing
borderStyle borderTop borderTopColor borderTopLeftRadius borderTopRightRadius borderTopStyle borderTopWidth borderWidth
bottom boxShadow boxSizing clear clipPath color columnGap columns content cursor direction display fill filter flex
flexBasis flexDirection flexGrow flexShrink flexWrap float font fontFamily fontSize fontStyle fontVariant fontWeight gap
grid gridArea gridColumn gridColumnEnd gridColumnStart gridRow gridRowEnd gridRowStart gridTemplateAreas
gridTemplateColumns gridTemplateRows height inset isolation justifyContent justifyItems justifySelf left letterSpacing
lineHeight listStyle listStyleType margin marginBottom marginLeft marginRight marginTop mask maskImage maxHeight maxWidth
minHeight minWidth mixBlendMode objectFit objectPosition opacity order outline outlineColor outlineOffset outlineStyle
outlineWidth overflow overflowWrap overflowX overflowY padding paddingBottom paddingLeft paddingRight paddingTop
perspective placeItems placeSelf pointerEvents position right rotate rowGap scale stroke strokeWidth tableLayout textAlign
textDecoration textDecorationColor textIndent textOverflow textShadow textTransform top transform transformOrigin
transition transitionDelay transitionDuration transitionProperty translate userSelect verticalAlign visibility
whiteSpace width wordBreak wordSpacing writingMode zIndex`.split(/\s+/)
);
const isCssKey = (k: string) => CSS_PROPS.has(k) || k.startsWith("--") || /^-?webkit/i.test(k);

// ── Did you mean ──────────────────────────────────────────────────────────────────────────
const norm = (k: string) => k.toLowerCase().replace(/[-_]/g, "");
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
/** Closest known key: same letters ignoring case/-/_, else edit distance ≤ 2 (≤ 1 for short keys). */
export function didYouMean(key: string, known: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = 3;
  const nk = norm(key);
  for (const k of known) {
    if (norm(k) === nk) return k;
    const d = lev(key, k);
    if (key.length < 5 && d > 1) continue;
    if (d < bestD) [best, bestD] = [k, d];
  }
  return best;
}

// ── Checks ────────────────────────────────────────────────────────────────────────────────
export interface Finding {
  code: "UNKNOWN_KEY" | "NO_EFFECT" | "BAD_VALUE" | "BAD_PARENT";
  severity: "error" | "warning";
  id?: string;
  type: string;
  /** specials.x | config.x | styles.x (breakpoint-free, so findings collapse across both). */
  at?: string;
  message: string;
  fix?: string;
}
/** Keys a hand rule in validate.ts already judges (with the renderer crash it causes). */
const HAND_CHECKED = new Set(["countdown.specials.language", "countdown.specials.type", "gallery.config.thumbnailPosition", "address.specials.field_name"]);
/** Editor / save bookkeeping every element carries — never a NO_EFFECT. */
const NOISE = new Set(["notloaded", "parentCarousel", "parentSlide", "lock", "constrainProportions", "ratioConstrain", "isChangeSection"]);
/** Keys an agent invents from HTML/CSS habits → where the element really keeps that. */
const INVENTED: Record<string, string> = {
  content: "put the text/HTML in specials.text",
  innerHTML: "put the text/HTML in specials.text",
  label: "put the label in specials.text",
  href: 'links are events: events:[{ type:"click", action:"open_link", target:"https://…" }]',
  url: 'links are events: events:[{ type:"click", action:"open_link", target:"https://…" }]',
  onClick: "interactions are events[]",
  image: "image-block: put the URL in specials.src",
};

function checkValue(type: string, bucket: Bucket, k: string, spec: KeySpec, v: any, base: { id?: string; type: string }, out: Finding[]) {
  if (v === null || v === undefined || v === "" || HAND_CHECKED.has(`${type}.${bucket}.${k}`)) return;
  const at = `${bucket}.${k}`;
  if (spec.enum && typeof v === "string" && !spec.enum.includes(v)) {
    const guess = didYouMean(v, spec.enum);
    out.push({ ...base, at, code: "BAD_VALUE", severity: "error", message: `"${v}" is not one of ${spec.enum.join("|")} (the editor's options)`, fix: guess ? `use "${guess}"` : `pick one of ${spec.enum.join("|")}` });
    return;
  }
  // value TYPE: specials/config only (styles values are emitted as CSS text either way)
  if (bucket === "styles" || !spec.types?.length || !spec.rendered) return;
  const got = typeOf(v);
  if (spec.types.includes(got)) return;
  const asBool = spec.types.includes("boolean") && got === "string" && /^(true|false)$/i.test(v);
  const asNum = spec.types.includes("number") && got === "string" && /^-?\d+(\.\d+)?$/.test(v.trim());
  out.push({ ...base, at, code: "BAD_VALUE", severity: "warning", message: `${got} value; real pages and the editor store ${spec.types.join("|")}`, fix: asBool ? `use ${String(v).toLowerCase()} (boolean)` : asNum ? `use ${Number(v)} (number)` : undefined });
}

/** Unknown, dead and mistyped keys of one node (specials, per-breakpoint config / styles). */
export function checkElementKeys(node: any): Finding[] {
  const out: Finding[] = [];
  if (!node || typeof node.type !== "string" || !RENDERED_TYPES.has(node.type)) return out;
  const type = node.type;
  const schema = elementSchema(type);
  if (!schema) return out;
  const base = { id: typeof node.id === "string" ? node.id : undefined, type };
  const seen = new Set<string>(); // a key set on both breakpoints is judged once
  const layers: [Bucket, any][] = [["specials", node.specials]];
  for (const bp of ["desktop", "mobile"]) layers.push(["config", node.responsive?.[bp]?.config], ["styles", node.responsive?.[bp]?.styles]);
  for (const [bucket, obj] of layers) {
    if (!isObj(obj)) continue;
    for (const [k, v] of Object.entries(obj)) {
      const at = `${bucket}.${k}`;
      if (NOISE.has(k) || seen.has(at)) continue;
      seen.add(at);
      const spec = schema.keys[bucket][k];
      if (spec) checkValue(type, bucket, k, spec, v, base, out);
      const real = !!spec || ANY[bucket].has(k) || (bucket === "styles" && isCssKey(k));
      if (real) {
        if (v === null || v === undefined || v === "" || renderedVia(type, bucket, k) || editorState(type, bucket, k)) continue;
        const moved = BUCKETS.find((b) => b !== bucket && b !== "properties" && renderedVia(type, b, k));
        out.push({
          ...base, at, code: "NO_EFFECT", severity: "warning",
          message: moved ? `${type} reads ${k} from ${moved}, not ${bucket} — stored here, changes nothing` : `${type} render code never reads ${at} — stored, changes nothing on the published page`,
          fix: moved ? `move it to ${moved === "specials" ? "specials" : `responsive.<bp>.${moved}`}` : `drop it; see the keys in get_element("${type}")`,
        });
        continue;
      }
      // Not a key of any element: invented or misspelled.
      const other = BUCKETS.find((b) => b !== bucket && b !== "properties" && (schema.keys[b][k] || (b === "styles" && isCssKey(k))));
      let guess = other || INVENTED[k] ? undefined : didYouMean(k, Object.keys(schema.keys[bucket])) ?? didYouMean(k, ANY[bucket]);
      // a misspelled key of another bucket (specials.letterSpacng → styles.letterSpacing)
      if (!guess && !other && !INVENTED[k])
        for (const b of BUCKETS.filter((x) => x !== bucket && x !== "properties")) {
          const g = didYouMean(k, b === "styles" ? [...Object.keys(schema.keys.styles), ...CSS_PROPS] : Object.keys(schema.keys[b]));
          if (g) {
            guess = `${b === "specials" ? "specials" : `responsive.<bp>.${b}`}.${g}`;
            break;
          }
        }
      out.push({
        ...base, at, code: "UNKNOWN_KEY", severity: "warning",
        message: other ? `belongs in ${other}, not ${bucket}` : `no element has a ${bucket} key "${k}" and no render code reads it`,
        fix: other ? `move it to ${other === "specials" ? "specials" : `responsive.<bp>.${other}`}` : INVENTED[k] ?? (guess ? `did you mean "${guess}"?` : `see get_element("${type}")`),
      });
    }
  }
  return out;
}

/** A node that must sit directly inside a given parent type but doesn't. */
export function checkParent(node: any, parentType: string | undefined): Finding | undefined {
  const need = PARENTS[node?.type];
  if (!need || (parentType && need.includes(parentType))) return undefined;
  return { code: "BAD_PARENT", severity: "warning", id: node.id, type: node.type, message: `sits in ${parentType ?? "the page root"}; real pages always put it directly inside ${need.join(" or ")}`, fix: `move it into a ${need[0]}` };
}

/** `[CODE] path #id (type) at: problem → fix`. */
export function formatFinding(f: Finding, path?: string): string {
  return `[${f.code}]${path ? ` ${path}` : ""}${f.id ? ` #${f.id}` : ""} (${f.type})${f.at ? ` ${f.at}` : ""}: ${f.message}${f.fix ? ` → ${f.fix}` : ""}`;
}

/** Same finding on many nodes → one line listing the ids (keeps a big page's warnings readable). */
export function collapseFindings(items: { f: Finding; path: string }[]): string[] {
  const groups = new Map<string, { f: Finding; path: string; ids: string[] }>();
  for (const it of items) {
    const key = `${it.f.code}|${it.f.type}|${it.f.at}|${it.f.message}`;
    const g = groups.get(key);
    if (g) g.ids.push(it.f.id ?? it.path);
    else groups.set(key, { ...it, ids: [it.f.id ?? it.path] });
  }
  return [...groups.values()].map((g) =>
    g.ids.length === 1
      ? formatFinding(g.f, g.path)
      : formatFinding({ ...g.f, id: undefined }, `${g.ids.length} elements (${g.ids.slice(0, 4).map((i) => `#${i}`).join(", ")}${g.ids.length > 4 ? ", …" : ""})`)
  );
}

/** Compact key reference for get_element: one line per key, rendered first; dead keys listed apart. */
export function keyReference(type: string): Record<string, any> | undefined {
  const s = elementSchema(type);
  if (!s) return undefined;
  const fmt = (v: unknown) => (typeof v === "string" ? JSON.stringify(v.length > 40 ? `${v.slice(0, 37)}…` : v) : String(v));
  const out: Record<string, any> = {};
  const dead: string[] = [];
  for (const b of BUCKETS) {
    if (b === "properties") continue;
    const rows = Object.entries(s.keys[b]).filter(([k]) => !NOISE.has(k));
    rows.sort(([ka, a], [kb, bb]) => Number(bb.rendered) - Number(a.rendered) || (bb.seen ?? 0) - (a.seen ?? 0) || ka.localeCompare(kb));
    const lines: string[] = [];
    for (const [k, spec] of rows) {
      if (!spec.rendered) {
        if (spec.seen || spec.label) dead.push(`${b}.${k}`);
        continue;
      }
      // open styles: list only the keys with something to say (the rest is plain CSS)
      if (b === "styles" && spec.via === "css-loop" && !spec.desc && !spec.enum) continue;
      const parts: string[] = [];
      const meaning = spec.desc ?? (spec.label ? `"${spec.label}"` : undefined);
      if (meaning) parts.push(meaning);
      if (spec.types && !(spec.enum && spec.types.length === 1) && !(meaning && spec.types.some((t) => meaning.startsWith(t)))) parts.push(spec.types.join("|"));
      if (spec.enum) parts.push(`one of ${spec.enum.join("|")}`);
      else if (spec.values?.length) parts.push(`e.g. ${spec.values.slice(0, 10).join("|")}`);
      if (spec.default !== undefined) parts.push(`default ${fmt(spec.default)}`);
      if (spec.via === "client" || spec.via === "child" || spec.via === "data") parts.push(`via ${spec.via === "child" ? "its children" : spec.via === "data" ? "event_data" : "client runtime"}`);
      lines.push(parts.length ? `${k}: ${parts.join(" · ")}` : k);
    }
    if (lines.length) out[b] = lines;
  }
  if (s.stylesOpen) {
    const dropped = (RTYPES[type]?.styles_dropped || []).filter((k: string) => !["top", "left", "width", "height", "transform", "mixBlendMode"].includes(k));
    out.styles_note = `every other CSS property in responsive.<bp>.styles is emitted as-is${dropped.length ? ` (except ${dropped.join(", ")}, handled above or dropped)` : ""}`;
  } else out.styles_note = "only the styles keys listed are rendered (fixed list); top/left/width/height/zIndex position every element";
  if (dead.length) out.no_effect = dead;
  return out;
}

/** Relations for get_element: real-page parents / children, the required parent, parent reads. */
export function relationsOf(type: string): Record<string, any> | undefined {
  const s = elementSchema(type);
  if (!s) return undefined;
  const top = (o?: Record<string, number>) => (o ? Object.entries(o).slice(0, 8).map(([t, n]) => `${t} ×${n}`).join(", ") : undefined);
  const r: Record<string, any> = {};
  if (!s.rendered) r.rendered = "no HTML builder case — renders an empty box on the published page";
  if (s.parents) r.must_be_inside = s.parents;
  if (s.relations.parents) r.parents_on_real_pages = top(s.relations.parents);
  if (s.relations.children) r.children_on_real_pages = top(s.relations.children);
  if (s.relations.reads_parent) r.reads_from_parent = s.relations.reads_parent;
  return Object.keys(r).length ? r : undefined;
}
