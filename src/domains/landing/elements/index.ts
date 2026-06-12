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
import { ElementNode, base, seedPosition, setBox } from "../../../core/element.js";
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
  if (d) return createElementFrom(d, overrides);

  const el = base();
  el.type = type;
  el.properties.name = overrides.name ?? type;
  seedPosition(el);
  setBox(el, 200, 100);
  if (CONTAINER_TYPES.has(type)) el.children = [];
  return el;
}
