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

export function validatePage(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let page: any;
  try {
    page = coercePage(input);
  } catch (e: any) {
    return { valid: false, errors: [`Invalid JSON: ${e.message}`], warnings: [], stats: { sections: 0, popups: 0, elements: 0, ids: 0 } };
  }

  // 1) Structural (JSON Schema)
  const ok = validateSchema(page);
  if (!ok && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      errors.push(`schema ${err.instancePath || "/"} ${err.message}`);
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
