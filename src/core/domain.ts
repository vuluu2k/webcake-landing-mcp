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
  /** The canonical JSON Schema (Draft 2020-12) for this domain's source. */
  schema: object;
}
