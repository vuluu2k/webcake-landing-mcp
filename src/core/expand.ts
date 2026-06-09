/**
 * Sparse-node hydration (token optimization).
 *
 * The model may author elements with only the MEANINGFUL fields — id, type, the
 * per-breakpoint `styles` (positions/sizes/colors/font), `specials`
 * (text/src/field_name…), and `events` when there are any — and OMIT the
 * repetitive boilerplate that is identical on every node: `properties`,
 * `runtime`, empty `events`/`children`, and each breakpoint's `config`
 * (notloaded + the default animation block). `expandNode` merges a sparse node
 * onto the domain's factory default for its type (recursively for children),
 * producing the full element node the renderer expects.
 *
 * Sending a COMPLETE node still works — the merge just overlays every provided
 * value over the seed, so it is backward compatible. The win: fewer tokens the
 * model must emit per element, which is the dominant cost of building a page.
 */
import type { ElementNode } from "./element.js";

type CreateElement = (type: string, overrides?: { name?: string }) => ElementNode;

const STD_KEYS = ["id", "type", "properties", "specials", "runtime", "events", "responsive", "children"];

const isObj = (v: any): v is Record<string, any> =>
  v != null && typeof v === "object" && !Array.isArray(v);

/** Hydrate ONE (possibly sparse) element node against the factory default for its type. */
export function expandNode(input: any, createElement: CreateElement): any {
  if (!isObj(input)) return input;
  const type = input.type;
  // No type → can't seed; pass through so the validator reports the missing type.
  if (typeof type !== "string" || type === "") return input;

  let seed: ElementNode;
  try {
    const name = isObj(input.properties) && typeof input.properties.name === "string"
      ? input.properties.name
      : undefined;
    seed = createElement(type, name ? { name } : undefined);
  } catch {
    return input;
  }

  const out: any = { ...seed };

  if (typeof input.id === "string") out.id = input.id;
  out.type = type;
  out.properties = { ...seed.properties, ...(isObj(input.properties) ? input.properties : {}) };
  out.specials = { ...seed.specials, ...(isObj(input.specials) ? input.specials : {}) };
  out.runtime = isObj(input.runtime) ? input.runtime : seed.runtime;
  out.events = Array.isArray(input.events) ? input.events : seed.events;

  // responsive: merge config + styles per breakpoint over the seed; keep the
  // seed breakpoint when the model omits it. (Provide BOTH breakpoints' styles
  // for correct layout — only the boilerplate around them is defaulted here.)
  out.responsive = { desktop: seed.responsive.desktop, mobile: seed.responsive.mobile };
  for (const bp of ["desktop", "mobile"] as const) {
    const inBp = isObj(input.responsive) ? input.responsive[bp] : undefined;
    const seedBp = seed.responsive[bp];
    out.responsive[bp] = isObj(inBp)
      ? {
          ...seedBp,
          ...inBp,
          config: { ...seedBp.config, ...(isObj(inBp.config) ? inBp.config : {}) },
          styles: { ...seedBp.styles, ...(isObj(inBp.styles) ? inBp.styles : {}) },
        }
      : seedBp;
  }

  // children: replace with the (recursively expanded) provided children; else keep the seed's.
  if (Array.isArray(input.children)) {
    out.children = input.children.map((c: any) => expandNode(c, createElement));
  } else if (Array.isArray(seed.children)) {
    out.children = seed.children;
  }

  // carry over any non-standard keys the model set (future-proofing).
  for (const k of Object.keys(input)) {
    if (!STD_KEYS.includes(k)) out[k] = input[k];
  }

  return out;
}

/** Hydrate every node in a page source ({ page, popup, dynamic_pages }). */
export function expandSource(source: any, createElement: CreateElement): any {
  if (!isObj(source)) return source;
  const out: any = { ...source };
  if (Array.isArray(source.page)) out.page = source.page.map((s: any) => expandNode(s, createElement));
  if (Array.isArray(source.popup)) out.popup = source.popup.map((p: any) => expandNode(p, createElement));
  if (Array.isArray(source.dynamic_pages))
    out.dynamic_pages = source.dynamic_pages.map((p: any) => expandNode(p, createElement));
  return out;
}
