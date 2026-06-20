/**
 * The Domain seam.
 *
 * A `Domain` bundles everything the generic MCP tools need to expose a build-
 * validate-persist workflow for one kind of output (today: a Webcake landing
 * page). The tool modules in ../tools depend only on this interface, so adding
 * another domain later means implementing `Domain` and registering the same
 * tool groups — no changes to core or the tool layer.
 */
import type { ElementNode } from "./element.js";
import type { ElementDoc } from "./descriptor.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: { sections: number; popups: number; elements: number; ids: number };
}

export interface Domain {
  /** Stable id, e.g. "landing". */
  id: string;
  /** Server instructions string shipped to every MCP client for this domain. */
  instructions: string;
  /** Payload returned by get_generation_guide (guide text + canvas + event vocab). */
  guide: unknown;
  /** Element catalog (docs) keyed by type. */
  catalog: Record<string, ElementDoc>;
  elementTypes: string[];
  containerTypes: Set<string>;
  fieldTypes: Set<string>;
  /** A structurally-valid default node for `type` (fresh id), optionally renamed. */
  createElement(type: string, overrides?: { name?: string }): ElementNode;
  /** An empty but complete top-level source shell to fill in. */
  createPageSource(opts: { mobileOnly?: boolean; settings?: Record<string, any> }): unknown;
  /** Structural + semantic validation of a generated source. */
  validate(input: unknown): ValidationResult;
  /** Accept an object or a JSON string; return the parsed source (throws on bad JSON). */
  coerce(input: unknown): unknown;
  /**
   * Hydrate a (possibly sparse) source: merge every element node onto its factory
   * default so the model can omit boilerplate (properties/runtime/empty
   * events+children/per-breakpoint config). Backward compatible — a full node is
   * just overlaid on the seed. Accepts an object or JSON string; tolerant (returns
   * the input unchanged if it can't be parsed). Run BEFORE validate/persist.
   */
  expand(input: unknown): unknown;
  /**
   * The inverse of `expand`: strip from a FULL source everything the factory
   * seed re-creates identically (boilerplate properties/runtime/empty
   * events+children/per-breakpoint config + seed-equal style keys), leaving the
   * sparse authoring shape. Invariant: expand(compact(x)) persists the same
   * tree as expand(x). Tolerant — returns the input unchanged on bad JSON or
   * unknown types. Used by get_page so the model READS sources in the same
   * sparse shape it is asked to WRITE.
   */
  compact(input: unknown): unknown;
  /** The canonical JSON Schema (Draft 2020-12) for this domain's source. */
  schema: object;
  /**
   * Optional: deterministically fix the layout defects this domain can resolve
   * without guessing intent — applied IN PLACE to an already-`expand`ed source
   * (off-canvas boxes pulled on-canvas, elements below wrapped text pushed down
   * to clear the spill, containers grown to fit). Returns a human-readable list
   * of every change so the correction is transparent. Run AFTER expand and
   * BEFORE validate/persist; idempotent (a second pass is a no-op). A domain
   * without auto-fixable geometry omits it; the tools call it optionally.
   */
  autofixLayout?(input: unknown): string[];
  /**
   * Optional: deterministically rebuild a parsed absolute-canvas builder export
   * (the `canvas` payload from the ingest tools — LadiPage-family / Webcake-
   * published HTML) into a ready-to-save source for THIS domain. A domain that
   * supports clone-by-geometry implements it; the ingest tools call it to fold a
   * `source` + `notes` (lossy-approximation list) into their response so a clone
   * keeps the original's exact boxes/styles/images instead of being hand-rebuilt.
   * `canvas` is the opaque ingest `canvas` object; returns the sparse source
   * (run through `expand`+`validate` by create_page) and the notes.
   */
  canvasToSource?(canvas: unknown, meta?: { title?: string; description?: string }): { source: unknown; notes: string[] };
}
