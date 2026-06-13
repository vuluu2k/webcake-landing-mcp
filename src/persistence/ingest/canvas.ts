/**
 * Absolute-canvas (LadiPage-family / Webcake-published HTML) ingest mode.
 */

import type { HTMLElement } from "node-html-parser";
import type { CanvasElement, CanvasSection, IngestedCanvas, IngestedSection } from "./types.js";
import { elementChildren } from "./semantic.js";

// ─── absolute-canvas (LadiPage-family) mode ──────────────────────────────────
//
// Builders like LadiPage — and Webcake's own published HTML — emit the page as
// bare positioned nodes (<div id="HEADLINE123" class="ladi-element">); ALL the
// layout + styling lives in per-id stylesheet rules (`#HEADLINE123 { top/left/
// width/height }`, `#HEADLINE123 > .ladi-headline { font… }`) and behaviors in
// a JSON <script id="script_event_data"> blob. The semantic classifier sees
// nothing there — but the geometry is exact, and the source canvas widths
// (mobile 420 / desktop 960) MATCH the Webcake canvas, so boxes transfer 1:1.

const LADI_TYPE_BY_PREFIX: Record<string, string> = {
  SECTION: "section",
  HEADLINE: "headline",
  PARAGRAPH: "paragraph",
  LIST_PARAGRAPH: "list",
  IMAGE: "image",
  BOX: "box",
  BUTTON: "button",
  BUTTON_TEXT: "button_text",
  FORM: "form",
  FORM_ITEM: "form_item",
  GROUP: "group",
  LINE: "line",
  SHAPE: "shape",
  COUNTDOWN: "countdown",
  COUNTDOWN_ITEM: "countdown_item",
  CAROUSEL: "carousel",
  GALLERY: "gallery",
  SPINLUCKY: "spin_wheel",
  POPUP: "popup",
  HTML_CODE: "html_code",
  NOTIFY: "notify",
  VIDEO: "video",
  TABS: "tabs",
  FRAME: "frame",
  BANNER: "banner",
  SURVEY: "survey",
  COLLECTION: "collection",
  COMBOBOX: "combobox",
  CART: "cart",
};

const LADI_TEXT_TYPES = new Set(["headline", "paragraph", "button_text"]);

const LADI_STYLE_KEYS = new Set([
  "font-family", "font-size", "font-weight", "font-style", "color", "text-align",
  "line-height", "letter-spacing", "text-transform", "text-shadow", "text-decoration-line",
  "background", "background-color", "background-image", "background-size", "background-position",
  "border", "border-style", "border-color", "border-width", "border-radius",
  "border-top", "border-right", "border-bottom", "border-left",
  "opacity", "transform", "box-shadow", "fill",
]);

const LADI_CONFIG_KEY_RE =
  /countdown_type|countdown_minute|thankyou_value|form_config_id|show_popup_welcome_page|delay_popup_welcome_page|autoplay|max_turn|time_show|time_delay/;

const MAX_CANVAS_ELEMENTS = 1000;
const CANVAS_SIZE_CAP = 1_000_000;
/** Shedding step 1 keeps only these style keys — the look-defining minimum for a rebuild. */
const CANVAS_CORE_STYLE_KEYS = ["font-family", "font-size", "font-weight", "color", "text-align", "background-color", "border-radius", "fill"];
const CANVAS_SVG_CAP = 1200;
const CANVAS_EMBED_CAP = 1200;

type LadiEventInfo = Pick<CanvasElement, "events" | "sticky" | "config">;

type LadiRules = {
  own: Map<string, Record<string, string>>;
  child: Map<string, Record<string, string>>;
  /** `#ID.ladi-animation …` rules — the builder's entrance/attention animations. */
  anim: Map<string, Record<string, string>>;
  /**
   * Spin-wheel artwork, kept SEPARATE because both live in `#ID <descendant>`
   * rules and would otherwise collide on `background-image` in `child`:
   * `wheel` = `.ladi-spin-lucky-screen:before` (the wheel face),
   * `button` = `.ladi-spin-lucky-start` (the center spin button).
   */
  spin: Map<string, { wheel?: string; button?: string }>;
};

type LadiCtx = { rules: LadiRules; events: Map<string, LadiEventInfo>; count: number; truncated: boolean };

function ladiTypeFromId(id: string): string {
  const m = /^([A-Z][A-Z_]*?)(\d+)$/.exec(id);
  const prefix = m ? m[1].replace(/_$/, "") : id;
  return LADI_TYPE_BY_PREFIX[prefix] ?? prefix.toLowerCase();
}

/** Split a CSS declaration block on semicolons NOT inside parens (data-URI urls contain `;`). */
function splitDeclarations(block: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of block) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function mergeLadiDecls(map: Map<string, Record<string, string>>, id: string, declsRaw: string): void {
  const rec = map.get(id) ?? {};
  for (const d of splitDeclarations(declsRaw)) {
    const i = d.indexOf(":");
    if (i <= 0) continue;
    const k = d.slice(0, i).trim().toLowerCase();
    const v = d.slice(i + 1).trim().replace(/\s*!important\s*$/i, "");
    if (!k || !v) continue;
    // data-URI artwork (arrow/list-bullet icons) is noise AND would overwrite a
    // real background-image URL merged from an earlier rule — never store it.
    if (v.includes("data:")) continue;
    rec[k] = v;
  }
  map.set(id, rec);
}

/**
 * Index the per-id stylesheet rules: `own` = the `#ID { … }` rule (geometry),
 * `child` = every `#ID <descendant> { … }` rule merged (visual styling).
 * Pseudo/state variants like `#ID.ladi-animation > …` are skipped on purpose.
 */
/** First http(s) background-image url in a raw declaration block, or undefined. */
function bgUrlFromDecls(declsRaw: string): string | undefined {
  for (const d of splitDeclarations(declsRaw)) {
    const i = d.indexOf(":");
    if (i <= 0) continue;
    if (d.slice(0, i).trim().toLowerCase() === "background-image") return urlFromCss(d.slice(i + 1));
  }
  return undefined;
}

function buildLadiRules(styleBlocks: string[]): LadiRules {
  const own = new Map<string, Record<string, string>>();
  const child = new Map<string, Record<string, string>>();
  const anim = new Map<string, Record<string, string>>();
  const spin = new Map<string, { wheel?: string; button?: string }>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const css of styleBlocks) {
    ruleRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css)) !== null) {
      const declsRaw = m[2].trim();
      if (!declsRaw) continue;
      for (const selRaw of m[1].split(",")) {
        const sel = selRaw.trim().replace(/\s*>\s*/g, " ").replace(/\s+/g, " ");
        if (!sel.startsWith("#")) continue;
        const animSel = /^#([\w-]+)\.ladi-animation( .+)?$/.exec(sel);
        if (animSel) {
          mergeLadiDecls(anim, animSel[1], declsRaw);
          continue;
        }
        const lead = /^#([\w-]+)( .+)?$/.exec(sel);
        if (!lead) continue;
        // Spin-wheel face + button images live in distinct descendant rules that
        // both set background-image — capture them separately before they collide.
        const rest = lead[2] ?? "";
        if (/ladi-spin-lucky-screen|ladi-spin-lucky-start/.test(rest)) {
          const u = bgUrlFromDecls(declsRaw);
          if (u) {
            const rec = spin.get(lead[1]) ?? {};
            if (/ladi-spin-lucky-screen/.test(rest)) rec.wheel = u;
            else rec.button = u;
            spin.set(lead[1], rec);
          }
        }
        mergeLadiDecls(lead[2] ? child : own, lead[1], declsRaw);
      }
    }
  }
  return { own, child, anim, spin };
}

function pxValue(v?: string): number | undefined {
  if (!v) return undefined;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  return m ? Math.round(parseFloat(m[1])) : undefined;
}

function urlFromCss(v?: string): string | undefined {
  if (!v) return undefined;
  const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(v);
  const u = m?.[1]?.trim();
  return u && /^https?:\/\//i.test(u) ? u : undefined;
}

/** `…ladicdn.com/s768x703/path.jpg` → `…ladicdn.com/path.jpg` (the full-size original). */
export function stripCdnSizePrefix(url: string): string {
  return url.replace(/^(https?:\/\/[^/]*ladicdn\.com)\/s\d+x\d+\//i, "$1/");
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function pickCanvasStyle(decls: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!decls) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(decls)) {
    if (!LADI_STYLE_KEYS.has(k)) continue;
    if (k === "background-image" && v === "none") continue;
    out[k] = v.length > 160 ? v.slice(0, 160) : v;
  }
  return Object.keys(out).length ? out : undefined;
}

function sectionBackground(bag: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!bag) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(bag)) {
    if (!/^background/.test(k) && k !== "opacity") continue;
    if (k === "background-image") {
      const u = urlFromCss(v);
      if (u) out[k] = stripCdnSizePrefix(u);
      continue;
    }
    if (v === "none") continue;
    out[k] = v.slice(0, 160);
  }
  return Object.keys(out).length ? out : undefined;
}

function parseLadiEventData(root: HTMLElement): Map<string, LadiEventInfo> {
  const map = new Map<string, LadiEventInfo>();
  const script = root.querySelector("#script_event_data");
  if (!script) return map;
  let data: Record<string, Record<string, unknown>>;
  try {
    data = JSON.parse(script.text || script.innerHTML || "");
  } catch {
    return map;
  }
  for (const [id, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object") continue;
    const info: LadiEventInfo = {};
    const de = entry["option.data_event"];
    if (Array.isArray(de)) {
      const events = de
        .map((x: any) => ({ type: String(x?.type ?? ""), action: String(x?.action ?? "") }))
        .filter((x) => x.type && x.action)
        .slice(0, 4);
      if (events.length) info.events = events;
    }
    if (entry["mobile.option.sticky"] === true || entry["option.sticky"] === true) {
      info.sticky = String(entry["mobile.option.sticky_position"] ?? entry["option.sticky_position"] ?? "bottom_left");
    }
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
      if (LADI_CONFIG_KEY_RE.test(k)) config[k.replace(/^.*option\./, "")] = v;
      // Spin-wheel prize list ships as base64("label|message|chance") entries — decode it.
      if (k.endsWith("spinlucky_setting.list_value") && Array.isArray(v)) {
        const prizes = v
          .map((x) => {
            try {
              const parts = Buffer.from(String(x), "base64").toString("utf8").split("|").map((p) => p.trim());
              return parts[0] ? { label: parts[0], chance: parts[2] ?? "" } : null;
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        if (prizes.length) config["prizes"] = prizes;
      }
    }
    if (Object.keys(config).length) info.config = config;
    if (info.events || info.sticky || info.config) map.set(id, info);
  }
  return map;
}

/** Direct + nested `.ladi-element` nodes under `node`, preserving the builder's parent→child tree. */
function collectCanvasElements(node: HTMLElement, ctx: LadiCtx): CanvasElement[] {
  const out: CanvasElement[] = [];
  for (const child of elementChildren(node)) {
    const tag = child.tagName?.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "svg") continue;
    const cls = child.getAttribute("class") ?? "";
    const id = child.getAttribute("id") ?? "";
    if (id && /(^|\s)ladi-element(\s|$)/.test(cls)) {
      if (ctx.count >= MAX_CANVAS_ELEMENTS) {
        ctx.truncated = true;
        return out;
      }
      ctx.count++;
      out.push(buildCanvasElement(child, id, ctx));
    } else {
      out.push(...collectCanvasElements(child, ctx));
    }
  }
  return out;
}

function buildCanvasElement(el: HTMLElement, id: string, ctx: LadiCtx): CanvasElement {
  const type = ladiTypeFromId(id);
  const node: CanvasElement = { id, type };

  const own = ctx.rules.own.get(id);
  if (own) {
    const box: NonNullable<CanvasElement["box"]> = {};
    for (const k of ["top", "left", "width", "height", "bottom", "right"] as const) {
      const v = pxValue(own[k]);
      if (v !== undefined) box[k] = v;
    }
    if ((own["position"] ?? "").includes("fixed")) box.fixed = true;
    if (Object.keys(box).length) node.box = box;
  }

  const bag = ctx.rules.child.get(id);
  if (bag) {
    const bgUrl = urlFromCss(bag["background-image"]);
    if (bgUrl && (type === "image" || type === "video" || type === "popup")) node.src = stripCdnSizePrefix(bgUrl);
    const style = pickCanvasStyle(bag);
    if (style) {
      if (node.src) delete style["background-image"];
      if (Object.keys(style).length) node.style = style;
    }
    // Inner image-layer geometry ≠ element box ⇒ an offset/zoom crop.
    if (type === "image") {
      const crop: NonNullable<CanvasElement["crop"]> = {};
      for (const k of ["top", "left", "width", "height"] as const) {
        const v = pxValue(bag[k]);
        if (v !== undefined) crop[k] = v;
      }
      const offset = (crop.top !== undefined && crop.top !== 0) || (crop.left !== undefined && crop.left !== 0);
      const zoomed =
        (crop.width !== undefined && node.box?.width !== undefined && crop.width !== node.box.width) ||
        (crop.height !== undefined && node.box?.height !== undefined && crop.height !== node.box.height);
      if (Object.keys(crop).length && (offset || zoomed)) node.crop = crop;
    }
  }

  const animBag = ctx.rules.anim.get(id);
  if (animBag) {
    const animation: Record<string, string> = {};
    for (const k of ["animation-name", "animation-duration", "animation-delay", "animation-iteration-count"]) {
      if (animBag[k]) animation[k.replace("animation-", "")] = animBag[k];
    }
    if (animation["name"]) node.animation = animation;
  }

  if (LADI_TEXT_TYPES.has(type)) {
    const t = collapseWs(el.textContent ?? "");
    if (t) node.text = t.slice(0, 300);
  } else if (type === "list") {
    const items = el
      .querySelectorAll("li")
      .map((li) => collapseWs(li.text))
      .filter(Boolean)
      .slice(0, 15);
    if (items.length) node.text = items.join("\n");
  } else if (type === "shape") {
    const svg = el.querySelector("svg");
    if (svg) {
      const markup = svg.toString().replace(/\s{2,}/g, " ").trim();
      if (markup.length <= CANVAS_SVG_CAP) node.svg = markup;
    }
  } else if (type === "html_code" || type === "notify") {
    const inner = collapseWs(el.innerHTML ?? "");
    if (inner) node.html = inner.slice(0, CANVAS_EMBED_CAP);
  } else if (type === "form_item") {
    const inp = el.querySelector("input, textarea, select");
    if (inp) {
      const tag = inp.tagName?.toLowerCase();
      node.input = {
        name: inp.getAttribute("name") || undefined,
        placeholder: inp.getAttribute("placeholder") || undefined,
        input_type: tag === "input" ? inp.getAttribute("type") ?? "text" : tag,
        required: inp.hasAttribute("required") || undefined,
        pattern: inp.getAttribute("pattern") || undefined,
      };
    }
  }

  if (el.tagName?.toLowerCase() === "a") {
    const href = el.getAttribute("href");
    if (href) node.href = href;
  }

  const evt = ctx.events.get(id);
  if (evt) Object.assign(node, evt);

  // spin-wheel: carry the original wheel-face + center-button images (kept separate
  // in rules.spin so they don't collide) so the clone uses the real art, not a default.
  const spinImgs = ctx.rules.spin.get(id);
  if (spinImgs && (spinImgs.wheel || spinImgs.button)) {
    const cfg: Record<string, unknown> = { ...(node.config ?? {}) };
    if (spinImgs.wheel) cfg["wheelImage"] = stripCdnSizePrefix(spinImgs.wheel);
    if (spinImgs.button) cfg["buttonImage"] = stripCdnSizePrefix(spinImgs.button);
    node.config = cfg;
  }

  const children = collectCanvasElements(el, ctx);
  if (children.length) node.children = children;
  return node;
}

export function parseAbsoluteCanvas(html: string, root: HTMLElement, styleBlocks: string[], only?: string[]): IngestedCanvas | null {
  const sectionEls = root.querySelectorAll(".ladi-section");
  if (!sectionEls.length) return null;
  const rules = buildLadiRules(styleBlocks);
  if (!rules.own.size) return null; // ladi-ish classes but no per-id geometry — let the role path handle it

  const wrapWidth = /\.ladi-wraper\s*\{[^}]*width:\s*(\d+)px/.exec(styleBlocks.join("\n"));
  const width = wrapWidth ? parseInt(wrapWidth[1], 10) : 960;
  const mobileOnly = /is_mobile_only\s*=\s*true/.test(html) || width <= 480;

  const ctx: LadiCtx = { rules, events: parseLadiEventData(root), count: 0, truncated: false };

  const sections: CanvasSection[] = [];
  const popups: CanvasElement[] = [];
  for (const secEl of sectionEls) {
    const id = secEl.getAttribute("id") ?? `SECTION_${sections.length + 1}`;
    if (only?.length && !only.includes(id)) continue; // section filter: full-detail re-fetch
    const elements = collectCanvasElements(secEl, ctx);
    if (id === "SECTION_POPUP") {
      popups.push(...elements.filter((e) => e.type === "popup"));
      continue;
    }
    const sec: CanvasSection = { id, elements };
    const h = pxValue((rules.own.get(id) ?? {})["height"]);
    if (h !== undefined) sec.height = h;
    const bg = sectionBackground(rules.child.get(id));
    if (bg) sec.background = bg;
    sections.push(sec);
  }
  if (!sections.length && !popups.length) return null;

  const canvas: IngestedCanvas = {
    builder: "ladi",
    width,
    ...(mobileOnly ? { mobile_only: true } : {}),
    sections,
    ...(popups.length ? { popups } : {}),
    element_count: ctx.count,
    ...(ctx.truncated ? { truncated: true } : {}),
  };
  shedCanvas(canvas);
  return canvas;
}

/** Keep the canvas payload under the size cap: prune styles to the core keys → svg/embeds → all styles → long text. */
function shedCanvas(canvas: IngestedCanvas): void {
  const walk = (els: CanvasElement[], fn: (e: CanvasElement) => void): void => {
    for (const e of els) {
      fn(e);
      if (e.children) walk(e.children, fn);
    }
  };
  const all = (fn: (e: CanvasElement) => void): void => {
    for (const s of canvas.sections) walk(s.elements, fn);
    if (canvas.popups) walk(canvas.popups, fn);
  };
  if (JSON.stringify(canvas).length <= CANVAS_SIZE_CAP) return;
  all((e) => {
    if (!e.style) return;
    const pruned: Record<string, string> = {};
    for (const k of CANVAS_CORE_STYLE_KEYS) if (e.style[k] !== undefined) pruned[k] = e.style[k];
    if (Object.keys(pruned).length) e.style = pruned;
    else delete e.style;
  });
  if (JSON.stringify(canvas).length > CANVAS_SIZE_CAP) {
    all((e) => {
      delete e.svg;
      delete e.html;
    });
  }
  if (JSON.stringify(canvas).length > CANVAS_SIZE_CAP) {
    all((e) => delete e.style);
  }
  if (JSON.stringify(canvas).length > CANVAS_SIZE_CAP) {
    all((e) => {
      if (e.text && e.text.length > 80) e.text = e.text.slice(0, 80);
    });
  }
  canvas.truncated = true;
  canvas.hint =
    "payload exceeded the size cap, so per-element styles were pruned/dropped — re-call the ingest tool with sections:[<id>] (one or a few ids from sections[].id; 'SECTION_POPUP' selects the popups) to get those sections in full untrimmed detail.";
}

/** Minimal role-section view of the canvas so existing consumers keep working. */
export function canvasRoleSections(canvas: IngestedCanvas): IngestedSection[] {
  return canvas.sections.map((s) => {
    const headings: string[] = [];
    const imgs: string[] = [];
    let hasForm = false;
    const walk = (els: CanvasElement[]): void => {
      for (const e of els) {
        if (e.type === "headline" && e.text) headings.push(e.text);
        if (e.src) imgs.push(e.src);
        if (e.type === "form") hasForm = true;
        if (e.children) walk(e.children);
      }
    };
    walk(s.elements);
    const sec: IngestedSection = { role: hasForm ? "form" : "unknown" };
    if (headings.length) sec.heading = headings[0].slice(0, 240);
    if (imgs.length) sec.images = imgs.slice(0, 12);
    if (s.height) sec.size_hint = { height: s.height, basis: "css", css: `${s.height}px` };
    return sec;
  });
}
