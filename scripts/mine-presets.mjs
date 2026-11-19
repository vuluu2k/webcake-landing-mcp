#!/usr/bin/env node
// What the landing EDITOR drops for each element type — read by RUNNING the editor's own picker
// code (landing_page_backend/assets/editor/main/pickers/*.vue): every picker is mounted with Vue 2
// in jsdom, ElementWrapper is stubbed to record the `element` it is handed (= the node ElementDrag
// clones into the page on drop), tabs are walked. The first card of a type is its default; the
// card count is kept as `variants`. Types no picker drops get editor/factory.js's default.
// Writes src/domains/landing/element-presets.json.
//   npm i --no-save esbuild && node scripts/mine-presets.mjs   (LANDING_BACKEND_DIR=../landing_page_backend)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const BACKEND = path.resolve(process.env.LANDING_BACKEND_DIR || "../landing_page_backend");
const ASSETS = path.join(BACKEND, "assets");
const PICKERS = path.join(ASSETS, "editor/main/pickers");
const OUT = path.resolve("src/domains/landing/element-presets.json");
if (!fs.existsSync(PICKERS)) {
  console.error(`No landing editor at ${PICKERS} — set LANDING_BACKEND_DIR.`);
  process.exit(2);
}
const req = createRequire(path.join(ASSETS, "package.json"));
let esbuild;
try {
  esbuild = createRequire(import.meta.url)("esbuild");
} catch {
  console.error("needs esbuild: npm i --no-save esbuild");
  process.exit(2);
}
const { parseComponent } = req("vue-template-compiler");

// Pickers that drop elements (asset/media/AI panels fetch remote data — skipped).
const SKIP = /^(AiImage|AIMedia|Asset|Assets|Media|SidebarMedia|Generative|Elements|ElementsCategoryList|ElementDrag|LayerNode|LayerView|DynamicPage|SectionPicker|PopupPicker)/;
// Sidebar order (Elements.vue) first, so a type's default is the card the user sees first.
const ORDER = ["Text", "Video", "Image", "Button", "Shape", "Icon", "Line", "Gallery", "Carousel", "Survey", "Form", "HTMLBox"].map((n) => `${n}Picker.vue`);
const rank = (f) => (ORDER.includes(f) ? ORDER.indexOf(f) : ORDER.length);
const pickers = fs.readdirSync(PICKERS).filter((f) => f.endsWith(".vue") && !SKIP.test(f)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mine-presets-"));
const entry = path.join(tmp, "entry.js");
const FACTORY = path.join(ASSETS, "editor/factory.js");
fs.writeFileSync(entry, [...pickers.map((f, i) => `export { default as P${i} } from ${JSON.stringify(path.join(PICKERS, f))};`), `export { default as factory } from ${JSON.stringify(FACTORY)};`].join("\n"));

const vuePlugin = {
  name: "vue",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => ({ path: path.join(ASSETS, "editor", a.path.slice(2)) }));
    // icon components: any named export is a stub component
    b.onResolve({ filter: /^webcake-ui-kit/ }, () => ({ path: "ui-kit", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "module.exports = new Proxy({}, { get: (t, k) => k === '__esModule' ? true : { render: (h) => h('i') } })", loader: "js" }));
    b.onLoad({ filter: /\.vue$/ }, (a) => {
      const sfc = parseComponent(fs.readFileSync(a.path, "utf8"));
      if (a.path.startsWith(PICKERS) && pickers.includes(path.basename(a.path))) {
        const script = (sfc.script?.content || "export default {}").replace(/export\s+default/, "const __c =");
        return { contents: `${script}\n__c.template = ${JSON.stringify(sfc.template?.content || "<div/>")};\nexport default __c;`, loader: "js", resolveDir: path.dirname(a.path) };
      }
      // every other component: a stub; ElementWrapper / VirtualElementWrapper record their element
      // ElementDrag records the element its slot holds (what mouseDbClick / drop clones)
      if (path.basename(a.path) === "ElementDrag.vue")
        return { contents: `export default { name: "ElementDrag", mounted() { const c = (this.$slots.default || [])[0]; const el = c && ((c.componentOptions && c.componentOptions.propsData && c.componentOptions.propsData.element) || (c.componentInstance && c.componentInstance.element)); if (el && globalThis.__seen) globalThis.__seen(el) }, render(h) { return h("div", this.$slots.default) } }`, loader: "js" };
      return { contents: `export default { name: ${JSON.stringify(path.basename(a.path, ".vue"))}, props: ["element"], created() { if (this.element && globalThis.__seen) globalThis.__seen(this.element) }, render(h) { return h("div", this.$slots.default) } }`, loader: "js" };
    });
    b.onLoad({ filter: /\.(s?css|less|png|jpe?g|gif|svg|woff2?|ttf)$/ }, () => ({ contents: "export default ''", loader: "js" }));
  },
};
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(tmp, "bundle.cjs"),
  plugins: [vuePlugin],
  nodePaths: [path.join(ASSETS, "node_modules")],
  logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"' },
});

const { JSDOM } = req("jsdom");
const dom = new JSDOM("<!doctype html><div id=app></div>", { pretendToBeVisual: true, url: "https://editor.local/" });
for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "getComputedStyle", "localStorage", "requestAnimationFrame"]) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
dom.window.DISPLAY_MODE = "desktop";
// factory.js picks timegroup.language from the editor locale (empty → "indonesian")
dom.window.localStorage.setItem("locale", "vi");
const Vue = req("vue/dist/vue.common.prod.js");
const Vuex = req("vuex");
Vue.use(Vuex);
Vue.config.silent = true;
Vue.config.errorHandler = (e) => console.error(`  ${current}: ${e.message}`);
Vue.prototype.$t = (k) => k;
Vue.prototype.$tc = (k) => k;
Vue.prototype.$te = () => true;
Vue.prototype.$i18n = { locale: "vi" };
Vue.prototype.$message = Vue.prototype.$notify = () => {};

// A permissive store: known editor state, anything else reads as an empty object.
const deep = (o) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : (t[k] = deep({}))) });
const store = new Vuex.Store({ state: deep({ ui: deep({ display: "desktop", source: [], popup: [], settings: deep({}) }), sidebar: deep({}) }) });

const bundle = createRequire(import.meta.url)(path.join(tmp, "bundle.cjs"));
const seen = [];
let current = "";
globalThis.__seen = (el) => seen.push({ picker: current, el: JSON.parse(JSON.stringify(el)) });

const tabKeys = (vm) => Object.keys(vm.$data).filter((k) => /tab|categor|type$/i.test(k) && typeof vm[k] === "string");
const tabValues = (vm) => {
  const out = new Set();
  for (const c of ["tabs", "categories", "types", "sections"]) for (const t of Array.isArray(vm[c]) ? vm[c] : []) if (t && typeof t.value === "string") out.add(t.value);
  return [...out];
};
for (const [i, f] of pickers.entries()) {
  current = f.replace(".vue", "");
  const comp = bundle[`P${i}`];
  try {
    const vm = new Vue({ store, render: (h) => h(comp, { props: { search: "" } }) }).$mount();
    const inner = vm.$children[0];
    if (inner) {
      for (const k of tabKeys(inner))
        for (const v of tabValues(inner)) {
          inner[k] = v;
          await Vue.nextTick();
        }
    }
    vm.$destroy();
  } catch (e) {
    console.error(`${current}: ${e.message}`);
  }
}

// Group by type; strip ids / editor-only flags; first card = default.
const clean = (n) => {
  if (!n || typeof n !== "object") return n;
  if (Array.isArray(n)) return n.map(clean);
  const o = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === "id" || k === "runtime" || k === "notloaded") continue;
    o[k] = clean(v);
  }
  return o;
};
// Where the first card is a special case, the neutral one is the default (a plain paragraph,
// not the 36px heading the text panel opens with).
const PREFER = { "text-block": (n) => n.specials?.tag === "p" };
const byType = {};
const key = (n) => JSON.stringify(clean(n));
for (const { picker, el } of seen) {
  if (!el?.type) continue;
  const t = (byType[el.type] ??= { picker, variants: 0, _keys: new Set(), default: clean(el) });
  if (t._keys.has(key(el))) continue;
  t._keys.add(key(el));
  t.variants++;
  if (PREFER[el.type] && !t._preferred && PREFER[el.type](el)) (t._preferred = true), (t.default = clean(el));
  (t._all ??= []).push(clean(el));
}
const all = Object.entries(byType).map(([t, v]) => [t, v._all]);
for (const t of Object.values(byType)) delete t._keys, delete t._all, delete t._preferred;
// Types the editor only drops INSIDE another preset (form fields, slides, grid items): their first
// occurrence in a preset's children is their default.
const harvest = (n, from) => {
  for (const c of n.children || []) {
    if (c?.type && !byType[c.type]) byType[c.type] = { picker: `${byType[from].picker} › ${from}`, variants: 1, default: c };
    harvest(c, from);
  }
};
for (const [t, nodes] of all) for (const n of nodes) harvest(n, t);
// Types no picker drops (group-select, input-datetime, …): editor/factory.js's own default.
const ROOTS = new Set(["section", "popup", "dynamic_page"]);
for (const t of new Set([...fs.readFileSync(FACTORY, "utf8").matchAll(/case\s+["']([\w-]+)["']\s*:/g)].map((m) => m[1])))
  if (!byType[t] && !ROOTS.has(t)) {
    try {
      byType[t] = { picker: "factory.js", variants: 1, default: clean(JSON.parse(JSON.stringify(bundle.factory(t)))) };
    } catch (e) {
      console.error(`factory ${t}: ${e.message}`);
    }
  }
fs.writeFileSync(OUT, JSON.stringify(byType, null, 1) + "\n");
console.log(`${Object.keys(byType).length} types from ${pickers.length} pickers → ${path.relative(process.cwd(), OUT)}`);
for (const [t, v] of Object.entries(byType)) console.log(`  ${t.padEnd(22)} ${String(v.variants).padStart(3)}  (${v.picker})`);
fs.rmSync(tmp, { recursive: true, force: true });
