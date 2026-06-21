/**
 * Layout coordinate math — the exact arithmetic the generation guide tells the
 * model to do by hand ("do the math, don't eyeball `left`; off-center is the #1
 * defect"), exposed as a deterministic helper so the model gets perfect
 * coordinates for BOTH breakpoints instead of computing them in its head (or
 * spinning up an ad-hoc script). Pure functions, no I/O.
 *
 * Four patterns cover the vast majority of landing layouts:
 *  - center : center ONE box on the canvas.
 *  - row    : N boxes in a horizontally-centered row (desktop) that STACK into a
 *             single column on mobile (the feature-card / stats / logo-strip case).
 *  - grid   : N uniform cells in `cols` columns, the block centered; stacks on mobile.
 *  - stack  : a vertical list down the shared content column, both breakpoints.
 *
 * Every result honours the page-margin axis (content column 80..880 desktop /
 * 20..400 mobile by default) and returns boxes the model drops straight into an
 * element's responsive.<bp>.styles.
 */
import { CANVAS } from "./vocab.js";

export interface LayoutBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface LayoutItemSize {
  width: number;
  height: number;
}

export interface LayoutOpts {
  mode: "center" | "row" | "grid" | "stack";
  /** Explicit per-item sizes (varied sizes allowed for row/stack). */
  items?: LayoutItemSize[];
  /** Uniform shortcut: `count` boxes of itemWidth × itemHeight. */
  count?: number;
  itemWidth?: number;
  itemHeight?: number;
  /** Horizontal gap between items in a row / grid columns (px). Default 24. */
  gap?: number;
  /** Vertical gap between rows (grid) or items (stack) (px). Default = gap. */
  rowGap?: number;
  /** Grid columns. Default min(itemCount, 3). */
  cols?: number;
  /** Desktop start y inside the section (px). Default 0. */
  top?: number;
  /** Mobile start y inside the section (px). Default = top. */
  mobileTop?: number;
  /** Canvas widths. Default 960 / 420. */
  canvasDesktop?: number;
  canvasMobile?: number;
  /** Page-margin (content column inset). Default 80 / 20. */
  marginDesktop?: number;
  marginMobile?: number;
  /** Horizontal alignment of the block within the canvas. Default "center". */
  align?: "center" | "left" | "right";
  /** Stacked-mobile item width (row/grid). Default = mobile content width. */
  mobileItemWidth?: number;
}

export interface LayoutResult {
  desktop: LayoutBox[];
  mobile: LayoutBox[];
  summary: string;
  notes: string[];
}

const r = Math.round;

function resolveItems(opts: LayoutOpts): LayoutItemSize[] {
  if (Array.isArray(opts.items) && opts.items.length) {
    return opts.items.map((it) => ({ width: Math.max(0, it.width || 0), height: Math.max(0, it.height || 0) }));
  }
  const n = Math.max(1, opts.count ?? 1);
  const w = Math.max(0, opts.itemWidth ?? 0);
  const h = Math.max(0, opts.itemHeight ?? 0);
  return Array.from({ length: n }, () => ({ width: w, height: h }));
}

/** Left edge of a `blockW`-wide block on a `canvas`-wide canvas for an alignment. */
function blockLeft(align: "center" | "left" | "right", canvas: number, margin: number, blockW: number): number {
  if (align === "left") return margin;
  if (align === "right") return canvas - margin - blockW;
  return r((canvas - blockW) / 2);
}

/** Stack a list of sizes into a single mobile column; returns boxes + the bottom y. */
function stackMobile(
  items: LayoutItemSize[],
  startTop: number,
  itemW: number,
  left: number,
  rowGap: number
): LayoutBox[] {
  let y = startTop;
  return items.map((it) => {
    const box = { top: r(y), left: r(left), width: r(itemW), height: it.height };
    y += it.height + rowGap;
    return box;
  });
}

export function computeLayout(opts: LayoutOpts): LayoutResult {
  const notes: string[] = [];
  const items = resolveItems(opts);
  const gap = opts.gap ?? 24;
  const rowGap = opts.rowGap ?? gap;
  const top = opts.top ?? 0;
  const mobileTop = opts.mobileTop ?? top;
  const canvasD = opts.canvasDesktop ?? CANVAS.desktopWidth;
  const canvasM = opts.canvasMobile ?? CANVAS.mobileWidth;
  const marginD = opts.marginDesktop ?? 80;
  const marginM = opts.marginMobile ?? 20;
  const align = opts.align ?? "center";
  const contentD = canvasD - 2 * marginD;
  const contentM = canvasM - 2 * marginM;
  const mobileItemW = Math.min(opts.mobileItemWidth ?? contentM, canvasM - 2 * marginM);

  let desktop: LayoutBox[] = [];
  let mobile: LayoutBox[] = [];
  let summary = "";

  if (opts.mode === "center") {
    const it = items[0];
    const wD = Math.min(it.width, canvasD);
    desktop = [{ top, left: r((canvasD - wD) / 2), width: wD, height: it.height }];
    const wM = Math.min(it.width, contentM);
    mobile = [{ top: mobileTop, left: r((canvasM - wM) / 2), width: wM, height: it.height }];
    if (wM !== it.width) notes.push(`mobile: width ${it.width}→${wM} to fit the ${contentM}px content column.`);
    summary = `center 1 box: desktop left ${desktop[0].left} (w ${wD}), mobile left ${mobile[0].left} (w ${wM}).`;
  } else if (opts.mode === "row") {
    const blockW = items.reduce((s, it) => s + it.width, 0) + gap * (items.length - 1);
    let x = blockLeft(align, canvasD, marginD, blockW);
    desktop = items.map((it) => {
      const box = { top, left: r(x), width: it.width, height: it.height };
      x += it.width + gap;
      return box;
    });
    const mLeft = blockLeft(align, canvasM, marginM, mobileItemW);
    mobile = stackMobile(items, mobileTop, mobileItemW, mLeft, rowGap);
    if (blockW > contentD)
      notes.push(`desktop row width ${blockW} exceeds the ${contentD}px content column — shrink the items or gap, or split into fewer per row (use grid).`);
    summary = `row of ${items.length}: desktop ${align}-aligned from left ${desktop[0].left} to ${desktop[desktop.length - 1].left + desktop[desktop.length - 1].width} at top ${top}; mobile stacked single-column (w ${mobileItemW}) from top ${mobileTop}.`;
  } else if (opts.mode === "grid") {
    const n = items.length;
    const cols = Math.max(1, opts.cols ?? Math.min(n, 3));
    const cellW = Math.max(...items.map((it) => it.width));
    const rows: LayoutItemSize[][] = [];
    for (let i = 0; i < n; i += cols) rows.push(items.slice(i, i + cols));
    const blockW = cols * cellW + (cols - 1) * gap;
    const startLeft = blockLeft(align, canvasD, marginD, blockW);
    let y = top;
    desktop = [];
    for (const row of rows) {
      const rowH = Math.max(...row.map((it) => it.height));
      row.forEach((it, c) => {
        desktop.push({ top: r(y), left: r(startLeft + c * (cellW + gap)), width: it.width, height: it.height });
      });
      y += rowH + rowGap;
    }
    const mLeft = blockLeft(align, canvasM, marginM, mobileItemW);
    mobile = stackMobile(items, mobileTop, mobileItemW, mLeft, rowGap);
    if (blockW > contentD)
      notes.push(`desktop grid width ${blockW} exceeds the ${contentD}px content column — reduce cols, item width, or gap.`);
    summary = `grid ${cols}×${rows.length} (${n} cells): desktop block from left ${startLeft}, top ${top}; mobile stacked single-column from top ${mobileTop}.`;
  } else {
    // stack
    let yD = top;
    desktop = items.map((it) => {
      const wD = Math.min(it.width, canvasD);
      const left = blockLeft(align, canvasD, marginD, wD);
      const box = { top: r(yD), left: r(left), width: wD, height: it.height };
      yD += it.height + rowGap;
      return box;
    });
    let yM = mobileTop;
    mobile = items.map((it) => {
      const wM = Math.min(it.width, contentM);
      const left = blockLeft(align, canvasM, marginM, wM);
      const box = { top: r(yM), left: r(left), width: wM, height: it.height };
      yM += it.height + rowGap;
      return box;
    });
    summary = `stack of ${items.length}: desktop ${align}-aligned from top ${top}; mobile from top ${mobileTop}.`;
  }

  // Guardrail: anything that lands off-canvas is a bad input — surface it (the
  // model can adjust, and create_page's autofix will also pull it back).
  const offEdge = (boxes: LayoutBox[], canvas: number) =>
    boxes.some((b) => b.left < 0 || b.left + b.width > canvas);
  if (offEdge(desktop, canvasD)) notes.push(`some desktop boxes fall outside 0..${canvasD} — reduce sizes/gap or change alignment.`);
  if (offEdge(mobile, canvasM)) notes.push(`some mobile boxes fall outside 0..${canvasM}.`);

  return { desktop, mobile, summary, notes };
}
