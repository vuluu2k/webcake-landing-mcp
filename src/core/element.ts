/**
 * Domain-agnostic element primitives shared by every domain that builds an
 * absolute-positioned, per-breakpoint element tree (the Webcake editor model).
 *
 * Holds the node shape, the empty-node factory (`base`), the small style
 * helpers, and the id/placeholder/animation utilities. A domain's per-element
 * `seed` (see ../core/descriptor.ts) builds on these to produce a structurally
 * valid default node. Nothing here knows about "landing pages" specifically.
 */

export type Breakpoint = { config: Record<string, any>; styles: Record<string, any> };
export type ElementNode = {
  id: string;
  type: string;
  properties: Record<string, any>;
  responsive: { desktop: Breakpoint; mobile: Breakpoint };
  specials: Record<string, any>;
  runtime: Record<string, any>;
  events: any[];
  children?: ElementNode[];
};

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALNUM[Math.floor(Math.random() * ALNUM.length)];
  return s;
}

/**
 * Placeholder image URL. There is no image API yet, so generated image elements
 * get a visible placeholder (sized to the element) instead of an empty src —
 * otherwise the page renders blank where images should be. Users swap these later.
 */
export function imgPlaceholder(w = 600, h = 400, label = "Image"): string {
  return `https://placehold.co/${Math.round(w)}x${Math.round(h)}?text=${encodeURIComponent(label)}`;
}

/** Default per-breakpoint animation block (matches real page_source). */
export function defaultAnimation() {
  return { name: "none", delay: 0, duration: 3, repeat: null };
}

/** An empty, structurally-valid element node (no type yet). */
export function base(): ElementNode {
  return {
    id: randomId(),
    type: "",
    properties: { movable: true, sync: true },
    responsive: {
      desktop: { config: { notloaded: false, animation: defaultAnimation() }, styles: {} },
      mobile: { config: { notloaded: false, animation: defaultAnimation() }, styles: {} },
    },
    specials: {},
    runtime: {},
    events: [],
  };
}

/** Set the same style key on both breakpoints. */
export function setStyle(el: ElementNode, key: string, value: any) {
  el.responsive.desktop.styles[key] = value;
  el.responsive.mobile.styles[key] = value;
}

/** Set width+height on both breakpoints. */
export function setBox(el: ElementNode, w?: number, h?: number) {
  if (w != null) setStyle(el, "width", w);
  if (h != null) setStyle(el, "height", h);
}

/** Seed top/left = 0 on both breakpoints (absolute-positioned leaf inside a container). */
export function seedPosition(el: ElementNode) {
  setStyle(el, "top", 0);
  setStyle(el, "left", 0);
}
