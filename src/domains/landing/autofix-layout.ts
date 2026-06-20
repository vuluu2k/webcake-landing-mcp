/**
 * Deterministic LAYOUT auto-fix — APPLIES the corrections the validator already
 * computes, so the dominant build loop "validate → read warnings → patch_page →
 * re-validate → re-publish" collapses to zero round-trips on the two most common
 * layout defects:
 *
 *   1. Off-canvas boxes — a child whose box runs past the canvas edge is pulled
 *      back on-canvas (left clamped to [0, canvasW − width]; negative top → 0).
 *   2. Wrapped-text overlap — a text-block renders height:AUTO from `top` (the
 *      renderer IGNORES the declared height), so text that wraps to more lines
 *      than the author assumed spills DOWN onto the element below. The ONLY real
 *      fix is to MOVE the elements below down — which is exactly what the reflow
 *      does, measuring the real rendered height with the SAME font metrics
 *      (estTextHeightPx) the validator warns with. A container is grown to
 *      contain its reflowed content.
 *
 * Runs AFTER expand (on the full hydrated tree) and BEFORE validate/persist, in
 * the build-a-new-page tools (create_page, add_section, validate_page). It
 * MUTATES the tree in place and returns a human-readable list of every change so
 * the correction is transparent — never a silent move. Conservative by design:
 *  - only ever ADDS vertical whitespace / pulls boxes inward, never removes;
 *  - skips intentional layering (declared-overlapping boxes — badges, card
 *    backdrops, image-behind-text) using the validator's own gate;
 *  - idempotent: a second pass over a fixed tree is a no-op.
 *
 * The validator still reports anything autofix can't safely resolve (e.g. a box
 * wider than the canvas, cross-column card-height mismatches) as warnings.
 */
import { estTextHeightPx } from "./text-metrics.js";

const CANVAS_DESKTOP = 960;
const CANVAS_MOBILE = 420;
const DEFAULT_SECTION_HEIGHT = 800;
const MIN_GAP = 8; // px breathing room kept between a wrapped block and the one below
const TOL = 1; // px rounding tolerance
const MAX_FIXES = 40; // cap the reported list so a pathological page can't flood the response

const BPS = ["desktop", "mobile"] as const;
type Bp = (typeof BPS)[number];

/** Coerce a style value (number or "300px"/"300") to a finite number, else undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Material Symbols / Font Awesome single glyph — one glyph, not wrapping text (skip measuring). */
function isIconGlyph(rawText: unknown): boolean {
  return (
    typeof rawText === "string" &&
    (/\b(material-symbols|material-icons)\b/.test(rawText) || /<i\b[^>]*\bfa-/.test(rawText))
  );
}

function idOf(node: any): string {
  return typeof node?.id === "string" && node.id ? node.id : node?.type ?? "?";
}

/**
 * Pull one child back on-canvas at a breakpoint (horizontal + negative-top only).
 * A box WIDER than the canvas can't be clamped without resizing — left for the
 * validator to warn about.
 */
function clampChild(child: any, bp: Bp, canvasW: number, fixes: string[]): void {
  const styles = child?.responsive?.[bp]?.styles;
  if (!styles || typeof styles !== "object") return;
  const left = num(styles.left);
  const width = num(styles.width);
  const top = num(styles.top);

  if (left != null && left < -TOL) {
    styles.left = 0;
    pushFix(fixes, `"${idOf(child)}" [${bp}]: off-canvas left=${left} → pulled to 0.`);
  } else if (left != null && width != null && width <= canvasW + TOL && left + width > canvasW + TOL) {
    const fixed = Math.round(canvasW - width);
    styles.left = fixed;
    pushFix(fixes, `"${idOf(child)}" [${bp}]: ran off the right edge (left+width=${left + width} > ${canvasW}) → moved left to ${fixed}.`);
  }
  if (top != null && top < -TOL) {
    styles.top = 0;
    pushFix(fixes, `"${idOf(child)}" [${bp}]: negative top=${top} → pulled to 0.`);
  }
}

/**
 * Push siblings DOWN so no element sits inside the spill of a wrapped text-block
 * above it. Uses ORIGINAL declared boxes to decide intentional layering (skip)
 * and CURRENT positions + effective heights to decide clearance. Single
 * top-to-bottom pass: each element's top is resolved once against finalized
 * priors, so it converges and only moves elements down.
 */
function reflowChildren(
  kids: any[],
  effH: Map<any, number>,
  origH: Map<any, number | undefined>,
  bp: Bp,
  fixes: string[]
): void {
  const items = kids
    .map((k) => {
      const s = k?.responsive?.[bp]?.styles ?? {};
      const top = num(s.top);
      if (top == null) return null;
      return {
        k,
        origTop: top,
        cur: top,
        left: num(s.left) ?? 0,
        w: num(s.width) ?? 0,
        // The ORIGINAL declared height decides intentional layering — NOT the
        // height a text-block leaf may have just been resized to (that would
        // make a too-short box look like it "contains" the element below it).
        declaredH: origH.get(k) ?? 0,
        eff: effH.get(k) ?? num(s.height) ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.origTop - b.origTop);

  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    let required = b.cur;
    for (let j = 0; j < i; j++) {
      const a = items[j];
      // intentional layering (badge over rect, image behind text…): the author
      // declared b inside a's declared box → leave it alone.
      if (b.origTop < a.origTop + a.declaredH - TOL) continue;
      // only a sibling in the same horizontal column can be hit by the spill.
      const intersects = a.left < b.left + b.w - TOL && b.left < a.left + a.w - TOL;
      if (!intersects) continue;
      required = Math.max(required, a.cur + a.eff + MIN_GAP);
    }
    if (required > b.cur + TOL) {
      const moved = Math.round(required - b.cur);
      b.cur = Math.round(required);
      b.k.responsive[bp].styles.top = b.cur;
      pushFix(fixes, `"${idOf(b.k)}" [${bp}]: pushed down ${moved}px (top ${b.origTop}→${b.cur}) to clear wrapped text above it.`);
    }
  }
}

/**
 * Settle one node's EFFECTIVE rendered height at a breakpoint (post-order):
 * recurse so child boxes settle first, clamp + reflow this node's direct
 * children, then grow this node's own height to contain them. Returns the
 * effective height the PARENT should use for this node when it reflows.
 */
function processNode(node: any, bp: Bp, canvasW: number, pageFont: unknown, fixes: string[]): number {
  if (!node || typeof node !== "object") return 0;
  const styles = node?.responsive?.[bp]?.styles ?? {};
  const ownW = num(styles.width) ?? canvasW;
  const ownH = num(styles.height);
  const kids = Array.isArray(node.children) ? node.children.filter((k: any) => k && typeof k === "object") : [];

  if (kids.length === 0) {
    // Leaf: a text-block renders at its measured height regardless of declared
    // height. Resize the declared box to match (clears the own-box warning) and
    // report it as the effective height the parent reflows against.
    if (node.type === "text-block" && !isIconGlyph(node.specials?.text)) {
      const est = estTextHeightPx(node.specials?.text, styles, pageFont);
      if (est != null) {
        const h = num(styles.height);
        const fs = num(styles.fontSize) ?? 16;
        if (h != null && est > h + Math.min(fs * 1.4, 24)) {
          styles.height = est;
          pushFix(fixes, `"${idOf(node)}" [${bp}]: resized height ${h}→${est} to fit wrapped text (real font metrics).`);
        }
        return est;
      }
    }
    return ownH ?? 0;
  }

  // Capture ORIGINAL declared heights before recursion mutates any (text leaves
  // get resized to their measured height) — the reflow's layering test needs the
  // author's intended box, not the corrected one.
  const origH = new Map<any, number | undefined>();
  for (const k of kids) origH.set(k, num(k?.responsive?.[bp]?.styles?.height));

  // 1) post-order: settle each child's effective height first.
  const eff = new Map<any, number>();
  for (const k of kids) {
    const childCanvasW = num(k?.responsive?.[bp]?.styles?.width) ?? ownW;
    eff.set(k, processNode(k, bp, childCanvasW, pageFont, fixes));
  }
  // 2) pull each child on-canvas (horizontal), then 3) reflow them downward.
  for (const k of kids) clampChild(k, bp, ownW, fixes);
  reflowChildren(kids, eff, origH, bp, fixes);

  // 4) grow this container to contain its (reflowed) children.
  let maxBottom = 0;
  for (const k of kids) {
    const t = num(k?.responsive?.[bp]?.styles?.top) ?? 0;
    maxBottom = Math.max(maxBottom, t + (eff.get(k) ?? 0));
  }
  if (ownH != null && Math.ceil(maxBottom) > ownH + TOL) {
    const grown = Math.ceil(maxBottom);
    node.responsive[bp].styles.height = grown;
    pushFix(fixes, `"${idOf(node)}" [${bp}]: grew height ${ownH}→${grown} to contain its content.`);
    return grown;
  }
  return ownH != null ? ownH : Math.ceil(maxBottom);
}

function pushFix(fixes: string[], msg: string): void {
  if (fixes.length < MAX_FIXES) fixes.push(msg);
  else if (fixes.length === MAX_FIXES) fixes.push("…(more layout fixes applied — re-fetch with get_page to see the final coordinates).");
}

/**
 * Apply the deterministic layout fixes to a (already-expanded) page source IN
 * PLACE and return the list of changes. Tolerant — a non-object or a tree with
 * no fixable defects returns an empty list. The canvas width comes from
 * settings.width_section (defaults 960/420), the page font from
 * settings.fontGeneral.
 */
export function autofixLayout(source: any): string[] {
  if (!source || typeof source !== "object") return [];
  const fixes: string[] = [];
  const pageFont = source?.settings?.fontGeneral;
  const ws = source?.settings?.width_section ?? {};
  const canvasFor: Record<Bp, number> = {
    desktop: num(ws.desktop) ?? CANVAS_DESKTOP,
    mobile: num(ws.mobile) ?? CANVAS_MOBILE,
  };

  const roots: any[] = [];
  for (const key of ["page", "popup"] as const) {
    if (Array.isArray(source[key])) roots.push(...source[key]);
  }
  for (const top of roots) {
    if (!top || typeof top !== "object") continue;
    for (const bp of BPS) {
      // A top-level section/popup has no top/left to clamp; process its subtree.
      processNode(top, bp, canvasFor[bp], pageFont, fixes);
    }
  }
  return fixes;
}
