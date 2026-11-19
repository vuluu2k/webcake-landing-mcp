#!/usr/bin/env node
// Static read of the landing published-page renderer (landing_page_build/render/build: index.js =
// HTML, exportCss.js = CSS, event-data.js = window.event_data the client runtime reads, animate.js)
// plus the client runtime (landing_page_backend/assets/render_v4). For every element type: which
// specials / config / styles / properties keys its HTML, CSS and data builders read, the fallback
// default, the literal values the code branches on (enum candidates), whether its CSS builder emits
// EVERY style key (a generic loop → styles are open) and which it drops, and whether its specials
// are shipped to the client wholesale. Writes src/domains/landing/renderer-keys.generated.json.
//   node scripts/mine-renderer.mjs   (LANDING_BUILD_DIR=../landing_page_build, LANDING_BACKEND_DIR=../landing_page_backend)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";

const BUILD = path.resolve(process.env.LANDING_BUILD_DIR || "../landing_page_build");
const BACKEND = path.resolve(process.env.LANDING_BACKEND_DIR || "../landing_page_backend");
const DIR = path.join(BUILD, "render/build");
const OUT = path.resolve("src/domains/landing/renderer-keys.generated.json");
const FILES = ["index.js", "exportCss.js", "event-data.js", "animate.js", "common.js"];
if (!fs.existsSync(path.join(DIR, "index.js"))) {
  console.error(`No landing renderer at ${DIR} — set LANDING_BUILD_DIR.`);
  process.exit(2);
}

// ── Parse: top-level functions per file ───────────────────────────────────────────────────
const fns = {}; // "file#name" → { file, name, node, sf }
const consts = {}; // "file#NAME" → string[] (module-level array literals: PROPERTY_NOT_SHOW…)
const sfs = {};
for (const f of FILES) {
  const sf = ts.createSourceFile(f, fs.readFileSync(path.join(DIR, f), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  sfs[f] = sf;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) fns[`${f}#${st.name.text}`] = { file: f, name: st.name.text, node: st, sf };
    else if (ts.isExportAssignment(st)) fns[`${f}#default`] = { file: f, name: "default", node: st.expression, sf };
    else if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) fns[`${f}#${d.name.text}`] = { file: f, name: d.name.text, node: d.initializer, sf };
        else if (ts.isArrayLiteralExpression(d.initializer)) consts[`${f}#${d.name.text}`] = d.initializer.elements.filter(ts.isStringLiteral).map((e) => e.text);
      }
  }
}
const lineOf = (fn, node) => `${fn.file}:${fn.sf.getLineAndCharacterOfPosition(node.getStart(fn.sf)).line + 1}`;
const resolveFn = (file, name) => fns[`${file}#${name}`] || (file !== "common.js" ? fns[`common.js#${name}`] : undefined);

// ── Dispatchers: switch (X.type) { case 'a': [case 'b':] … fn(…) } ─────────────────────────
function dispatchOf(file, fname, { pick = () => true } = {}) {
  const root = fns[`${file}#${fname}`];
  const out = {}; // type → [fnKey]
  let deflt = [];
  const visit = (n) => {
    if (ts.isSwitchStatement(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "type") {
      let pending = [];
      for (const c of n.caseBlock.clauses) {
        if (ts.isCaseClause(c) && ts.isStringLiteral(c.expression)) pending.push(c.expression.text);
        if (!c.statements.length) continue;
        const called = [];
        const scan = (x) => {
          if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) {
            const r = resolveFn(file, x.expression.text);
            if (r && pick(x.expression.text)) called.push(`${r.file}#${r.name}`);
          }
          ts.forEachChild(x, scan);
        };
        c.statements.forEach(scan);
        if (ts.isDefaultClause(c)) deflt = called;
        for (const t of pending) out[t] = [...new Set([...(out[t] || []), ...called])];
        pending = [];
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(root.node);
  return { out, deflt };
}
const html = dispatchOf("index.js", "renderElement").out;
const css = dispatchOf("exportCss.js", "cssElement").out;
const data = dispatchOf("event-data.js", "data_struct", { pick: (n) => /_struct$/.test(n) });
// Shared plumbing every element goes through (wrapper markup / position CSS / animation / sticky).
const GENERIC_ROOTS = ["index.js#renderElementWrapper", "exportCss.js#cssElementWrapper", "exportCss.js#handleStyleSticky", "animate.js#default"];
const STOP = new Set(["index.js#renderElement", "index.js#renderElementWrapper", "index.js#renderChildren", "exportCss.js#cssElement", "exportCss.js#buildCss", "common.js#traversal", "common.js#getConfig", "common.js#getStyle"]);

function reachable(roots, depth = 3) {
  const seen = new Set();
  let frontier = roots.map((r) => [r, 0]);
  while (frontier.length) {
    const next = [];
    for (const [k, d] of frontier) {
      if (seen.has(k) || (STOP.has(k) && !roots.includes(k))) continue;
      seen.add(k);
      if (d >= depth) continue;
      const fn = fns[k];
      const scan = (x) => {
        if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) {
          const r = resolveFn(fn.file, x.expression.text);
          if (r) next.push([`${r.file}#${r.name}`, d + 1]);
        }
        ts.forEachChild(x, scan);
      };
      scan(fn.node);
    }
    frontier = next;
  }
  return [...seen];
}

// ── Key reads in one function ─────────────────────────────────────────────────────────────
const BUCKETS = ["specials", "config", "styles", "properties"];
const lit = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : n && ts.isNumericLiteral(n) ? Number(n.text) : n?.kind === ts.SyntaxKind.TrueKeyword ? true : n?.kind === ts.SyntaxKind.FalseKeyword ? false : undefined);
const strip = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isNonNullExpression?.(n) || ts.isAsExpression?.(n))) n = n.expression;
  // X || {}  /  X ?? {}
  if (n && ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind) && (ts.isObjectLiteralExpression(n.right) || ts.isArrayLiteralExpression(n.right))) return strip(n.left);
  // Object.assign({}, X)  /  cloneDeep(X)
  if (n && ts.isCallExpression(n)) {
    const c = n.expression.getText();
    if (c === "Object.assign" && n.arguments.length === 2 && ts.isObjectLiteralExpression(n.arguments[0])) return strip(n.arguments[1]);
    if (/^(cloneDeep|_\.cloneDeep)$/.test(c) && n.arguments.length === 1) return strip(n.arguments[0]);
  }
  // { ...X }
  if (n && ts.isObjectLiteralExpression(n) && n.properties.length === 1 && ts.isSpreadAssignment(n.properties[0])) return strip(n.properties[0].expression);
  return n;
};
/** Member chain of an expression: el.responsive[mode].styles.color → ["el","responsive","*","styles","color"] */
function chain(n) {
  const parts = [];
  n = strip(n);
  while (n) {
    if (ts.isPropertyAccessExpression(n)) parts.unshift(n.name.text), (n = n.expression);
    else if (ts.isElementAccessExpression(n)) parts.unshift(lit(n.argumentExpression) ?? "*"), (n = n.expression);
    else if (ts.isIdentifier(n)) return parts.unshift(n.text), parts;
    else if (n.kind === ts.SyntaxKind.ThisKeyword) return parts.unshift("this"), parts;
    else if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression?.(n)) n = n.expression;
    else return null;
  }
  return null;
}

function readFn(fn) {
  const reads = {}; // bucket → key → { default, values:Set, at }
  const parentReads = new Set();
  const flags = { stylesOpen: false, dropped: new Set(), clientSpecials: false };
  const alias = {}; // local → bucket ("specials" | "config" | "styles") ; or "el" for element vars
  const parentVars = new Set(["parent"]);
  const local = {}; // local var → [bucket, key]
  const add = (bucket, key, node, patch = {}) => {
    if (typeof key !== "string" || !key || key === "*") return;
    const e = ((reads[bucket] ||= {})[key] ||= { values: new Set(), at: lineOf(fn, node) });
    if (patch.default !== undefined && e.default === undefined) e.default = patch.default;
    for (const v of patch.values || []) if (typeof v === "string" || typeof v === "number") e.values.add(v);
  };
  // A chain → [bucket, key, isParent] when it reads one key.
  const keyOf = (c) => {
    if (!c) return null;
    const isP = parentVars.has(c[0]);
    const i = c.indexOf("specials");
    if (i >= 1 && c.length === i + 2) return ["specials", c[i + 1], isP];
    const p = c.indexOf("properties");
    if (p >= 1 && c.length === p + 2) return ["properties", c[p + 1], isP];
    const r = c.indexOf("responsive");
    if (r >= 1 && c.length === r + 4 && (c[r + 2] === "config" || c[r + 2] === "styles")) return [c[r + 2], c[r + 3], isP];
    if (c.length === 2 && alias[c[0]] && alias[c[0]] !== "el") return [alias[c[0]], c[1], false];
    return null;
  };
  // A chain → the bucket object it IS (el.specials, el.responsive[mode].styles, a styles alias).
  const bucketOf = (c) => {
    if (!c) return null;
    if (c.length === 1 && alias[c[0]] && alias[c[0]] !== "el") return alias[c[0]];
    if (c.length >= 2 && c[c.length - 1] === "specials") return "specials";
    if (c.length >= 2 && c[c.length - 1] === "properties") return "properties";
    const r = c.indexOf("responsive");
    if (r >= 1 && c.length === r + 3 && (c[r + 2] === "config" || c[r + 2] === "styles")) return c[r + 2];
    return null;
  };
  const exprKey = (n) => {
    n = strip(n);
    if (!n) return null;
    if (ts.isIdentifier(n) && local[n.text]) return local[n.text];
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^(getConfig|getStyle)$/.test(n.expression.text) && n.arguments.length >= 3) {
      const k = lit(n.arguments[2]);
      const base = chain(n.arguments[0]);
      if (typeof k === "string") return [n.expression.text === "getConfig" ? "config" : "styles", k, !!base && parentVars.has(base[0])];
    }
    // lodash get(el, 'specials.x')
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "get" && n.arguments.length >= 2) {
      const p = lit(n.arguments[1]);
      if (typeof p === "string") {
        const m = /^(specials|properties)\.(\w+)$/.exec(p);
        if (m) return [m[1], m[2], false];
      }
    }
    const k = keyOf(chain(n));
    return k;
  };
  const arrayVals = (n) => {
    n = strip(n);
    if (!n) return null;
    if (ts.isArrayLiteralExpression(n)) {
      const vals = [];
      for (const e of n.elements) {
        if (ts.isSpreadElement(e) && ts.isIdentifier(e.expression)) vals.push(...(consts[`${fn.file}#${e.expression.text}`] || localArrays[e.expression.text] || []));
        else if (lit(e) !== undefined) vals.push(lit(e));
      }
      return vals;
    }
    if (ts.isIdentifier(n)) return consts[`${fn.file}#${n.text}`] || localArrays[n.text] || null;
    return null;
  };
  const localArrays = {};
  const localObjects = {};
  // Pass 1: aliases, locals, local arrays (flow-insensitive).
  const bind = (name, init) => {
    if (!init) return;
    if (ts.isIdentifier(name)) {
      if (ts.isArrayLiteralExpression(init)) localArrays[name.text] = arrayVals(init) || [];
      // a lookup table: const lang = { vietnam: [...], english: [...] } → lang[language]
      if (ts.isObjectLiteralExpression(init)) localObjects[name.text] = init.properties.map((pr) => (pr.name && (ts.isIdentifier(pr.name) || ts.isStringLiteral(pr.name)) ? pr.name.text : null)).filter(Boolean);
      const ic = chain(init);
      const b = bucketOf(ic);
      if (b) alias[name.text] = b;
      else if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "findParent") parentVars.add(name.text);
      let base = init;
      let dflt;
      if (ts.isBinaryExpression(init) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(init.operatorToken.kind)) (base = init.left), (dflt = lit(init.right));
      const k = exprKey(base);
      if (k) {
        local[name.text] = k;
        if (dflt !== undefined) add(k[0], k[1], init, { default: dflt });
      }
    } else if (ts.isObjectBindingPattern(name)) {
      const ic = chain(init);
      const b = bucketOf(ic);
      const isP = !!ic && parentVars.has(ic[0]);
      for (const el of name.elements) {
        const key = el.propertyName ? (ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName) ? el.propertyName.text : null) : ts.isIdentifier(el.name) ? el.name.text : null;
        if (!key) continue;
        if (b) {
          if (isP) parentReads.add(`${b}.${key}`);
          else add(b, key, el, { default: lit(el.initializer) });
          if (ts.isIdentifier(el.name)) local[el.name.text] = [b, key, isP];
          if (ts.isObjectBindingPattern(el.name) || ts.isArrayBindingPattern(el.name)) continue;
        } else if (ic && ic.length === 1 && (key === "specials" || key === "properties") && ts.isIdentifier(el.name)) alias[el.name.text] = key;
        else if (ic && ic[ic.length - 2] === "responsive" && (key === "config" || key === "styles") && ts.isIdentifier(el.name)) alias[el.name.text] = key;
      }
    }
  };
  const pass1 = (n) => {
    if (ts.isVariableDeclaration(n)) bind(n.name, n.initializer);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) bind(n.left, n.right);
    ts.forEachChild(n, pass1);
  };
  pass1(fn.node);
  // Pass 2: reads, defaults, compared values, generic loops, pass-through.
  const entriesKeyVars = {}; // local key var of Object.entries(bucketObj) → bucket
  const pass2 = (n) => {
    // direct reads
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const k = keyOf(chain(n));
      // only the outermost access of a chain counts (el.specials.text, not el.specials)
      if (k && !(n.parent && (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) && n.parent.expression === n && keyOf(chain(n.parent)))) {
        if (k[2]) parentReads.add(`${k[0]}.${k[1]}`);
        else add(k[0], k[1], n);
      }
    }
    // table[key]: the table's keys are the values the code can use
    if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && localObjects[n.expression.text]) {
      const k = exprKey(n.argumentExpression);
      if (k && !k[2]) add(k[0], k[1], n, { values: localObjects[n.expression.text] });
    }
    if (ts.isCallExpression(n)) {
      const k = exprKey(n);
      if (k && !local[n.getText()]) (k[2] ? parentReads.add(`${k[0]}.${k[1]}`) : add(k[0], k[1], n));
      // [lits].includes(X)
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "includes" && n.arguments.length === 1) {
        const vals = arrayVals(n.expression.expression);
        const arg = strip(n.arguments[0]);
        if (vals) {
          const kk = exprKey(arg);
          if (kk && !kk[2]) add(kk[0], kk[1], n, { values: vals });
          if (ts.isIdentifier(arg) && entriesKeyVars[arg.text]) for (const v of vals) add(entriesKeyVars[arg.text], v, n);
        }
      }
      // Object.entries(bucket).forEach(([key, value]) => …) / Object.keys(bucket)
      const callee = n.expression.getText();
      if (/^Object\.(entries|keys)$/.test(callee) && n.arguments.length === 1) {
        const b = bucketOf(chain(n.arguments[0]));
        if (b === "styles") flags.stylesOpen = true;
        const fe = n.parent && ts.isPropertyAccessExpression(n.parent) && /^(forEach|map|filter|reduce)$/.test(n.parent.name.text) ? n.parent.parent : null;
        const cb = fe && ts.isCallExpression(fe) ? fe.arguments[0] : null;
        const p0 = cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) ? cb.parameters[0]?.name : null;
        const kv = p0 && ts.isArrayBindingPattern(p0) ? p0.elements[0]?.name : p0;
        if (b && kv && ts.isIdentifier(kv)) entriesKeyVars[kv.text] = b;
      }
    }
    // for (let key in style)
    if (ts.isForInStatement(n) && bucketOf(chain(n.expression)) === "styles") flags.stylesOpen = true;
    // for (let key of [...]) delete style[key]
    if (ts.isForOfStatement(n)) {
      const vals = arrayVals(n.expression);
      const v = n.initializer && ts.isVariableDeclarationList(n.initializer) ? n.initializer.declarations[0]?.name : null;
      if (vals && v && ts.isIdentifier(v)) {
        let deletes = false;
        const scan = (x) => {
          if (ts.isDeleteExpression(x) && ts.isElementAccessExpression(x.expression) && bucketOf(chain(x.expression.expression)) === "styles" && x.expression.argumentExpression.getText() === v.text) deletes = true;
          ts.forEachChild(x, scan);
        };
        scan(n.statement);
        if (deletes) for (const k of vals) flags.dropped.add(k);
      }
    }
    if (ts.isDeleteExpression(n)) {
      const c = chain(n.expression);
      if (c && c.length === 2 && alias[c[0]] === "styles" && c[1] !== "*") flags.dropped.add(c[1]);
    }
    // comparisons
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) {
      for (const [a, b] of [[n.left, n.right], [n.right, n.left]]) {
        const v = lit(b);
        if (v === undefined || typeof v === "boolean") continue;
        const k = exprKey(a);
        if (k && !k[2]) add(k[0], k[1], n, { values: [v] });
        const s = strip(a);
        if (s && ts.isIdentifier(s) && entriesKeyVars[s.text] && typeof v === "string") add(entriesKeyVars[s.text], v, n);
      }
    }
    // defaults: X || lit, X ?? lit
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)) {
      const v = lit(n.right);
      const k = exprKey(n.left);
      if (k && !k[2] && v !== undefined) add(k[0], k[1], n, { default: v });
    }
    if (ts.isSwitchStatement(n)) {
      const k = exprKey(n.expression);
      if (k && !k[2]) add(k[0], k[1], n, { values: n.caseBlock.clauses.filter(ts.isCaseClause).map((c) => lit(c.expression)).filter((x) => x !== undefined) });
    }
    // { specials: el.specials } / vm.specials = el.specials → every special reaches the client
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "specials" && bucketOf(chain(n.initializer)) === "specials") flags.clientSpecials = true;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && /\.specials$/.test(n.left.getText()) && bucketOf(chain(n.right)) === "specials") flags.clientSpecials = true;
    ts.forEachChild(n, pass2);
  };
  pass2(fn.node);
  return { reads, parentReads, flags };
}

const cache = {};
const readOf = (k) => (cache[k] ||= readFn(fns[k]));
const mergeInto = (into, r) => {
  for (const [b, keys] of Object.entries(r.reads))
    for (const [k, v] of Object.entries(keys)) {
      const e = ((into[b] ||= {})[k] ||= { values: new Set(), at: v.at });
      if (v.default !== undefined && e.default === undefined) e.default = v.default;
      for (const x of v.values) e.values.add(x);
    }
};

// ── Per type ──────────────────────────────────────────────────────────────────────────────
const generic = new Set(reachable(GENERIC_ROOTS, 2));
const allTypes = new Set([...Object.keys(html), ...Object.keys(css), ...Object.keys(data.out)]);
const reach = {};
for (const t of allTypes) {
  const roots = [...(html[t] || []), ...(css[t] || []), ...(data.out[t] || data.deflt)];
  reach[t] = reachable(roots).filter((k) => !generic.has(k));
}
const fanIn = {};
for (const ks of Object.values(reach)) for (const k of ks) fanIn[k] = (fanIn[k] || 0) + 1;
const GENERIC = 12; // a helper more types reach than this is shared plumbing
const shared = {};
for (const k of generic) mergeInto(shared, readOf(k));

const types = {};
for (const t of [...allTypes].sort()) {
  const e = { html: (html[t] || []).map((k) => k.split("#")[1]), css: (css[t] || []).map((k) => k.split("#")[1]), data: (data.out[t] || data.deflt).map((k) => k.split("#")[1]) };
  const own = {};
  const parent = new Set();
  let stylesOpen = false;
  let clientSpecials = false;
  const dropped = new Set();
  for (const k of reach[t]) {
    const r = readOf(k);
    mergeInto(fanIn[k] > GENERIC ? shared : own, r);
    for (const p of r.parentReads) parent.add(p);
    // a generic style loop / pass-through only counts in the type's own CSS / data builders
    if ((css[t] || []).includes(k) && r.flags.stylesOpen) {
      stylesOpen = true;
      for (const d of r.flags.dropped) dropped.add(d);
    }
    if ((data.out[t] || data.deflt).includes(k) && r.flags.clientSpecials) clientSpecials = true;
  }
  for (const b of BUCKETS) if (own[b]) e[b] = own[b];
  if (stylesOpen) e.styles_open = true;
  if (dropped.size) e.styles_dropped = [...dropped].sort();
  if (clientSpecials) e.client_specials = true;
  if (parent.size) e.parent_reads = [...parent].sort();
  types[t] = e;
}

// ── Client runtime (render_v4): every identifier it mentions ──────────────────────────────
const clientFiles = [];
(function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name === "node_modules" || f.name === "addresses" || f.name === "test") continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(js|vue)$/.test(f.name)) clientFiles.push(p);
  }
})(path.join(BACKEND, "assets/render_v4"));
const mined = JSON.parse(fs.readFileSync("src/domains/landing/element-keys.generated.json", "utf8"));
const universe = new Set();
for (const t of Object.values(mined)) for (const b of BUCKETS) for (const k of Object.keys(t[b] || {})) universe.add(k);
const tokensOf = (files) => {
  const s = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/[A-Za-z_$][\w$]*/g)) if (universe.has(m[0])) s.add(m[0]);
  return s;
};
const client = tokensOf(clientFiles);
// Also any string literal / identifier on the server side (keys read through a key list or variable).
const server = tokensOf(FILES.map((f) => path.join(DIR, f)));

const ser = (o) => {
  if (o instanceof Set) return [...o].sort((a, b) => String(a).localeCompare(String(b)));
  if (Array.isArray(o)) return o.map(ser);
  if (o && typeof o === "object") {
    const r = {};
    for (const k of Object.keys(o).sort()) {
      const v = o[k];
      if (v instanceof Set && !v.size) continue;
      r[k] = ser(v);
    }
    return r;
  }
  return o;
};
let branch = "?";
try {
  branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: BUILD }).toString().trim();
} catch {}
if (branch !== "master" && branch !== "?") console.warn(`! landing_page_build is on "${branch}", not master`);
const out = {
  meta: { source: "landing_page_build/render/build (index.js, exportCss.js, event-data.js, animate.js, common.js) + landing_page_backend/assets/render_v4", branch, types: Object.keys(types).length, note: "at = file:line of the first read. styles_open: the CSS builder emits every styles key (minus styles_dropped). client_specials: all specials are shipped to window.event_data for the client runtime." },
  dispatched_html: Object.keys(html).sort(),
  dispatched_css: Object.keys(css).sort(),
  dispatched_data: Object.keys(data.out).sort(),
  shared: ser(shared),
  client_mentioned: [...client].sort(),
  server_mentioned: [...server].sort(),
  types: ser(types),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
const nKeys = Object.values(types).reduce((n, t) => n + BUCKETS.reduce((m, b) => m + Object.keys(t[b] || {}).length, 0), 0);
console.log(`${Object.keys(types).length} types (html ${out.dispatched_html.length}, css ${out.dispatched_css.length}), ${nKeys} per-type key reads, ${Object.values(types).filter((t) => t.styles_open).length} open-style types, shared ${BUCKETS.map((b) => `${Object.keys(shared[b] || {}).length} ${b}`).join(" / ")}; client mentions ${client.size} keys → ${path.relative(process.cwd(), OUT)}`);
