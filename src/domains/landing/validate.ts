/**
 * Page validation: JSON-Schema structural check (ajv, draft 2020-12) plus
 * semantic checks the schema can't express (unique ids, dangling event targets,
 * children only on containers, missing field_name, top-level types). Also checks
 * form-data bindings: duplicate field_name within a single form, and dangling
 * option-level event targets (specials.options[].events_option promoId) and
 * survey/field cross-wiring (connectedSurvey / connectedForm / set_field_value).
 */
import { readFileSync } from "node:fs";
import Ajv2020Module from "ajv/dist/2020.js";
import { CONTAINER_TYPES, FIELD_TYPES } from "./elements/index.js";
import { ANIMATABLE_TYPES, ANIMATION_NAMES } from "./vocab.js";
import { estTextHeightPx, measureTextBlock } from "./text-metrics.js";
import type { ValidationResult } from "../../core/domain.js";

export type { ValidationResult };

// ajv ships as CJS; under Node16 ESM the constructor is on `.default`.
const Ajv2020: any = (Ajv2020Module as any).default ?? Ajv2020Module;

// Loaded at runtime (the build copies this JSON beside the compiled validator)
// to avoid JSON-import-attribute differences across Node versions.
export const pageSchema: object = JSON.parse(
  readFileSync(new URL("./page-schema.json", import.meta.url), "utf8")
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(pageSchema);

// Actions whose `target` is an existing element id (so a missing target is a
// dangling-reference warning). NOTE: play_audio/stop_audio are intentionally NOT
// here — their target is an audio file URL, not an element id (render_v4 event
// dispatcher), so checking them produced false-positive warnings. `collapse`
// targets an element id and IS checked.
const ELEMENT_TARGET_ACTIONS = new Set([
  "open_popup", "close_popup", "scroll_to", "show_section", "hide_section",
  "show_hide_element", "change_tab", "collapse",
]);

const TOP_LEVEL_TYPES = new Set(["section", "dynamic_page", "popup"]);

// Fields whose renderer builds each <option> from `option.name`. A missing name
// crashes the published renderer (radio/checkbox-group call .replace/.normalize on
// it; select shows a blank option). The correct option shape is {id, name} — NOT
// the HTML-style {label, value}.
const OPTION_NAME_FIELDS = new Set(["select", "radio", "checkbox-group"]);

// Fields whose renderer ALWAYS emits unescapeHTML(field_placeholder) with NO
// default (renderSelect / renderCountrySelect / renderGroupSelectItem) — a missing
// field_placeholder throws "Cannot read properties of undefined (reading 'replace')"
// and the whole page fails to render.
const PLACEHOLDER_REQUIRED_FIELDS = new Set(["select", "country-select", "group-select-item"]);

// countdown's renderer indexes a fixed `lang` table by specials.language and then
// destructures the result: `const [d,h,m,s] = lang[language]`. Any value outside
// this set (e.g. a locale code like "vi"/"en") yields undefined → "is not iterable"
// and the whole page fails to render. 'custom' instead reads specials.customTranslation.
const COUNTDOWN_LANGUAGES = new Set(["vietnam", "english", "filipino", "khmer", "lao", "indonesian", "thai", "malay", "custom"]);

// countdown's specials.type must be one of these; any other value causes a TypeError
// when the renderer tries to look up timer mode (timer dead, page broken).
const COUNTDOWN_TYPES = new Set(["minute", "duration", "daily"]);

// Fixed canvas reference (matches vocab CANVAS) used for the layout/bounds check.
const CANVAS_DESKTOP = 960;
const CANVAS_MOBILE = 420;
const DEFAULT_SECTION_HEIGHT = 800;
const BOUNDS_TOL = 1; // px tolerance for rounding
const MAX_LAYOUT_WARNINGS = 12;

/** Coerce a style value (number or "300px"/"300") to a finite number, else undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Text height is estimated with REAL per-character font metrics + greedy
// word-wrap (./text-metrics.ts — honors fontWeight, letterSpacing,
// textTransform, lineHeight and the page's settings.fontGeneral). The old flat
// `chars × fontSize × 0.55 / width` guess under-counted UPPERCASE/bold
// headings and let hero-title overlaps slip through.

/**
 * True when a CSS background value paints SOMETHING (any color, gradient or
 * image — unlike isVividColor, neutrals count). Used by the svgMask check: a
 * mask over a background that paints nothing renders invisible.
 */
function isVisibleBackground(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (!s || s === "none" || s === "transparent" || s === "inherit" || s === "initial" || s === "unset") return false;
  const rgba = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(",").map((x) => parseFloat(x.trim()));
    if (parts.length >= 4 && Number.isFinite(parts[3]) && parts[3] <= 0.05) return false;
  }
  return true;
}

/**
 * True when a CSS color string carries real hue — i.e. NOT white/black/grey/
 * transparent. Used to flag a page that ships with no color at all (every band
 * white/neutral, no accent), which renders flat/"colorless". A gradient or image
 * background counts as color. Neutrals (white/black/grey) have ~0 channel spread.
 */
function isVividColor(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (!s || s === "transparent" || s === "none" || s === "inherit") return false;
  if (s.includes("gradient") || s.startsWith("url(")) return true;
  let r: number, g: number, b: number, a = 1;
  const rgba = s.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1].split(",").map((x) => parseFloat(x.trim()));
    [r, g, b] = parts;
    if (parts.length >= 4 && Number.isFinite(parts[3])) a = parts[3];
  } else {
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (!hex) return false;
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  if (a <= 0.05) return false; // fully transparent
  return Math.max(r, g, b) - Math.min(r, g, b) >= 16; // channel spread ⇒ has hue
}

/** Accept an object or a JSON string. Returns the parsed page or throws. */
export function coercePage(input: unknown): any {
  if (typeof input === "string") return JSON.parse(input);
  return input;
}

/**
 * Resolve an ajv instancePath (e.g. "/page/1/children/2/responsive/desktop") to
 * the deepest ELEMENT (object with string id + type) along it, plus the final
 * value the path lands on. The positional path alone is the #1 reason a model
 * patches the WRONG element after a schema error — indices are easy to miscount;
 * ids are not.
 */
function describeInstancePath(
  page: any,
  instancePath: string
): { id?: string; type?: string; value?: unknown } {
  if (!instancePath || instancePath === "/") return {};
  let cur: any = page;
  let el: any;
  for (const rawSeg of instancePath.split("/").slice(1)) {
    if (cur == null || typeof cur !== "object") return { id: el?.id, type: el?.type };
    const seg = rawSeg.replace(/~1/g, "/").replace(/~0/g, "~");
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
    if (cur && typeof cur === "object" && typeof cur.id === "string" && typeof cur.type === "string") el = cur;
  }
  return { id: el?.id, type: el?.type, value: cur };
}

/**
 * Format one ajv error as an ACTIONABLE message: positional path + ajv message,
 * plus the offending property name (additionalProperties), the actual bad value
 * (enum/type), and — crucially — the enclosing element's id/type so the fix can
 * target the right element by id on the first try. For stray-key errors it also
 * names the only op that can fix them: patch update MERGES, so deleting a key
 * needs op:'replace' (or, on a rebuild, simply omitting the key).
 */
function describeSchemaError(page: any, err: any): string {
  const path = err.instancePath || "/";
  let msg = `schema ${path} ${err.message}`;
  const at = describeInstancePath(page, path);
  const extraKey: string | undefined = err.params?.additionalProperty;
  if (extraKey) msg += ` — offending key: "${extraKey}"`;
  if (
    (err.keyword === "enum" || err.keyword === "type" || err.keyword === "const") &&
    (typeof at.value === "string" || typeof at.value === "number" || typeof at.value === "boolean")
  ) {
    msg += ` — got: ${JSON.stringify(at.value)}`;
  }
  if (at.id) msg += ` — element id="${at.id}"${at.type ? ` (type ${at.type})` : ""}`;
  if (extraKey && at.id) {
    msg +=
      `. patch_page op:'update' MERGES and cannot delete this key — fix via ` +
      `{op:'replace', id:'${at.id}', element:<the clean node without "${extraKey}">}` +
      (extraKey === "animation" ? ` (animation belongs in responsive.<bp>.config.animation, not responsive.<bp>)` : "");
  }
  return msg;
}

export function validatePage(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let page: any;
  try {
    page = coercePage(input);
  } catch (e: any) {
    return { valid: false, errors: [`Invalid JSON: ${e.message}`], warnings: [], stats: { sections: 0, popups: 0, elements: 0, ids: 0 } };
  }

  // 1) Structural (JSON Schema) — each error names the enclosing ELEMENT (id +
  //    type) and the offending key/value, so a fix can target the right element
  //    by id instead of decoding positional indices.
  const ok = validateSchema(page);
  if (!ok && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      errors.push(describeSchemaError(page, err));
    }
  }

  // 2) Semantic
  const ids = new Map<string, number>();
  const eventTargets: { from: string; action: string; target: string }[] = [];
  // option-level events (specials.options[].events_option) targeting an element id
  const optionTargets: { from: string; kind: string; target: string }[] = [];
  // survey/field cross-wiring (specials.connectedSurvey / connectedForm)
  const connectRefs: { from: string; key: string; target: string }[] = [];
  // form nodes — used to check field_name uniqueness within each form's scope
  const forms: any[] = [];
  let elementCount = 0;
  // Whether ANY element (section, button, text…) carries real color on either
  // breakpoint. A page where this stays false renders flat/colorless (warned once).
  let anyVividColor = false;

  // Page font for the real-metrics text measurement (per-element styles.fontFamily wins).
  const pageFont = page?.settings?.fontGeneral;

  const topList: any[] = Array.isArray(page?.page)
    ? page.page
    : page?.page
    ? [page.page]
    : [];

  if (topList.length === 0) errors.push('Root "page" must be a non-empty array of sections.');

  topList.forEach((sec, i) => {
    if (sec && sec.type && !TOP_LEVEL_TYPES.has(sec.type)) {
      warnings.push(`page[${i}] is type "${sec.type}"; top-level items are normally section/dynamic_page/popup.`);
    }
  });

  const walk = (node: any, path: string) => {
    if (!node || typeof node !== "object") return;
    elementCount++;

    if (typeof node.id === "string") ids.set(node.id, (ids.get(node.id) || 0) + 1);
    else errors.push(`${path}: missing string "id".`);

    const type = node.type;
    if (typeof type !== "string") errors.push(`${path}: missing "type".`);

    // responsive presence
    if (!node.responsive?.desktop || !node.responsive?.mobile) {
      errors.push(`${path} (${type}): must have responsive.desktop AND responsive.mobile.`);
    }

    // does this element put any real color on the page? (background / text / border)
    if (!anyVividColor) {
      for (const bp of ["desktop", "mobile"] as const) {
        const st = node.responsive?.[bp]?.styles;
        if (
          st &&
          (isVividColor(st.background) ||
            isVividColor(st.backgroundColor) ||
            isVividColor(st.color) ||
            isVividColor(st.borderColor))
        ) {
          anyVividColor = true;
          break;
        }
      }
    }

    // children only on containers
    if (Array.isArray(node.children) && node.children.length > 0 && type && !CONTAINER_TYPES.has(type)) {
      const idRef = typeof node.id === "string" ? node.id : "<id>";
      errors.push(
        `${path} (${type}, id=${idRef}): has children but "${type}" is not a container type. ` +
        `Fix via patch_page {op:'replace', id:'${idRef}', element:{type:'group', …}} — a group with the SAME box and the SAME children, ` +
        `plus a full-size rectangle (top:0, left:0, the group's width/height) inserted as the FIRST child carrying this element's ` +
        `background/borderRadius/boxShadow (a group's own background does NOT render on the live page; children's top/left are relative to the group).`
      );
    }

    // form fields need field_name
    if (type && FIELD_TYPES.has(type)) {
      const specials = node.specials;
      const fn = specials?.field_name;
      if (!fn || typeof fn !== "string" || fn.trim() === "") {
        warnings.push(`${path} (${type}): form input should have a unique specials.field_name.`);
      }

      // `field_placeholder` is the ONLY placeholder key the renderer reads. A stray
      // `placeholder` renders blank; a select with no field_placeholder crashes the
      // published renderer (unescapeHTML(undefined)).
      if (specials && typeof specials === "object") {
        const hasFieldPlaceholder = typeof specials.field_placeholder === "string";
        if (typeof specials.placeholder === "string" && !hasFieldPlaceholder) {
          warnings.push(`${path} (${type}): uses specials.placeholder — the renderer reads specials.field_placeholder. Rename "placeholder" → "field_placeholder".`);
        }
        if (PLACEHOLDER_REQUIRED_FIELDS.has(type) && !hasFieldPlaceholder) {
          errors.push(`${path} (${type}): needs a string specials.field_placeholder (this element's renderer crashes without it).`);
        }
      }

      // select/radio/checkbox-group render each option from option.name; a missing
      // name crashes the renderer (radio/checkbox-group) or renders blank (select).
      if (OPTION_NAME_FIELDS.has(type) && Array.isArray(specials?.options)) {
        specials.options.forEach((opt: any, oi: number) => {
          if (typeof opt?.name !== "string" || opt.name.trim() === "") {
            const keys = opt && typeof opt === "object" ? Object.keys(opt) : [];
            const hint = keys.includes("label") || keys.includes("value")
              ? ` Use {id, name} — not {label, value} (found keys: ${keys.join(", ")}).`
              : "";
            errors.push(`${path} (${type}): specials.options[${oi}] needs a non-empty string "name" (the visible option text).${hint}`);
          }
        });
      }
    }

    // custom CSS/class escape hatches (effects beyond an element's built-in specials).
    // Renderer gates BOTH on specials.customAdvance===true (render/build/index.js
    // custom_class + exportCss.js custom_css); without it they are silently dropped.
    // And custom_css is injected as plain DECLARATIONS inside #w-<id>{…}, so a
    // selector / :hover / @keyframes there corrupts the rule — those go in
    // settings.extra_css (full stylesheet, injected raw into <head>).
    {
      const sp: any = node.specials;
      if (sp && typeof sp === "object") {
        const hasCustom =
          (typeof sp.custom_css === "string" && sp.custom_css.trim() !== "") ||
          (typeof sp.custom_class === "string" && sp.custom_class.trim() !== "");
        if (hasCustom && sp.customAdvance !== true) {
          warnings.push(`${path} (${type}): specials.custom_css/custom_class is set but specials.customAdvance!==true — the renderer ignores both. Set "customAdvance": true.`);
        }
        if (typeof sp.custom_css === "string" && /[{}]|@keyframes|:hover|:focus|::/.test(sp.custom_css)) {
          warnings.push(`${path} (${type}): specials.custom_css is injected as plain declarations inside #w-${node.id}{…} — a selector/:hover/@keyframes/media-query there breaks the rule. Keep declarations only here (e.g. "box-shadow:0 20px 40px rgba(0,0,0,.08);backdrop-filter:blur(20px);"); put hover/keyframes/media rules in settings.extra_css targeting #w-${node.id} (or a specials.custom_class).`);
        }
      }
    }

    // animation contract — checked per breakpoint
    // Source: landing_page_build/render/build/animate.js (animatable type list)
    //         landing_page_backend/assets/editor/main/traits/TraitAnimation.vue (name set)
    for (const bp of ["desktop", "mobile"] as const) {
      const anim = node.responsive?.[bp]?.config?.animation;
      if (!anim || typeof anim !== "object") continue;
      const animName: unknown = anim.name;
      if (typeof animName !== "string" || animName === "none") continue;
      // name is present and not 'none' — check type animatability first
      if (type && !ANIMATABLE_TYPES.has(type)) {
        errors.push(
          `${path} (${type}) [${bp}]: the renderer cannot animate type "${type}" — ` +
          `the element will render stuck/dim in its pre-animation state. ` +
          `Fix: patch_page setting config:{${bp}:{animation:{name:'none',delay:0,duration:3,repeat:null}}} ` +
          `or move the animation onto an animatable wrapper (e.g. type "group").`
        );
      }
      // name must be in the known animate.css set
      if (!ANIMATION_NAMES.has(animName)) {
        errors.push(
          `${path} (${type ?? "?"}) [${bp}]: animation name "${animName}" is not in the editor's ` +
          `animate.css set — the keyframe is unknown and the animation never runs. ` +
          `Valid examples: fadeInUp, slideInLeft, zoomIn, bounceIn, backInDown, flipInX, lightSpeedInLeft, rotateIn, rollIn, jackInTheBox.`
        );
      }
    }

    // styles.opacity < 1 renders the element permanently faded (exportCss.js emits opacity:<v>)
    for (const bp of ["desktop", "mobile"] as const) {
      const styles = node.responsive?.[bp]?.styles;
      if (!styles || typeof styles !== "object") continue;
      const raw = (styles as any).opacity;
      if (raw === undefined || raw === null) continue;
      const v = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
      if (!Number.isFinite(v)) continue; // non-numeric garbage → schema territory, skip
      if (v < 1) {
        warnings.push(
          `${path} (${type ?? "?"}) [${bp}]: styles.opacity=${v} — ` +
          `the element will render permanently faded. ` +
          `If unintended, fix via patch_page({op:'update',id:'${node.id ?? "?"}',styles:{${bp}:{opacity:1}}}); ` +
          `for a muted color use rgba() alpha on the color/background property instead.`
        );
      }
    }

    // countdown.language must be a key the renderer's lang table knows (or 'custom');
    // anything else (e.g. a locale code "vi"/"en") crashes the renderer with
    // "is not iterable" when it destructures lang[language].
    if (type === "countdown") {
      const lang = node.specials?.language;
      if (typeof lang === "string" && !COUNTDOWN_LANGUAGES.has(lang)) {
        errors.push(`${path} (countdown): specials.language="${lang}" is not supported and crashes the renderer. Use one of: ${[...COUNTDOWN_LANGUAGES].join(", ")} (use "custom" + specials.customTranslation for other languages).`);
      }
      // countdown.type must be one of the three mode keys; anything else → TypeError (timer dead).
      const cdType = node.specials?.type;
      if (cdType !== undefined && !COUNTDOWN_TYPES.has(cdType)) {
        errors.push(`${path} (countdown): specials.type="${cdType}" is not a valid countdown mode — the timer will throw a TypeError and remain dead. Must be one of: minute, duration, daily.`);
      }
      if (cdType === undefined || cdType === null || cdType === "") {
        errors.push(`${path} (countdown): specials.type is missing — must be 'minute', 'duration', or 'daily'.`);
      }
    }

    // image-block: if neither specials.src nor a url() in styles.background exists
    // on a breakpoint, the live publisher has nothing to paint — renders blank.
    // (The normalization pass in landingDomain.expand auto-derives background from
    // src when src is set; this warning fires only if both are absent.)
    if (type === "image-block") {
      for (const bp of ["desktop", "mobile"] as const) {
        const styles = node.responsive?.[bp]?.styles;
        const src = node.specials?.src;
        const hasSrc = typeof src === "string" && src.trim() !== "";
        const hasBgUrl = typeof styles?.background === "string" && styles.background.includes("url(");
        if (!hasSrc && !hasBgUrl) {
          warnings.push(`${path} (image-block) [${bp}]: neither specials.src nor a url() in styles.background is set — the live published page renders blank here. Set specials.src to an image URL.`);
        }
      }
    }

    // text-block: styles.background activates gradient-text-fill mode
    // (emits -webkit-text-fill-color:transparent); without -webkitBackgroundClip:'text'
    // the glyphs go invisible on the live page. Warn when background is set but the
    // clip key is absent.
    if (type === "text-block") {
      for (const bp of ["desktop", "mobile"] as const) {
        const styles = node.responsive?.[bp]?.styles;
        if (!styles || typeof styles !== "object") continue;
        const hasBg = typeof styles.background === "string" && styles.background.trim() !== "";
        const hasClip = typeof styles["-webkitBackgroundClip"] === "string";
        if (hasBg && !hasClip) {
          warnings.push(
            `${path} (text-block) [${bp}]: styles.background is set (gradient text-fill mode) but styles['-webkitBackgroundClip'] is missing — the text glyphs will be invisible on the live page. Add styles['-webkitBackgroundClip']:'text', or use styles.backgroundTxt for a box background instead.`
          );
        }
      }
      // Emoji-as-icon: a text-block whose visible content is ONLY emoji is a
      // standalone keyboard-emoji icon (🎯💼📱✅⭐) — the guide bans these on
      // cards. Emoji inline within a sentence does not trip this (the text has
      // other characters).
      const rawText = node.specials?.text;
      if (typeof rawText === "string") {
        const visible = rawText.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim();
        const onlyEmoji =
          visible !== "" &&
          /\p{Extended_Pictographic}/u.test(visible) &&
          // allowed alongside pictographs: emoji components, ZWJ (200D),
          // variation selector-16 (FE0F), keycap (20E3), whitespace
          /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|[\u200D\uFE0F\u20E3\s])+$/u.test(visible);
        if (onlyEmoji) {
          warnings.push(
            `${path} (text-block): specials.text is only the emoji "${visible}" — keyboard emoji as standalone icons look unprofessional and render inconsistently across devices. Use a rectangle with per-breakpoint config.svgMask (raw <svg> string) + styles.background set to the brand accent color instead (see the rectangle element's example). Emoji are fine inline within sentences, never as card icons.`
          );
        }

        // Wrapped-text overflow: live text height is AUTO — text that wraps to
        // more lines than the declared box spills DOWN and overlaps the element
        // below (the classic "2-line card title over the card body" defect).
        // Slack is capped at 24px: a full-line slack on a 40px heading (56px)
        // is exactly what lets the most common defect — a 2-line H2 on a
        // 1-line-tall box — slip through, while body text (16px → 22px line)
        // keeps its old tolerance against the rough estimate.
        for (const bp of ["desktop", "mobile"] as const) {
          const styles = node.responsive?.[bp]?.styles;
          const w = num(styles?.width);
          const h = num(styles?.height);
          const fs = num(styles?.fontSize) ?? 16;
          if (!w || !h) continue;
          const est = estTextHeightPx(rawText, styles, pageFont);
          if (est == null) continue;
          if (est > h + Math.min(fs * 1.4, 24)) {
            warnings.push(
              `${path} (text-block) [${bp}]: text wraps to ~${est}px but the box is only ${h}px tall — live text height is AUTO, so it will spill down and overlap the element below. Set height ≈ ${est}px and push the elements below down (measured with real font metrics — UPPERCASE/bold text wraps to more lines than it looks).`
            );
          }
        }
      }
    }

    // editor-blog: specials.html containing HTML-escaped markup (heuristic: '&lt;'
    // present) will render as literal tag strings on the live page. The publisher
    // injects html RAW with no unescape — store raw HTML, not escaped HTML.
    if (type === "editor-blog") {
      const html = node.specials?.html;
      if (typeof html === "string" && html.includes("&lt;")) {
        warnings.push(
          `${path} (editor-blog): specials.html appears to contain escaped HTML ('&lt;' found) — the publisher injects html RAW so escaped markup will render as literal '&lt;p&gt;' text on the live page. Store raw HTML (e.g. '<p>Hello</p>' not '&lt;p&gt;Hello&lt;/p&gt;').`
        );
      }
    }

    // rectangle + config.svgMask: the SVG is only a MASK — the renderer (build
    // host exportCss.js AND the editor's Rectangle.vue) base64-encodes it into
    // -webkit-mask-image and paints styles.background through it. The SVG's own
    // fill/stroke colors are IGNORED, so an icon-rectangle without a visible
    // styles.background renders INVISIBLE (the #1 "my icon doesn't show" bug).
    // Each breakpoint's config is read separately with NO fallback.
    if (type === "rectangle") {
      const maskD = node.responsive?.desktop?.config?.svgMask;
      const maskM = node.responsive?.mobile?.config?.svgMask;
      // svgMask put where the renderer never reads it (specials / styles).
      if (!maskD && !maskM) {
        const stray =
          (node.specials?.svgMask && "specials") ||
          (node.responsive?.desktop?.styles?.svgMask && "responsive.desktop.styles") ||
          (node.responsive?.mobile?.styles?.svgMask && "responsive.mobile.styles");
        if (stray) {
          warnings.push(
            `${path} (rectangle): svgMask found in ${stray} — the renderer ONLY reads responsive.<bp>.config.svgMask (per breakpoint), so this shows a plain rectangle. Move it into BOTH desktop and mobile config.`
          );
        }
      }
      if (maskD || maskM) {
        // Malformed / non-painting SVG → the mask fails and the icon is invisible.
        for (const bp of ["desktop", "mobile"] as const) {
          const mask = node.responsive?.[bp]?.config?.svgMask;
          if (typeof mask !== "string" || mask === "") continue;
          if (!mask.startsWith("<svg")) {
            warnings.push(
              `${path} (rectangle) [${bp}]: config.svgMask must start EXACTLY with '<svg' — the renderer splices preserveAspectRatio into the first characters, so leading whitespace or an '<?xml' prolog corrupts the SVG and the mask fails (icon renders INVISIBLE). Trim it to start with '<svg'.`
            );
            continue;
          }
          if (!/viewBox\s*=/i.test(mask)) {
            warnings.push(
              `${path} (rectangle) [${bp}]: config.svgMask has no viewBox — without it the SVG cannot scale to the element box (icon renders cropped or blank). Add viewBox='0 0 <w> <h>' to the <svg> tag.`
            );
          }
          if (!/<(path|rect|circle|ellipse|polygon|polyline|line|use|text)\b/i.test(mask)) {
            warnings.push(
              `${path} (rectangle) [${bp}]: config.svgMask contains no shape element (path/rect/circle/polygon/…) — an SVG that paints nothing masks everything away (icon renders INVISIBLE). Use an SVG whose shapes are filled or stroked.`
            );
          }
        }
        if (!!maskD !== !!maskM) {
          const has = maskD ? "desktop" : "mobile";
          const missing = maskD ? "mobile" : "desktop";
          warnings.push(
            `${path} (rectangle): config.svgMask is set on ${has} only — the renderer reads each breakpoint's config separately (no fallback), so ${missing} shows a plain rectangle instead of the icon. Copy the same svgMask into responsive.${missing}.config.`
          );
        }
        for (const bp of ["desktop", "mobile"] as const) {
          if (!node.responsive?.[bp]?.config?.svgMask) continue;
          const bg = node.responsive?.[bp]?.styles?.background;
          if (!isVisibleBackground(bg)) {
            warnings.push(
              `${path} (rectangle) [${bp}]: config.svgMask is set but styles.background is ${typeof bg === "string" && bg.trim() ? `"${bg}"` : "missing"} — the SVG is only a MASK: visible pixels come entirely from styles.background (the SVG's own fill/stroke is ignored), so this icon renders INVISIBLE. Set styles.background to the icon color (e.g. rgba(34,197,94,1) or a gradient).`
            );
          }
        }
      }
    }

    // video: required specials by typeVideo.
    if (type === "video") {
      const tv = node.specials?.typeVideo;
      if (tv === "webcake" || tv === "vimeo") {
        const vid = node.specials?.video;
        if (!vid || typeof vid !== "string" || vid.trim() === "") {
          errors.push(
            `${path} (video): typeVideo='${tv}' requires specials.video (${tv === "vimeo" ? "full Vimeo URL" : "webcake video URL"}) — missing causes a TypeError that breaks the whole page on load.`
          );
        }
      }
      if (tv === "youtube") {
        const id = node.specials?.id;
        if (!id || typeof id !== "string" || id.trim() === "") {
          errors.push(
            `${path} (video): typeVideo='youtube' requires specials.id (the YouTube video ID, e.g. 'dQw4w9WgXcQ') — missing causes the player to fail to initialize.`
          );
        }
        const vid = node.specials?.video;
        if (typeof vid === "string" && vid.trim() !== "") {
          // a non-URL string in specials.video crashes new URL() during hydration
          try { new URL(vid); } catch {
            warnings.push(
              `${path} (video): typeVideo='youtube' has specials.video='${vid}' which is not a valid URL — this can crash new URL() during page hydration. For YouTube, only specials.id is needed; leave specials.video unset or set it to a valid URL.`
            );
          }
        }
      }
    }

    // list-paragraph: missing specials.text renders the literal string "undefined".
    if (type === "list-paragraph") {
      const txt = node.specials?.text;
      if (txt === undefined || txt === null || txt === "") {
        warnings.push(`${path} (list-paragraph): specials.text is missing or empty — the live renderer renders the literal string 'undefined'. Set specials.text to a string of <li>item</li> entries.`);
      }
    }

    // type 'checkbox' never renders on the published page — warn immediately.
    if (type === "checkbox") {
      warnings.push(`${path} (checkbox): renders blank on the published page and never submits — the published renderer has no case for this type. Use checkbox-group with a single option instead.`);
    }

    // address.field_name must be exactly 'province_id/district_id/commune_id'; any
    // other value causes the dropdowns to never populate (renderer splits on '/').
    if (type === "address") {
      const fn = node.specials?.field_name;
      if (fn !== "province_id/district_id/commune_id") {
        errors.push(`${path} (address): specials.field_name must be exactly "province_id/district_id/commune_id" (got "${fn ?? "missing"}") — the renderer splits on '/' to derive the three internal select names; any other value causes dropdowns to never populate.`);
      }
    }

    // verify-code: split-input mode (default) only renders for length_otp 4 or 6.
    if (type === "verify-code") {
      const otpInputType = node.specials?.type_otp_input;
      const isSplit = !otpInputType || otpInputType !== "one-input";
      if (isSplit) {
        const len = node.specials?.length_otp;
        if (len !== 4 && len !== 6) {
          errors.push(`${path} (verify-code): type_otp_input is 'split-input' (default) but length_otp=${len ?? "missing"} — split-input only renders OTP boxes for length_otp 4 or 6; any other value renders nothing. Use type_otp_input:'one-input' for other lengths.`);
        }
      }
    }

    // random-number: all three numbers are required; missing any → renders 'NaN'.
    if (type === "random-number") {
      const sp = node.specials ?? {};
      const bad = (["startNumber", "endNumber", "jumpNumber"] as const).filter((k) => {
        const v = sp[k];
        return v === undefined || v === null || (typeof v !== "number" && isNaN(Number(v)));
      });
      if (bad.length > 0) {
        errors.push(`${path} (random-number): specials.${bad.join(", ")} missing or non-numeric — renders literal 'NaN'. All three (startNumber, endNumber, jumpNumber) are required.`);
      }
    }

    // spin-wheel: segment percents must sum to 100; also validate message when popup='default'.
    if (type === "spin-wheel") {
      const codeStr: unknown = node.specials?.code;
      const codeDataStr: unknown = node.specials?.codeDataset;
      const hasCode = typeof codeStr === "string" && codeStr.trim() !== "";
      const hasCodeDataset = typeof codeDataStr === "string" && codeDataStr.trim() !== "";
      if (hasCode || hasCodeDataset) {
        const source = hasCode ? (codeStr as string) : (codeDataStr as string);
        const lines = source.split("\n").map((l: string) => l.trim()).filter(Boolean);
        const percents = lines.map((l: string) => {
          const parts = l.split("|");
          return parts.length >= 3 ? parseFloat(parts[2]) : NaN;
        });
        const allNumeric = percents.every((p: number) => Number.isFinite(p));
        if (allNumeric && percents.length > 0) {
          const total = percents.reduce((a: number, b: number) => a + b, 0);
          if (Math.abs(total - 100) > 0.01) {
            errors.push(`${path} (spin-wheel): segment percents sum to ${total.toFixed(2)}, not 100 — the winner-selection algorithm throws a TypeError on spin. Adjust segment percents so they sum to exactly 100.`);
          }
        }
      }
    }

    // survey: option.title is required unless type=='image'.
    if (type === "survey") {
      const surveyType = node.specials?.type;
      if (surveyType !== "image" && Array.isArray(node.specials?.options)) {
        node.specials.options.forEach((opt: any, oi: number) => {
          if (!opt || typeof opt !== "object") return;
          if (!opt.title || (typeof opt.title === "string" && opt.title.trim() === "")) {
            errors.push(`${path} (survey): options[${oi}] is missing title — causes a TypeError during page build when type is not 'image'. Set option.title or change specials.type to 'image'.`);
          }
        });
      }
    }

    // grid without a datasetId is permanently invisible on the live published page
    // (the renderer hides it pending a dataset fetch that never arrives).
    if (type === "grid") {
      const dsId = node.specials?.datasetId;
      if (!dsId || typeof dsId !== "string" || dsId.trim() === "") {
        warnings.push(`${path} (grid): specials.datasetId is missing — the grid is hidden (opacity 0, off-canvas) on the published page until a successful dataset fetch that never arrives. Set a valid datasetId or use groups for static card layouts.`);
      }
    }

    // cart-items placed on the page renders empty on publish — the type-switch in
    // the publisher has no cart-items case (default ''); render_v4 has no
    // cart-items class either. The real cart UI is WCart's floating drawer
    // (div.cart_view) appended beside the cart icon, not by this element.
    if (type === "cart-items") {
      warnings.push(`${path} (cart-items): renders empty on the published page — the cart drawer is rendered by WCart beside the cart icon, not by this element. Remove it; configure cartConfigs.checkoutElements['CART-ITEM'] for drawer font sizes instead.`);
    }

    // collect events
    if (Array.isArray(node.events)) {
      for (const ev of node.events) {
        if (ev && typeof ev.action === "string" && typeof ev.target === "string") {
          eventTargets.push({ from: node.id ?? path, action: ev.action, target: ev.target });
        }
      }
    }

    // collect form-data bindings: option-level events (showhide/collapse promoId)
    // and survey/field cross-wiring; and remember form scopes for field_name checks.
    const sp = node.specials;
    if (sp && typeof sp === "object") {
      if (Array.isArray(sp.options)) {
        for (const opt of sp.options) {
          if (!opt || !Array.isArray(opt.events_option)) continue;
          for (const ev of opt.events_option) {
            if (
              ev &&
              (ev.type === "showhide" || ev.type === "collapse") &&
              typeof ev.promoId === "string" &&
              ev.promoId.trim() !== ""
            ) {
              optionTargets.push({ from: node.id ?? path, kind: ev.type, target: ev.promoId });
            }
          }
        }
      }
      for (const key of ["connectedSurvey", "connectedForm"] as const) {
        const v = sp[key];
        if (typeof v === "string" && v.trim() !== "") {
          connectRefs.push({ from: node.id ?? path, key, target: v });
        }
      }
    }
    if (type === "form") forms.push(node);

    if (Array.isArray(node.children)) {
      node.children.forEach((c: any, idx: number) => walk(c, `${path}.children[${idx}]`));
    }
  };

  topList.forEach((sec, i) => walk(sec, `page[${i}]`));

  // popups + dynamic_pages are SEPARATE top-level element arrays (not inside `page`)
  const popups: any[] = Array.isArray(page?.popup) ? page.popup : [];
  const dynPages: any[] = Array.isArray(page?.dynamic_pages) ? page.dynamic_pages : [];
  popups.forEach((p, i) => {
    if (p && p.type && p.type !== "popup") {
      warnings.push(`popup[${i}] has type "${p.type}"; entries of "popup" should be type "popup".`);
    }
    walk(p, `popup[${i}]`);
  });
  dynPages.forEach((p, i) => walk(p, `dynamic_pages[${i}]`));

  // duplicate ids
  for (const [id, count] of ids) {
    if (count > 1) errors.push(`Duplicate id "${id}" used ${count} times — ids must be unique.`);
  }

  // Does `target` fail to resolve to any element id? (ids may be stored with or
  // without the runtime `w-`/`#w-` prefix.)
  const danglesId = (target: string) => {
    const cleaned = target.replace(/^#?w-/, "");
    return !ids.has(target) && !ids.has(cleaned);
  };

  // dangling element-target events
  for (const t of eventTargets) {
    if (ELEMENT_TARGET_ACTIONS.has(t.action)) {
      if (danglesId(t.target)) {
        warnings.push(`event on "${t.from}" action="${t.action}" target="${t.target}" does not match any element id.`);
      }
    } else if (t.action === "set_field_value" && /^#?w-/.test(t.target) && danglesId(t.target)) {
      // set_field_value target is a field_name OR an element id; only an explicit
      // element ref (w- prefix) can dangle — a bare field_name is not an id.
      warnings.push(`event on "${t.from}" action="set_field_value" target="${t.target}" looks like an element id but matches none.`);
    }
  }

  // dangling option-level event targets (specials.options[].events_option promoId)
  for (const t of optionTargets) {
    if (danglesId(t.target)) {
      warnings.push(`option event on "${t.from}" type="${t.kind}" promoId="${t.target}" does not match any element id.`);
    }
  }

  // dangling survey/field cross-wiring
  for (const r of connectRefs) {
    if (danglesId(r.target)) {
      warnings.push(`"${r.from}" specials.${r.key}="${r.target}" does not match any element id.`);
    }
  }

  // field_name uniqueness WITHIN each form — duplicate names collide in the
  // submitted data. (A nested form is its own data scope, so stop at one.)
  // Also: warn on fields nested deeper than a direct child of the form (they
  // validate but never submit — the form's submit loop iterates children only).
  const collectFieldNames = (n: any, acc: string[]) => {
    if (!n || !Array.isArray(n.children)) return;
    for (const c of n.children) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "form") continue;
      const fn = c.specials?.field_name;
      if (typeof fn === "string" && fn.trim() !== "") acc.push(fn.trim());
      collectFieldNames(c, acc);
    }
  };
  for (const form of forms) {
    const names: string[] = [];
    collectFieldNames(form, names);
    const counts = new Map<string, number>();
    for (const fn of names) counts.set(fn, (counts.get(fn) || 0) + 1);
    for (const [fn, count] of counts) {
      if (count > 1) {
        warnings.push(
          `form "${form.id ?? "?"}": field_name "${fn}" used ${count} times — inputs in one form need a unique field_name (data collides on submit).`
        );
      }
    }

    // submit_success must be the NUMBER 1 or 2, not a string.
    const ss = form.specials?.submit_success;
    if (ss !== undefined && typeof ss === "string") {
      warnings.push(`form "${form.id ?? "?"}": specials.submit_success is a string "${ss}" — must be the NUMBER 1 (popup) or 2 (redirect). A string silently falls to the redirect branch (no-op).`);
    }
    // submit_success===1 needs a popup_target that resolves to a popup element id.
    if (ss === 1) {
      const pt = form.specials?.popup_target;
      if (!pt || typeof pt !== "string" || pt.trim() === "") {
        warnings.push(`form "${form.id ?? "?"}": submit_success=1 but popup_target is missing — submit succeeds with zero user feedback. Set popup_target to the id of a popup element.`);
      } else if (danglesId(pt)) {
        warnings.push(`form "${form.id ?? "?"}": submit_success=1 but popup_target="${pt}" does not match any element id — submit succeeds with zero user feedback.`);
      }
    }
    // submit_success===2 needs a redirect_url.
    if (ss === 2) {
      const ru = form.specials?.redirect_url;
      if (!ru || typeof ru !== "string" || ru.trim() === "") {
        warnings.push(`form "${form.id ?? "?"}": submit_success=2 but redirect_url is missing — redirect destination unknown, submit will be a no-op.`);
      }
    }

    // Warn on FIELD_TYPES elements that are descendants of the form but NOT direct children.
    // The form's submit loop only iterates form.children (no recursion), so nested fields
    // validate but never submit.
    const checkNestedFields = (parent: any, depth: number) => {
      if (!parent || !Array.isArray(parent.children)) return;
      for (const c of parent.children) {
        if (!c || typeof c !== "object") continue;
        if (c.type === "form") continue; // nested form is its own scope
        if (depth > 0 && FIELD_TYPES.has(c.type)) {
          warnings.push(
            `form "${form.id ?? "?"}": field "${c.id ?? "?"}" (${c.type}) is nested inside "${parent.type}" — it will validate but never submit. Make it a direct child of the form.`
          );
        }
        checkNestedFields(c, depth + 1);
      }
    };
    checkNestedFields(form, 0);
  }

  // 3) Layout bounds — flag children that fall off their container's canvas (a
  //    common cause of "off-center / misaligned" pages). Warnings only.
  let layoutWarnings = 0;
  const widthSection = page?.settings?.width_section ?? {};
  const rootCanvasD = num(widthSection.desktop) ?? CANVAS_DESKTOP;
  const rootCanvasM = num(widthSection.mobile) ?? CANVAS_MOBILE;

  const checkBounds = (
    container: any,
    canvasWD: number,
    canvasHD: number,
    canvasWM: number,
    canvasHM: number,
    path: string
  ) => {
    if (!container || !Array.isArray(container.children)) return;
    container.children.forEach((child: any, idx: number) => {
      if (!child || typeof child !== "object") return;
      const cpath = `${path}.children[${idx}]`;
      const label = `${cpath} (${child.type ?? "?"})`;

      for (const [bp, canvasW, canvasH] of [
        ["desktop", canvasWD, canvasHD] as const,
        ["mobile", canvasWM, canvasHM] as const,
      ]) {
        const styles = child?.responsive?.[bp]?.styles;
        if (!styles) continue;
        const left = num(styles.left) ?? 0;
        const top = num(styles.top) ?? 0;
        const width = num(styles.width);
        const height = num(styles.height);

        if (layoutWarnings < MAX_LAYOUT_WARNINGS) {
          if (left < -BOUNDS_TOL) {
            warnings.push(`${label} ${bp}: left=${left} is negative (off-canvas left). Set left ≥ 0.`);
            layoutWarnings++;
          } else if (width != null && left + width > canvasW + BOUNDS_TOL) {
            warnings.push(
              `${label} ${bp}: left+width=${left + width} exceeds canvas ${canvasW} (overflows right). To center: left = round((${canvasW} - ${width})/2) = ${Math.round((canvasW - width) / 2)}.`
            );
            layoutWarnings++;
          }
        }
        if (layoutWarnings < MAX_LAYOUT_WARNINGS && top < -BOUNDS_TOL) {
          warnings.push(`${label} ${bp}: top=${top} is negative (above its section). Set top ≥ 0.`);
          layoutWarnings++;
        }
        if (
          layoutWarnings < MAX_LAYOUT_WARNINGS &&
          canvasH > 0 &&
          height != null &&
          top + height > canvasH + BOUNDS_TOL
        ) {
          warnings.push(
            `${label} ${bp}: top+height=${top + height} exceeds container height ${canvasH} (extends below). Move it up or increase the section/container height.`
          );
          layoutWarnings++;
        }
      }

      // Recurse into nested containers using the child's own box as the canvas.
      if (Array.isArray(child.children) && child.children.length > 0) {
        const ds = child?.responsive?.desktop?.styles ?? {};
        const ms = child?.responsive?.mobile?.styles ?? {};
        checkBounds(
          child,
          num(ds.width) ?? canvasWD,
          num(ds.height) ?? canvasHD,
          num(ms.width) ?? canvasWM,
          num(ms.height) ?? canvasHM,
          cpath
        );
      }
    });
  };

  topList.forEach((sec, i) => {
    const ds = sec?.responsive?.desktop?.styles ?? {};
    const ms = sec?.responsive?.mobile?.styles ?? {};
    checkBounds(
      sec,
      rootCanvasD,
      num(ds.height) ?? DEFAULT_SECTION_HEIGHT,
      rootCanvasM,
      num(ms.height) ?? DEFAULT_SECTION_HEIGHT,
      `page[${i}]`
    );
  });

  // 3c) Wrapped-text collision — live text height is AUTO, so a text-block whose
  //     content wraps past its declared box spills DOWN. When the declared layout
  //     puts a sibling directly below (boxes NOT overlapping — overlapping boxes
  //     are intentional layering), the spill lands ON that sibling: the classic
  //     broken-looking page of a 2-line H2 over its subheading or a wrapped card
  //     title over the card body. The own-box check (section 1) flags the text
  //     block itself; this geometric pass names the VICTIM and the exact fix.
  let overlapWarnings = 0;
  const MAX_OVERLAP_WARNINGS = 12;
  const checkTextOverlap = (container: any, path: string) => {
    if (!container || !Array.isArray(container.children)) return;
    const kids = container.children;
    kids.forEach((child: any, idx: number) => {
      if (!child || typeof child !== "object") return;
      const cpath = `${path}.children[${idx}]`;
      const rawText = child.type === "text-block" ? child.specials?.text : undefined;
      if (typeof rawText === "string") {
        for (const bp of ["desktop", "mobile"] as const) {
          if (overlapWarnings >= MAX_OVERLAP_WARNINGS) break;
          const s = child.responsive?.[bp]?.styles;
          const top = num(s?.top);
          const left = num(s?.left) ?? 0;
          const w = num(s?.width);
          const h = num(s?.height);
          if (top == null || h == null || !w) continue;
          const est = estTextHeightPx(rawText, s, pageFont);
          if (est == null || est <= h) continue;
          const estBottom = top + est;
          // nearest sibling the declared layout places below this text block
          let hit: { p: string; t: number; type: string } | undefined;
          kids.forEach((sib: any, j: number) => {
            if (j === idx || !sib || typeof sib !== "object") return;
            const ss = sib.responsive?.[bp]?.styles;
            const st = num(ss?.top);
            const sl = num(ss?.left) ?? 0;
            const sw = num(ss?.width);
            if (st == null || sw == null) return;
            if (st < top + h) return; // declared boxes overlap or sibling is above → layering, skip
            if (sl + sw <= left || sl >= left + w) return; // no horizontal intersection
            if (estBottom > st + 4 && (!hit || st < hit.t)) hit = { p: `${path}.children[${j}]`, t: st, type: sib.type ?? "?" };
          });
          if (hit) {
            warnings.push(
              `${cpath} (text-block) [${bp}]: wrapped text renders ~${est}px tall (declared ${h}px) and will spill onto ${hit.p} (${hit.type}, top=${hit.t}) below it. Set this block's height ≈ ${est} and move the elements below to top ≥ ${estBottom + 8}.`
            );
            overlapWarnings++;
          }
        }
      }
      if (Array.isArray(child.children) && child.children.length > 0) checkTextOverlap(child, cpath);
    });
  };
  topList.forEach((sec, i) => checkTextOverlap(sec, `page[${i}]`));

  // 3c2) Pill/badge alignment — the classic "background hugging a label"
  //      pattern is a rounded rectangle with a single-line text-block layered
  //      on top. The renderer draws text-blocks with height:AUTO from `top`
  //      (declared height is ignored), so the glyph row sits at top + lineBox/2
  //      — models that eyeball `top` against the pill leave the text visibly
  //      off-center. With real font metrics we can check both axes and name
  //      the exact corrected coordinates.
  let pillWarnings = 0;
  const MAX_PILL_WARNINGS = 12;
  const isPillRect = (sib: any, bp: "desktop" | "mobile") => {
    if (sib?.type !== "rectangle") return false;
    if (sib.responsive?.[bp]?.config?.svgMask) return false; // icon, not a pill
    const ss = sib.responsive?.[bp]?.styles;
    const br = ss?.borderRadius;
    const hasRadius = br != null && String(br).trim() !== "" && parseFloat(String(br)) !== 0;
    const h = num(ss?.height);
    const w = num(ss?.width);
    return hasRadius && h != null && h <= 88 && w != null && w <= 600;
  };
  const checkPillAlignment = (container: any, path: string) => {
    if (!container || !Array.isArray(container.children)) return;
    const kids = container.children;
    kids.forEach((child: any, idx: number) => {
      if (!child || typeof child !== "object") return;
      const cpath = `${path}.children[${idx}]`;
      const rawText = child.type === "text-block" ? child.specials?.text : undefined;
      if (typeof rawText === "string") {
        for (const bp of ["desktop", "mobile"] as const) {
          if (pillWarnings >= MAX_PILL_WARNINGS) break;
          const s = child.responsive?.[bp]?.styles;
          const top = num(s?.top);
          const left = num(s?.left);
          const w = num(s?.width);
          if (top == null || left == null || !w) continue;
          const m = measureTextBlock(rawText, s, pageFont);
          if (!m || m.lines !== 1) continue; // pill labels are single-line
          // the pill: a rounded rectangle sibling whose box contains the text row
          const pill = kids.find((sib: any, j: number) => {
            if (j === idx || !isPillRect(sib, bp)) return false;
            const ss = sib.responsive[bp].styles;
            const rt = num(ss?.top), rl = num(ss?.left), rw = num(ss?.width), rh = num(ss?.height);
            if (rt == null || rl == null || !rw || !rh) return false;
            return top >= rt - 2 && top < rt + rh && left >= rl - rw * 0.25 && left + w <= rl + rw * 1.25;
          });
          if (!pill) continue;
          const ps = pill.responsive[bp].styles;
          const pTop = num(ps.top)!, pLeft = num(ps.left)!, pW = num(ps.width)!, pH = num(ps.height)!;

          // vertical: glyph row center vs pill center
          const dy = Math.round(top + m.lineHeightPx / 2 - (pTop + pH / 2));
          if (Math.abs(dy) > 4) {
            warnings.push(
              `${cpath} (text-block) [${bp}]: badge label sits ~${Math.abs(dy)}px ${dy > 0 ? "BELOW" : "ABOVE"} the center of its pill (${pill.id}) — text-blocks render with height:auto from \`top\` (declared height is ignored), so center the LINE BOX, not the styles.height: set top = ${Math.round(pTop + (pH - m.lineHeightPx) / 2)} (pill top ${pTop} + (pill height ${pH} − line box ${Math.round(m.lineHeightPx)})/2).`
            );
            pillWarnings++;
          }

          // text wider than the pill → spills out both ends
          if (m.maxLineWidthPx > pW - 8) {
            warnings.push(
              `${cpath} (text-block) [${bp}]: badge label is ~${Math.round(m.maxLineWidthPx)}px wide but its pill (${pill.id}) is only ${pW}px — the text spills past the rounded background. Set the pill width ≈ ${Math.ceil(m.maxLineWidthPx + 32)} (text + 16px padding each side) and re-center it.`
            );
            pillWarnings++;
          } else {
            // horizontal: painted text center vs pill center
            const centered = typeof s?.textAlign === "string" && /center/i.test(s.textAlign);
            const tCx = centered ? left + w / 2 : left + m.maxLineWidthPx / 2;
            const dx = Math.round(tCx - (pLeft + pW / 2));
            if (Math.abs(dx) > 6) {
              const fixLeft = centered ? Math.round(pLeft + pW / 2 - w / 2) : Math.round(pLeft + (pW - m.maxLineWidthPx) / 2);
              warnings.push(
                `${cpath} (text-block) [${bp}]: badge label is ~${Math.abs(dx)}px ${dx > 0 ? "RIGHT" : "LEFT"} of its pill's center (${pill.id}) — set left = ${fixLeft}${centered ? "" : " (or add textAlign:'center' and center the box on the pill)"}.`
              );
              pillWarnings++;
            }
          }
        }
      }
      if (Array.isArray(child.children) && child.children.length > 0) checkPillAlignment(child, cpath);
    });
  };
  topList.forEach((sec, i) => checkPillAlignment(sec, `page[${i}]`));

  // 3d) Trailing dead space — a section far taller than its lowest content
  //     renders as a big empty band, which reads as a broken/unfinished page.
  //     Threshold is generous (320px) since text auto-grow and bottom padding
  //     are legitimate; advisory only.
  topList.forEach((sec, i) => {
    if (!sec || !Array.isArray(sec.children) || sec.children.length === 0) return;
    for (const bp of ["desktop", "mobile"] as const) {
      const sh = num(sec.responsive?.[bp]?.styles?.height);
      if (sh == null) continue;
      let maxBottom: number | undefined;
      for (const child of sec.children) {
        const s = child?.responsive?.[bp]?.styles;
        const t = num(s?.top);
        const h = num(s?.height);
        if (t == null || h == null) continue;
        if (maxBottom == null || t + h > maxBottom) maxBottom = t + h;
      }
      if (maxBottom != null && sh > maxBottom + 320) {
        warnings.push(
          `page[${i}] (section) [${bp}]: height=${sh} but the lowest child ends at ${maxBottom} — ~${sh - maxBottom}px of empty band at the bottom of the section. Reduce the section height to ≈ ${maxBottom + 80} (or move content down into the band).`
        );
      }
    }
  });

  // 3b) Page margin axis — every band (header included) should put its
  //     left-anchored content on ONE shared left margin. A header/section that
  //     starts on a different left than the rest is the #1 "looks misaligned"
  //     defect (and exactly what eyeballing `left` produces). For each section
  //     compute its left-anchored content edge (desktop), then warn ONCE if those
  //     edges diverge. Advisory only.
  const leftEdgeFor = (sec: any): number | undefined => {
    if (!sec || !Array.isArray(sec.children)) return undefined;
    let edge = Infinity;
    for (const child of sec.children) {
      const styles = child?.responsive?.desktop?.styles;
      if (!styles) continue;
      const left = num(styles.left);
      const width = num(styles.width);
      if (left == null || width == null || left < 0) continue;
      // skip full-bleed backgrounds / near-full-width media (their left is 0-ish)
      if (width >= rootCanvasD * 0.9) continue;
      // skip horizontally-centered content (its left is dictated by centering math)
      if (Math.abs(left - (rootCanvasD - width) / 2) <= 16) continue;
      // only LEFT-anchored content participates (right-anchored CTAs sit on the right axis)
      if (left >= rootCanvasD * 0.4) continue;
      if (left < edge) edge = left;
    }
    return Number.isFinite(edge) ? edge : undefined;
  };
  const sectionEdges: { i: number; edge: number }[] = [];
  topList.forEach((sec, i) => {
    const e = leftEdgeFor(sec);
    if (e != null) sectionEdges.push({ i, edge: e });
  });
  if (sectionEdges.length >= 2) {
    const minEdge = Math.min(...sectionEdges.map((e) => e.edge));
    const maxEdge = Math.max(...sectionEdges.map((e) => e.edge));
    if (maxEdge - minEdge > 48) {
      const list = sectionEdges.map((e) => `page[${e.i}] left=${e.edge}`).join(", ");
      warnings.push(
        `Sections start on different left margins (${list}). Put every band's left-anchored content (the header logo included) on ONE shared left axis — e.g. left=${minEdge} desktop — so the page reads aligned, not ragged. This is the #1 header-misalignment defect.`
      );
    }
  }

  // 3c) Colorless page — nothing on the page carries real color (every band/button/
  //     heading is white/black/grey). Sections have NO default background, so a page
  //     that never sets one renders as a flat white wall. Advisory only.
  if (topList.length >= 2 && elementCount >= 3 && !anyVividColor) {
    warnings.push(
      `Page has no color — no section background, button, or text uses a non-neutral color, so it renders as a flat white/grey wall. Set responsive.<bp>.styles.background on each section (alternate light/tinted/dark from the palette) and give the primary CTA an accent background. If a stark black-and-white look is intentional, ignore this.`
    );
  }
  popups.forEach((p, i) => {
    const ds = p?.responsive?.desktop?.styles ?? {};
    const ms = p?.responsive?.mobile?.styles ?? {};
    checkBounds(
      p,
      num(ds.width) ?? rootCanvasD,
      num(ds.height) ?? DEFAULT_SECTION_HEIGHT,
      num(ms.width) ?? rootCanvasM,
      num(ms.height) ?? DEFAULT_SECTION_HEIGHT,
      `popup[${i}]`
    );
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: { sections: topList.length, popups: popups.length, elements: elementCount, ids: ids.size },
  };
}
