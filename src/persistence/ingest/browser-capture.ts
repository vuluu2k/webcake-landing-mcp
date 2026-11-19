/**
 * Clone ANY page into the landing absolute canvas by MEASURING it in a real browser (Playwright),
 * not by reading its CSS: the page is loaded at a desktop width and at the mobile canvas width,
 * every visible text / image / button / painted box / svg / form is recorded with its box, and the
 * two captures are matched by DOM path. Desktop boxes are scaled onto the 960 canvas, mobile boxes
 * are used as measured (420 viewport = 420 canvas); an element the mobile layout hides gets
 * config.hide on mobile. The result is the IngestedCanvas IR canvasToPageSource already converts.
 */
import type { IngestedCanvas, CanvasElement, CanvasSection } from "./types.js";
import { withContext, isAllowedScreenshotUrl } from "../screenshot-playwright.js";

// captureInPage runs in the browser; the project has no DOM lib, so its globals are loosely typed here.
declare const document: any, window: any, getComputedStyle: any;
type Element = any; type HTMLElement = any; type HTMLAnchorElement = any; type HTMLImageElement = any; type HTMLVideoElement = any;
type HTMLIFrameElement = any; type HTMLInputElement = any; type HTMLMetaElement = any; type CSSStyleDeclaration = any;

export const DESKTOP_VIEWPORT = 1200;
const DESKTOP_CANVAS = 960;
const MOBILE_CANVAS = 420;
const MAX_ELEMENTS = 700;

/** One element as measured in the page (viewport px; top relative to its section). */
type Raw = {
  fixed?: boolean;
  /** in-page only: the element, read by push() then dropped. */
  __el?: any;
  key: string; kind: string; tag?: string; text?: string; src?: string; href?: string; svg?: string;
  box: { top: number; left: number; width: number; height: number };
  style: Record<string, string>;
  input?: { name?: string; placeholder?: string; input_type?: string; required?: boolean };
  fields?: Raw[];
  /** clip group (an overflow:hidden box whose content spills out): children are relative to it. */
  children?: Raw[];
  /** declarations of the page's own `<selector>:hover` rules that match this element. */
  hover?: string;
  transition?: string;
  /** entrance animation from AOS / animate.css / WOW classes, mapped to an animate.css name. */
  animation?: Record<string, string>;
};
type RawSection = { key: string; top: number; height: number; background: Record<string, string>; elements: Raw[]; sticky?: boolean };
type RawCapture = { title: string; description: string; width: number; sections: RawSection[]; truncated: boolean; headLinks: string[] };

/**
 * Runs INSIDE the page (serialized by Playwright): self-contained, no outer references.
 * Sections = the vertical bands under the first element with more than one sizeable child.
 */
function captureInPage(maxElements: number): RawCapture {
  const vw = document.documentElement.clientWidth;
  const sy = window.scrollY;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "BR", "HEAD", "OPTION"]);
  const FIELD = new Set(["INPUT", "TEXTAREA", "SELECT"]);
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
      if (textClip(s) && gradient(s)) st.push(`background:${gradient(s)};-webkit-background-clip:text;background-clip:text;color:transparent`);
      else if (s.color !== ps.color) st.push(`color:${s.color}`);
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
  const readRules = (rules: any) => {
    for (const r of Array.from<any>(rules ?? [])) {
      if (hoverRules.length > 400) return;
      if (r.media && !window.matchMedia(r.media.mediaText).matches) continue;
      if (r.cssRules && !r.selectorText) readRules(r.cssRules);
      if (!r.selectorText || !r.selectorText.includes(":hover") || !r.style?.cssText) continue;
      for (const part of r.selectorText.split(",")) {
        const sel = part.trim();
        if (!/:hover(?=[^\s>+~]*$)/.test(sel)) continue;
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
  const ICON_FONT = /awesome|material|icon|remix|boxicons|ionicons|icomoon|fontello|themify|feather|phosphor|tabler/i;

  // sections
  let root: Element = document.body;
  const sizeable = (el: Element) => Array.from<any>(el.children).filter((c) => !SKIP.has(c.tagName) && shown(c) && c.getBoundingClientRect().height >= 16);
  for (let i = 0; i < 12; i++) {
    const kids = sizeable(root);
    if (kids.length === 1 && kids[0].children.length) root = kids[0];
    else break;
  }
  const bandEls = sizeable(root).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
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

  for (const band of bandEls.length ? bandEls : [root]) {
    const br = band.getBoundingClientRect();
    const secTop = br.top + sy;
    const bs = cs(band);
    const background: Record<string, string> = { "background-color": alpha(bs.backgroundColor) > 0 ? bs.backgroundColor : pageBg };
    if (bgUrl(bs)) background["background-image"] = bgUrl(bs);
    else if (gradient(bs)) background["background-image"] = gradient(bs);
    const elements: Raw[] = [];
    // Paint (boxes, background images, rules) under content, keeping DOM order inside each layer.
    const layer = (e: Raw) => (e.kind === "box" || e.kind === "line" || e.key.endsWith("~bg") ? 0 : e.kind === "image" || e.kind === "shape" || e.kind === "video" || e.kind === "embed" || e.kind === "group" ? 1 : 2);
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
    let origin = { top: secTop, left: 0 };
    const push = (raw: Raw) => {
      const el = (raw as any).__el;
      delete (raw as any).__el;
      if (el) {
        const deg = angleOf(el);
        if (deg) raw.style.transform = `rotate(${deg}deg)`;
        const es = cs(el);
        if (es.position === "fixed") raw.fixed = true;
        if (ICON_FONT.test(es.fontFamily)) usesIconFont = true;
        {
          const h = hoverOf(el);
          if (h) raw.hover = h;
          if (es.transitionDuration && es.transitionDuration.split(",").some((d: string) => parseFloat(d) > 0)) raw.transition = es.transition.slice(0, 300);
          const a = animationOf(el);
          if (a) raw.animation = a;
        }
      }
      if (count >= maxElements) {
        truncated = true;
        return;
      }
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
        push({ __el: el, key: keyOf(el), kind: tag === "VIDEO" ? "video" : "embed", src, box: boxOf(el), style });
        return;
      }
      if (tag === "FORM" && !inForm) {
        const fr = el.getBoundingClientRect();
        const base = { top: fr.top + sy, left: fr.left };
        const fields: Raw[] = [];
        el.querySelectorAll("input,textarea,select,button,[type=submit]").forEach((f: any) => {
          if (!shown(f) || (f as HTMLInputElement).type === "hidden") return;
          const fs = cs(f);
          const st: Record<string, string> = {};
          paint(fs, st);
          typo(fs, st);
          if (f.tagName === "BUTTON" || (f as HTMLInputElement).type === "submit")
            fields.push({ key: keyOf(f), kind: "button", text: (f as HTMLElement).innerText?.trim() || (f as HTMLInputElement).value || "Gửi", box: boxOf(f, base), style: st });
          else
            fields.push({
              key: keyOf(f), kind: "form_item", box: boxOf(f, base), style: st,
              input: { name: (f as HTMLInputElement).name || undefined, placeholder: (f as HTMLInputElement).placeholder || undefined, input_type: (f as HTMLInputElement).type, required: (f as HTMLInputElement).required || undefined },
            });
        });
        paint(s, style);
        push({ __el: el, key: keyOf(el), kind: "form", box: boxOf(el), style, fields });
        Array.from<any>(el.children).forEach((c) => visit(c, true));
        return;
      }
      if (inForm && (FIELD.has(tag) || tag === "BUTTON")) return; // already a form field
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
        const [outerSink, outerOrigin] = [sink, origin];
        sink = group.children!;
        origin = { top: er.top + sy, left: er.left };
        for (const r of rules(el, s, boxOf(el))) push(r);
        if (painted(s)) {
          const url = bgUrl(s);
          paint(s, style);
          push({ __el: el, key: keyOf(el) + "~bg", kind: url ? "image" : "box", src: url || undefined, box: boxOf(el), style });
        }
        Array.from<any>(el.children).forEach((c) => visit(c, inForm));
        group.children!.sort((a, b) => layer(a) - layer(b));
        [sink, origin] = [outerSink, outerOrigin];
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
      Array.from<any>(el.children).forEach((c) => visit(c, inForm));
    };
    Array.from<any>(band.children).forEach((c) => visit(c, false));
    if (!band.children.length && (band as HTMLElement).innerText?.trim()) visit(band, false);
    elements.sort((a, b) => layer(a) - layer(b));
    const pos = bs.position;
    sections.push({ key: keyOf(band), top: Math.round(secTop), height: Math.round(br.height), background, elements, ...((pos === "sticky" || pos === "fixed") && br.top <= 1 ? { sticky: true } : {}) });
  }
  return {
    title: document.title,
    description: (document.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content || "",
    width: vw, sections, truncated,
    // icon-font stylesheets (Font Awesome, Material…) the glyph texts need → settings.bhet
    headLinks: usesIconFont
      ? Array.from<any>(document.querySelectorAll('link[rel="stylesheet"][href]')).map((l: any) => l.href).filter((h: string) => ICON_FONT.test(h)).slice(0, 5)
      : [],
  };
}

async function captureAt(target: { url?: string; html?: string }, width: number): Promise<RawCapture> {
  const r = await withContext(width, 1, async (ctx: any) => {
    // Every request the page makes (subresources, redirects, html-embedded urls) passes the same
    // public-host guard as the url itself: no SSRF into the host's private network.
    await ctx.route("**/*", (route: any) => {
      const u = route.request().url();
      return /^(data|blob|about):/.test(u) || isAllowedScreenshotUrl(u).ok ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    try {
      if (target.url) await page.goto(target.url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => undefined);
      else await page.setContent(target.html!, { waitUntil: "networkidle", timeout: 30000 }).catch(() => undefined);
      // Scroll through once so lazy images and reveal-on-scroll content are in their final state.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((res) => setTimeout(res, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(400);
      return await page.evaluate(captureInPage, MAX_ELEMENTS);
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
function slack(box: Raw["box"], style: Record<string, string>, kind: string): Raw["box"] {
  if (!["headline", "paragraph", "button"].includes(kind)) return box;
  const fs = parseFloat(style["font-size"] ?? "16");
  const lh = parseFloat(style["line-height"] ?? "1.25") * fs;
  if (kind !== "button" && box.height > lh * 1.6) return box;
  const extra = Math.max(6, Math.round(box.width * 0.1));
  const align = style["text-align"];
  const left = align === "center" ? box.left - extra / 2 : align === "right" ? box.left - extra : box.left;
  return kind === "button" ? box : { ...box, left: Math.round(Math.max(0, left)), width: box.width + extra };
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
  const toEl = (e: Raw, mob: Raw | null | undefined, kk: number): CanvasElement => {
    const el: CanvasElement = {
      id: `${e.kind.toUpperCase()}${++n}`,
      type: e.kind === "embed" ? "html_code" : e.kind,
      box: { ...slack(scaleBox(e.box, kk), scaleStyle(e.style, kk), e.kind), ...(e.fixed ? { fixed: true } : {}) },
      style: scaleStyle(e.style, kk),
    };
    if (e.text) el.text = e.text;
    if (e.src) el.src = e.src;
    if (e.svg) el.svg = e.svg;
    if (e.input) el.input = e.input;
    if (e.tag) el.tag = e.tag;
    if (e.kind === "embed" && e.src) el.html = `<iframe src="${e.src}" style="width:100%;height:100%;border:0" allowfullscreen></iframe>`;
    if (e.href && /^https?:|^tel:|^mailto:/.test(e.href)) el.events = [{ type: e.href.startsWith("tel:") ? "phone" : "link", action: e.href.replace(/^tel:/, "") }];
    if (e.kind === "button") el.children = [{ id: `${el.id}_T`, type: "button_text", text: e.text, style: scaleStyle(e.style, kk) }];
    if (mob === null) el.mobile = null; // not shown in the mobile layout
    else if (mob) {
      const ms = scaleStyle(mob.style, km);
      el.mobile = { box: slack(scaleBox(mob.box, km), ms, e.kind), style: Object.fromEntries(TYPO.filter((p) => ms[p]).map((p) => [p, ms[p]])) };
    }
    if (e.fields) {
      el.children = e.fields.map((f) => toEl(f, mob ? mob.fields?.find((x) => x.key === f.key) ?? null : undefined, kk));
    }
    if (e.children) {
      // a clip group: children are relative to it on both layouts; mobile counterparts live in the mobile group
      el.children = e.children.map((c) => toEl(c, mob ? mob.children?.find((x) => x.key === c.key) ?? null : undefined, kk));
    }
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
  const sections: CanvasSection[] = desk.sections.map((s, i) => {
    const ms = mobSec.get(s.key);
    const sec: CanvasSection = {
      id: `SECTION${i + 1}`,
      height: Math.max(40, Math.round(s.height * k)),
      background: s.background,
      elements: s.elements.map((e) => {
        const m = mobEl.get(e.key);
        return toEl(e, !mob ? undefined : !m ? null : m.sec === s.key ? m.e : undefined, k);
      }),
      ...(s.sticky ? { sticky: true } : {}),
    };
    if (ms) {
      sec.mobile = { height: Math.max(40, Math.round(ms.height * km)) };
      // Shown only in the mobile layout (a hamburger bar, a mobile logo): hidden on desktop.
      const deskKeys = new Set(s.elements.map((e) => e.key));
      for (const me of ms.elements) {
        if (deskKeys.has(me.key)) continue;
        const el = toEl(me, undefined, km);
        mobileOnly(el, true);
        sec.elements.push(el);
      }
    }
    return sec;
  });
  const count = sections.reduce((a, s) => a + s.elements.length, 0);
  return {
    builder: "browser", width: DESKTOP_CANVAS, sections, element_count: count, measured_mobile: !!mob,
    ...(desk.headLinks?.length ? { head_links: desk.headLinks } : {}),
    title: desk.title, description: desk.description,
    ...(desk.truncated ? { truncated: true, hint: `more than ${MAX_ELEMENTS} elements: the rest of the page was cut — clone it in parts (html of one section at a time).` } : {}),
  } as any;
}

/** Load the page in Chrome at DESKTOP_VIEWPORT and at the mobile canvas width; measure; merge. */
export async function captureLayout(target: { url?: string; html?: string }) {
  if (target.url) {
    const ok = isAllowedScreenshotUrl(target.url);
    if (!ok.ok) throw new Error(ok.error);
  }
  const desk = await captureAt(target, DESKTOP_VIEWPORT);
  const mob = await captureAt(target, MOBILE_CANVAS).catch(() => null);
  return mergeCaptures(desk, mob);
}
