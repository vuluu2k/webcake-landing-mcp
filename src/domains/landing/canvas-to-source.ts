/**
 * Deterministic absolute-canvas → Webcake page-source converter.
 *
 * Builders like LadiPage (and Webcake's own published HTML) lay the page out on
 * a fixed-width absolute canvas (mobile 420 / desktop 960) — the SAME canvas the
 * Webcake editor uses — so the parsed geometry transfers 1:1. `parseAbsoluteCanvas`
 * (src/persistence/html-ingest.ts) turns that HTML into an `IngestedCanvas`; this
 * module turns that canvas into a ready-to-save `{ page, popup, settings, … }`
 * source WITHOUT a model in the loop, so a clone keeps the original's exact boxes,
 * styles, images, and behaviors instead of being hand-rebuilt (and degraded).
 *
 * It emits the SPARSE authoring shape (responsive styles + specials + the few
 * non-default configs); `create_page`/`patch_page` run `expand` over it to hydrate
 * the boilerplate, then validate + auto-host images + publish. Anything that can't
 * map cleanly (fixed elements, svg-less shapes, social-proof toasts) degrades
 * gracefully and is reported in `notes` so the caller can patch it.
 */
import { createPageSource } from "./page.js";
import { ANIMATABLE_TYPES, ANIMATION_NAMES, CANVAS } from "./vocab.js";
import type { IngestedCanvas, CanvasElement, CanvasSection } from "../../persistence/html-ingest.js";

const MOBILE_W = CANVAS.mobileWidth;
const DESKTOP_W = CANVAS.desktopWidth;

type Ctx = { mobileOnly: boolean; notes: string[]; usedIds: Set<string>; mobileByBox: WeakMap<object, CanvasElement["mobile"]>; css: string[]; measured: boolean };
type StyleBag = Record<string, string> | undefined;
type Styles = Record<string, string | number>;
type Breakpoint = { styles: Styles; config?: Record<string, any> };
type Responsive = { desktop: Breakpoint; mobile: Breakpoint };
type SourceNode = {
  id: string;
  type: string;
  responsive: Responsive;
  specials?: Record<string, any>;
  children?: SourceNode[];
  events?: Array<Record<string, any>>;
};

// ─── small helpers ────────────────────────────────────────────────────────────
const cloneJ = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function idOf(raw: string): string {
  return raw.toLowerCase();
}

function num(v?: string): number | undefined {
  if (!v) return undefined;
  const m = /^(-?\d+(?:\.\d+)?)/.exec(v.trim());
  return m ? Math.round(parseFloat(m[1])) : undefined;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * De-fingerprint raw html-box passthrough: rename the source builder's class
 * tokens to a Webcake-neutral prefix so a clone doesn't ship LadiPage class names.
 * Covers both `class="ladi-…"` attributes and inline `.ladi-…` CSS selectors.
 * The known html-embed wrapper maps to Webcake's element name; any other `ladi-*`
 * gets the `webcake-` prefix. The lookbehind avoids touching `ladicdn`/URL paths
 * (no `ladi-` token there), so image links are left intact.
 */
function sanitizeBuilderClasses(html: string): string {
  return html.replace(/ladi-html-code/g, "webcake-html-box").replace(/(?<![\w/])ladi-/g, "webcake-");
}

const BG_URL_RE = /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/;

/** The editor-canonical url() background shorthand its picker can re-parse. */
function canonicalBg(src: string): string {
  return `center center/ cover no-repeat scroll content-box url(${src}) border-box`;
}

/** Schema only allows these border styles — 3D styles (outset/inset/groove/ridge) degrade to solid. */
const BORDER_STYLES = new Set(["solid", "dashed", "dotted", "double", "none"]);
function normBorderStyle(v: string): string {
  return BORDER_STYLES.has(v) ? v : "solid";
}

/** "3px solid rgb(1,2,3)" → { borderWidth, borderStyle, borderColor } */
function parseBorderShorthand(v: string): Styles {
  const out: Styles = {};
  const w = /^(\d+(?:\.\d+)?)px\b/.exec(v.trim());
  if (w) out.borderWidth = Math.round(parseFloat(w[1]));
  const s = /\b(solid|dashed|dotted|double|outset|inset|groove|ridge)\b/.exec(v);
  if (s) out.borderStyle = normBorderStyle(s[1]);
  const c = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/.exec(v);
  if (c) out.borderColor = c[1];
  return out;
}

/** Whitelisted canvas style bag → Webcake camelCase styles for one element type. */
function mapStyles(bag: StyleBag, type: string): Styles {
  const out: Styles = {};
  if (!bag) return out;
  const fs = num(bag["font-size"]);
  if (fs !== undefined) out.fontSize = fs;
  if (bag["color"]) out.color = bag["color"];
  if (bag["text-align"]) out.textAlign = bag["text-align"];
  if (bag["font-weight"]) out.fontWeight = bag["font-weight"];
  if (bag["font-style"]) out.fontStyle = bag["font-style"];
  if (bag["font-family"]) out.fontFamily = bag["font-family"];
  if (bag["line-height"]) {
    const lh = parseFloat(bag["line-height"]);
    if (Number.isFinite(lh)) out.lineHeight = lh;
  }
  if (bag["letter-spacing"]) out.letterSpacing = bag["letter-spacing"];
  if (bag["text-transform"]) out.textTransform = bag["text-transform"];
  if (bag["text-shadow"]) out.textShadow = bag["text-shadow"];
  if (bag["border-radius"]) out.borderRadius = bag["border-radius"];
  if (bag["box-shadow"]) out.boxShadow = bag["box-shadow"];
  if (bag["transform"] && /^rotate\(-?\d+(\.\d+)?deg\)$/.test(bag["transform"])) out.transform = bag["transform"];
  const op = bag["opacity"] !== undefined ? parseFloat(bag["opacity"]) : NaN;
  if (Number.isFinite(op) && op < 1) out.opacity = op;
  // Borders: shorthand or longhand.
  if (bag["border"]) Object.assign(out, parseBorderShorthand(bag["border"]));
  if (bag["border-top"] && type === "line") Object.assign(out, parseBorderShorthand(bag["border-top"]));
  if (bag["border-width"]) out.borderWidth = num(bag["border-width"])!;
  if (bag["border-style"]) out.borderStyle = normBorderStyle(bag["border-style"]);
  if (bag["border-color"]) out.borderColor = bag["border-color"];
  // background: NEVER on text-block (it activates gradient-text-fill and makes
  // glyphs invisible); image-block gets it derived from src by the server.
  if (bag["filter"] && type !== "text-block") out.filter = bag["filter"];
  if (bag["backdrop-filter"]) out.backdropFilter = bag["backdrop-filter"];
  // gradient text (browser capture): a text-block paints styles.background into its glyphs
  if (type === "text-block" && bag["text-gradient"]) out.background = bag["text-gradient"];
  if (type !== "text-block" && type !== "image-block") {
    const bg = bag["background"]?.includes("gradient(") ? bag["background"] : (bag["background-color"] ?? bag["background"]);
    if (bg && !bg.includes("url(")) out.background = bg;
    else if (bg) {
      const u = BG_URL_RE.exec(bg);
      if (u) out.background = canonicalBg(u[1]);
    }
  }
  return out;
}

function uniqueId(ctx: Ctx, raw: string): string {
  let id = idOf(raw);
  while (ctx.usedIds.has(id)) id = `${id}x`;
  ctx.usedIds.add(id);
  return id;
}

/** Build responsive.{desktop,mobile}.styles from a box + mapped styles. */
function responsiveOf(ctx: Ctx, box: CanvasElement["box"], styles: Styles, sectionH?: number): Responsive {
  const primary: Styles = { ...styles };
  if (box) {
    let top = box.top;
    let left = box.left;
    // position:fixed floating elements (LadiPage sticky widgets): keep a sane
    // in-flow box as the fallback home, then pin them to the viewport via the
    // sticky config (applySticky) so they don't bake mid-page. bottom/right anchored.
    if (box.fixed) {
      const w = box.width ?? 100;
      const h = box.height ?? 40;
      const canvasW = ctx.mobileOnly ? MOBILE_W : DESKTOP_W;
      if (top === undefined) top = Math.max(0, (sectionH ?? 800) - h - (box.bottom ?? 10));
      if (left === undefined) left = Math.max(0, canvasW - w - (box.right ?? 10));
    }
    if (top !== undefined) primary.top = top;
    if (left !== undefined) primary.left = left;
    if (box.width !== undefined) primary.width = box.width;
    if (box.height !== undefined) primary.height = box.height;
  }
  if (ctx.mobileOnly) {
    return { desktop: { styles: cloneJ(primary) }, mobile: { styles: cloneJ(primary) } };
  }
  // Measured in a browser (browser-capture.ts): the mobile layout as it really is, or hidden there.
  const measured = box ? ctx.mobileByBox.get(box) : undefined;
  if (measured === null) {
    const m = cloneJ(primary);
    for (const k of ["left", "width"]) if (typeof m[k] === "number") m[k] = Math.round((m[k] as number) * (MOBILE_W / DESKTOP_W));
    return { desktop: { styles: primary }, mobile: { styles: m, config: { hide: true } } };
  }
  if (measured) {
    const m = cloneJ(primary);
    Object.assign(m, measured.box);
    const ms = measured.style ?? {};
    if (ms["font-size"]) m.fontSize = Number(ms["font-size"]);
    if (ms["line-height"]) m.lineHeight = parseFloat(ms["line-height"]);
    if (ms["letter-spacing"]) m.letterSpacing = ms["letter-spacing"];
    if (ms["text-align"]) m.textAlign = ms["text-align"];
    return { desktop: measured.only ? { styles: primary, config: { hide: true } } : { styles: primary }, mobile: { styles: m } };
  }
  // Desktop source: mobile gets a simple horizontal 420/960 scale as a start.
  const scale = MOBILE_W / DESKTOP_W;
  const m = cloneJ(primary);
  for (const k of ["left", "width"]) if (typeof m[k] === "number") m[k] = Math.round((m[k] as number) * scale);
  return { desktop: { styles: primary }, mobile: { styles: m } };
}

function setBothConfigs(node: SourceNode, config: Record<string, any>): void {
  node.responsive.desktop.config = { ...(node.responsive.desktop.config ?? {}), ...cloneJ(config) };
  node.responsive.mobile.config = { ...(node.responsive.mobile.config ?? {}), ...cloneJ(config) };
}

function mapEvents(ctx: Ctx, e: CanvasElement): SourceNode["events"] {
  const out: Array<Record<string, any>> = [];
  let i = 0;
  for (const ev of e.events ?? []) {
    const id = `ev_${idOf(e.id)}_${i++}`;
    if (ev.type === "popup") out.push({ id, type: "click", action: "open_popup", target: idOf(ev.action) });
    else if (ev.type === "section") out.push({ id, type: "click", action: "scroll_to", target: idOf(ev.action) });
    else if (ev.type === "link") out.push({ id, type: "click", action: "open_link", target: ev.action, targetURL: "_blank" });
    else if (ev.type === "phone") out.push({ id, type: "click", action: "open_link", target: `tel:${ev.action}` });
    else ctx.notes.push(`${e.id}: unsupported event type '${ev.type}' skipped`);
  }
  if (!out.length && e.href && !e.href.startsWith("#")) {
    out.push({
      id: `ev_${idOf(e.id)}_href`,
      type: "click",
      action: "open_link",
      target: e.href,
      targetURL: e.href.startsWith("tel:") ? "_self" : "_blank",
    });
  }
  return out.length ? out : undefined;
}

function applyAnimation(node: SourceNode, e: CanvasElement, type: string): void {
  const name = e.animation?.["name"];
  if (!name || !ANIMATABLE_TYPES.has(type) || !ANIMATION_NAMES.has(name)) return;
  const secs = (v?: string): number | undefined => {
    const n = v ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const anim: Record<string, any> = { name };
  const delay = secs(e.animation?.["delay"]);
  const duration = secs(e.animation?.["duration"]);
  if (delay !== undefined) anim.delay = delay;
  if (duration !== undefined) anim.duration = duration;
  setBothConfigs(node, { animation: anim });
}

/** LadiPage sticky_position keyword → Webcake stickyPosition anchor code. */
const LADI_STICKY_TO_WEBCAKE: Record<string, string> = {
  top_left: "t-l",
  top_center: "t-c",
  top_right: "t-r",
  middle_left: "l-c",
  middle_right: "r-c",
  bottom_left: "b-l",
  bottom_center: "b-c",
  bottom_right: "b-r",
};

/**
 * Pin a position:fixed element to the viewport via Webcake's sticky config
 * instead of leaving it baked in-flow mid-page (where the original floating
 * corner widget "jumps outside" into a random section). Webcake reads
 * sticky / stickyPosition / sticky{Top,Bottom,Left,Right,Width,Height} from
 * responsive.<bp>.config (docs/element-specials-reference.md §1). The parser
 * already captured `sticky` (bottom_left…) and the box's bottom/right offsets.
 */
function applySticky(ctx: Ctx, node: SourceNode, e: CanvasElement): void {
  if (!e.box?.fixed) return;
  const b = e.box;
  const pos = LADI_STICKY_TO_WEBCAKE[e.sticky ?? ""] ?? "b-r";
  const cfg: Record<string, any> = { sticky: true, stickyPosition: pos };
  if (b.top !== undefined) cfg.stickyTop = b.top;
  if (b.bottom !== undefined) cfg.stickyBottom = b.bottom;
  if (b.left !== undefined) cfg.stickyLeft = b.left;
  if (b.right !== undefined) cfg.stickyRight = b.right;
  if (b.width !== undefined) cfg.stickyWidth = b.width;
  if (b.height !== undefined) cfg.stickyHeight = b.height;
  setBothConfigs(node, cfg);
  ctx.notes.push(`${e.id}: position:fixed → pinned as a sticky '${pos}' element (was floating ${e.sticky ?? "bottom_right"}).`);
}

const FIELD_NAME_MAP: Record<string, string> = {
  name: "full_name",
  fullname: "full_name",
  full_name: "full_name",
  phone: "phone_number",
  tel: "phone_number",
  phone_number: "phone_number",
  email: "email",
  address: "address",
};

// ─── element conversion ──────────────────────────────────────────────────────
function convertChildren(ctx: Ctx, e: CanvasElement, sectionH?: number): SourceNode[] {
  return (e.children ?? []).map((c) => convertElement(ctx, c, sectionH)).filter(Boolean) as SourceNode[];
}

/** Build a node, then pin it to the viewport if it was position:fixed (recurses via convertChildren). */
function convertElement(ctx: Ctx, e: CanvasElement, sectionH?: number): SourceNode | null {
  const node = convertElementInner(ctx, e, sectionH);
  if (node && e.box?.fixed) applySticky(ctx, node, e);
  if (node && (e.hover || e.transition)) ctx.css.push(hoverCss(node, e.hover, e.transition));
  return node;
}

const ICON_CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|use\.fontawesome\.com|maxcdn\.bootstrapcdn\.com|stackpath\.bootstrapcdn\.com|code\.ionicframework\.com|unicons\.iconscout\.com|cdn\.lineicons\.com|site-assets\.fontawesome\.com)\//;

/** The inner box each type paints into (render/build/index.js): hover colours go there, motion on #w-<id>. */
const INNER_CLASS: Record<string, string> = { button: "button-css", rectangle: "rectangle-css", "text-block": "text-block-css", "image-block": "image-block-css" };
const WRAPPER_PROPS = /^(transform|translate|scale|rotate|opacity|filter|z-index)$/;
/**
 * The page's own :hover rules + transition, scoped to this element (#w-<id>): a native landing node
 * has no hover state, so this is the one piece of a clone that needs settings.extra_css.
 */
function hoverCss(node: SourceNode, hover?: string, transition?: string): string {
  const id = `#w-${node.id}`;
  const inner = INNER_CLASS[node.type] ? ` .${INNER_CLASS[node.type]}` : "";
  // a group paints nothing itself: it takes motion + shadow (its paint box inside takes the colours)
  const group = node.type === "group";
  const wrap: string[] = [];
  const paint: string[] = [];
  for (const d of (hover ?? "").split(";").map((x) => x.trim()).filter(Boolean)) {
    // the source page's CSS lands in raw <style>: nothing that could close the tag / open a rule
    if (/[<>{}\\]/.test(d)) continue;
    const prop = d.slice(0, d.indexOf(":")).trim().toLowerCase();
    if (!prop || /^(position|top|left|right|bottom|width|height|display|margin|padding)/.test(prop)) continue; // geometry belongs to the canvas
    if (WRAPPER_PROPS.test(prop) || (group && prop === "box-shadow")) wrap.push(d);
    else if (!group) paint.push(d);
  }
  let css = "";
  if (transition && !/[<>{}\\;]/.test(transition)) css += `${id}${inner ? `,${id}${inner}` : ""}{transition:${transition}}`;
  if (wrap.length) css += `${id}:hover{${wrap.join(";")}}`;
  if (paint.length) css += `${id}:hover${inner}{${paint.join(";")}}`;
  return css;
}

function convertElementInner(ctx: Ctx, e: CanvasElement, sectionH?: number): SourceNode | null {
  const t = e.type;
  const style = e.style ?? {};
  if (t === "notify") {
    ctx.notes.push(`${e.id}: notify (social-proof toast) skipped — needs its own data source; re-add manually if wanted.`);
    return null;
  }
  if (t === "countdown_item") return null; // rendered by the parent countdown

  // headline / paragraph / button_text → text-block
  if (t === "headline" || t === "paragraph" || t === "button_text") {
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "text-block",
      responsive: responsiveOf(ctx, e.box, mapStyles(style, "text-block"), sectionH),
      specials: { text: e.text ?? "", tag: e.tag && /^(h[1-6]|p)$/.test(e.tag) ? e.tag : t === "paragraph" ? "p" : "h3" },
    };
    // measured in a browser: the rendered height is known — record it the way the editor does
    if (ctx.measured) {
      for (const bp of ["desktop", "mobile"] as const) {
        const h = node.responsive[bp].styles.height;
        if (typeof h === "number") node.responsive[bp].config = { ...(node.responsive[bp].config ?? {}), virtualHeight: h };
      }
    }
    const ev = mapEvents(ctx, e);
    if (ev) node.events = ev;
    applyAnimation(node, e, "text-block");
    return node;
  }

  if (t === "list") {
    const items = (e.text ?? "").split("\n").filter(Boolean);
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "list-paragraph",
      responsive: responsiveOf(ctx, e.box, mapStyles(style, "list-paragraph"), sectionH),
      specials: { text: items.map((i) => `<li>${i}</li>`).join("") },
    };
    setBothConfigs(node, { iconSize: 12, iconTop: 5, linePaddingLeft: 23, linePaddingBottom: 10 });
    return node;
  }

  // Native video player for what the landing video element plays (youtube / vimeo / a file); other
  // iframes stay html-box embeds.
  const yt = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(e.src ?? "");
  const vimeo = /player\.vimeo\.com\/video\/(\d+)|vimeo\.com\/(\d+)/.exec(e.src ?? "");
  if ((t === "html_code" && (yt || vimeo)) || (t === "video" && e.video)) {
    const specials: Record<string, any> = yt
      ? { typeVideo: "youtube", id: yt[1], img: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` }
      : vimeo
        ? { typeVideo: "vimeo", video: `https://vimeo.com/${vimeo[1] ?? vimeo[2]}` }
        : { typeVideo: "webcake", video: e.video, ...(e.src ? { img: e.src } : {}) };
    return { id: uniqueId(ctx, e.id), type: "video", responsive: responsiveOf(ctx, e.box, {}, sectionH), specials };
  }

  if (t === "image" || t === "video") {
    if (!e.src && t === "video") {
      ctx.notes.push(`${e.id}: video without a recoverable source skipped.`);
      return null;
    }
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "image-block",
      responsive: responsiveOf(ctx, e.box, mapStyles(style, "image-block"), sectionH),
      specials: { src: e.src ?? "", imageCompression: true },
    };
    if (e.crop) {
      const crop: Record<string, number> = {};
      if (e.crop.width !== undefined) crop.widthBgImage = e.crop.width;
      if (e.crop.height !== undefined) crop.heightBgImage = e.crop.height;
      if (e.crop.top !== undefined) crop.topBgImage = e.crop.top;
      if (e.crop.left !== undefined) crop.leftBgImage = e.crop.left;
      if (Object.keys(crop).length) setBothConfigs(node, crop);
      // measured mobile layout: its own crop, or none (the image fits its mobile box)
      if (ctx.measured && e.mobile !== undefined) {
        const mc = e.mobile?.crop;
        const mcfg: Record<string, any> = { ...(node.responsive.mobile.config ?? {}) };
        for (const k of ["widthBgImage", "heightBgImage", "topBgImage", "leftBgImage"]) delete mcfg[k];
        if (mc) Object.assign(mcfg, { widthBgImage: mc.width, heightBgImage: mc.height, topBgImage: mc.top, leftBgImage: mc.left });
        node.responsive.mobile.config = mcfg;
      }
    }
    const ev = mapEvents(ctx, e);
    if (ev) node.events = ev;
    applyAnimation(node, e, "image-block");
    return node;
  }

  if (t === "box") {
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "rectangle",
      responsive: responsiveOf(ctx, e.box, mapStyles(style, "rectangle"), sectionH),
      specials: {},
    };
    const ev = mapEvents(ctx, e);
    if (ev) node.events = ev;
    applyAnimation(node, e, "rectangle");
    return node;
  }

  if (t === "shape") {
    const styles = mapStyles(style, "rectangle");
    if (!styles.background) styles.background = style["fill"] ?? "rgba(0,0,0,1)";
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "rectangle",
      responsive: responsiveOf(ctx, e.box, styles, sectionH),
      specials: {},
    };
    if (e.svg) {
      // svgMask paints the silhouette; color comes from styles.background.
      setBothConfigs(node, { svgMask: e.svg.replace(/"/g, "'") });
      if (style["fill"]) {
        node.responsive.desktop.styles.background = style["fill"];
        node.responsive.mobile.styles.background = style["fill"];
      }
    } else {
      ctx.notes.push(`${e.id}: shape had no recoverable <svg> — converted to a plain rectangle.`);
    }
    const ev = mapEvents(ctx, e);
    if (ev) node.events = ev;
    return node;
  }

  if (t === "line") {
    const styles = mapStyles(style, "line");
    if (styles.borderWidth === undefined) {
      styles.borderWidth = 1;
      styles.borderStyle = (styles.borderStyle as string) ?? "solid";
      styles.borderColor = (styles.borderColor as string) ?? "rgba(208,213,221,1)";
    }
    return {
      id: uniqueId(ctx, e.id),
      type: "line",
      responsive: responsiveOf(ctx, e.box, styles, sectionH),
      specials: {},
    };
  }

  if (t === "button") {
    const label = (e.children ?? []).find((c) => c.type === "button_text");
    const styles = mapStyles(style, "rectangle"); // background/borderRadius from the button itself
    Object.assign(styles, mapStyles(label?.style, "text-block")); // typography from the label child
    if (!styles.textAlign) styles.textAlign = "center";
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "button",
      responsive: responsiveOf(ctx, e.box, styles, sectionH),
      specials: { text: label?.text ?? e.text ?? "Button" },
    };
    const ev = mapEvents(ctx, e);
    if (ev) node.events = ev;
    applyAnimation(node, e, "button");
    return node;
  }

  if (t === "form") {
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "form",
      responsive: responsiveOf(ctx, e.box, mapStyles(style, "rectangle"), sectionH),
      specials: {},
      children: [],
    };
    const redirect = e.config?.["thankyou_value"];
    if (typeof redirect === "string" && /^https?:\/\//.test(redirect)) {
      node.specials!.submit_success = 2;
      node.specials!.redirect_url = redirect;
      node.specials!.target_url = "_self";
    }
    // Inputs/buttons must be DIRECT children of the form to submit.
    for (const c of e.children ?? []) {
      if (c.type === "form_item") {
        const rawName = c.input?.name ?? `input_${idOf(c.id)}`;
        const fieldName = FIELD_NAME_MAP[rawName.toLowerCase()] ?? rawName;
        const child: SourceNode = {
          id: uniqueId(ctx, c.id),
          type: "input",
          responsive: responsiveOf(ctx, c.box, mapStyles(c.style, "rectangle"), sectionH),
          specials: {
            field_name: fieldName,
            field_placeholder: c.input?.placeholder ?? "",
            field_type: fieldName === "phone_number" ? "phone" : c.input?.input_type === "email" ? "email" : "text",
            ...(c.input?.required ? { required: true } : {}),
          },
        };
        node.children!.push(child);
      } else {
        const conv = convertElement(ctx, c, sectionH);
        if (conv) node.children!.push(conv);
      }
    }
    return node;
  }

  if (t === "group") {
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "group",
      responsive: responsiveOf(ctx, e.box, {}, sectionH),
      specials: {},
      children: convertChildren(ctx, e, sectionH),
    };
    // a clip group (browser capture): the renderer has no overflow setting, custom_css carries it
    if (style["overflow"] === "hidden") {
      node.specials = {
        customAdvance: true,
        custom_css: `overflow:hidden;${style["border-radius"] ? `border-radius:${style["border-radius"]};` : ""}${style["box-shadow"] ? `box-shadow:${style["box-shadow"]};` : ""}`,
      };
    }
    const ev = mapEvents(ctx, e);
    if (ev) node.events = ev;
    applyAnimation(node, e, "group");
    return node;
  }

  if (t === "countdown") {
    const minutes = e.config?.["countdown_minute"];
    const styles = mapStyles(style, "rectangle");
    if (!styles.color) styles.color = "rgba(40,40,40,1)";
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "countdown",
      responsive: responsiveOf(ctx, e.box, styles, sectionH),
      specials: {
        type: "minute",
        duration: String(typeof minutes === "number" ? minutes : 60),
        language: "custom",
        customTranslation: { day: "Ngày", hour: "Giờ", minute: "Phút", second: "Giây" },
        showDay: true,
        showHour: true,
        showSecond: true,
        showText: true,
        repeat: true,
        customize: "nothing",
        customMessage: "",
        dailyStart: "",
        dailyEnd: "",
      },
    };
    applyAnimation(node, e, "countdown");
    return node;
  }

  // browser capture: a slider → the native carousel (slideWidth × slideToShow), each slide with its content
  if (t === "slider") {
    const slides = (e.children ?? []).filter((c) => c.type === "slide");
    if (!slides.length) return null;
    const sw = (slides[0].box?.width || 0) > 0 ? slides[0].box!.width! : Math.round((e.box?.width ?? 0) / slides.length);
    if (!(sw > 0)) {
      ctx.notes.push(`${e.id}: slider with no measurable slide width — skipped.`);
      return null;
    }
    const show = Math.max(1, Math.round((e.box?.width ?? sw) / sw));
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "carousel",
      responsive: responsiveOf(ctx, e.box, {}, sectionH),
      specials: {},
      children: slides.map((s) => ({
        id: uniqueId(ctx, s.id),
        type: "slide",
        responsive: responsiveOf(ctx, s.box, {}, sectionH),
        specials: {},
        children: convertChildren(ctx, s, sectionH),
      })),
    };
    const m = e.mobile ? e.mobile.box : null;
    const msw = slides[0].mobile && slides[0].mobile.box.width > 0 ? slides[0].mobile.box.width : Math.max(1, Math.round(sw * (MOBILE_W / DESKTOP_W)));
    const mshow = m ? Math.max(1, Math.round(m.width / msw)) : show;
    node.responsive.desktop.styles.width = show * sw;
    node.responsive.mobile.styles.width = mshow * msw;
    const base = { showNavigation: !!e.config?.["nav"], autoplayMode: "repeat", delayTimeMs: 5000, infinity: true };
    node.responsive.desktop.config = { ...(node.responsive.desktop.config ?? {}), ...base, slideWidth: sw, slideToShow: show };
    node.responsive.mobile.config = { ...(node.responsive.mobile.config ?? {}), ...base, slideWidth: msw, slideToShow: mshow };
    ctx.notes.push(`${e.id}: slider → native carousel (${slides.length} slides, ${show} visible on desktop, ${mshow} on mobile)`);
    return node;
  }

  if (t === "carousel" || t === "gallery") {
    const media = (e.children ?? [])
      .filter((c) => c.type === "image" && c.src)
      .map((c) => ({ type: "image", link: c.src, linkVideo: "", typeVideo: "youtube", imageCompression: true }));
    if (!media.length) {
      ctx.notes.push(`${e.id}: carousel/gallery had no recoverable images — skipped.`);
      return null;
    }
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "gallery",
      responsive: responsiveOf(ctx, e.box, {}, sectionH),
      specials: { media },
    };
    setBothConfigs(node, { showThumbnail: false, showNavigation: true, allowZoom: "off" });
    ctx.notes.push(`${e.id}: source carousel converted to a gallery slider (${media.length} images).`);
    return node;
  }

  if (t === "spin_wheel") {
    const prizes = (e.config?.["prizes"] as Array<{ label: string; chance: string }>) ?? [];
    let lines: string[];
    if (prizes.length) {
      const nums = prizes.map((p) => parseInt(String(p.chance), 10) || 0);
      const sum = nums.reduce((a, b) => a + b, 0);
      if (sum !== 100) {
        // percents MUST sum to 100 or the winner selection throws — fix the largest slot.
        const iMax = nums.indexOf(Math.max(...nums));
        nums[iMax] += 100 - sum;
        ctx.notes.push(`${e.id}: spin-wheel percents summed to ${sum} — adjusted to 100.`);
      }
      lines = prizes.map((p, i) => `PRIZE${i + 1}|${p.label.replace(/\|/g, "/")}|${Math.max(0, nums[i])}`);
    } else {
      lines = ["PRIZE1|Giải may mắn|50", "MISS|Chúc may mắn lần sau|50"];
      ctx.notes.push(`${e.id}: spin-wheel had no recoverable prize list — seeded a default; edit specials.code.`);
    }
    // Prefer the ORIGINAL wheel-face + center-button art (the parser kept them in
    // config so they don't collide); fall back to the editor default only when they
    // couldn't be recovered. The original urls auto-host on save like any image.
    const wheelImg = e.config?.["wheelImage"] as string | undefined;
    const btnImg = e.config?.["buttonImage"] as string | undefined;
    if (!wheelImg) ctx.notes.push(`${e.id}: spin-wheel face image not recovered — using the editor default wheel.`);
    const node: SourceNode = {
      id: uniqueId(ctx, e.id),
      type: "spin-wheel",
      responsive: responsiveOf(ctx, e.box, mapStyles(style, "rectangle"), sectionH),
      specials: {
        background: wheelImg ?? "https://cdn.webcake.co/editor/main/pickers/spin-wheel-default.png",
        backgroundBtn: btnImg ?? "https://cdn.webcake.co/editor/main/pickers/spin-wheel-btn-default.png",
        spin: String(e.config?.["spinlucky_setting.max_turn"] ?? "1"),
        rotate: "0",
        popup: "default",
        popupTurnOver: "default",
        showCoupon: "yes",
        code: lines.join("\n"),
        message:
          "Chúc mừng! Bạn nhận được {{coupon_text}} (mã: {{coupon_code}}). Bạn còn {{spin_turn_left}} lượt quay.",
      },
    };
    return node;
  }

  if (t === "html_code") {
    if (!e.html) return null;
    return {
      id: uniqueId(ctx, e.id),
      type: "html-box",
      responsive: responsiveOf(ctx, e.box, {}, sectionH),
      specials: { html: escapeHtml(sanitizeBuilderClasses(e.html)) },
    };
  }

  // Unknown/unsupported type — degrade gracefully, keep geometry.
  if (e.children?.length) {
    ctx.notes.push(`${e.id}: unmapped type '${t}' converted to a group.`);
    return {
      id: uniqueId(ctx, e.id),
      type: "group",
      responsive: responsiveOf(ctx, e.box, {}, sectionH),
      specials: {},
      children: convertChildren(ctx, e, sectionH),
    };
  }
  if (e.text) {
    ctx.notes.push(`${e.id}: unmapped type '${t}' converted to a text-block.`);
    return {
      id: uniqueId(ctx, e.id),
      type: "text-block",
      responsive: responsiveOf(ctx, e.box, mapStyles(style, "text-block"), sectionH),
      specials: { text: e.text, tag: "p" },
    };
  }
  if (e.src) {
    ctx.notes.push(`${e.id}: unmapped type '${t}' converted to an image-block.`);
    return {
      id: uniqueId(ctx, e.id),
      type: "image-block",
      responsive: responsiveOf(ctx, e.box, {}, sectionH),
      specials: { src: e.src, imageCompression: true },
    };
  }
  ctx.notes.push(`${e.id}: unmapped type '${t}' with no content skipped.`);
  return null;
}

function convertSection(ctx: Ctx, s: CanvasSection): SourceNode {
  const h = s.height ?? CANVAS.defaultSectionHeight;
  const styles: Styles = { height: h };
  if (s.background) {
    const u = s.background["background-image"];
    const color = s.background["background-color"];
    if (u?.includes("gradient(")) styles.background = u;
    else if (u) styles.background = canonicalBg(u);
    else if (color) styles.background = color;
  }
  const mStyles = cloneJ(styles);
  if (s.mobile?.height) mStyles.height = s.mobile.height;
  // a sticky header: the section's native "always on top" sticky (exportCss.js:207)
  const config = s.sticky ? { sticky: true, stickyPosition: "a-t" } : undefined;
  return {
    id: uniqueId(ctx, s.id),
    type: "section",
    responsive: { desktop: { styles: cloneJ(styles), ...(config ? { config: { ...config } } : {}) }, mobile: { styles: mStyles, ...(config ? { config: { ...config } } : {}) } },
    children: s.elements.map((e) => convertElement(ctx, e, h)).filter(Boolean) as SourceNode[],
  };
}

function convertPopup(ctx: Ctx, p: CanvasElement): SourceNode {
  const styles = mapStyles(p.style, "rectangle");
  if (p.src) styles.background = canonicalBg(p.src);
  const node: SourceNode = {
    id: uniqueId(ctx, p.id),
    type: "popup",
    responsive: responsiveOf(ctx, p.box, styles),
    specials: { position: "center" },
    children: convertChildren(ctx, p, p.box?.height),
  };
  if (p.config?.["show_popup_welcome_page"] === true) {
    node.specials!.openInPage = true;
    const delay = p.config?.["delay_popup_welcome_page"];
    if (typeof delay === "number") node.specials!.delayPopup = delay;
  }
  return node;
}

// ─── entry point ─────────────────────────────────────────────────────────────
export type CanvasToSourceMeta = { title?: string; description?: string };
export type CanvasToSourceResult = { source: unknown; notes: string[] };

/**
 * Convert a parsed absolute-canvas (LadiPage-family) into a complete, sparse
 * Webcake page source. The result's `source` is ready for `create_page`
 * (which expands + validates + auto-hosts images); `notes` lists every
 * lossy approximation the caller should review/patch.
 */
export function canvasToPageSource(canvas: IngestedCanvas, meta: CanvasToSourceMeta = {}): CanvasToSourceResult {
  const ctx: Ctx = { mobileOnly: !!canvas.mobile_only, notes: [], usedIds: new Set(), mobileByBox: new WeakMap(), css: [], measured: canvas.builder === "browser" };
  const index = (e: CanvasElement) => {
    if (e.box && e.mobile !== undefined) ctx.mobileByBox.set(e.box, e.mobile);
    (e.children ?? []).forEach(index);
  };
  canvas.sections.forEach((s) => s.elements.forEach(index));
  (canvas.popups ?? []).forEach(index);
  const source: any = createPageSource({
    mobileOnly: ctx.mobileOnly,
    settings: {
      title: meta.title ?? "Cloned page",
      description: meta.description ?? meta.title ?? "Cloned page",
    },
  });
  source.page = canvas.sections.map((s) => convertSection(ctx, s));
  source.popup = (canvas.popups ?? []).map((p) => convertPopup(ctx, p));
  // Custom code only for what no native setting covers: hover states (scoped to #w-<id>) and the
  // icon-font stylesheets glyph texts need.
  const css = ctx.css.filter(Boolean).join("\n");
  if (css) {
    source.settings.extra_css = css;
    ctx.notes.push(`hover effects of ${ctx.css.filter(Boolean).length} element(s) → settings.extra_css (scoped to #w-<id>)`);
  }
  // icon-font stylesheets only from the public CDNs that serve them (a cloned page must not get an
  // arbitrary third-party stylesheet on the user's domain)
  const links = (canvas.head_links ?? []).filter((h) => ICON_CDN.test(h));
  if (links.length) {
    source.settings.bhet = links.map((h) => `<link rel="stylesheet" href="${h.replace(/["<>]/g, encodeURIComponent)}">`).join("");
    ctx.notes.push(`icon font stylesheet(s) → settings.bhet: ${links.join(", ")}`);
  }
  if (canvas.truncated) {
    ctx.notes.push(
      "the canvas payload was truncated (styles pruned) — for full typography re-ingest per section (sections:[id]) and patch the affected elements."
    );
  }
  if (!ctx.mobileOnly && !canvas.measured_mobile) {
    ctx.notes.push("desktop source: the mobile breakpoint is a simple 420/960 horizontal scale — review and polish it.");
  }
  return { source, notes: ctx.notes };
}
