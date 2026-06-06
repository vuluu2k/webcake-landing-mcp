/**
 * The single-descriptor element model.
 *
 * Every element type is declared ONCE as an `ElementDescriptor`: its category,
 * its container/field flags, its default layer name, its AI usage docs, an
 * optional filled example, and a `seed` that stamps the factory's visual
 * defaults onto a fresh node. From a list of descriptors we DERIVE the catalog
 * (docs), the container-type set, and the field-type set — so adding an element
 * is a one-file change instead of editing four files that must stay in sync.
 */
import { ElementNode, base } from "./element.js";

export type ElementCategory = "layout" | "content" | "form" | "commerce" | "marketing";

export interface ElementDescriptor {
  /** Element kind, e.g. "section", "text-block", "button". */
  type: string;
  category: ElementCategory;
  /** Can hold `children`. Drives CONTAINER_TYPES and auto-seeds `children: []`. */
  container: boolean;
  /** Form input that submits a value → needs a unique specials.field_name. Drives FIELD_TYPES. */
  field?: boolean;
  /** Default properties.name (layer label). */
  defaultName: string;
  /** One-line catalog summary. */
  summary: string;
  /** When the AI should reach for this element. */
  useWhen: string;
  /** Key `specials` fields documented for the AI. */
  keySpecials: Record<string, string>;
  /** Optional filled example node (validated by smoke). */
  example?: unknown;
  /**
   * Stamp the editor's visual defaults (sizes/specials/styles) onto a fresh
   * node. `children: []` is already seeded for container types before this runs.
   * Omit for types that need no visual defaults (e.g. group-select).
   */
  seed?: (el: ElementNode) => void;
}

/** The doc-facing subset of a descriptor (what list_elements / get_element expose). */
export interface ElementDoc {
  type: string;
  category: ElementCategory;
  container: boolean;
  summary: string;
  useWhen: string;
  keySpecials: Record<string, string>;
  example?: unknown;
}

/** Build a default node for a descriptor (replaces the old `createElement` switch). */
export function createElementFrom(d: ElementDescriptor, overrides: { name?: string } = {}): ElementNode {
  const el = base();
  el.type = d.type;
  el.properties.name = overrides.name ?? d.defaultName;
  if (d.container) el.children = [];
  d.seed?.(el);
  return el;
}

/** Catalog (docs) derived from descriptors — the LIBRARY the reference tools read. */
export function buildCatalog(elements: ElementDescriptor[]): Record<string, ElementDoc> {
  const catalog: Record<string, ElementDoc> = {};
  for (const d of elements) {
    catalog[d.type] = {
      type: d.type,
      category: d.category,
      container: d.container,
      summary: d.summary,
      useWhen: d.useWhen,
      keySpecials: d.keySpecials,
      example: d.example,
    };
  }
  return catalog;
}

export function deriveContainerTypes(elements: ElementDescriptor[]): Set<string> {
  return new Set(elements.filter((d) => d.container).map((d) => d.type));
}

export function deriveFieldTypes(elements: ElementDescriptor[]): Set<string> {
  return new Set(elements.filter((d) => d.field).map((d) => d.type));
}
