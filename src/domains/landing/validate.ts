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
      errors.push(`${path} (${type}): has children but "${type}" is not a container type.`);
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

    // countdown.language must be a key the renderer's lang table knows (or 'custom');
    // anything else (e.g. a locale code "vi"/"en") crashes the renderer with
    // "is not iterable" when it destructures lang[language].
    if (type === "countdown") {
      const lang = node.specials?.language;
      if (typeof lang === "string" && !COUNTDOWN_LANGUAGES.has(lang)) {
        errors.push(`${path} (countdown): specials.language="${lang}" is not supported and crashes the renderer. Use one of: ${[...COUNTDOWN_LANGUAGES].join(", ")} (use "custom" + specials.customTranslation for other languages).`);
      }
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
