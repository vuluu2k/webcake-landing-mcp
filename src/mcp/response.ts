/**
 * Shared MCP response helpers. `text()` wraps any value as a single text content
 * block (objects are pretty-printed JSON) — the shape every tool returns.
 */
export function text(value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: body }] };
}

/**
 * Wrap a base64 image as an MCP image content block, optionally followed by a
 * text block (notes/metadata the model should read). Used by render_preview so a
 * multimodal model can SEE the rendered page and compare it to the reference.
 */
export function image(dataBase64: string, mimeType = "image/png", note?: unknown) {
  const content: Array<
    | { type: "image"; data: string; mimeType: string }
    | { type: "text"; text: string }
  > = [{ type: "image" as const, data: dataBase64, mimeType }];
  if (note !== undefined) {
    content.push({ type: "text" as const, text: typeof note === "string" ? note : JSON.stringify(note, null, 2) });
  }
  return { content };
}

/**
 * Like `image()` but returns SEVERAL image blocks (e.g. a tall page tiled into
 * top→bottom bands), optionally followed by a text note. The model sees each band
 * at a readable size instead of one over-squished image.
 */
export function images(items: Array<{ dataBase64: string; mimeType?: string }>, note?: unknown) {
  const content: Array<
    | { type: "image"; data: string; mimeType: string }
    | { type: "text"; text: string }
  > = items.map((it) => ({ type: "image" as const, data: it.dataBase64, mimeType: it.mimeType ?? "image/png" }));
  if (note !== undefined) {
    content.push({ type: "text" as const, text: typeof note === "string" ? note : JSON.stringify(note, null, 2) });
  }
  return { content };
}

/**
 * Directive shipped alongside every non-empty validation-warnings list.
 * Warnings are design defects the customer WILL see (text overlapping the
 * element below, off-canvas boxes, empty bands, dead event targets, missing
 * field_name…) — without this, models treat them as advisory noise and save
 * anyway.
 */
export const WARNINGS_NOTICE =
  "FIX THESE WARNINGS — each one is a visible defect the customer will see, not a suggestion. Apply the fix each warning prescribes (patch_page by element id is the cheap path), then re-validate until the list is empty. Only a warning you can demonstrate is a false positive may remain — name it to the user and say why. Do NOT report the page as done while warnings stand.";

/** Spread helper: {} when there are no warnings, else { warnings, warnings_notice }. */
export function warningsField(warnings: string[] | undefined) {
  return warnings && warnings.length > 0 ? { warnings, warnings_notice: WARNINGS_NOTICE } : {};
}

/**
 * Directive shipped alongside an auto-fix change list. Unlike warnings, these
 * defects were ALREADY corrected deterministically on this call (positions /
 * heights changed in the saved tree), so the model needs no action — just
 * awareness that coordinates moved.
 */
export const AUTO_FIXED_NOTICE =
  "These layout defects were auto-corrected on this call (off-canvas boxes pulled on-canvas; elements below wrapped text pushed down to clear the spill; containers grown to fit). The new coordinates/heights are what got validated and saved — no action needed. If you re-emit this source later, keep these positions (or re-fetch with get_page) rather than reverting to the originals.";

/** Spread helper: {} when nothing was auto-fixed, else { auto_fixed, auto_fixed_notice }. */
export function autoFixedField(autoFixed: string[] | undefined) {
  return autoFixed && autoFixed.length > 0 ? { auto_fixed: autoFixed, auto_fixed_notice: AUTO_FIXED_NOTICE } : {};
}
