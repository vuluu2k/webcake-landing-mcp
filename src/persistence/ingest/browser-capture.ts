/**
 * Clone ANY page into the landing absolute canvas by MEASURING it in a real browser (Playwright),
 * not by reading its CSS: the page is loaded at a desktop width and at the mobile canvas width,
 * every visible text / image / button / painted box / svg / form is recorded with its box, and the
 * two captures are matched by DOM path. Desktop boxes are scaled onto the 960 canvas, mobile boxes
 * are used as measured (420 viewport = 420 canvas); an element the mobile layout hides gets
 * config.hide on mobile. The result is the IngestedCanvas IR canvasToPageSource already converts.
 */
import type { IngestedCanvas, CanvasElement, CanvasSection } from "./types.js";
import { withContext, isAllowedScreenshotUrl, isPublicUrl } from "../screenshot-playwright.js";

// captureInPage runs in the browser; the project has no DOM lib, so its globals are loosely typed here.
declare const document: any, window: any, getComputedStyle: any;
type Element = any; type HTMLElement = any; type HTMLAnchorElement = any; type HTMLImageElement = any; type HTMLVideoElement = any;
type HTMLIFrameElement = any; type HTMLInputElement = any; type HTMLMetaElement = any; type CSSStyleDeclaration = any;

export const DESKTOP_VIEWPORT = 1200;
const DESKTOP_CANVAS = 960;
const MOBILE_CANVAS = 420;
const MAX_ELEMENTS = 1500;

/** One element as measured in the page (viewport px; top relative to its section). */
type Raw = {
  fixed?: boolean;
  /** in-page only: the element, read by push() then dropped. */
  __el?: any;
  key: string; kind: string; tag?: string; text?: string; src?: string; href?: string; svg?: string; video?: string;
  /** in-page click target: { type:'popup', action:'POPUPn' } | { type:'section', action:'SECTIONn' }. */
  target?: { type: string; action: string; index?: number; show?: boolean };
  /** a collapsible panel (ACCn) / a tab set (TABSn): the element id its triggers' events target. */
  ref?: string;
  /** slider: a tab set (one panel shown, switched by its tab buttons) — no autoplay, no arrows. */
  tabs?: boolean;
  /** a CSS animation the landing set has no native name for: the page's @keyframes + the animation shorthand. */
  keyframes?: { css: string; animation: string };
  box: { top: number; left: number; width: number; height: number };
  style: Record<string, string>;
  input?: { name?: string; placeholder?: string; input_type?: string; required?: boolean; label?: string; options?: string[]; multiple?: boolean };
  fields?: Raw[];
  /** clip group (an overflow:hidden box whose content spills out) / slider / slide: children are relative to it. */
  children?: Raw[];
  /** slider: the source shows prev/next arrows. */
  nav?: boolean;
  /** image clipped by an overflow:hidden ancestor: the full image's box relative to the visible box. */
  crop?: { top: number; left: number; width: number; height: number };
  /** declarations of the page's own `<selector>:hover` rules that match this element. */
  hover?: string;
  transition?: string;
  /** entrance animation from AOS / animate.css / WOW classes, mapped to an animate.css name. */
  animation?: Record<string, string>;
};
type RawSection = { key: string; top: number; height: number; background: Record<string, string>; elements: Raw[]; sticky?: boolean; width?: number; style?: Record<string, string> };
type RawCapture = { title: string; description: string; width: number; sections: RawSection[]; truncated: boolean; headLinks: string[]; popups?: RawSection[] };

/**
 * Runs INSIDE the page (serialized by Playwright): self-contained, no outer references.
 * Sections = the vertical bands under the first element with more than one sizeable child.
 */
function captureInPage(opt: { max: number; popups: boolean }): RawCapture {
  const maxElements = opt.max;
  const vw = document.documentElement.clientWidth;
  const sy = window.scrollY;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "BR", "HEAD", "OPTION"]);
  const FIELD = new Set(["INPUT", "TEXTAREA", "SELECT"]);
  /** labels of radio/checkbox choices: drawn by the choice field itself, not as separate texts. */
  const consumed = new Set<Element>();
  const cs = (el: Element) => getComputedStyle(el);
  const keyOf = (el: Element): string => {
    const parts: string[] = [];
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const p: Element | null = n.parentElement;
      const same = p ? Array.from<any>(p.children).filter((c) => c.tagName === n!.tagName) : [];
      parts.push(`${n.tagName.toLowerCase()}${same.length > 1 ? same.indexOf(n) : ""}`);
    }
    return parts.reverse().join(">");
  };
  const shown = (el: Element) => {
    const s = cs(el);
    const r = el.getBoundingClientRect();
    // > 2px and not clipped away: skips screen-reader-only text (1px, clip: rect(0 0 0 0)).
    const clipped = /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(s.clip) || /inset\(50%\)/.test(s.clipPath);
    return s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity) > 0.02 && r.width > 2 && r.height > 2 && !clipped;
  };
  const alpha = (c: string) => {
    if (!c || c === "transparent") return 0;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const p = m[1].split(/[ ,/]+/).filter(Boolean);
    return p.length >= 4 ? parseFloat(p[3]) : 1;
  };
  const bgUrl = (s: CSSStyleDeclaration) => {
    const m = s.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
    return m ? m[1] : "";
  };
  const typo = (s: CSSStyleDeclaration, out: Record<string, string>) => {
    const fs = parseFloat(s.fontSize);
    out["font-size"] = String(Math.round(fs));
    out["color"] = s.color;
    out["font-weight"] = s.fontWeight;
    if (s.fontStyle === "italic") out["font-style"] = "italic";
    const fam = s.fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    if (fam) out["font-family"] = fam;
    // landing lineHeight is a multiplier of the font size
    if (s.lineHeight !== "normal" && fs) out["line-height"] = String(Math.round((parseFloat(s.lineHeight) / fs) * 100) / 100);
    if (s.letterSpacing !== "normal" && parseFloat(s.letterSpacing)) out["letter-spacing"] = `${Math.round(parseFloat(s.letterSpacing) * 10) / 10}px`;
    out["text-align"] = s.textAlign === "start" ? "left" : s.textAlign === "end" ? "right" : s.textAlign;
    if (s.textTransform !== "none") out["text-transform"] = s.textTransform;
    if (s.textShadow !== "none") out["text-shadow"] = s.textShadow;
  };
  // Every colour as rgba(r, g, b, a) — what the editor's colour trait parses. The browser may report
  // rgb(), oklch(), lab(), color(srgb …) (Tailwind v4…): paint it on a 1×1 canvas and read the pixel.
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = 1;
  const c2d = cvs.getContext("2d", { willReadFrequently: true });
  const colorCache = new Map<string, string>();
  const rgba = (c: string): string => {
    if (!c2d || colorCache.has(c)) return colorCache.get(c) ?? c;
    c2d.clearRect(0, 0, 1, 1);
    c2d.fillStyle = "rgba(1, 2, 3, 0.5)";
    c2d.fillStyle = c;
    if (c2d.fillStyle === "rgba(1, 2, 3, 0.5)") return c; // not a colour the canvas understands
    c2d.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c2d.getImageData(0, 0, 1, 1).data;
    const out = `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
    colorCache.set(c, out);
    return out;
  };
  const colorsIn = (v: string) => (typeof v === "string" ? v.replace(/\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^()]*\)/g, rgba) : v);
  const normColors = (st: Record<string, string>) => {
    for (const k of Object.keys(st)) if (/color|background|shadow|fill|gradient|border/.test(k)) st[k] = colorsIn(st[k]);
    return st;
  };
  const textClip = (s: CSSStyleDeclaration) => s.webkitBackgroundClip === "text" || s.backgroundClip === "text";
  const gradient = (s: CSSStyleDeclaration) => (/gradient\(/.test(s.backgroundImage) && !/url\(/.test(s.backgroundImage) ? s.backgroundImage : "");
  const paint = (s: CSSStyleDeclaration, out: Record<string, string>) => {
    if (alpha(s.backgroundColor) > 0) out["background-color"] = s.backgroundColor;
    if (gradient(s) && !textClip(s)) out["background"] = gradient(s);
    if (s.filter && s.filter !== "none") out["filter"] = s.filter;
    if (s.backdropFilter && s.backdropFilter !== "none") out["backdrop-filter"] = s.backdropFilter;
    const bw = parseFloat(s.borderTopWidth);
    // A border on all four sides is the box's border; a single top/bottom rule is emitted as a line (rules()).
    const all = ["Right", "Bottom", "Left"].every((d) => parseFloat(s[`border${d}Width`]) === bw);
    if (all && bw > 0 && s.borderTopStyle !== "none" && alpha(s.borderTopColor) > 0) {
      out["border-width"] = String(Math.round(bw));
      out["border-style"] = s.borderTopStyle;
      out["border-color"] = s.borderTopColor;
    }
    const br = parseFloat(s.borderTopLeftRadius);
    if (br > 0) out["border-radius"] = `${Math.round(br)}px`;
    if (s.boxShadow !== "none") out["box-shadow"] = s.boxShadow;
    if (parseFloat(s.opacity) < 1) out["opacity"] = s.opacity;
  };
  const painted = (s: CSSStyleDeclaration) =>
    alpha(s.backgroundColor) > 0 || !!bgUrl(s) || (!!gradient(s) && !textClip(s)) || (!!s.backdropFilter && s.backdropFilter !== "none") || (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none" && parseFloat(s.borderBottomWidth) > 0) || s.boxShadow !== "none";
  /** top-only / bottom-only borders (dividers, FAQ rows) → line elements at that edge. */
  const rules = (el: Element, s: CSSStyleDeclaration, box: { top: number; left: number; width: number; height: number }): Raw[] => {
    const out: Raw[] = [];
    for (const side of ["Top", "Bottom"]) {
      const w = parseFloat(s[`border${side}Width`]);
      const other = parseFloat(s[side === "Top" ? "borderBottomWidth" : "borderTopWidth"]);
      if (!(w > 0) || other > 0 || s[`border${side}Style`] === "none" || alpha(s[`border${side}Color`]) === 0) continue;
      out.push({
        key: `${keyOf(el)}~${side}`, kind: "line",
        box: { top: side === "Top" ? box.top : box.top + box.height - w, left: box.left, width: box.width, height: Math.max(1, Math.round(w)) },
        style: { "border-width": String(Math.round(w)), "border-style": s[`border${side}Style`], "border-color": s[`border${side}Color`] },
      });
    }
    return out;
  };
  /** small inline icons (svg/img ≤ 32px) beside text: drawn on their own, the text stays one block. */
  const icon = (c: Element) => ["svg", "SVG", "IMG"].includes(c.tagName) && c.getBoundingClientRect().width <= 32 && c.getBoundingClientRect().height <= 32;
  const inlineOnly = (el: Element) =>
    Array.from<any>(el.children).every((c) => {
      const d = cs(c).display;
      return (d.startsWith("inline") && !["IMG", "SVG", "svg", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "VIDEO", "IFRAME"].includes(c.tagName)) || d === "none" || c.tagName === "BR" || icon(c);
    });
  /** the text a visitor sees: skips screen-reader-only / hidden descendants (innerText keeps them). */
  const visibleText = (el: Element): string => {
    let out = "";
    const walk = (n: any) => {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.nodeType === 1 && n.tagName === "BR") out += "\n";
      else if (n.nodeType === 1 && (n === el || shown(n))) {
        const block = n !== el && !cs(n).display.startsWith("inline");
        if (block) out += "\n";
        n.childNodes.forEach(walk);
        if (block) out += "\n";
      }
    };
    walk(el);
    return out.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  };
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  /** The text as landing text-block HTML: inline runs that differ from the block (colour, weight,
   *  italic, underline, gradient fill) keep their look as <span style>; hidden runs are dropped. */
  const textOf = (root: Element): string => {
    const walk = (n: any, ps: CSSStyleDeclaration): string => {
      if (n.nodeType === 3) return esc(n.textContent.replace(/\s+/g, " "));
      if (n.nodeType !== 1) return "";
      if (n.tagName === "BR") return "<br>";
      if (n !== root && (!shown(n) || icon(n))) return "";
      const s = cs(n);
      const inner = Array.from<any>(n.childNodes).map((c: any) => walk(c, s)).join("");
      if (n === root) return inner;
      const st: string[] = [];
      if (textClip(s) && gradient(s)) st.push(`background:${colorsIn(gradient(s))};-webkit-background-clip:text;background-clip:text;color:transparent`);
      else if (s.color !== ps.color) st.push(`color:${rgba(s.color)}`);
      if (s.fontWeight !== ps.fontWeight) st.push(`font-weight:${s.fontWeight}`);
      if (s.fontStyle !== ps.fontStyle) st.push(`font-style:${s.fontStyle}`);
      if (s.textDecorationLine !== ps.textDecorationLine && s.textDecorationLine !== "none") st.push(`text-decoration:${s.textDecorationLine}`);
      return st.length ? `<span style="${st.join(";").replace(/"/g, "'")}">${inner}</span>` : inner;
    };
    return walk(root, cs(root)).replace(/\s*<br>\s*/g, "<br>").trim();
  };

  // The page's own :hover rules (same-origin / CORS-readable sheets; @media that matches; @supports,
  // @layer): `X:hover` on the subject only — the hovered element is the one restyled.
  const hoverRules: { base: string; css: string }[] = [];
  const keyframeRules = new Map<string, string>();
  const readRules = (rules: any) => {
    for (const r of Array.from<any>(rules ?? [])) {
      if (r.type === 7 && r.name && keyframeRules.size < 60 && r.cssText.length < 6000) keyframeRules.set(r.name, r.cssText); // CSSKeyframesRule
      if (hoverRules.length > 400) return;
      if (r.media && !window.matchMedia(r.media.mediaText).matches) continue;
      if (r.cssRules && !r.selectorText) readRules(r.cssRules);
      if (!r.selectorText || !r.selectorText.includes(":hover") || !r.style?.cssText) continue;
      for (const part of r.selectorText.split(",")) {
        const sel = part.trim();
        // `X:hover` restyles X; `.card:hover img` restyles the img — a flat landing canvas has no such
        // ancestor, so it is applied when the img itself is hovered.
        // ponytail: ancestor hover → self hover; exact only when the ancestor becomes a group
        const base = sel.replace(/:hover/, "");
        if (base && !base.includes(":hover")) hoverRules.push({ base, css: r.style.cssText });
      }
    }
  };
  for (const sheet of Array.from<any>(document.styleSheets)) {
    try {
      readRules(sheet.cssRules);
    } catch {
      /* cross-origin sheet without CORS: unreadable */
    }
  }
  const hoverOf = (el: Element) => {
    const css = new Set<string>();
    for (const r of hoverRules) {
      try {
        if (el.matches(r.base)) r.css.split(";").map((d: string) => d.trim()).filter(Boolean).forEach((d: string) => css.add(d));
      } catch {
        /* selector the engine rejects */
      }
    }
    return [...css].join(";");
  };
  /** A running CSS animation with no native counterpart (loops, pulses, floats): its @keyframes + shorthand. */
  const keyframesOf = (el: Element): { css: string; animation: string } | undefined => {
    const s = cs(el);
    if (!s.animationName || s.animationName === "none") return undefined;
    const names = s.animationName.split(",").map((n: string) => n.trim());
    const css = names.map((n: string) => keyframeRules.get(n)).filter(Boolean);
    if (css.length !== names.length) return undefined;
    const at = (v: string, i: number) => { const p = v.split(","); return (p[i] ?? p[0]).trim(); };
    const animation = names.map((n: string, i: number) =>
      [at(s.animationDuration, i), at(s.animationTimingFunction, i), at(s.animationDelay, i), at(s.animationIterationCount, i), at(s.animationDirection, i), at(s.animationFillMode, i), n].join(" ")).join(",");
    return { css: css.join(""), animation };
  };
  // Entrance animations from the usual libraries → animate.css names (the landing animation set).
  const AOS: Record<string, string> = {
    fade: "fadeIn", "fade-up": "fadeInUp", "fade-down": "fadeInDown", "fade-left": "fadeInRight", "fade-right": "fadeInLeft",
    "zoom-in": "zoomIn", "zoom-in-up": "zoomInUp", "zoom-in-down": "zoomInDown", "zoom-out": "zoomOut",
    "flip-left": "flipInY", "flip-right": "flipInY", "flip-up": "flipInX", "flip-down": "flipInX",
    "slide-up": "slideInUp", "slide-down": "slideInDown", "slide-left": "slideInRight", "slide-right": "slideInLeft",
  };
  const animationOf = (el: Element): Record<string, string> | undefined => {
    const a = el.closest("[data-aos]");
    if (a && AOS[a.getAttribute("data-aos")]) {
      const out: Record<string, string> = { name: AOS[a.getAttribute("data-aos")], duration: String((Number(a.getAttribute("data-aos-duration")) || 600) / 1000) };
      const d = Number(a.getAttribute("data-aos-delay"));
      if (d) out.delay = String(d / 1000);
      return out;
    }
    const c = el.closest('[class*="animate__"], .wow');
    const m = c && String(c.className).match(/(?:animate__|\bwow\s+(?:animate__)?)([a-z]+[A-Z][A-Za-z]*|[a-z]+In)\b/);
    if (m && !/^(animated|delay|faster|slow)/.test(m[1])) return { name: m[1], duration: "1" };
    return undefined;
  };
  // Sliders of the usual libraries → native carousel; their own slides (library clones excluded).
  const SLIDER_SEL = ".swiper, .swiper-container, .slick-slider, .splide, .owl-carousel, .carousel, .glide, .flickity-enabled, .keen-slider, .embla";
  const SLIDE_SEL = ".swiper-slide:not(.swiper-slide-duplicate), .slick-slide:not(.slick-cloned), .splide__slide:not(.splide__slide--clone), .owl-item:not(.cloned), .carousel-item, .glide__slide:not(.glide__slide--clone), .flickity-slider > *, .keen-slider__slide, .embla__slide";
  const TAB_PANE = '[role="tabpanel"], .tab-pane';
  const tabPanes = (el: Element) => Array.from<any>(el.children).filter((c: any) => c.matches(TAB_PANE));
  const tabSets = Array.from<any>(document.querySelectorAll("body *")).filter((c: any) => tabPanes(c).length >= 2);
  const slidesOf = (el: Element) =>
    el.matches(SLIDER_SEL) ? Array.from<any>(el.querySelectorAll(SLIDE_SEL)).filter((s: any) => s.closest(SLIDER_SEL) === el)
    : tabSets.includes(el) ? tabPanes(el) : [];
  const ICON_FONT = /awesome|material|icon|remix|boxicons|ionicons|icomoon|fontello|themify|feather|phosphor|tabler/i;

  // Popups: modal-like boxes hidden on load (Bootstrap .modal, <dialog>, [role=dialog], .popup…), in DOM
  // order → POPUP1…; the buttons/links that open them become open_popup events.
  const POPUP_SEL = 'dialog, [role="dialog"], [aria-modal="true"], .modal, .popup, [class*="popup"], [class*="modal"], [id*="popup"], [id*="modal"]';
  const popupEls = Array.from<any>(document.querySelectorAll(POPUP_SEL)).filter((c: any, i: number, all: any[]) => {
    if (all.some((o: any) => o !== c && o.contains(c)) || c.closest("[data-wc-dismissed]")) return false; // outermost only; no dismissed cookie bar / chat
    const s = cs(c);
    // a modal overlays the page (fixed / dialog); a hidden "popup-menu" dropdown sits in the flow
    const overlay = c.tagName === "DIALOG" || s.position === "fixed" || c.getAttribute("role") === "dialog" || c.getAttribute("aria-modal") === "true" || c.classList.contains("modal");
    return overlay && (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05 || (c.tagName === "DIALOG" && !c.open)) && c.querySelector("*");
  }).slice(0, 8);
  const popupIdOf = (target: Element | null) => {
    const i = target ? popupEls.findIndex((p: any) => p === target || p.contains(target)) : -1;
    return i >= 0 ? `POPUP${i + 1}` : "";
  };
  const targetOf = (el: Element): { type: string; action: string; index?: number; show?: boolean } | undefined => {
    const acc = el.closest("[data-wc-acc-trigger]");
    if (acc) {
      const ref = acc.getAttribute("data-wc-acc-trigger");
      return { type: "collapse", action: ref, show: !!document.querySelector(`[data-wc-acc="${ref}"][data-wc-acc-open]`) };
    }
    const tab = el.closest('[role="tab"], [data-bs-toggle="tab"], [data-toggle="tab"]');
    if (tab) {
      const ref = tab.getAttribute("aria-controls") || tab.getAttribute("data-bs-target") || tab.getAttribute("data-target") || tab.getAttribute("href") || "";
      let pane: Element | null = null;
      try { pane = ref.length > 1 ? document.querySelector(ref.startsWith("#") ? ref : `#${ref}`) : null; } catch { pane = null; }
      const k = pane ? tabSets.findIndex((t: any) => t === pane!.parentElement) : -1;
      if (k >= 0) return { type: "tab", action: `TABS${k + 1}`, index: tabPanes(tabSets[k]).indexOf(pane) };
    }
    const trig = el.closest('[data-bs-target], [data-target], [data-popup], a[href^="#"], [aria-controls]');
    if (!trig) return undefined;
    const ref = trig.getAttribute("data-bs-target") || trig.getAttribute("data-target") || trig.getAttribute("data-popup") || trig.getAttribute("aria-controls") || trig.getAttribute("href") || "";
    let dest: Element | null = null;
    try {
      dest = ref.length > 1 ? document.querySelector(ref.startsWith("#") || ref.startsWith(".") ? ref : `#${ref}`) : null;
    } catch {
      dest = null;
    }
    const pid = popupIdOf(dest);
    if (pid) return { type: "popup", action: pid };
    const si = dest ? bandEls.findIndex((b: any) => b.contains(dest)) : -1;
    return si >= 0 ? { type: "section", action: `SECTION${si + 1}` } : undefined;
  };

  // sections
  let root: Element = document.body;
  const sizeable = (el: Element) => Array.from<any>(el.children).filter((c) => !SKIP.has(c.tagName) && shown(c) && c.getBoundingClientRect().height >= 16);
  // A <form> is measured whole (its fields only exist as the form's children) — never entered as the
  // root or split into bands. A page-wrapping form (ASP.NET WebForms) is entered like any wrapper.
  // ponytail: "page wrapper" = taller than 2 viewports; a very long order form gets split instead.
  // A form without a <form> tag (JS-submitted): the TIGHTEST box holding 2+ fields and a button, outside any <form>.
  const ctrls = (el: Element) => el.querySelectorAll("input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]),textarea,select").length;
  const hasBtn = (el: Element) => !!el.querySelector("button,[type=submit],[role=button]");
  const looseForm = (el: Element) => {
    const n = ctrls(el);
    return n >= 2 && hasBtn(el) && !el.closest("form") && !el.querySelector("form") &&
      !Array.from<any>(el.children).some((c) => ctrls(c) === n && hasBtn(c));
  };
  const realForm = (el: Element) => (el.tagName === "FORM" || looseForm(el)) && el.getBoundingClientRect().height <= window.innerHeight * 2;
  for (let i = 0; i < 12; i++) {
    const kids = sizeable(root);
    if (kids.length === 1 && kids[0].children.length && !realForm(kids[0])) root = kids[0];
    else break;
  }
  const byTop = (a: any, b: any) => a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  // fixed / absolute layers (floating widgets, side TOCs, overlays) are not bands: each becomes a pinned
  // group inside the section where it sits.
  // A fixed bar across the top (the site header) IS a band — the section's native sticky — when the
  // page keeps room for it (nothing with content starts under it); a fixed header laid over the hero stays a layer.
  const contentful = (b: Element) => !!(b as HTMLElement).innerText?.trim() || !!b.querySelector("img,svg,video,iframe,canvas,picture,input,select,textarea") || painted(cs(b));
  const topBar = (c: Element) => {
    const r = c.getBoundingClientRect();
    return cs(c).position === "fixed" && r.top <= 1 && r.width >= vw * 0.9 && r.height <= window.innerHeight * 0.4 &&
      Array.from<any>(root.children).every((o: any) => o === c || isOverlayRaw(o) || !shown(o) || !contentful(o) || o.getBoundingClientRect().top >= r.bottom - 4);
  };
  const isOverlayRaw = (c: Element) => ["fixed", "absolute"].includes(cs(c).position);
  const isOverlay = (c: Element) => isOverlayRaw(c) && !(c.parentElement === root && topBar(c));
  // A tall band made of full-width blocks stacked one under another (<main> wrapping every section)
  // is split into those blocks, down to 3 levels; a lone wrapper inside it (<main><div>…) is looked through.
  const flatten = (els: Element[], depth: number): Element[] =>
    els.flatMap((b: any) => {
      const r = b.getBoundingClientRect();
      let kids = sizeable(b).filter((c: any) => !isOverlay(c)).sort(byTop);
      for (let i = 0; i < 4 && kids.length === 1 && !realForm(kids[0]) && !slidesOf(kids[0]).length; i++) kids = sizeable(kids[0]).filter((c: any) => !isOverlay(c)).sort(byTop);
      const stacked = kids.length >= 2 && kids.every((c: any, i: number) => {
        const q = c.getBoundingClientRect();
        // stacked: each block starts below the middle of the previous one (angled / overlapping
        // sections with negative margins still count)
        const prev = i ? kids[i - 1].getBoundingClientRect() : null;
        return q.width >= r.width * 0.5 && (!prev || q.top >= prev.top + prev.height * 0.5);
      });
      return depth < 3 && !realForm(b) && r.height > window.innerHeight * 1.5 && stacked ? flatten(kids, depth + 1) : [b];
    });
  const topLevel = sizeable(root).sort(byTop);
  const overlayEls = topLevel.filter(isOverlay);
  // an empty band (a spacer under a fixed header) adds no section: the band above spans its room
  const bandEls = flatten(topLevel.filter((c) => !isOverlay(c)), 0).filter(contentful).sort(byTop);
  // popups mode: show each hidden popup and measure its content box as its own band
  const popupContents: Element[] = [];
  if (opt.popups) {
    for (const p of popupEls) {
      if (p.tagName === "DIALOG") (p as any).open = true;
      p.classList.add("show", "open", "active", "is-open", "in");
      for (const [k, v] of [["display", "block"], ["visibility", "visible"], ["opacity", "1"], ["transform", "none"]]) p.style.setProperty(k, v, "important");
      // the visible card inside a full-screen overlay
      const vw0 = document.documentElement.clientWidth;
      const sized = (c: any) => {
        const r = c.getBoundingClientRect();
        return r.width > 40 && r.height > 40;
      };
      // the library's own card class first (it may fill a phone screen), else the first box smaller than the overlay
      const inner =
        Array.from<any>(p.querySelectorAll(".modal-content, .modal-dialog, .popup-content, .popup-inner, [role='document']")).find(sized) ||
        [p, ...Array.from<any>(p.querySelectorAll("[class*='content'], [class*='inner'], [class*='box'], div"))].find((c: any) => {
          const r = c.getBoundingClientRect();
          return sized(c) && (r.width < vw0 * 0.97 || r.height < window.innerHeight * 0.9);
        });
      popupContents.push(inner || p);
    }
  }
  let count = 0;
  let truncated = false;
  let usesIconFont = false;
  const sections: RawSection[] = [];
  const pageBg = (() => {
    for (const el of [root, document.body, document.documentElement]) {
      const c = cs(el).backgroundColor;
      if (alpha(c) > 0) return c;
    }
    return "rgb(255, 255, 255)";
  })();

  const popupSections: RawSection[] = [];
  const bands = opt.popups ? popupContents : bandEls.length ? bandEls : [root];
  // A section spans from its band's top to the NEXT band's top (margins between bands are part of the
  // page; the first starts at 0, the last runs to the end of the document).
  // (docH is read once, before any band is measured)
  const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const spanOf = (i: number) => {
    const r = bands[i].getBoundingClientRect();
    if (opt.popups) return { top: r.top + sy, height: r.height };
    const top = i === 0 ? 0 : r.top + sy;
    // overlapping bands (angled sections, negative margins): this one ends where the next begins —
    // landing sections stack, so counting the overlap twice would push everything below down
    if (i + 1 < bands.length) return { top, height: Math.max(1, bands[i + 1].getBoundingClientRect().top + sy - top) };
    return { top, height: Math.max(r.bottom + sy, docH) - top };
  };
  for (const band of bands) {
    const br = band.getBoundingClientRect();
    const span = spanOf(bands.indexOf(band));
    const secTop = span.top;
    const bs = cs(band);
    // a transparent band shows the wrapper it was split from (<main class="bg-light">), else the page's background
    let bgEl: Element = band;
    while (alpha(cs(bgEl).backgroundColor) === 0 && bgEl.parentElement && bgEl !== root) bgEl = bgEl.parentElement;
    const bgColor = cs(bgEl).backgroundColor;
    const background: Record<string, string> = { "background-color": rgba(alpha(bgColor) > 0 ? bgColor : pageBg) };
    if (bgUrl(bs)) background["background-image"] = bgUrl(bs);
    else if (gradient(bs)) background["background-image"] = colorsIn(gradient(bs));
    const elements: Raw[] = [];
    // Paint (boxes, background images, rules) under content, keeping DOM order inside each layer.
    const layer = (e: Raw) => (e.kind === "box" || e.kind === "line" || e.key.endsWith("~bg") ? 0 : e.kind === "image" || e.kind === "shape" || e.kind === "video" || e.kind === "embed" || e.kind === "group" || e.kind === "slider" ? 1 : 2);
    // A rotated element: its UNROTATED box (centred on the drawn one) + the angle, which is what the
    // landing renderer takes (styles.transform rotate(); exportCss.js:205).
    const angleOf = (el: Element) => {
      const m = cs(el).transform.match(/matrix\(([^)]+)\)/);
      if (!m) return 0;
      const [a, b] = m[1].split(",").map(parseFloat);
      return Math.round((Math.atan2(b, a) * 180) / Math.PI);
    };
    const boxOf = (el: Element, base = origin) => {
      const r = el.getBoundingClientRect();
      const deg = angleOf(el);
      if (deg && (el as any).offsetWidth) {
        const w = (el as any).offsetWidth, h = (el as any).offsetHeight;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        return { top: Math.round(cy - h / 2 + sy - base.top), left: Math.round(cx - w / 2 - base.left), width: w, height: h };
      }
      return { top: Math.round(r.top + sy - base.top), left: Math.round(r.left - base.left), width: Math.round(r.width), height: Math.round(r.height) };
    };
    /** A text's box is its CONTENT box: the landing text-block has no padding, the source's padding is offset. */
    const contentBox = (el: Element, s: CSSStyleDeclaration) => {
      const b = boxOf(el);
      if (angleOf(el)) return b;
      const [pt, pr, pb, pl] = ["Top", "Right", "Bottom", "Left"].map((d) => (parseFloat(s[`padding${d}`]) || 0) + (parseFloat(s[`border${d}Width`]) || 0));
      return { top: Math.round(b.top + pt), left: Math.round(b.left + pl), width: Math.max(4, Math.round(b.width - pl - pr)), height: Math.max(4, Math.round(b.height - pt - pb)) };
    };
    // Where push() writes and what boxOf() measures from: the section, or the clip group being filled.
    let sink: Raw[] = elements;
    let origin = { top: secTop, left: opt.popups ? br.left : 0 };
    // ancestors above this one clip natively (a clip group / slide): only those below it are applied
    let clipStop: Element | null = band.parentElement;
    /** The part of `el` its overflow-clipping ancestors (up to clipStop) let through, in page px. */
    const visibleRect = (el: Element) => {
      const r = el.getBoundingClientRect();
      let v = { l: r.left, t: r.top + sy, r: r.right, b: r.bottom + sy };
      for (let a = el.parentElement; a && a !== clipStop && a !== document.body; a = a.parentElement) {
        const s2 = cs(a);
        const q = a.getBoundingClientRect();
        if (s2.overflowX !== "visible") v = { ...v, l: Math.max(v.l, q.left), r: Math.min(v.r, q.right) };
        if (s2.overflowY !== "visible") v = { ...v, t: Math.max(v.t, q.top + sy), b: Math.min(v.b, q.bottom + sy) };
      }
      // …and the band's own span: a landing section does not clip, so a picture hanging into the next
      // band would push or overlap it — keep it inside its section
      if (!opt.popups && clipStop === band.parentElement)
        v = { l: Math.max(v.l, 0), r: Math.min(v.r, document.documentElement.clientWidth), t: Math.max(v.t, secTop), b: Math.min(v.b, secTop + span.height) };
      return { v, full: { l: r.left, t: r.top + sy, r: r.right, b: r.bottom + sy } };
    };
    const push = (raw: Raw) => {
      const el = (raw as any).__el;
      delete (raw as any).__el;
      if (el) {
        const deg = angleOf(el);
        if (deg) raw.style.transform = `rotate(${deg}deg)`;
        // clipped by an overflow:hidden ancestor: keep the visible part (an image keeps its full size as a crop)
        if (!deg && ["image", "box", "shape", "line"].includes(raw.kind)) {
          const { v, full } = visibleRect(el);
          if (v.r - v.l < 2 || v.b - v.t < 2) return; // entirely clipped away
          if (v.l > full.l + 1 || v.t > full.t + 1 || v.r < full.r - 1 || v.b < full.b - 1) {
            raw.box = { top: Math.round(v.t - origin.top), left: Math.round(v.l - origin.left), width: Math.round(v.r - v.l), height: Math.round(v.b - v.t) };
            if (raw.kind === "image") raw.crop = { top: Math.round(full.t - v.t), left: Math.round(full.l - v.l), width: Math.round(full.r - full.l), height: Math.round(full.b - full.t) };
          }
        }
        const es = cs(el);
        if (es.position === "fixed" && !opt.popups) raw.fixed = true;
        const tg = targetOf(el);
        if (tg) raw.target = tg;
        if (ICON_FONT.test(es.fontFamily)) usesIconFont = true;
        {
          const h = hoverOf(el);
          if (h) raw.hover = h;
          if (es.transitionDuration && es.transitionDuration.split(",").some((d: string) => parseFloat(d) > 0)) raw.transition = es.transition.slice(0, 300);
          const a = animationOf(el);
          if (a) raw.animation = a;
          // a looping / custom animation (float, pulse, spin…) on the element or the wrapper that moves it
          // ponytail: a wrapper's animation is copied onto each captured child (same motion for translate/opacity)
          else for (let n = el; n && n !== band && n !== document.body; n = n.parentElement) {
            const k = keyframesOf(n);
            if (k) { raw.keyframes = k; break; }
          }
        }
      }
      if (count >= maxElements) {
        truncated = true;
        return;
      }
      normColors(raw.style);
      count++;
      sink.push(raw);
    };
    const visit = (el: Element, inForm: boolean) => {
      if (SKIP.has(el.tagName) || !shown(el) || count >= maxElements) return;
      const s = cs(el);
      const tag = el.tagName;
      const style: Record<string, string> = {};
      const href = (el.closest("a") as HTMLAnchorElement | null)?.href || undefined;
      if (tag === "IMG" || tag === "PICTURE") {
        const img = (tag === "IMG" ? el : el.querySelector("img")) as HTMLImageElement | null;
        if (img?.currentSrc || img?.src) {
          paint(s, style);
          push({ __el: el, key: keyOf(el), kind: "image", src: img.currentSrc || img.src, box: boxOf(el), style, href });
        }
        return;
      }
      if (tag.toLowerCase() === "svg") {
        // A multi-colour svg (logos, illustrations, gradients) cannot be a single-colour mask: it becomes an
        // image of itself, every shape's computed paint inlined (page CSS does not travel with the file).
        const SHAPES = "path,circle,rect,ellipse,polygon,polyline,line,text";
        const paints = new Set<string>();
        el.querySelectorAll(SHAPES).forEach((n: any) => {
          const c = cs(n);
          if (c.fill && c.fill !== "none") paints.add(c.fill);
          if (c.stroke && c.stroke !== "none" && parseFloat(c.strokeWidth) > 0) paints.add(c.stroke);
        });
        if (paints.size > 1 || el.querySelector("image, linearGradient, radialGradient, pattern")) {
          const copy = el.cloneNode(true) as any;
          const src = Array.from<any>(el.querySelectorAll(SHAPES));
          Array.from<any>(copy.querySelectorAll(SHAPES)).forEach((n: any, i: number) => {
            const c = src[i] && cs(src[i]);
            if (!c) return;
            for (const [a, v] of [["fill", c.fill], ["stroke", c.stroke], ["stroke-width", c.strokeWidth], ["opacity", c.opacity], ["fill-opacity", c.fillOpacity], ["stroke-opacity", c.strokeOpacity]]) if (v) n.setAttribute(a, v);
          });
          const b = boxOf(el);
          copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          copy.setAttribute("width", String(b.width));
          copy.setAttribute("height", String(b.height));
          const markup = copy.outerHTML;
          if (markup.length <= 60000) {
            push({ __el: el, key: keyOf(el), kind: "image", src: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(markup))), box: b, style, href });
            return;
          }
        }
        paint(s, style);
        style["fill"] = s.fill && s.fill !== "none" ? s.fill : s.color;
        // <use href="#sprite"> points into a sprite elsewhere in the page: inline the symbol.
        let svg = el.outerHTML;
        const use = el.querySelector("use");
        const ref = use && (use.getAttribute("href") || use.getAttribute("xlink:href"));
        const sym = ref && ref.startsWith("#") ? document.querySelector(ref) : null;
        if (sym) {
          const vb = sym.getAttribute("viewBox") || el.getAttribute("viewBox") || "";
          svg = `<svg xmlns="http://www.w3.org/2000/svg"${vb ? ` viewBox="${vb}"` : ""}>${sym.innerHTML}</svg>`;
        }
        push({ __el: el, key: keyOf(el), kind: "shape", svg: svg.slice(0, 8000), box: boxOf(el), style, href });
        return;
      }
      if (tag === "VIDEO" || tag === "IFRAME") {
        const src = (el as HTMLVideoElement).poster || (el as HTMLIFrameElement).src || "";
        // a playable file url only (MSE / HLS players expose blob: urls)
        const video = tag === "VIDEO" ? [(el as HTMLVideoElement).currentSrc, el.querySelector("source")?.src].find((u: any) => /^https?:/i.test(u || "")) || "" : "";
        push({ __el: el, key: keyOf(el), kind: tag === "VIDEO" ? "video" : "embed", src, ...(video ? { video } : {}), box: boxOf(el), style });
        return;
      }
      // a collapsible panel (opened for the measurement): one group, the target of its trigger's collapse
      const accRef = el.getAttribute("data-wc-acc");
      if (accRef) {
        const er = el.getBoundingClientRect();
        const group: Raw = { __el: el, key: keyOf(el) + "~acc", kind: "group", ref: accRef, box: boxOf(el), style: {}, children: [] };
        const [outerSink, outerOrigin] = [sink, origin];
        sink = group.children!;
        origin = { top: er.top + sy, left: er.left };
        if (painted(s)) {
          const url = bgUrl(s);
          paint(s, style);
          push({ key: keyOf(el) + "~bg", kind: url ? "image" : "box", src: url || undefined, box: boxOf(el), style });
        }
        Array.from<any>(el.children).forEach((c) => visit(c, inForm));
        group.children!.sort((a, b) => layer(a) - layer(b));
        [sink, origin] = [outerSink, outerOrigin];
        if (group.children!.length) push(group);
        return;
      }
      if ((tag === "FORM" || looseForm(el)) && !inForm) {
        const fr = el.getBoundingClientRect();
        const base = { top: fr.top + sy, left: fr.left };
        const fields: Raw[] = [];
        const clean = (t: string) => (t || "").replace(/\s+/g, " ").replace(/[\s:*]+$/, "").trim();
        // a control's label: <label for>, a wrapping <label>, aria-label, aria-labelledby
        const labelOf = (f: any): { text: string; el?: Element } => {
          const l = (f.labels && f.labels[0]) || f.closest("label");
          if (l) {
            const c = l.cloneNode(true) as any;
            c.querySelectorAll("input,select,textarea").forEach((x: any) => x.remove());
            return { text: clean(c.textContent), el: l };
          }
          const by = f.getAttribute("aria-labelledby");
          const lb = by ? document.getElementById(by.split(/\s+/)[0]) : null;
          return { text: clean(f.getAttribute("aria-label") || lb?.textContent || "") };
        };
        const union = (els: Element[]) => {
          const bs = els.map((x) => boxOf(x, base)).filter((b) => b.width > 0 && b.height > 0);
          const t = Math.min(...bs.map((b) => b.top)), l = Math.min(...bs.map((b) => b.left));
          return { top: t, left: l, width: Math.max(...bs.map((b) => b.left + b.width)) - l, height: Math.max(...bs.map((b) => b.top + b.height)) - t };
        };
        const grouped = new Set<string>();
        el.querySelectorAll("input,textarea,select,button,[type=submit]").forEach((f: any) => {
          const ty = String(f.type || "").toLowerCase();
          if (ty === "hidden" || ty === "reset") return;
          if (ty === "radio" || ty === "checkbox") {
            // ONE choice field per name: the inputs are often visually hidden behind styled labels,
            // so the group is the union of every input + label box that shows.
            const gk = f.name || keyOf(f);
            if (grouped.has(gk)) return;
            grouped.add(gk);
            const members: any[] = f.name ? Array.from(el.querySelectorAll(`input[type=${ty}]`)).filter((x: any) => x.name === f.name) : [f];
            const labels = members.map(labelOf);
            const parts = [...members, ...labels.map((x) => x.el)].filter((x) => x && shown(x));
            const gbox = parts.length ? union(parts) : null;
            if (!gbox || !isFinite(gbox.top)) return;
            labels.forEach((x) => x.el && consumed.add(x.el));
            const legend = clean(f.closest("fieldset")?.querySelector("legend")?.textContent || "");
            const st: Record<string, string> = {};
            typo(cs(labels[0].el || f), st);
            fields.push({
              key: keyOf(f), kind: "form_item", box: gbox, style: st,
              input: {
                name: f.name || undefined, input_type: ty, required: members.some((x) => x.required) || undefined,
                label: legend || (members.length === 1 ? labels[0].text : undefined),
                options: members.map((x, i) => labels[i].text || x.value).filter(Boolean),
              },
            });
            return;
          }
          if (!shown(f)) return;
          const fs = cs(f);
          const st: Record<string, string> = {};
          paint(fs, st);
          typo(fs, st);
          if (f.tagName === "BUTTON" || ty === "submit") {
            fields.push({ key: keyOf(f), kind: "button", text: (f as HTMLElement).innerText?.trim() || (f as HTMLInputElement).value || "Gửi", box: boxOf(f, base), style: st });
            return;
          }
          const opts = f.tagName === "SELECT" ? Array.from<any>(f.options) : [];
          // a value-less first option ("-- Chọn --") is the select's prompt, not a choice
          const prompt = opts[0] && (!opts[0].value || opts[0].disabled) ? clean(opts.shift().text) : "";
          fields.push({
            key: keyOf(f), kind: "form_item", box: boxOf(f, base), style: st,
            input: {
              name: f.name || undefined, placeholder: f.placeholder || prompt || undefined,
              input_type: f.tagName === "SELECT" ? "select" : f.tagName === "TEXTAREA" ? "textarea" : ty,
              required: f.required || undefined, label: labelOf(f).text || undefined,
              ...(opts.length ? { options: opts.map((o: any) => clean(o.text)).filter(Boolean) } : {}),
              ...(f.multiple ? { multiple: true } : {}),
            },
          });
        });
        paint(s, style);
        push({ __el: el, key: keyOf(el), kind: "form", box: boxOf(el), style, fields });
        Array.from<any>(el.children).forEach((c) => visit(c, true));
        return;
      }
      if (inForm && (FIELD.has(tag) || tag === "BUTTON" || consumed.has(el))) return; // already a form field
      if (FIELD.has(tag)) return; // a field outside a form cannot submit on a landing page
      const text = visibleText(el);
      const buttonish = (tag === "A" || tag === "BUTTON" || el.getAttribute("role") === "button") && painted(s) && text.length > 0 && text.length <= 60 && el.getBoundingClientRect().height <= 120;
      if (buttonish) {
        paint(s, style);
        typo(s, style);
        style["text-align"] = "center"; // a button's label sits in the middle (flex/padding in the source)
        push({ __el: el, key: keyOf(el), kind: "button", text, box: boxOf(el), style, href });
        return;
      }
      // a slider: one native carousel; each slide measured where it is — a hidden one is laid over the
      // first slide for the measurement (out of flow, so nothing else moves) and restored after.
      const slides = slidesOf(el);
      if (slides.length >= 2) {
        const er0 = el.getBoundingClientRect();
        const first = slides[0].getBoundingClientRect();
        const tk = tabSets.indexOf(el);
        const slider: Raw = { __el: el, key: keyOf(el) + "~slider", kind: "slider", box: boxOf(el), style: {}, children: [], ...(tk >= 0 ? { ref: `TABS${tk + 1}`, tabs: true } : {}), nav: tk < 0 && !!el.querySelector(".swiper-button-next, .slick-next, .splide__arrow, .owl-next, .carousel-control-next, .glide__arrow, .flickity-prev-next-button, [class*='next']") };
        const [outerSink, outerOrigin, outerStop] = [sink, origin, clipStop];
        for (const sl of slides.slice(0, 12)) {
          const saved = sl.getAttribute("style");
          if (!shown(sl)) {
            for (const [k2, v2] of [["display", "block"], ["visibility", "visible"], ["opacity", "1"], ["position", "absolute"], ["top", "0"], ["left", "0"], ["width", `${first.width}px`], ["transform", "none"]]) sl.style.setProperty(k2, v2, "important");
          }
          const sr = sl.getBoundingClientRect();
          const slide: Raw = { key: keyOf(sl), kind: "slide", box: { top: 0, left: 0, width: Math.round(sr.width || first.width), height: Math.round(sr.height || first.height) }, style: {}, children: [] };
          sink = slide.children!;
          origin = { top: sr.top + sy, left: sr.left };
          clipStop = sl; // a slide clips its own content
          const ss = cs(sl);
          if (painted(ss)) {
            const st0: Record<string, string> = {};
            paint(ss, st0);
            push({ key: keyOf(sl) + "~bg", kind: bgUrl(ss) ? "image" : "box", src: bgUrl(ss) || undefined, box: { top: 0, left: 0, width: slide.box.width, height: slide.box.height }, style: st0 });
          }
          Array.from<any>(sl.children).forEach((c) => visit(c, inForm));
          slide.children!.sort((a, b) => layer(a) - layer(b));
          if (saved === null) sl.removeAttribute("style");
          else sl.setAttribute("style", saved);
          slider.children!.push(slide);
        }
        [sink, origin, clipStop] = [outerSink, outerOrigin, outerStop];
        if (er0.width > 0) push(slider);
        return;
      }
      // overflow:hidden box whose content spills out (decor, zoomed images, rotated shapes): a group
      // that clips its children (custom_css overflow:hidden on the group), the box's paint inside it.
      const er = el.getBoundingClientRect();
      if (el !== band && (s.overflowX !== "visible" || s.overflowY !== "visible") && er.width > 40 && er.height > 40 && !angleOf(el) &&
          Array.from<any>(el.querySelectorAll("*")).slice(0, 400).some((d: any) => {
            const q = d.getBoundingClientRect();
            return q.width > 0 && q.height > 0 && (q.left < er.left - 2 || q.right > er.right + 2 || q.top < er.top - 2 || q.bottom > er.bottom + 2);
          })) {
        const group: Raw = { __el: el, key: keyOf(el) + "~clip", kind: "group", box: boxOf(el), style: { overflow: "hidden" }, children: [] };
        const br0 = parseFloat(s.borderTopLeftRadius);
        if (br0 > 0) group.style["border-radius"] = `${Math.round(br0)}px`;
        const [outerSink, outerOrigin, outerStop] = [sink, origin, clipStop];
        sink = group.children!;
        origin = { top: er.top + sy, left: er.left };
        clipStop = el;
        for (const r of rules(el, s, boxOf(el))) push(r);
        if (painted(s)) {
          const url = bgUrl(s);
          paint(s, style);
          push({ __el: el, key: keyOf(el) + "~bg", kind: url ? "image" : "box", src: url || undefined, box: boxOf(el), style });
        }
        Array.from<any>(el.children).forEach((c) => visit(c, inForm));
        group.children!.sort((a, b) => layer(a) - layer(b));
        [sink, origin, clipStop] = [outerSink, outerOrigin, outerStop];
        push(group);
        // The group carries the element's motion (hover lift, entrance) and its shadow — a shadow inside
        // an overflow:hidden box would be clipped; the paint box inside keeps only its colours.
        const bg = group.children!.find((c) => c.key === keyOf(el) + "~bg");
        if (s.boxShadow !== "none") group.style["box-shadow"] = s.boxShadow;
        if (bg) {
          delete bg.style["box-shadow"];
          delete bg.animation;
          delete bg.transition;
          if (bg.hover) bg.hover = bg.hover.split(";").filter((d) => !/^\s*(transform|translate|scale|rotate|box-shadow)\s*:/.test(d)).join(";") || undefined;
        }
        return;
      }
      if (el !== band) for (const r of rules(el, s, boxOf(el))) push(r);
      if (painted(s) && el !== band) {
        const url = bgUrl(s);
        paint(s, style);
        push({ __el: el, key: keyOf(el) + "~bg", kind: url ? "image" : "box", src: url || undefined, box: boxOf(el), style });
      }
      // A row of links (a nav) is one text per link, not one merged line.
      const kids = Array.from<any>(el.children).filter((c: any) => shown(c));
      const linkRow = kids.length >= 2 && kids.every((c: any) => c.tagName === "A");
      if (text && inlineOnly(el) && !linkRow) {
        const st: Record<string, string> = {};
        typo(s, st);
        // gradient text (background-clip:text): a landing text-block paints its background INTO the glyphs
        if (textClip(s) && gradient(s)) st["text-gradient"] = gradient(s);
        push({ __el: el, key: keyOf(el), kind: /^H[1-6]$/.test(tag) ? "headline" : "paragraph", tag: tag.toLowerCase(), text: textOf(el), box: contentBox(el, s), style: st, href });
        Array.from<any>(el.children).filter(icon).forEach((c: any) => visit(c, inForm));
        return;
      }
      // mixed content (<div><b>Name</b> some text</div>): the element's own text runs, measured by Range
      for (const n of Array.from<any>(el.childNodes)) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const st: Record<string, string> = {};
        typo(s, st);
        push({ key: `${keyOf(el)}~t${Array.from<any>(el.childNodes).indexOf(n)}`, kind: "paragraph", text: esc(n.textContent.trim().replace(/\s+/g, " ")), box: { top: Math.round(r.top + sy - origin.top), left: Math.round(r.left - origin.left), width: Math.round(r.width), height: Math.round(r.height) }, style: st, href });
      }
      Array.from<any>(el.children).forEach((c) => visit(c, inForm));
    };
    // a band that IS a slider is measured as one (its children are slides, not elements)
    // … and so is a band that IS a form (its fields are only found from the form itself)
    if (slidesOf(band).length >= 2 || realForm(band)) visit(band, false);
    else Array.from<any>(band.children).forEach((c) => visit(c, false));
    if (!opt.popups) {
      for (const ov of overlayEls) {
        const ot = ov.getBoundingClientRect().top + sy;
        if (ot < secTop || ot >= secTop + span.height || !shown(ov)) continue;
        // one pinned group: its children keep their places relative to it
        const orr = ov.getBoundingClientRect();
        const g: Raw = { __el: ov, key: keyOf(ov) + "~layer", kind: "group", box: boxOf(ov), style: {}, children: [] };
        const [outerSink, outerOrigin] = [sink, origin];
        sink = g.children!;
        origin = { top: orr.top + sy, left: orr.left };
        const os = cs(ov);
        if (painted(os)) {
          const st0: Record<string, string> = {};
          paint(os, st0);
          push({ key: keyOf(ov) + "~bg", kind: bgUrl(os) ? "image" : "box", src: bgUrl(os) || undefined, box: { top: 0, left: 0, width: Math.round(orr.width), height: Math.round(orr.height) }, style: st0 });
        }
        Array.from<any>(ov.children).forEach((c) => visit(c, false));
        g.children!.sort((a, b) => layer(a) - layer(b));
        [sink, origin] = [outerSink, outerOrigin];
        if (g.children!.length) push(g);
      }
    }
    if (!band.children.length && (band as HTMLElement).innerText?.trim()) visit(band, false);
    elements.sort((a, b) => layer(a) - layer(b));
    const pos = bs.position;
    if (opt.popups) {
      const pst: Record<string, string> = {};
      paint(bs, pst);
      if (!pst["background-color"] && !pst["background"]) pst["background-color"] = "rgb(255, 255, 255)";
      normColors(pst);
      popupSections.push({ key: `POPUP${popupContents.indexOf(band) + 1}`, top: 0, height: Math.round(br.height), width: Math.round(br.width), background: {}, style: pst, elements });
      continue;
    }
    sections.push({ key: keyOf(band), top: Math.round(secTop), height: Math.round(span.height), background, elements, ...((pos === "sticky" || pos === "fixed") && br.top <= 1 ? { sticky: true } : {}) });
  }
  return {
    title: document.title,
    description: (document.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content || "",
    width: vw, sections: opt.popups ? [] : sections, truncated,
    ...(opt.popups ? { popups: popupSections } : {}),
    // icon-font stylesheets (Font Awesome, Material…) the glyph texts need → settings.bhet
    headLinks: usesIconFont
      ? Array.from<any>(document.querySelectorAll('link[rel="stylesheet"][href]')).map((l: any) => l.href).filter((h: string) => ICON_FONT.test(h)).slice(0, 5)
      : [],
  };
}

/** Saved / copied HTML: a <base href> so its relative images, stylesheets and fonts load from the original site. */
export function withBase(html: string, baseUrl?: string): string {
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl) || /<base\s[^>]*href/i.test(html)) return html;
  const tag = `<base href="${baseUrl.replace(/["<>]/g, encodeURIComponent)}">`;
  const head = /<head(\s[^>]*)?>/i; // not <header>
  return head.test(html) ? html.replace(head, (h) => h + tag) : tag + html;
}

/**
 * Runs in the page BEFORE the measurement: every collapsible panel (accordion / FAQ: <details>, Bootstrap
 * collapse, [aria-expanded][aria-controls]) is opened so its content is measured, and marked — the panel
 * data-wc-acc="ACCn" (+ data-wc-acc-open when it was open on load), its trigger data-wc-acc-trigger="ACCn".
 * The clone then closes it again natively: a click→collapse event on the trigger (collapsed on load).
 * Nav menus (navbar-collapse, menus inside header/nav) are left alone — they are a layout, not a FAQ.
 */
function openCollapsibles() {
  let n = 0;
  const force = (el: any) => {
    for (const [k, v] of [["display", "block"], ["height", "auto"], ["max-height", "none"], ["overflow", "visible"], ["visibility", "visible"], ["opacity", "1"]]) el.style.setProperty(k, v, "important");
  };
  const mark = (panel: any, trigger: any, open: boolean) => {
    if (!panel || !trigger || panel.hasAttribute("data-wc-acc") || panel.closest("nav, header, .navbar, [role=dialog], .modal")) return;
    const ref = `ACC${++n}`;
    panel.setAttribute("data-wc-acc", ref);
    if (open) panel.setAttribute("data-wc-acc-open", "");
    trigger.setAttribute("data-wc-acc-trigger", ref);
  };
  document.querySelectorAll("details").forEach((d: any) => {
    const summary = d.querySelector(":scope > summary");
    if (!summary || summary.hasAttribute("data-wc-acc-trigger")) return; // already opened + marked
    const wasOpen = d.open;
    d.open = true;
    // the content is every child but the summary: one wrapper so it collapses as one panel
    const body = document.createElement("div");
    Array.from<any>(d.childNodes).filter((c: any) => c !== summary).forEach((c: any) => body.appendChild(c));
    d.appendChild(body);
    mark(body, summary, wasOpen);
  });
  document.querySelectorAll('[data-bs-toggle="collapse"], [data-toggle="collapse"], [aria-expanded][aria-controls]').forEach((t: any) => {
    if (t.matches('[role="tab"], [aria-haspopup]') || t.closest("nav, header, .navbar")) return;
    const ref = t.getAttribute("data-bs-target") || t.getAttribute("data-target") || t.getAttribute("aria-controls") || t.getAttribute("href") || "";
    let panel: any = null;
    try { panel = ref.length > 1 ? document.querySelector(ref.startsWith("#") || ref.startsWith(".") ? ref : `#${ref}`) : null; } catch { panel = null; }
    if (!panel || panel.matches(".navbar-collapse") || panel.contains(t)) return;
    const s = getComputedStyle(panel);
    const open = s.display !== "none" && s.visibility !== "hidden" && panel.getBoundingClientRect().height > 2;
    panel.classList.add("show");
    force(panel);
    mark(panel, t, open);
  });
}

/**
 * Runs in the page BEFORE the measurement: what floats over the page that is not its design is taken away.
 * Consent / newsletter / promo layers are dismissed the way a visitor does (their accept / close control
 * clicked: Vietnamese + English texts, aria-labels); what still floats then — cookie bars, empty
 * full-screen dim backdrops, chat widgets — is hidden and left out (data-wc-dismissed), and a promo modal
 * left open is hidden too (the popup pass measures it as a landing popup). Only position:fixed layers are touched, never the site header
 * or anything in the flow.
 */
function dismissOverlays() {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const CONSENT = /cookie|consent|gdpr|quyền riêng tư|privacy/i;
  const PROMO = /newsletter|subscribe|popup|modal|dialog|promo|đăng ký nhận/i;
  const CHAT = /chat|messenger|zalo|tawk|crisp|intercom|tidio|zopim|livechat|hubspot-messages|freshchat|drift|contact-fab|hỗ trợ|support/i;
  const CLOSE = /^(chấp nhận( tất cả)?|đồng ý( tất cả)?|tôi đồng ý|accept( all)?( cookies)?|allow( all)?( cookies)?|agree|i agree|got it|ok(ay)?|đã hiểu|đóng|close|dismiss|no,? thanks|không,? cảm ơn|bỏ qua|để sau|later|[×✕✖xX])$/i;
  const attrs = (el: any) => `${el.id || ""} ${typeof el.className === "string" ? el.className : ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("role") || ""}`;
  const visible = (el: any) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity) > 0.02;
  };
  const header = (el: any) => el.matches("header, [role=banner]") || !!el.querySelector("nav, [role=navigation]");
  /** the outermost position:fixed ancestor-or-self (below <body>) */
  const layerOf = (el: any) => {
    let out: any = null;
    for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === "fixed") out = n;
    return out;
  };
  const kind = (el: any) => {
    const text = (el.innerText || "").trim();
    if (CONSENT.test(attrs(el)) || /cookie|consent|gdpr/i.test(text) || (CONSENT.test(text) && text.length < 800)) return "consent";
    if (el.matches("dialog, [role=dialog], [aria-modal=true]") || PROMO.test(attrs(el))) return "promo";
    return "";
  };
  // 1. the visitor's click: accept / close inside a consent or promo layer (no navigation, no form submit)
  for (const b of Array.from<any>(document.querySelectorAll("button, a, [role=button], input[type=button]"))) {
    const t = (b.innerText || b.value || b.getAttribute("aria-label") || b.getAttribute("title") || "").trim().replace(/\s+/g, " ");
    if (!CLOSE.test(t) || !visible(b) || (b.tagName === "A" && /^https?:|^\//.test(b.getAttribute("href") || "")) || (b.closest("form") && b.type !== "button")) continue;
    const layer = layerOf(b) || b.closest("dialog, [role=dialog], [aria-modal=true]");
    if (layer && !header(layer) && kind(layer)) {
      try { b.click(); } catch { /* a handler that throws */ }
    }
  }
  // 2. what still floats
  for (const el of Array.from<any>(document.querySelectorAll("body *"))) {
    if (!el.isConnected || getComputedStyle(el).position !== "fixed" || layerOf(el) !== el || !visible(el) || header(el)) continue;
    const r = el.getBoundingClientRect();
    const k = kind(el);
    const text = (el.innerText || "").trim();
    const backdrop = r.width >= vw * 0.9 && r.height >= vh * 0.9 && !text && !el.querySelector("img, svg, video, iframe, picture, canvas");
    const small = r.width * r.height < vw * vh * 0.15;
    const chat = small && (CHAT.test(attrs(el)) || Array.from<any>(el.querySelectorAll("[id], [class], [aria-label], iframe")).some((d: any) => CHAT.test(attrs(d)) || CHAT.test(d.src || "")) || (text.length <= 24 && CHAT.test(text)));
    // hidden, not removed: a framework (React…) that still owns the node crashes when it is gone
    if (k === "consent" || backdrop || chat) el.setAttribute("data-wc-dismissed", "");
    if (k || backdrop || chat) el.style.setProperty("display", "none", "important");
  }
}

async function captureAt(target: { url?: string; html?: string; baseUrl?: string }, width: number): Promise<RawCapture> {
  const r = await withContext(width, 1, async (ctx: any) => {
    // Every request the page makes (subresources, redirects, html-embedded urls) passes the same
    // public-host guard as the url itself: no SSRF into the host's private network.
    await ctx.route("**/*", async (route: any) => {
      const u = route.request().url();
      return /^(data|blob|about):/.test(u) || (await isPublicUrl(u)) ? route.continue() : route.abort();
    });
    // WebSockets bypass ctx.route: refuse them outright (a measurement needs none)
    await ctx.routeWebSocket?.("**/*", (ws: any) => ws.close()).catch?.(() => undefined);
    const page = await ctx.newPage();
    try {
      if (target.url) {
        await page.goto(target.url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => undefined);
      }
      else await page.setContent(withBase(target.html!, target.baseUrl), { waitUntil: "networkidle", timeout: 30000 }).catch(() => undefined);
      await page.evaluate(dismissOverlays).catch(() => undefined);
      await page.waitForTimeout(300); // the dismissed layers' close animations
      await page.evaluate(dismissOverlays).catch(() => undefined);
      await page.evaluate(openCollapsibles).catch(() => undefined);
      // An app shell that scrolls inside a full-height box (body = one viewport, content in a
      // overflow:auto div): unlock it so the document is as tall as the page.
      await page.evaluate(() => {
        const vh = window.innerHeight;
        if (document.documentElement.scrollHeight > vh * 1.5) return;
        const scroller = Array.from<any>(document.querySelectorAll("body *")).find((e: any) => {
          const s = getComputedStyle(e);
          return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 200 && e.clientHeight > vh * 0.6;
        });
        for (let n = scroller; n; n = n.parentElement)
          for (const [k, v] of [["height", "auto"], ["max-height", "none"], ["overflow", "visible"], ["overflow-y", "visible"]]) n.style.setProperty(k, v, "important");
      });
      // Scroll through slowly so lazy images and reveal-on-scroll content (IntersectionObserver) settle
      // in their final, shown state (~12 s at most).
      // (instant scrolling: a page with scroll-behavior:smooth would still be gliding back to the top
      // when the measurement runs, and sticky bars would be measured mid-page)
      await page.evaluate(async () => {
        document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
        const h = document.documentElement.scrollHeight;
        const step = Math.max(400, Math.ceil(h / 80));
        for (let y = 0; y < h; y += step) {
          window.scrollTo({ top: y, behavior: "instant" as any });
          await new Promise((res) => setTimeout(res, 150));
        }
        window.scrollTo({ top: 0, behavior: "instant" as any });
      });
      await page.waitForTimeout(400);
      // a layer that only appeared while scrolling (a newsletter after N seconds / % scrolled)
      await page.evaluate(dismissOverlays).catch(() => undefined);
      const main = await page.evaluate(captureInPage, { max: MAX_ELEMENTS, popups: false });
      // second pass reveals the hidden popups (mutates the page: after the main capture)
      const pop = await page.evaluate(captureInPage, { max: 200, popups: true }).catch(() => null);
      return { ...main, popups: pop?.popups ?? [] };
    } finally {
      await page.close().catch(() => undefined);
    }
  });
  if (!r.ok) throw new Error(r.error);
  return r.value as RawCapture;
}

const scaleStyle = (style: Record<string, string>, k: number) => {
  const out = { ...style };
  for (const p of ["font-size", "border-width"]) if (out[p]) out[p] = String(Math.max(1, Math.round(parseFloat(out[p]) * k)));
  if (out["letter-spacing"]) out["letter-spacing"] = `${Math.round(parseFloat(out["letter-spacing"]) * k * 10) / 10}px`;
  if (out["border-radius"]) out["border-radius"] = `${Math.round(parseFloat(out["border-radius"]) * k)}px`;
  return out;
};
const scaleBox = (b: Raw["box"], k: number) => ({
  top: Math.round(b.top * k), left: Math.round(b.left * k), width: Math.max(1, Math.round(b.width * k)), height: Math.max(1, Math.round(b.height * k)),
});
const TYPO = ["font-size", "line-height", "letter-spacing", "text-align"];

/** One-line text gets room to spare: the page font may render wider than the source's (no wrap = no reflow). */
function slack(box: Raw["box"], style: Record<string, string>, kind: string, canvasW = DESKTOP_CANVAS): Raw["box"] {
  if (!["headline", "paragraph", "button"].includes(kind)) return box;
  const fs = parseFloat(style["font-size"] ?? "16");
  const lh = parseFloat(style["line-height"] ?? "1.25") * fs;
  if (kind !== "button" && box.height > lh * 1.6) return box;
  const extra = Math.max(6, Math.round(box.width * 0.1));
  const align = style["text-align"];
  const left = align === "center" ? box.left - extra / 2 : align === "right" ? box.left - extra : box.left;
  if (kind === "button") return box;
  // never past the canvas edges: what does not fit in the slack stays as measured
  const l = Math.round(Math.max(0, left));
  return { ...box, left: l, width: Math.max(box.width, Math.min(box.width + extra, canvasW - l)) };
}

/** Desktop + mobile captures → the IngestedCanvas IR (desktop boxes on 960, mobile as measured). */
export function mergeCaptures(desk: RawCapture, mob: RawCapture | null): IngestedCanvas & { title: string; description: string } {
  const k = DESKTOP_CANVAS / desk.width;
  const km = mob ? MOBILE_CANVAS / mob.width : 1;
  // An element's mobile box is relative to ITS mobile section: only used when that is the same band.
  const mobEl = new Map<string, { sec: string; e: Raw }>();
  const mobSec = new Map<string, RawSection>();
  for (const s of mob?.sections ?? []) {
    mobSec.set(s.key, s);
    for (const e of s.elements) mobEl.set(e.key, { sec: s.key, e });
  }
  let n = 0;
  /** mob: the mobile measurement, null = hidden on mobile, undefined = unknown (scaled fallback). */
  /** pw / pmw: the width a text's slack may grow into — the canvas, or the group / slide / form it sits in. */
  const toEl = (e: Raw, mob: Raw | null | undefined, kk: number, pw = DESKTOP_CANVAS, pmw = MOBILE_CANVAS): CanvasElement => {
    const el: CanvasElement = {
      id: e.ref ?? `${e.kind.toUpperCase()}${++n}`,
      type: e.kind === "embed" ? "html_code" : e.kind,
      box: { ...slack(scaleBox(e.box, kk), scaleStyle(e.style, kk), e.kind, pw), ...(e.fixed ? { fixed: true } : {}) },
      style: scaleStyle(e.style, kk),
    };
    if (e.text) el.text = e.text;
    if (e.src) el.src = e.src;
    if (e.video) el.video = e.video;
    if (e.crop) el.crop = scaleBox(e.crop, kk);
    if (e.svg) el.svg = e.svg;
    if (e.input) el.input = e.input;
    if (e.tag) el.tag = e.tag;
    if (e.kind === "embed" && e.src && /^https?:/i.test(e.src)) el.html = `<iframe src="${e.src}" style="width:100%;height:100%;border:0" allowfullscreen></iframe>`;
    if (e.target) el.events = [e.target];
    else if (e.href && /^https?:|^tel:|^mailto:/.test(e.href) && !/#[\w-]+$/.test(e.href)) el.events = [{ type: e.href.startsWith("tel:") ? "phone" : "link", action: e.href.replace(/^tel:/, "") }];
    if (e.kind === "button") el.children = [{ id: `${el.id}_T`, type: "button_text", text: e.text, style: scaleStyle(e.style, kk) }];
    if (mob === null) el.mobile = null; // not shown in the mobile layout
    else if (mob) {
      const ms = scaleStyle(mob.style, km);
      el.mobile = { box: slack(scaleBox(mob.box, km), ms, e.kind, pmw), style: Object.fromEntries(TYPO.filter((p) => ms[p]).map((p) => [p, ms[p]])), ...(mob.crop ? { crop: scaleBox(mob.crop, km) } : {}) };
    }
    if (e.fields) {
      el.children = e.fields.map((f) => toEl(f, mob ? mob.fields?.find((x) => x.key === f.key) ?? null : undefined, kk, el.box!.width, el.mobile?.box.width));
    }
    if (e.children) {
      // a clip group: children are relative to it on both layouts; mobile counterparts live in the mobile group
      el.children = e.children.map((c) => toEl(c, mob ? mob.children?.find((x) => x.key === c.key) ?? null : undefined, kk, el.box!.width, el.mobile?.box.width));
    }
    if (e.nav) el.config = { ...(el.config ?? {}), nav: true };
    if (e.tabs) el.config = { ...(el.config ?? {}), tabs: true };
    if (e.keyframes) el.keyframes = e.keyframes;
    if (e.hover) el.hover = e.hover;
    if (e.transition) el.transition = e.transition;
    if (e.animation) el.animation = e.animation;
    return el;
  };
  /** A mobile-only element: hidden on desktop; it and its children keep their measured mobile boxes. */
  const mobileOnly = (el: CanvasElement, top: boolean) => {
    el.mobile = {
      box: el.box as { top: number; left: number; width: number; height: number },
      style: Object.fromEntries(TYPO.filter((p) => el.style?.[p]).map((p) => [p, el.style![p]])),
      ...(top ? { only: true } : {}),
    };
    (el.children ?? []).forEach((c) => c.box && mobileOnly(c, false));
  };
  // Desktop ↔ mobile matching, GLOBAL: the two layouts may cut the page into different bands (a
  // two-rail desktop that splits into nothing, a one-column mobile that splits into many). Every mobile
  // element is placed by its absolute page position; each desktop section gets a mobile FRAME — from its
  // matched elements down to the next section's frame — and its mobile boxes are relative to that frame.
  // Matching is by DOM path, else by what the element shows (text / picture / icon); a section that
  // barely matches hides nothing on mobile (scaled fallback) and gets no mobile-only additions.
  const sigOf = (e: Raw) => (e.text ? `t:${e.text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 80)}` : e.src ? `s:${e.src}` : e.svg ? `v:${e.svg.slice(0, 120)}` : "");
  type MobRef = { e: Raw; abs: number; sec: RawSection };
  const mobAll: MobRef[] = (mob?.sections ?? []).flatMap((ms) => ms.elements.map((e) => ({ e, abs: ms.top + e.box.top, sec: ms })));
  const byKey = new Map(mobAll.map((r) => [r.e.key, r]));
  const bySig = new Map<string, MobRef[]>();
  for (const r of mobAll) {
    const g = sigOf(r.e);
    if (g) (bySig.get(g) ?? bySig.set(g, []).get(g)!).push(r);
  }
  const used = new Set<MobRef>();
  const byKeyPick = (e: Raw): MobRef | undefined => {
    const k1 = byKey.get(e.key);
    if (k1 && !used.has(k1)) return used.add(k1), k1;
    return undefined;
  };
  const bySigPick = (e: Raw, ok: (r: MobRef) => boolean): MobRef | undefined => {
    const cand = (bySig.get(sigOf(e)) ?? []).find((x) => !used.has(x) && ok(x));
    if (cand) used.add(cand);
    return cand;
  };
  // pass 1: DOM paths. When they mostly hold (a server-rendered page), frames come from them and the
  // content signature only matches INSIDE the section's own frame (the same "Tour" in a footer is not
  // the nav's "Tour"); when they don't (a client-rendered page re-keyed between loads), signatures
  // match freely and the frames come from those.
  const matchesOf: (MobRef | undefined)[][] = desk.sections.map((s) => s.elements.map((e) => (mob ? byKeyPick(e) : undefined)));
  const total = desk.sections.reduce((a, s) => a + s.elements.length, 0);
  const keyed = matchesOf.flat().filter(Boolean).length;
  const keysHold = total > 0 && keyed / total >= 0.3;
  if (mob && !keysHold)
    desk.sections.forEach((s, i) => s.elements.forEach((e, j) => (matchesOf[i][j] ??= bySigPick(e, () => true))));
  // frames: the same band on mobile when its key matches, else the first matched element (monotonic)
  const mobEnd = Math.max(0, ...(mob?.sections ?? []).map((ms) => ms.top + ms.height));
  const frames: number[] = [];
  desk.sections.forEach((s, i) => {
    const same = mobSec.get(s.key);
    const hits = matchesOf[i].filter(Boolean) as MobRef[];
    const prev = frames.length ? frames[frames.length - 1] : 0;
    // the mobile band of its first matched element — unless that band also holds the section before
    // (mobile cut coarser than desktop): then just above its highest matched element
    let top = same ? same.top : hits.length ? Math.min(...hits.map((h) => h.sec.top)) : NaN;
    if (!same && hits.length && top <= prev) top = Math.min(...hits.map((h) => h.abs)) - 16;
    if (!Number.isFinite(top)) top = prev;
    if (i === 0) top = 0;
    frames.push(Math.max(top, frames.length ? frames[frames.length - 1] : 0));
  });
  const frameOf = (abs: number) => {
    let i = 0;
    while (i + 1 < frames.length && frames[i + 1] <= abs) i++;
    return i;
  };
  if (mob && keysHold)
    desk.sections.forEach((s, i) => {
      const end = i + 1 < frames.length ? frames[i + 1] : Infinity;
      s.elements.forEach((e, j) => (matchesOf[i][j] ??= bySigPick(e, (r) => r.abs >= frames[i] && r.abs < end)));
    });
  const relative = (r: MobRef, frameTop: number): Raw => ({ ...r.e, box: { ...r.e.box, top: Math.round(r.abs - frameTop) } });
  const sections: CanvasSection[] = desk.sections.map((s, i) => {
    const hits = matchesOf[i];
    const reliable = !!mob && (s.elements.length === 0 || hits.filter(Boolean).length / s.elements.length >= 0.3);
    const fTop = frames[i];
    const fEnd = i + 1 < frames.length ? frames[i + 1] : mobEnd;
    const sec: CanvasSection = {
      id: `SECTION${i + 1}`,
      height: Math.max(40, Math.round(s.height * k)),
      background: s.background,
      elements: s.elements.map((e, j) => toEl(e, !mob || !reliable ? undefined : hits[j] ? relative(hits[j]!, fTop) : null, k)),
      ...(s.sticky ? { sticky: true } : {}),
    };
    if (mob && fEnd > fTop) sec.mobile = { height: Math.max(40, Math.round((fEnd - fTop) * km)) };
    return sec;
  });
  // Shown only in the mobile layout (a hamburger bar, a mobile logo): hidden on desktop, in the frame
  // that holds it (only where that section matched reliably).
  for (const r of mobAll) {
    if (used.has(r)) continue;
    const i = frameOf(r.abs);
    const hits = matchesOf[i] ?? [];
    if (!desk.sections[i] || (desk.sections[i].elements.length && hits.filter(Boolean).length / desk.sections[i].elements.length < 0.3)) continue;
    const el = toEl(relative(r, frames[i]), undefined, km);
    mobileOnly(el, true);
    sections[i].elements.push(el);
  }
  // popups: their own canvas box, children relative to it; the mobile counterpart by POPUPn
  const mobPop = new Map((mob?.popups ?? []).map((p) => [p.key, p]));
  const popups: CanvasElement[] = (desk.popups ?? []).map((p) => {
    const mp = mobPop.get(p.key);
    const kp = Math.min(k, DESKTOP_CANVAS / Math.max(1, p.width ?? DESKTOP_CANVAS));
    const el: CanvasElement = {
      id: p.key, type: "popup",
      box: { top: 0, left: 0, width: Math.round((p.width ?? 600) * kp), height: Math.round(p.height * kp) },
      style: scaleStyle(p.style ?? {}, kp),
      children: p.elements.map((e) => toEl(e, mp ? mp.elements.find((x) => x.key === e.key) ?? null : undefined, kp)),
    };
    if (mp) el.mobile = { box: { top: 0, left: 0, width: Math.min(MOBILE_CANVAS, Math.round((mp.width ?? 380) * km)), height: Math.round(mp.height * km) } };
    return el;
  });
  const count = sections.reduce((a, s) => a + s.elements.length, 0);
  return {
    builder: "browser", width: DESKTOP_CANVAS, sections, element_count: count, measured_mobile: !!mob,
    ...(popups.length ? { popups } : {}),
    ...(desk.headLinks?.length ? { head_links: desk.headLinks } : {}),
    title: desk.title, description: desk.description,
    ...(desk.truncated ? { truncated: true, hint: `more than ${MAX_ELEMENTS} elements: the rest of the page was cut — clone it in parts (html of one section at a time).` } : {}),
  } as any;
}

/** Load the page in Chrome at DESKTOP_VIEWPORT and at the mobile canvas width; measure; merge. */
export async function captureLayout(target: { url?: string; html?: string; baseUrl?: string }) {
  if (target.url) {
    const ok = isAllowedScreenshotUrl(target.url);
    if (!ok.ok) throw new Error(ok.error);
    if (!(await isPublicUrl(target.url))) throw new Error("the url resolves to a private / loopback address");
  }
  const desk = await captureAt(target, DESKTOP_VIEWPORT);
  const mob = await captureAt(target, MOBILE_CANVAS).catch(() => null);
  return mergeCaptures(desk, mob);
}
