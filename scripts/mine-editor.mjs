#!/usr/bin/env node
// Static read of the landing editor's trait panels (landing_page_backend/assets/editor/main/traits):
// for every element type, the specials / config / styles keys an editor control writes, the label
// the user sees (i18n, English first), the control kind (boolean/number/color/select/text) and the
// options a select / tabs / radio offers. Panels are tied to types the way the editor mounts them:
// statics/traitGroup.js (type → trait groups) → Trait.vue (group → panel component) → the panel's own
// sub-components (narrowed by `type == 'x'` gates / `switch (field.type)` pickers). Only keys known to
// be real (mined pages ∪ renderer reads) are kept. Writes src/domains/landing/editor-keys.generated.json.
//   node scripts/mine-editor.mjs   (LANDING_BACKEND_DIR=../landing_page_backend)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";

const BACKEND = path.resolve(process.env.LANDING_BACKEND_DIR || "../landing_page_backend");
const EDITOR = path.join(BACKEND, "assets/editor");
const TRAITS = path.join(EDITOR, "main/traits");
const OUT = path.resolve("src/domains/landing/editor-keys.generated.json");
if (!fs.existsSync(path.join(TRAITS, "Trait.vue"))) {
  console.error(`No landing editor at ${TRAITS} — set LANDING_BACKEND_DIR.`);
  process.exit(2);
}
const mined = JSON.parse(fs.readFileSync("src/domains/landing/element-keys.generated.json", "utf8"));
const renderer = JSON.parse(fs.readFileSync("src/domains/landing/renderer-keys.generated.json", "utf8"));
const BUCKET = { special: "specials", config: "config", style: "styles" };
const known = { specials: new Set(), config: new Set(), styles: new Set() };
for (const t of Object.values(mined)) for (const b of Object.keys(known)) for (const k of Object.keys(t[b] || {})) known[b].add(k);
for (const t of [renderer.shared, ...Object.values(renderer.types)]) for (const b of Object.keys(known)) for (const k of Object.keys(t[b] || {})) known[b].add(k);

// i18n: en first, vi fallback.
const flat = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o || {})) v && typeof v === "object" ? flat(v, `${p}${k}.`, out) : (out[`${p}${k}`] = String(v));
  return out;
};
const loc = (l) => {
  try {
    return flat(JSON.parse(fs.readFileSync(path.join(EDITOR, `locales/${l}.json`), "utf8")));
  } catch {
    return {};
  }
};
const EN = loc("en");
const VI = loc("vi");
const tr = (k) => EN[k] || VI[k];

// ── One .vue / .js file → its script AST, template, imports ──────────────────────────────
const parsed = {};
function parse(file) {
  if (parsed[file]) return parsed[file];
  const src = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const isVue = file.endsWith(".vue");
  const tpl = isVue ? /<template>([\s\S]*)<\/template>/.exec(src)?.[1] || "" : "";
  const script = isVue ? /<script[^>]*>([\s\S]*?)<\/script>/.exec(src)?.[1] || "" : src;
  const sf = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = {}; // local name → absolute file
  for (const st of sf.statements)
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause) {
      const spec = st.moduleSpecifier.text;
      if (!spec.startsWith(".")) continue;
      let abs = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(abs)) for (const ext of [".vue", ".js", "/index.js"]) if (fs.existsSync(abs + ext)) (abs += ext);
      if (st.importClause.name) imports[st.importClause.name.text] = abs;
      for (const e of st.importClause.namedBindings?.elements || []) imports[e.name.text] = abs;
    }
  return (parsed[file] = { file, tpl, script, sf, imports });
}
const lit = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined);

// Members (computed get/set + methods) of a component / mixin: name → { keys:[[b,k]], keyed:{b, param} }
function members(file) {
  const p = parse(file);
  const out = {};
  const arrays = {}; // name → option values (data/computed arrays of {value|key})
  const typeGates = {}; // imported component name → types a `switch (x.type)` picks it for
  const visitFn = (name, fn) => {
    const m = (out[name] ||= { keys: [], calls: [], keyed: null, assigns: [] });
    const params = (fn.parameters || []).map((x) => (ts.isIdentifier(x.name) ? x.name.text : null));
    const scan = (n) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText(p.sf);
        // $store.commit('ui/change-special', { key: 'x' | key, value })
        if (/\$store\.commit$|^commit$/.test(callee) && lit(n.arguments[0])) {
          const kind = /^ui\/change-(special|config|style)$/.exec(lit(n.arguments[0]))?.[1];
          const pay = n.arguments[1];
          if (kind && pay && ts.isObjectLiteralExpression(pay)) {
            for (const pr of pay.properties) {
              const nm = pr.name?.getText(p.sf);
              if (nm !== "key") continue;
              const v = ts.isPropertyAssignment(pr) ? pr.initializer : ts.isShorthandPropertyAssignment(pr) ? pr.name : null;
              if (lit(v)) m.keys.push([BUCKET[kind], lit(v)]);
              else if (v && ts.isIdentifier(v) && params.includes(v.text)) m.keyed = { b: BUCKET[kind], param: params.indexOf(v.text) };
            }
          }
        }
        // this.other('x', v)
        if (ts.isPropertyAccessExpression(n.expression) && n.expression.expression.kind === ts.SyntaxKind.ThisKeyword)
          m.calls.push([n.expression.name.text, n.arguments.map(lit)]);
      }
      // this.computedX = v
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.expression.kind === ts.SyntaxKind.ThisKeyword) m.assigns.push(n.left.name.text);
      ts.forEachChild(n, scan);
    };
    scan(fn.body || fn);
  };
  const optionValues = (n) => {
    if (!n || !ts.isArrayLiteralExpression(n)) return null;
    const vals = [];
    for (const e of n.elements) {
      if (lit(e)) vals.push(lit(e));
      else if (ts.isObjectLiteralExpression(e))
        for (const pr of e.properties) if (ts.isPropertyAssignment(pr) && /^(value|key)$/.test(pr.name.getText(p.sf)) && (lit(pr.initializer) !== undefined || ts.isNumericLiteral(pr.initializer))) vals.push(lit(pr.initializer) ?? pr.initializer.text);
    }
    return vals.length ? vals : null;
  };
  const walk = (n) => {
    // computed: { x: { get(){}, set(v){} } }, methods: { m(a,b){} }, data(){ return { tabs: [...] } }
    if (ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) {
      const name = n.name?.getText(p.sf);
      if (ts.isMethodDeclaration(n) && name) visitFn(name, n);
      if (ts.isPropertyAssignment(n) && name) {
        const v = n.initializer;
        if (ts.isFunctionExpression(v) || ts.isArrowFunction(v)) visitFn(name, v);
        if (ts.isObjectLiteralExpression(v)) {
          const set = v.properties.find((x) => x.name?.getText(p.sf) === "set");
          if (set) visitFn(name, ts.isMethodDeclaration(set) ? set : set.initializer);
        }
        const vals = optionValues(v);
        if (vals) arrays[name] = vals;
      }
      if (ts.isMethodDeclaration(n) && name) {
        // x() { return [...] }
        const ret = n.body?.statements.find(ts.isReturnStatement);
        const vals = optionValues(ret?.expression);
        if (vals) arrays[name] = vals;
      }
    }
    if (ts.isSwitchStatement(n) && /\.type$/.test(n.expression.getText(p.sf))) {
      let pending = [];
      for (const c of n.caseBlock.clauses) {
        if (ts.isCaseClause(c) && lit(c.expression)) pending.push(lit(c.expression));
        const ret = c.statements.find(ts.isReturnStatement);
        if (!c.statements.length) continue;
        if (ret?.expression && ts.isIdentifier(ret.expression) && ts.isCaseClause(c)) typeGates[ret.expression.text] = [...(typeGates[ret.expression.text] || []), ...pending];
        pending = [];
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(p.sf);
  // mixins: [a, b] → their members too (a member defined here wins)
  for (const [name, abs] of Object.entries(p.imports)) {
    if (!abs.endsWith(".js") || !new RegExp(String.raw`mixins\s*:\s*\[[^\]]*\b${name}\b`).test(p.script)) continue;
    const mx = members(abs);
    for (const [k, v] of Object.entries(mx.out)) out[k] ||= v;
    for (const [k, v] of Object.entries(mx.arrays)) arrays[k] ||= v;
  }
  // resolve keys transitively: a member's keys + keys of the members it calls / assigns
  const keysOf = (name, seen = new Set()) => {
    const m = out[name];
    if (!m || seen.has(name)) return [];
    seen.add(name);
    const ks = [...m.keys];
    for (const [c, args] of m.calls) {
      const cm = out[c];
      if (cm?.keyed && typeof args[cm.keyed.param] === "string") ks.push([cm.keyed.b, args[cm.keyed.param]]);
      ks.push(...keysOf(c, seen));
    }
    for (const a of m.assigns) ks.push(...keysOf(a, seen));
    return ks;
  };
  return { out, arrays, keysOf, typeGates };
}

const CONTROL = [
  [/date|time/i, "text"],
  [/switch|checkbox/i, "boolean"],
  [/number|slider|range/i, "number"],
  [/color|picker(?!image)|painter|gradient/i, "color"],
  [/select|radio|tabs|segment|dropdown|align/i, "select"],
  [/input|textarea|editor/i, "text"],
];
const controlOf = (tag) => CONTROL.find(([re]) => re.test(tag))?.[1];
const clean = (s) => s.replace(/\s+/g, " ").replace(/[:：]\s*$/, "").trim();
function labelBefore(tpl, at) {
  const win = tpl.slice(Math.max(0, at - 600), at);
  const c = [];
  for (const m of win.matchAll(/:label="\$t\('([^']+)'\)"/g)) c.push([m.index, tr(m[1])]);
  for (const m of win.matchAll(/(?<![:\w-])label="([^"{}$]{2,60})"/g)) c.push([m.index, m[1]]);
  const best = c.filter(([, v]) => v).sort((a, b) => b[0] - a[0])[0];
  return best ? clean(best[1]) : undefined;
}

// Controls of one file: [{ bucket, key, label, control, options }]
const controlsCache = {};
function controls(file) {
  if (controlsCache[file]) return controlsCache[file];
  const p = parse(file);
  const mem = members(file);
  const hits = [];
  for (const m of p.tpl.matchAll(/<([A-Za-z][\w-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*(\/?)>/g)) {
    const [whole, tag, attrs, selfClose] = m;
    const exprs = [...attrs.matchAll(/(?:@[\w:.-]+|v-model(?::\w+)?)="([^"]*)"/g)].map((x) => x[1]);
    if (!exprs.length) continue;
    const keys = [];
    for (const e of exprs) {
      // m('lit', …) on a keyed member, m(…) on a member with keys, x = val on a computed
      for (const c of e.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
        const mm = mem.out[c[1]];
        if (!mm) continue;
        const args = c[2].split(",").map((s) => /^\s*['"]([\w-]+)['"]\s*$/.exec(s)?.[1]);
        if (mm.keyed && args[mm.keyed.param]) keys.push([mm.keyed.b, args[mm.keyed.param]]);
        keys.push(...mem.keysOf(c[1]));
      }
      for (const a of e.matchAll(/\b([A-Za-z_$][\w$]*)\s*=(?!=)/g)) keys.push(...mem.keysOf(a[1]));
      if (/^[A-Za-z_$][\w$]*$/.test(e.trim())) keys.push(...mem.keysOf(e.trim())); // v-model="x" / @change="handler"
    }
    const uniq = new Map(keys.filter(([b, k]) => known[b]?.has(k)).map((x) => [x.join("."), x]));
    if (!uniq.size) continue;
    const control = controlOf(tag);
    let options = [];
    if (!selfClose) {
      const close = p.tpl.indexOf(`</${tag}>`, m.index);
      if (close > 0) {
        const inner = p.tpl.slice(m.index + whole.length, close);
        options = [...inner.matchAll(/<\w*(?:Option|Radio|Tab)\w*[^>]*?(?<![:\w-])value="([^"{}]{1,40})"/gi)].map((x) => x[1]);
        // <template v-for="opt in positionOptions"> … :value="opt.value" — minus `opt.value != 'divider'` markers
        for (const f of inner.matchAll(/v-for="\(?\s*(\w+)[^"]*?\bin\s+([A-Za-z_$][\w$]*)"/g)) {
          const skip = new Set([...inner.matchAll(new RegExp(String.raw`\b${f[1]}\.(?:value|key)\s*!==?\s*'([^']+)'`, "g"))].map((x) => x[1]));
          options.push(...(mem.arrays[f[2]] || []).filter((v) => !skip.has(String(v))));
        }
      }
    }
    for (const r of attrs.matchAll(/:(?:options|tabs|items)="([A-Za-z_$][\w$]*)"/g)) options.push(...(mem.arrays[r[1]] || []));
    const label = labelBefore(p.tpl, m.index);
    // options belong to the key only when the control writes that one key (a "format" select that
    // writes showDay + showHour + showSecond offers format values, not values of each key)
    const one = uniq.size === 1;
    for (const [b, k] of uniq.values()) hits.push({ bucket: b, key: k, label, control: one ? control : undefined, options: one ? options.map(String) : [] });
  }
  return (controlsCache[file] = hits);
}

// Sub-components a file mounts (template tags matching an import, or `:is` pickers), with type gates.
function children(file) {
  const p = parse(file);
  const mem = members(file);
  const out = [];
  for (const [name, abs] of Object.entries(p.imports)) {
    if (!abs.endsWith(".vue") || !abs.startsWith(TRAITS)) continue;
    const kebab = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const tagRe = new RegExp(`<(?:${name}|${kebab})\\b([^>]*)>`, "g");
    const gates = new Set(mem.typeGates[name] || []);
    let mounted = gates.size > 0;
    let ungated = false;
    for (const t of p.tpl.matchAll(tagRe)) {
      mounted = true;
      const vif = /v-if="([^"]*)"/.exec(t[1])?.[1] || "";
      const ts_ = [...vif.matchAll(/type\s*===?\s*'([\w-]+)'/g)].map((x) => x[1]);
      for (const l of vif.matchAll(/\[([^\]]+)\]\.includes\([^)]*type\)/g)) ts_.push(...[...l[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]));
      if (ts_.length) ts_.forEach((x) => gates.add(x));
      else ungated = true;
    }
    if (mounted) out.push({ file: abs, types: ungated ? null : [...gates] });
  }
  return out;
}

// ── Trait.vue: group → panel component; always-mounted panels ─────────────────────────────
const trait = parse(path.join(TRAITS, "Trait.vue"));
const groupFiles = {}; // group → [file]
const always = [];
for (const [name, abs] of Object.entries(trait.imports)) {
  if (!abs.endsWith(".vue")) continue;
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  for (const t of trait.tpl.matchAll(new RegExp(`<(?:${name}|${kebab})\\b([^>]*)>`, "g"))) {
    const groups = [...t[1].matchAll(/trait\.includes\('([\w-]+)'\)/g)].map((x) => x[1]);
    if (groups.length) for (const g of groups) (groupFiles[g] ||= []).push(abs);
    else always.push(abs);
  }
}
const tgSrc = fs.readFileSync(path.join(EDITOR, "statics/traitGroup.js"), "utf8");
const traitGroup = {};
for (const m of tgSrc.matchAll(/['"]([\w-]+)['"]\s*:\s*\[([^\]]*)\]/g)) traitGroup[m[1]] = [...m[2].matchAll(/['"]([\w-]+)['"]/g)].map((x) => x[1]);

// Files per type (panel + sub-components, depth 4, honouring type gates).
function filesFor(type) {
  const roots = [...always, ...(traitGroup[type] || []).flatMap((g) => groupFiles[g] || [])];
  const seen = new Set();
  const stack = roots.map((f) => [f, 0]);
  while (stack.length) {
    const [f, d] = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (d >= 4) continue;
    for (const c of children(f)) if (!c.types || c.types.includes(type)) stack.push([c.file, d + 1]);
  }
  return [...seen];
}

const TYPES = [...new Set([...Object.keys(traitGroup), ...Object.keys(mined)])].filter((t) => traitGroup[t]).sort();
const out = { meta: { source: "landing_page_backend/assets/editor/main/traits (statics/traitGroup.js → Trait.vue → panels)", branch: "?" }, types: {} };
try {
  out.meta.branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: BACKEND }).toString().trim();
} catch {}
let nKeys = 0;
let nOpt = 0;
for (const T of TYPES) {
  const files = filesFor(T);
  const per = {};
  for (const f of files) for (const h of controls(f)) (per[`${h.bucket}.${h.key}`] ||= []).push({ ...h, file: path.relative(EDITOR, f) });
  const t = {};
  for (const [bk, hs] of Object.entries(per).sort()) {
    const [b, k] = [bk.slice(0, bk.indexOf(".")), bk.slice(bk.indexOf(".") + 1)];
    const labels = [...new Set(hs.map((h) => h.label).filter(Boolean))];
    const ctl = hs.map((h) => h.control).filter(Boolean);
    const options = [...new Set(hs.flatMap((h) => h.options))].filter((o) => /^[\w#%.-]{1,40}$/.test(o));
    const v = { ...(labels.length ? { label: labels.slice(0, 2).join(" / ") } : {}), ...(ctl.length ? { control: ctl.sort((a, c) => ctl.filter((x) => x === c).length - ctl.filter((x) => x === a).length)[0] } : {}), ...(options.length ? { options: options.slice(0, 40) } : {}), file: hs[0].file };
    (t[b] ||= {})[k] = v;
    nKeys++;
    if (v.options) nOpt++;
  }
  t.panels = files.length;
  out.types[T] = t;
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`${TYPES.length} types, ${nKeys} editor-written keys (${nOpt} with options), ${Object.keys(groupFiles).length} trait groups + ${always.length} always-mounted panels → ${path.relative(process.cwd(), OUT)}`);
