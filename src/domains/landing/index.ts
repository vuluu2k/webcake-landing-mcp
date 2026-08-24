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
import { canvasToPageSource } from "./canvas-to-source.js";
import type { IngestedCanvas } from "../../persistence/html-ingest.js";
import { validatePage, coercePage, pageSchema } from "./validate.js";
import { autofixLayout } from "./autofix-layout.js";
import { computeLayout, type LayoutOpts } from "./layout.js";
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

/** Deliberate-placeholder image hosts (the factory seed fills new image-blocks with one). */
const PLACEHOLDER_IMG_HOSTS = ["placehold.co", "placeholder.com", "dummyimage.com"];
/** True when a url / CSS background string points at a deliberate placeholder image. */
function isPlaceholderImg(s: unknown): boolean {
  return typeof s === "string" && PLACEHOLDER_IMG_HOSTS.some((h) => s.includes(h));
}

/** Walk a tree node and normalise every image-block in-place (mutates). */
function normalizeImageBlocks(node: any): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "image-block") {
    const src = node.specials?.src;
    if (typeof src === "string" && src.trim() !== "") {
      const srcIsReal = !isPlaceholderImg(src);
      for (const bp of ["desktop", "mobile"] as const) {
        const styles = node.responsive?.[bp]?.styles;
        if (!styles) continue;
        // The publish renderer paints an image-block ONLY from styles.background —
        // specials.src is never read on publish. Derive the background from
        // specials.src when the slot has no image url yet, OR when it still holds a
        // placeholder url while specials.src is a REAL image: the factory seed
        // pre-fills background with the placeholder, which would otherwise WIN over a
        // real src and render the placeholder on the published page. An explicit real
        // background (model-set, non-placeholder) is left untouched.
        if (!hasUrl(styles.background) || (srcIsReal && isPlaceholderImg(styles.background))) {
          styles.background = imgBackground(src);
        }
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) normalizeImageBlocks(child);
  }
}

// ---------------------------------------------------------------------------
// borderRadius normalization: the renderer emits border-radius RAW from the
// styles object (exportCss.js: `border-radius: ${style.borderRadius};`).
// A bare number (e.g. 16) or a unit-less string (e.g. "16") produces invalid
// CSS that browsers silently ignore — every corner renders square. Valid values
// are strings with CSS units: "16px", "50%", "16px 16px 0 0".
//
// Fix: after every expand pass, walk every node and, for each breakpoint whose
// styles.borderRadius is a number or a unit-less numeric string, coerce it to
// "<n>px". Already-valid strings (contain a letter or %) pass through untouched.
// ---------------------------------------------------------------------------

/** True when s is a plain number-string with no CSS unit (e.g. "16", "0"). */
function isUnitless(s: string): boolean {
  return /^\s*-?\d+(\.\d+)?\s*$/.test(s);
}

/** Walk a tree node and coerce numeric/unit-less borderRadius to "<n>px" in-place (mutates). */
function normalizeBorderRadius(node: any): void {
  if (!node || typeof node !== "object") return;
  for (const bp of ["desktop", "mobile"] as const) {
    const styles = node.responsive?.[bp]?.styles;
    if (!styles || typeof styles !== "object") continue;
    const br = styles.borderRadius;
    if (typeof br === "number" && Number.isFinite(br)) {
      styles.borderRadius = `${br}px`;
    } else if (typeof br === "string" && isUnitless(br)) {
      styles.borderRadius = `${parseFloat(br)}px`;
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) normalizeBorderRadius(child);
  }
}

// ---------------------------------------------------------------------------
// background normalization: the editor's background trait can only parse a
// url() layer written in its own canonical shorthand
//   '<pos>/ <size> <repeat> <attachment> content-box url(<src>) border-box'
// (splitBackground in landing_page_backend/assets/editor/common.js). A url()
// layer in any other format — e.g. plain CSS copied from a reference page like
// 'url(x) center/cover no-repeat' — survives the first save, but the moment the
// page is touched in the editor the picker re-composes it from unparsed parts
// as 'undefined/ undefined/ … content-box url(x)' and SAVES that garbage, so
// the band renders blank. Gradient/color layers are unaffected.
//
// Fix: after every expand pass, split styles.background into top-level comma
// layers (paren-aware); keep gradient/color layers unless they carry a literal
// 'undefined' token (a previously mangled layer — drop it); rewrite every url()
// layer that is not already editor-canonical into the canonical shorthand,
// preserving the url. Deterministic + idempotent, so expand(compact(x)) ==
// expand(x) still holds.
// ---------------------------------------------------------------------------

/** Split a CSS background value into top-level comma-separated layers. */
function splitBackgroundLayers(bg: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of bg) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      layers.push(cur);
      cur = "";
    } else cur += ch;
  }
  layers.push(cur);
  return layers.map((l) => l.trim()).filter((l) => l !== "");
}

/** The editor-canonical url() layer shape its splitBackground() can re-parse. */
const CANONICAL_URL_LAYER =
  /^(left|center|right) (top|center|bottom)\/ (cover|contain|auto|[\d.]+(?:px|%)(?: [\d.]+(?:px|%))?) (no-repeat|repeat|repeat-x|repeat-y|space|round)(?: (scroll|fixed|local))? content-box url\(.+\)(?: border-box)?$/;

/** Normalise one styles.background value (returns the input when no url layer). */
function normalizeBackgroundValue(bg: unknown): unknown {
  if (typeof bg !== "string" || !bg.includes("url(")) return bg;
  const out: string[] = [];
  for (const layer of splitBackgroundLayers(bg)) {
    const url = layer.match(/url\((['"]?)(.*?)\1\)/);
    if (url) {
      out.push(CANONICAL_URL_LAYER.test(layer) ? layer : imgBackground(url[2]));
    } else if (!/\bundefined\b/.test(layer)) {
      out.push(layer);
    }
  }
  return out.length ? out.join(", ") : bg;
}

/** Walk a tree node and canonicalise every url() background layer in-place (mutates). */
function normalizeBackgrounds(node: any): void {
  if (!node || typeof node !== "object") return;
  for (const bp of ["desktop", "mobile"] as const) {
    const styles = node.responsive?.[bp]?.styles;
    if (!styles || typeof styles !== "object") continue;
    const fixed = normalizeBackgroundValue(styles.background);
    if (fixed !== styles.background) styles.background = fixed;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) normalizeBackgrounds(child);
  }
}

// ---------------------------------------------------------------------------
// misplaced-animation normalization: models regularly emit the animation object
// directly under responsive.<bp> instead of responsive.<bp>.config.animation —
// the single most common "must NOT have additional properties" schema error,
// and one a patch op:'update' can never fix (update merges; it cannot delete
// the stray key). The intent is unambiguous, so move it where the editor reads
// it: into config.animation (the author's explicit non-'none' config.animation
// wins if both are set), then drop the stray key. Deterministic + idempotent,
// so the expand(compact(x)) == expand(x) invariant holds.
// ---------------------------------------------------------------------------

/** Walk a tree node and relocate responsive.<bp>.animation → config.animation in-place (mutates). */
function normalizeMisplacedAnimation(node: any): void {
  if (!node || typeof node !== "object") return;
  for (const bp of ["desktop", "mobile"] as const) {
    const rbp = node.responsive?.[bp];
    if (!rbp || typeof rbp !== "object") continue;
    const stray = (rbp as any).animation;
    if (stray !== undefined) {
      if (stray && typeof stray === "object") {
        rbp.config = rbp.config && typeof rbp.config === "object" ? rbp.config : {};
        const existing = rbp.config.animation;
        const existingWins =
          existing && typeof existing === "object" && typeof existing.name === "string" && existing.name !== "none";
        if (!existingWins) {
          rbp.config.animation = { name: "none", delay: 0, duration: 3, repeat: null, ...stray };
        }
      }
      delete (rbp as any).animation;
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) normalizeMisplacedAnimation(child);
  }
}

// ---------------------------------------------------------------------------
// editor-value normalization: the Webcake EDITOR does not store every numeric
// style as a number. Confirmed write paths in landing_page_backend/assets/editor:
//   • fontSize   → "59"   (main/panels/EditTextPanel.vue: updateStyle('fontSize', e.target.value))
//                  "13px" / "11px" / "70"  (main/pickers/*.vue seed values)
//   • height     → "600"  (main/traits/SizeAndPosition.vue handleBlur: e.target.value)
//   • borderWidth→ "1" / "0px"
//   • opacity    → "50%"  (main/traits/Layer.vue: updateStyle('opacity', val + '%'))
//   • top/left   → "unset"
// The published renderer copes (landing_page_build/render/build/exportCss.js
// parseInt()s the KEY_PREFIX_PIXEL group and string-concatenates '+ "px"' for
// top/left/width/height), so these pages are perfectly valid — but the MCP
// schema demanded numbers, so ONE manual tweak in the editor locked the page out
// of every MCP edit tool. That is the bug this pass removes.
//
// Fix: after every expand pass, coerce a unit-less or px-suffixed numeric string
// back to a number for the keys the renderer treats as bare px numbers, and turn
// an editor percent opacity into the 0–1 fraction. Values the coercion cannot
// read (`"unset"`, `"auto"`, `"100%"`) are left alone — the schema accepts them
// and validate.ts warns where the renderer would choke. Deterministic +
// idempotent, so the expand(compact(x)) == expand(x) invariant holds.
// ---------------------------------------------------------------------------

/** Style keys the renderer emits as bare px numbers (or parseInt()s). */
const NUMERIC_STYLE_KEYS = new Set(["top", "left", "width", "height", "zIndex", "fontSize", "borderWidth"]);

/** Per-breakpoint config keys the renderer appends "px" to / uses as numbers. */
const NUMERIC_CONFIG_KEYS = new Set([
  "virtualHeight", "column", "row", "slideWidth", "iconSize", "iconTop", "linePaddingLeft",
  "topBgImage", "leftBgImage", "widthBgImage", "heightBgImage",
  "stickyTop", "stickyLeft", "stickyRight", "stickyBottom",
]);

/** A number written as a string, with an optional "px" suffix: "59", " 12.5 ", "13px". */
const NUMERIC_PX_STRING = /^\s*-?\d+(?:\.\d+)?\s*(?:px)?\s*$/i;

/** "59" | "13px" -> 59 | 13. Anything else (including numbers) passes through. */
function numFromEditorString(v: unknown): unknown {
  if (typeof v !== "string" || !NUMERIC_PX_STRING.test(v)) return v;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : v;
}

/** "50%" -> 0.5 (the editor's Layer trait writes percent); else numeric-string coercion. */
function opacityFromEditorString(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const pct = v.trim().match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) {
    const n = parseFloat(pct[1]) / 100;
    return Number.isFinite(n) ? n : v;
  }
  return numFromEditorString(v);
}

/** Walk a tree node and coerce editor-written numeric strings in-place (mutates). */
function normalizeEditorValues(node: any): void {
  if (!node || typeof node !== "object") return;
  for (const bp of ["desktop", "mobile"] as const) {
    const rbp = node.responsive?.[bp];
    if (!rbp || typeof rbp !== "object") continue;

    const styles = rbp.styles;
    if (styles && typeof styles === "object") {
      for (const key of NUMERIC_STYLE_KEYS) {
        if (styles[key] !== undefined) styles[key] = numFromEditorString(styles[key]);
      }
      if (styles.opacity !== undefined && styles.opacity !== null) {
        styles.opacity = opacityFromEditorString(styles.opacity);
      }
    }

    const config = rbp.config;
    if (config && typeof config === "object") {
      for (const key of NUMERIC_CONFIG_KEYS) {
        if (config[key] !== undefined) config[key] = numFromEditorString(config[key]);
      }
      const anim = config.animation;
      if (anim && typeof anim === "object") {
        for (const key of ["delay", "duration"] as const) {
          if (anim[key] !== undefined && anim[key] !== null) anim[key] = numFromEditorString(anim[key]);
        }
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) normalizeEditorValues(child);
  }
}

/** settings.width_section carries the canvas width the coords live in — keep it numeric. */
function normalizeSettings(source: any): void {
  const ws = source?.settings?.width_section;
  if (!ws || typeof ws !== "object") return;
  for (const bp of ["desktop", "mobile"] as const) {
    if (ws[bp] !== undefined) ws[bp] = numFromEditorString(ws[bp]);
  }
}

/** Apply all post-expand normalizations to every node in a page source. */
function normalizeSource(source: any): any {
  if (!source || typeof source !== "object") return source;
  for (const arr of ["page", "popup", "dynamic_pages"] as const) {
    if (Array.isArray((source as any)[arr])) {
      for (const node of (source as any)[arr]) {
        normalizeEditorValues(node);
        normalizeMisplacedAnimation(node);
        normalizeImageBlocks(node);
        normalizeBorderRadius(node);
        normalizeBackgrounds(node);
      }
    }
  }
  normalizeSettings(source);
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
      // Normalize FIRST (on a clone, so a caller's fetched tree is never mutated):
      // a page hand-tweaked in the editor stores fontSize as "59" and height as
      // "600", and the model should READ the canonical number it is asked to
      // WRITE. Normalizing before compaction also lets a value that merely
      // differs from the seed by its type ("20" vs 20) compact away.
      const normalized = structuredClone(coercePage(input));
      for (const arr of ["page", "popup", "dynamic_pages"] as const) {
        if (Array.isArray((normalized as any)?.[arr])) (normalized as any)[arr].forEach(normalizeEditorValues);
      }
      normalizeSettings(normalized);
      return compactSource(normalized, createElement);
    } catch {
      return input; // bad JSON — return as-is
    }
  },
  schema: pageSchema,
  // Applies the deterministic layout fixes IN PLACE to an already-expanded tree
  // (off-canvas clamp + wrapped-text downward reflow) and returns the change log.
  autofixLayout: (input) => {
    try {
      return autofixLayout(input);
    } catch {
      return []; // never let a layout-fix corner case block the build
    }
  },
  // Exact centering/row/grid/stack coordinates for both breakpoints (the math
  // the guide prescribes), so the model never hand-computes `left`/`top`.
  computeLayout: (opts) => computeLayout(opts as LayoutOpts),
  canvasToSource: (canvas, meta) => canvasToPageSource(canvas as IngestedCanvas, meta),
};
