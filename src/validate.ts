/**
 * Page validation: JSON-Schema structural check (ajv, draft 2020-12) plus
 * semantic checks the schema can't express (unique ids, dangling event targets,
 * children only on containers, missing field_name, top-level types).
 */
import { readFileSync } from "node:fs";
import Ajv2020Module from "ajv/dist/2020.js";
import { CONTAINER_TYPES, FIELD_TYPES } from "./factory.js";

// ajv ships as CJS; under Node16 ESM the constructor is on `.default`.
const Ajv2020: any = (Ajv2020Module as any).default ?? Ajv2020Module;

// Loaded at runtime (the build copies src/page-schema.json -> dist/page-schema.json)
// to avoid JSON-import-attribute differences across Node versions.
export const pageSchema: object = JSON.parse(
  readFileSync(new URL("./page-schema.json", import.meta.url), "utf8")
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(pageSchema);

// Actions whose `target` is expected to be an element id (vs a URL / text).
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

// Fixed canvas reference (matches library CANVAS) used for the layout/bounds check.
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

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: { sections: number; popups: number; elements: number; ids: number };
};

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
  let elementCount = 0;

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

    // children only on containers
    if (Array.isArray(node.children) && node.children.length > 0 && type && !CONTAINER_TYPES.has(type)) {
      errors.push(`${path} (${type}): has children but "${type}" is not a container type.`);
    }

    // form fields need field_name
    if (type && FIELD_TYPES.has(type)) {
      const fn = node.specials?.field_name;
      if (!fn || typeof fn !== "string" || fn.trim() === "") {
        warnings.push(`${path} (${type}): form input should have a unique specials.field_name.`);
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

  // dangling element-target events
  for (const t of eventTargets) {
    if (ELEMENT_TARGET_ACTIONS.has(t.action)) {
      const cleaned = t.target.replace(/^#?w-/, "");
      if (!ids.has(t.target) && !ids.has(cleaned)) {
        warnings.push(`event on "${t.from}" action="${t.action}" target="${t.target}" does not match any element id.`);
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
