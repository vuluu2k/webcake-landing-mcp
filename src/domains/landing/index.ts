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
      return expandSource(coercePage(input), createElement);
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
