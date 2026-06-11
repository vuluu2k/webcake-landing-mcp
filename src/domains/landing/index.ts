/**
 * The landing-page domain: the single object that implements the `Domain` seam
 * by wiring together the element registry, the event vocabulary, the generation
 * guide, the page-shell builder, the validator, and the JSON Schema. The MCP
 * server and tool layer depend only on this — never on the modules below.
 */
import type { Domain } from "../../core/domain.js";
import {
  CANVAS,
  EVENT_TRIGGERS,
  CLICK_ACTIONS,
  HOVER_ACTIONS,
  SUCCESS_ACTIONS,
  ERROR_ACTIONS,
  DELAY_ACTIONS,
} from "./vocab.js";
import { GENERATION_GUIDE } from "./guide.js";
import { INSTRUCTIONS } from "./instructions.js";
import { LIBRARY, ELEMENT_TYPES, CONTAINER_TYPES, FIELD_TYPES, createElement } from "./elements/index.js";
import { createPageSource } from "./page.js";
import { validatePage, coercePage, pageSchema } from "./validate.js";
import { expandSource } from "../../core/expand.js";
import { compactSource } from "../../core/compact.js";

/** The payload returned by the get_generation_guide tool. */
export const guidePayload = {
  guide: GENERATION_GUIDE,
  canvas: CANVAS,
  event_triggers: EVENT_TRIGGERS,
  click_actions: CLICK_ACTIONS,
  hover_actions: HOVER_ACTIONS,
  success_actions: SUCCESS_ACTIONS,
  error_actions: ERROR_ACTIONS,
  delay_actions: DELAY_ACTIONS,
};

// ---------------------------------------------------------------------------
// image-block normalization: derive styles.background from specials.src.
//
// The live published renderer paints an image-block ONLY from styles.background
// (exportCss.js:593,608-615); specials.src is never read by publish or render_v4.
// The editor silently writes the full background shorthand into styles.background
// when it is missing (ImageBlock.vue:244-249) — so editor-made pages work but
// MCP-authored pages that only set specials.src render blank on publish.
//
// Fix: after every expand pass, walk every image-block and, for each breakpoint
// whose styles.background is missing or contains no url(), stamp it with the
// editor's exact format derived from specials.src. Both breakpoints independently.
//
// compact() strips styles.background when it equals the seed value (which already
// carries the placeholder url()), but expand() re-derives it deterministically from
// specials.src — so the expand(compact(x)) == expand(x) invariant holds.
// ---------------------------------------------------------------------------

/** Build the editor's exact background shorthand from an image URL. */
function imgBackground(src: string): string {
  return `center center/ cover no-repeat scroll content-box url(${src}) border-box`;
}

/** True when a CSS background value already contains a url(). */
function hasUrl(bg: unknown): boolean {
  return typeof bg === "string" && bg.includes("url(");
}

/** Walk a tree node and normalise every image-block in-place (mutates). */
function normalizeImageBlocks(node: any): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "image-block") {
    const src = node.specials?.src;
    if (typeof src === "string" && src.trim() !== "") {
      for (const bp of ["desktop", "mobile"] as const) {
        const styles = node.responsive?.[bp]?.styles;
        if (styles && !hasUrl(styles.background)) {
          styles.background = imgBackground(src);
        }
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) normalizeImageBlocks(child);
  }
}

/** Apply image-block normalization to every node in a page source. */
function normalizeSource(source: any): any {
  if (!source || typeof source !== "object") return source;
  for (const arr of ["page", "popup", "dynamic_pages"] as const) {
    if (Array.isArray((source as any)[arr])) {
      for (const node of (source as any)[arr]) normalizeImageBlocks(node);
    }
  }
  return source;
}

export const landingDomain: Domain = {
  id: "landing",
  instructions: INSTRUCTIONS,
  guide: guidePayload,
  catalog: LIBRARY,
  elementTypes: ELEMENT_TYPES,
  containerTypes: CONTAINER_TYPES,
  fieldTypes: FIELD_TYPES,
  createElement,
  createPageSource,
  validate: validatePage,
  coerce: coercePage,
  expand: (input) => {
    try {
      return normalizeSource(expandSource(coercePage(input), createElement));
    } catch {
      return input; // bad JSON — let validate report it
    }
  },
  compact: (input) => {
    try {
      return compactSource(coercePage(input), createElement);
    } catch {
      return input; // bad JSON — return as-is
    }
  },
  schema: pageSchema,
};
