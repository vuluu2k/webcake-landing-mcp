/**
 * One-answer repairs, run on every write BEFORE validate (via domain.autofixLayout). Each one fixes
 * an input the real renderer (landing_page_build/render/build) crashes on or mis-renders, where
 * only ONE value can be meant. Anything with more than one plausible fix stays a validate error.
 * Evidence: scripts/fuzz-render.mjs + scripts/render-check.mjs against the real renderer.
 */
import { createElement } from "./elements/index.js";

const isObj = (v: unknown): v is Record<string, any> => v != null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Locale codes an AI writes for countdown.language → the renderer's lang-table key (index.js:943). */
const COUNTDOWN_LANG_ALIAS: Record<string, string> = {
  vi: "vietnam", vn: "vietnam", "vi-vn": "vietnam", vietnamese: "vietnam",
  en: "english", "en-us": "english", "en-gb": "english",
  th: "thai", id: "indonesian", ms: "malay", my: "malay", km: "khmer", kh: "khmer",
  lo: "lao", la: "lao", fil: "filipino", tl: "filipino", ph: "filipino",
};
/** These renderers call unescapeHTML(specials.field_placeholder) unguarded (index.js:605/658). */
const PLACEHOLDER_REQUIRED = new Set(["select", "country-select", "group-select-item"]);

export function repairSource(source: any): string[] {
  const fixed: string[] = [];
  if (!isObj(source)) return fixed;

  // Page boilerplate the renderer reads unguarded — event-data.js:107 settings.width_section.mobile,
  // exportCss.js:82 options.mobileOnly, popups — filled silently like expand fills node boilerplate.
  if (!isObj(source.settings)) source.settings = {};
  const s = source.settings;
  const ws = isObj(s.width_section) ? s.width_section : {};
  if (!isNum(ws.desktop) || !isNum(ws.mobile))
    s.width_section = { desktop: isNum(ws.desktop) ? ws.desktop : 960, mobile: isNum(ws.mobile) ? ws.mobile : 420 };
  if (!isObj(source.options)) source.options = {};
  if (!Array.isArray(source.popup)) source.popup = [];
  // The renderer wraps fontGeneral in its own quotes: `'${fontGeneral}', san-serif` (index.js:52), and
  // load-font.js matches it by name — a CSS font list there breaks both. The editor stores a bare name.
  if (typeof s.fontGeneral === "string" && /[',"]/.test(s.fontGeneral)) {
    const bare = s.fontGeneral.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    fixed.push(`settings.fontGeneral "${s.fontGeneral}" → "${bare}" (a bare family name; the renderer adds the quotes)`);
    s.fontGeneral = bare;
  }

  const walk = (n: any, path: string) => {
    if (!isObj(n)) return;
    const id = `${path}#${n.id ?? "?"} (${n.type})`;
    const sp = isObj(n.specials) ? n.specials : (n.specials = {});

    if (n.type === "grid" && (!Array.isArray(n.children) || n.children.length === 0)) {
      n.children = [createElement("grid-item")];
      fixed.push(`${id}: added a grid-item (the renderer renders children[0] and crashes on an empty grid)`);
    }
    if (n.type === "spin-wheel" && typeof sp.code !== "string") {
      sp.code = "";
      fixed.push(`${id}: specials.code → "" (the renderer splits it and crashes when it is not a string)`);
    }
    if (n.type === "countdown" && sp.language !== undefined) {
      const lang = sp.language;
      const alias = typeof lang === "string" ? COUNTDOWN_LANG_ALIAS[lang.toLowerCase()] : undefined;
      if (lang === null || lang === "") {
        delete sp.language;
        fixed.push(`${id}: removed empty specials.language (the renderer defaults to english only when it is absent)`);
      } else if (alias) {
        sp.language = alias;
        fixed.push(`${id}: specials.language "${lang}" → "${alias}"`);
      }
    }
    if (PLACEHOLDER_REQUIRED.has(n.type) && typeof sp.field_placeholder !== "string") {
      const from = typeof sp.placeholder === "string" ? sp.placeholder : "";
      sp.field_placeholder = from;
      if (from) delete sp.placeholder;
      fixed.push(`${id}: specials.field_placeholder → ${JSON.stringify(from)} (the renderer crashes without it)`);
    }
    if (Array.isArray(n.events)) {
      const kept = n.events.filter((e: any) => !(isObj(e) && (e.action == null || e.action === "")));
      if (kept.length !== n.events.length) {
        fixed.push(`${id}: dropped ${n.events.length - kept.length} event(s) with no action (they do nothing)`);
        n.events = kept;
      }
    }
    for (const bp of ["desktop", "mobile"]) {
      const st = n.responsive?.[bp]?.styles;
      // The renderer emits border-radius raw (exportCss.js:566/673/2666): a bare number is invalid CSS
      // and the corners stay square. The editor stores "6px"; parseInt sites read "6px" the same.
      if (isObj(st) && typeof st.borderRadius === "number" && st.borderRadius !== 0) {
        fixed.push(`${id} [${bp}]: borderRadius ${st.borderRadius} → "${st.borderRadius}px"`);
        st.borderRadius = `${st.borderRadius}px`;
      }
      const anim = n.responsive?.[bp]?.config?.animation;
      if (isObj(anim) && typeof anim.repeat === "string" && /^\d+$/.test(anim.repeat)) {
        fixed.push(`${id} [${bp}]: animation.repeat "${anim.repeat}" → ${Number(anim.repeat)}`);
        anim.repeat = Number(anim.repeat);
      }
    }
    (Array.isArray(n.children) ? n.children : []).forEach((c: any, i: number) => walk(c, `${path}.children[${i}]`));
  };
  for (const key of ["page", "popup"]) (Array.isArray(source[key]) ? source[key] : []).forEach((n: any, i: number) => walk(n, `${key}[${i}]`));

  // extra_css rules that only target elements no longer on the page (#w-<id> of a deleted node) are
  // dead code: drop them. Flat stylesheets only — anything with @-rules / nesting is left untouched.
  if (typeof s.extra_css === "string" && s.extra_css.includes("#w-") && !/[@]/.test(s.extra_css)) {
    const ids = new Set<string>();
    const collect = (n: any) => {
      if (!isObj(n)) return;
      if (typeof n.id === "string") ids.add(n.id);
      (Array.isArray(n.children) ? n.children : []).forEach(collect);
    };
    for (const key of ["page", "popup"]) (Array.isArray(source[key]) ? source[key] : []).forEach(collect);
    const rules = s.extra_css.match(/[^{}]+\{[^{}]*\}/g);
    if (rules && rules.join("").replace(/\s/g, "") === s.extra_css.replace(/\s/g, "")) {
      const dead = (r: string) => {
        const targets = [...r.slice(0, r.indexOf("{")).matchAll(/#w-([\w-]+)/g)].map((m) => m[1]);
        return targets.length > 0 && targets.every((id) => !ids.has(id));
      };
      const kept = rules.filter((r: string) => !dead(r));
      if (kept.length !== rules.length) {
        fixed.push(`settings.extra_css: dropped ${rules.length - kept.length} rule(s) for elements no longer on the page`);
        s.extra_css = kept.map((r: string) => r.trim()).join("\n");
      }
    }
  }
  return fixed;
}
