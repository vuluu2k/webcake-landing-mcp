/**
 * Element registry: the single source of truth for the landing element model.
 *
 * Concatenates the per-category descriptor lists (in the canonical catalog
 * order) and DERIVES everything else from them:
 *  - LIBRARY        — the doc catalog the reference tools expose
 *  - ELEMENT_TYPES  — every supported type, in catalog order
 *  - CONTAINER_TYPES / FIELD_TYPES — from each descriptor's container/field flag
 *  - createElement  — a structurally-valid default node for a type
 *
 * Adding or editing an element means touching ONE descriptor in ./<category>.ts;
 * `npm run smoke` then re-checks that page-schema.json's elementType enum still
 * matches these keys, so schema drift fails the gate instead of passing silently.
 */
import {
  ElementDescriptor,
  buildCatalog,
  createElementFrom,
  deriveContainerTypes,
  deriveFieldTypes,
} from "../../../core/descriptor.js";
import { readFileSync } from "node:fs";
import { ElementNode, base, seedPosition, setBox, imgPlaceholder, randomId } from "../../../core/element.js";
import { LAYOUT } from "./layout.js";
import { CONTENT } from "./content.js";
import { FORM } from "./form.js";
import { COMMERCE } from "./commerce.js";
import { MARKETING } from "./marketing.js";

/** All descriptors, in catalog order (layout → content → form → commerce → marketing). */
export const ELEMENTS: ElementDescriptor[] = [...LAYOUT, ...CONTENT, ...FORM, ...COMMERCE, ...MARKETING];

/** Fast lookup by type. */
export const BY_TYPE: Record<string, ElementDescriptor> = Object.fromEntries(
  ELEMENTS.map((d) => [d.type, d])
);

/** The doc catalog (formerly LIBRARY) — what list_elements / get_element read. */
export const LIBRARY = buildCatalog(ELEMENTS);

/** Every supported element type, in catalog order. */
export const ELEMENT_TYPES = ELEMENTS.map((d) => d.type);

/**
 * One-line, name-only catalog grouped by category, for embedding in the
 * always-on instructions/guide — the model sees the FULL menu of types without
 * a list_elements round-trip (fixes the unknown-unknowns gap where it can't
 * get_element a type it doesn't know exists). Derived, so it never drifts.
 */
export const CATALOG_SUMMARY = [...new Set(ELEMENTS.map((d) => d.category))]
  .map((c) => `${c}: ${ELEMENTS.filter((d) => d.category === c).map((d) => d.type).join(", ")}`)
  .join(" · ");

/** Types that can hold `children` (derived from the container flag). */
export const CONTAINER_TYPES = deriveContainerTypes(ELEMENTS);

/** Form inputs that submit a value and need a unique specials.field_name. */
export const FIELD_TYPES = deriveFieldTypes(ELEMENTS);

/**
 * Create a structurally-valid default node for `type` (fresh id), optionally
 * renamed. Unknown / niche types fall back to a generic skeleton (matching the
 * editor factory's old `default` case).
 */
export function createElement(type: string, overrides: { name?: string } = {}): ElementNode {
  const d = BY_TYPE[type];
  if (d) {
    const el = createElementFrom(d, overrides);
    // The renderer renders a grid's children[0] as its template and crashes on an empty grid.
    if (type === "grid") el.children = [createElement("grid-item")];
    return el;
  }

  const el = base();
  el.type = type;
  el.properties.name = overrides.name ?? type;
  seedPosition(el);
  setBox(el, 200, 100);
  if (CONTAINER_TYPES.has(type)) el.children = [];
  return el;
}

// What the editor drops for a type (scripts/mine-presets.mjs runs the editor's pickers).
const PRESETS: Record<string, { picker: string; variants: number; default: any }> = JSON.parse(
  readFileSync(new URL("../element-presets.json", import.meta.url), "utf8")
);
/** Keys where the MCP's own seed wins: media stays a sized placeholder the AI swaps (not the
 * editor's sample photos/video), ids and per-element field names stay fresh. */
const OWN_SPECIALS = new Set(["src", "img", "video", "typeVideo", "media", "html", "editingSlide", "field_name"]);

/** The editor's default for `type` laid over createElement(type): the look (colours, font,
 * border, size), settings and children a user gets when they drop it in the editor. Position stays
 * the seed's; children get fresh ids. A type the editor has no picker for = createElement. */
export function presetElement(type: string, overrides: { name?: string } = {}): ElementNode {
  const el = createElement(type, overrides);
  const p = PRESETS[type]?.default;
  if (!p) return el;
  overlay(el, p, true);
  if (p.children?.length) el.children = p.children.map(presetChild);
  // media placeholders sized to the final (editor) box
  const { width, height } = el.responsive.desktop.styles;
  if (type === "image-block") setImage(el, imgPlaceholder(width, height));
  if (type === "video" && typeof el.specials.img === "string") el.specials.img = imgPlaceholder(width, height, "Video");
  return el;
}

function setImage(el: ElementNode, src: string) {
  el.specials.src = src;
  for (const bp of ["desktop", "mobile"] as const)
    el.responsive[bp].styles.background = `center center/ cover no-repeat scroll content-box url(${src}) border-box`;
}

function overlay(el: ElementNode, p: any, top: boolean) {
  for (const [k, v] of Object.entries(p.specials ?? {})) if (!(top && OWN_SPECIALS.has(k)) && k !== "editingSlide") el.specials[k] = structuredClone(v);
  // option ids become DOM ids (radio, checkbox-group) and survey options submit as sv_<id>_<n>
  if (Array.isArray(el.specials.options) && p.specials?.options)
    el.specials.options.forEach((o: any, i: number) => {
      if (o && typeof o === "object") o.id = randomId(); // the miner drops the editor's random ids
      if (el.type === "survey" && o && typeof o === "object") {
        o.field_name = `sv_${el.id}_${i + 1}`;
        if (o.image) o.image = imgPlaceholder(el.specials.imageWidth || 60, el.specials.imageHeight || 60, `Option ${i + 1}`);
      }
    });
  for (const bp of ["desktop", "mobile"] as const) {
    const src = p.responsive?.[bp];
    if (!src) continue;
    const { top: t, left: l } = el.responsive[bp].styles;
    Object.assign(el.responsive[bp].config, structuredClone(src.config ?? {}));
    Object.assign(el.responsive[bp].styles, structuredClone(src.styles ?? {}));
    if (top) for (const [k, v] of [["top", t], ["left", l]] as const) v === undefined ? delete el.responsive[bp].styles[k] : (el.responsive[bp].styles[k] = v);
    delete el.responsive[bp].config.notloaded;
  }
}

/** A preset's child: its own seed + the editor's values (incl. its position inside the parent);
 * an image gets a placeholder sized to its box instead of the editor's sample photo. */
function presetChild(c: any): ElementNode {
  const el = createElement(c.type);
  overlay(el, c, false);
  if (c.type === "image-block") {
    const { width = 600, height = 400 } = el.responsive.desktop.styles;
    setImage(el, imgPlaceholder(width, height));
  }
  if (c.children?.length) el.children = c.children.map(presetChild);
  return el;
}
