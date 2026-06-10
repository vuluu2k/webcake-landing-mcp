/**
 * Full-node compaction (the inverse of ./expand.ts).
 *
 * `compactNode` strips from a FULL element node everything that `expandNode`
 * would re-create identically from the type's factory default: `properties`
 * keys equal to the seed (movable/sync/default name), `runtime` when it equals
 * the seed's, empty `events`, empty seed-equal `children`, and each
 * breakpoint's `config`/`styles` keys whose values match the seed (notloaded +
 * the default animation block). What remains is the SPARSE authoring shape the
 * model is asked to emit — so `get_page` can return a compacted tree and the
 * model sees (and learns to write) sparse nodes instead of boilerplate.
 *
 * Invariant (smoke-tested): expand(compact(x)) persists the SAME tree as
 * expand(x). Compaction only removes data the expansion seed restores.
 * Unknown types and non-element values pass through untouched.
 */
import { base, type ElementNode } from "./element.js";

type CreateElement = (type: string, overrides?: { name?: string }) => ElementNode;

const STD_KEYS = ["id", "type", "properties", "specials", "runtime", "events", "responsive", "children"];

const isObj = (v: any): v is Record<string, any> =>
  v != null && typeof v === "object" && !Array.isArray(v);

/** JSON-ish deep equality (objects, arrays, primitives — no cycles). */
export function deepEq(a: any, b: any): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEq(v, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEq(a[k], b[k]));
  }
  return false;
}

/** Keys of `input` whose values differ from `seed`'s; undefined when nothing differs. */
function diffShallow(input: any, seed: any): Record<string, any> | undefined {
  if (!isObj(input)) return undefined;
  const out: Record<string, any> = {};
  const seedObj = isObj(seed) ? seed : {};
  for (const k of Object.keys(input)) {
    if (!deepEq(input[k], seedObj[k])) out[k] = input[k];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Strip from ONE (full) element node everything its factory seed re-creates. */
export function compactNode(input: any, createElement: CreateElement): any {
  if (!isObj(input)) return input;
  const type = input.type;
  if (typeof type !== "string" || type === "") return input;

  // Seed with the DEFAULT name (no override): a custom properties.name must
  // survive the diff, because expandNode re-seeds from input.properties.name.
  let seed: ElementNode;
  try {
    seed = createElement(type);
  } catch {
    return input;
  }

  const out: any = {};
  if (typeof input.id === "string") out.id = input.id;
  out.type = type;

  const props = diffShallow(input.properties, seed.properties);
  if (props) out.properties = props;

  const specials = diffShallow(input.specials, seed.specials);
  if (specials) out.specials = specials;

  // runtime/events are replaced WHOLESALE by expandNode when provided, so they
  // can only be dropped when they equal the seed's (typically {} / []).
  if (isObj(input.runtime) && !deepEq(input.runtime, seed.runtime)) out.runtime = input.runtime;
  if (Array.isArray(input.events) && !deepEq(input.events, seed.events)) out.events = input.events;

  const responsive: any = {};
  for (const bp of ["desktop", "mobile"] as const) {
    const inBp = isObj(input.responsive) ? input.responsive[bp] : undefined;
    if (!isObj(inBp)) continue; // absent → expand restores the seed breakpoint
    const seedBp = seed.responsive[bp];
    const bpOut: any = {};
    const cfg = diffShallow(inBp.config, seedBp.config);
    if (cfg) bpOut.config = cfg;
    const sty = diffShallow(inBp.styles, seedBp.styles);
    if (sty) bpOut.styles = sty;
    for (const k of Object.keys(inBp)) {
      if (k === "config" || k === "styles") continue;
      if (!deepEq(inBp[k], (seedBp as any)[k])) bpOut[k] = inBp[k];
    }
    if (Object.keys(bpOut).length) responsive[bp] = bpOut;
  }
  if (Object.keys(responsive).length) out.responsive = responsive;

  // children: expandNode falls back to seed.children when omitted, so a
  // seed-equal children array (e.g. an empty []) can be dropped entirely.
  if (Array.isArray(input.children) && !deepEq(input.children, seed.children)) {
    out.children = input.children.map((c: any) => compactNode(c, createElement));
  }

  // carry over any non-standard keys (expandNode round-trips them too).
  for (const k of Object.keys(input)) {
    if (!STD_KEYS.includes(k)) out[k] = input[k];
  }

  return out;
}

/**
 * The sparse AUTHORING TEMPLATE of a factory node — what get_element/new_element
 * hand the model to copy. Unlike `compactNode` (which diffs against the type's
 * own seed and so reduces a fresh factory node to nothing), this KEEPS the
 * seeded meaningful values — styles, specials, non-default config, children —
 * and drops only the boilerplate the server hydrates on persist: `properties`,
 * `runtime`, empty `events`, and each breakpoint's base config (notloaded +
 * the default animation block). Both breakpoints stay visible: the model must
 * always provide desktop AND mobile styles.
 */
export function sparseTemplate(node: ElementNode): any {
  const blank = base();
  const out: any = { id: node.id, type: node.type };
  if (isObj(node.specials) && Object.keys(node.specials).length) out.specials = node.specials;
  const responsive: any = {};
  for (const bp of ["desktop", "mobile"] as const) {
    const nBp = node.responsive[bp];
    const bpOut: any = {};
    const cfg = diffShallow(nBp?.config, blank.responsive[bp].config);
    if (cfg) bpOut.config = cfg;
    bpOut.styles = isObj(nBp?.styles) ? nBp.styles : {};
    responsive[bp] = bpOut;
  }
  out.responsive = responsive;
  if (Array.isArray(node.events) && node.events.length) out.events = node.events;
  if (Array.isArray(node.children)) out.children = node.children.map(sparseTemplate);
  return out;
}

/** Compact every node in a page source ({ page, popup, dynamic_pages }). */
export function compactSource(source: any, createElement: CreateElement): any {
  if (!isObj(source)) return source;
  const out: any = { ...source };
  if (Array.isArray(source.page)) out.page = source.page.map((s: any) => compactNode(s, createElement));
  if (Array.isArray(source.popup)) out.popup = source.popup.map((p: any) => compactNode(p, createElement));
  if (Array.isArray(source.dynamic_pages))
    out.dynamic_pages = source.dynamic_pages.map((p: any) => compactNode(p, createElement));
  return out;
}
