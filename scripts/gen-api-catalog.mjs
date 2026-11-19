#!/usr/bin/env node
// Generate src/api-catalog.generated.json — every landing_page_backend route the MCP's JWT can
// call (pipe_through :passport + :account), read STATICALLY from the Phoenix router and
// controllers, so api_find / api_call cover the whole backend without a hand-written tool per route.
//
//   LANDING_BACKEND_DIR=../landing_page_backend node scripts/gen-api-catalog.mjs
//
// Per route: method, path, the host it lives on (`api` = config.base, unscoped /api/v1/…;
// `builder` = config.builderBase, the `host: "builder."` scope), Controller.action, the
// permission pipelines it runs through, and the body/query keys the action reads — top-level
// keys the clause pattern-matches (required: it won't match without them, the backend 500s) or
// reads from params, plus, for a key bound to a variable, the fields read off it one level down.
// Ported from webcake_cms_mcp/scripts/gen-api-catalog.mjs (builderx_api).
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(process.env.LANDING_BACKEND_DIR || new URL("../../landing_page_backend", import.meta.url).pathname);
const ROUTER = join(ROOT, "lib/landing_page_web/router.ex");
const BASE_ALIAS = "LandingPageWeb";
const OUT = new URL("../src/api-catalog.generated.json", import.meta.url);

/** Pipelines that are not a permission (content negotiation / auth itself). */
const PLAIN_PIPES = new Set(["api", "public", "browser", "passport", "account"]);
/** Need a credential the MCP token isn't (super admin role). Their routes are left out. */
const UNREACHABLE_PIPES = new Set(["super_admin", "service_secret", "susa_plug", "pos_api", "pos_api_check", "gateway_auth", "webhook_transactions_pancake", "public_api", "end_user"]);
/** HTML pages (the editor shell), not API. */
const HTML_ACTION = /^(render_|uncatch_url$|get_blank$|transport$|logout$)/;

const VERBS = "get|post|put|patch|delete";
const stripComments = (src) => src.replace(/^\s*#.*$/gm, "").replace(/\s+#(?![{]).*$/gm, "");

// ── Router ──────────────────────────────────────────────────────────────────────────────
function parseRouter() {
  const src = stripComments(readFileSync(ROUTER, "utf8"));
  const routes = [];
  // Statement tokens in source order. Verb calls may span lines; \s joins them.
  const re = new RegExp(
    [
      String.raw`(?<pipeline>^\s*pipeline\s+:(?<pname>\w+)\s+do\s*$)`,
      String.raw`(?<scope>^\s*scope\s*\(?\s*(?:"(?<spath>[^"]*)")?\s*(?:,\s*(?<salias>[A-Z][\w.]*))?(?<srest>[^\n]*)\bdo\s*$)`,
      String.raw`(?<pipe>^\s*pipe_through\s*\(?\s*(?<plist>\[[^\]]*\]|:\w+))`,
      String.raw`(?<verb>^\s*(?<v>${VERBS})\s*\(?\s*"(?<vpath>[^"]*)"\s*,\s*(?<ctrl>[\w.]+)\s*,\s*:(?<action>\w+))`,
      String.raw`(?<open>^[^\n]*\bdo\s*$)`,
      String.raw`(?<close>^\s*end\b)`,
    ].join("|"),
    "gm"
  );
  const root = () => ({ kind: "root", path: "", alias: BASE_ALIAS, host: undefined, pipes: [] });
  const stack = [root()];
  for (const m of src.matchAll(re)) {
    const g = m.groups;
    const top = stack[stack.length - 1];
    if (g.pipeline) {
      stack.push({ ...top, kind: "pipeline" });
    } else if (g.scope) {
      const alias = g.salias ? (g.salias.startsWith(BASE_ALIAS) ? g.salias : `${top.alias}.${g.salias}`) : top.alias;
      const seg = g.spath ? (g.spath.startsWith("/") ? g.spath : `/${g.spath}`) : "";
      const host = /host:\s*"([^"]*)"/.exec(g.srest || "")?.[1] ?? top.host;
      stack.push({ kind: "scope", path: top.path + seg, alias, host, pipes: [...top.pipes] });
    } else if (g.pipe) {
      top.pipes.push(...[...g.plist.matchAll(/:(\w+)/g)].map((x) => x[1]));
    } else if (g.verb) {
      const path = (top.path + (g.vpath.startsWith("/") || !g.vpath ? g.vpath : `/${g.vpath}`)).replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
      routes.push({ method: g.v.toUpperCase(), path, alias: top.alias, ctrl: g.ctrl, action: g.action, host: top.host, pipes: [...top.pipes] });
    } else if (g.open) {
      stack.push({ ...top, kind: "block" });
    } else if (g.close) {
      stack.pop();
      if (!stack.length) stack.push(root());
    }
  }
  return routes;
}

// ── Controllers: module → file, then the keys an action reads ────────────────────────────
function walkFiles(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (f.endsWith(".ex")) out.push(p);
  }
  return out;
}
const MODULE_FILE = {};
for (const f of walkFiles(join(ROOT, "lib"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/^defmodule\s+([\w.]+)\s+do/gm)) MODULE_FILE[m[1]] = f;
}
/** `V1.PageController` inside `scope …, V1` reads as V1.V1.PageController — try the alias, then the base. */
const controllerOf = (alias, ctrl) => [`${alias}.${ctrl}`, `${BASE_ALIAS}.${ctrl}`, ctrl].find((c) => MODULE_FILE[c]) || `${alias}.${ctrl}`;

/** Each `def action(` clause of a module: its head (args) and body text. */
function clausesOf(file, action) {
  const src = stripComments(readFileSync(file, "utf8"));
  const out = [];
  const re = new RegExp(String.raw`^(\s*)def\s+${action}\s*\(`, "gm");
  for (const m of src.matchAll(re)) {
    const indent = m[1].length;
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    const head = src.slice(m.index + m[0].length, i - 1);
    const rest = src.slice(i);
    const next = new RegExp(String.raw`^\s{${indent}}(def|defp|defmacro)\s`, "m").exec(rest);
    out.push({ head, body: next ? rest.slice(0, next.index) : rest });
  }
  return out;
}

const PATH_PARAM = /:(\w+)/g;

/** Split a call's argument list at top-level commas. */
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** `Foo` in a controller → the full module, via its `alias` lines (or a unique last-segment match). */
function resolveModule(file, short) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/^\s*alias\s+([\w.]+)(?:\.\{([^}]+)\})?(?:,\s*as:\s*(\w+))?/gm)) {
    if (m[2]) {
      for (const part of m[2].split(",").map((x) => x.trim())) if (part.split(".").pop() === short.split(".")[0]) return `${m[1]}.${part}${short.slice(short.split(".")[0].length)}`;
    } else if ((m[3] || m[1].split(".").pop()) === short.split(".")[0]) return `${m[1]}${short.slice(short.split(".")[0].length)}`;
  }
  if (MODULE_FILE[short]) return short;
  const hits = Object.keys(MODULE_FILE).filter((k) => k.endsWith(`.${short}`));
  return hits.length === 1 ? hits[0] : undefined;
}
const readsOf = (body, v) =>
  [...body.matchAll(new RegExp(String.raw`\b${v}\["([\w-]+)"\]|Map\.get\(\s*${v}\s*,\s*"([\w-]+)"|"([\w-]+)"\s*=>\s*\w+[^\n]*\}\s*=\s*${v}\b`, "g"))].map((r) => r[1] || r[2] || r[3]);
/** Keys read by functions the action hands `v` to, one call deep (Module.fun(…, v, …)). */
function followReads(file, body, v) {
  const keys = new Set();
  for (const c of body.matchAll(/\b([A-Z][\w.]*)\.(\w+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    const args = splitArgs(c[3]);
    const pos = args.findIndex((a) => a === v);
    if (pos < 0) continue;
    const mod = resolveModule(file, c[1]);
    const target = mod && MODULE_FILE[mod];
    if (!target) continue;
    for (const { head, body: fb } of clausesOf(target, c[2])) {
      const arg = splitArgs(head)[pos];
      if (!arg) continue;
      const pv = /=\s*(\w+)\s*$/.exec(arg)?.[1] || /^(\w+)$/.exec(arg)?.[1];
      for (const k of [...arg.matchAll(/"([\w-]+)"\s*=>/g)].map((x) => x[1])) keys.add(k);
      if (pv && !pv.startsWith("_")) readsOf(fb, pv).forEach((k) => keys.add(k));
    }
  }
  return keys;
}
function bodyOf(controller, action, pathParams) {
  const file = MODULE_FILE[controller];
  if (!file) return null;
  const clauses = clausesOf(file, action);
  if (!clauses.length) return null;
  const fields = {}; // key → Set(sub) | null
  let required = null;
  for (const { head, body } of clauses) {
    // Second argument: `%{ "k" => var, ... } = params` | `params` | `_`.
    const arg = head.replace(/^\s*[\w_]+\s*,/, "");
    const pattern = /%\{([\s\S]*?)\}/.exec(arg)?.[1] || "";
    const bound = [...pattern.matchAll(/"([\w-]+)"\s*=>\s*(\w+)?/g)];
    const keys = new Set(bound.map((b) => b[1]));
    required = required ? new Set([...required].filter((k) => keys.has(k))) : keys;
    const paramsVar = /=\s*(\w+)\s*$/.exec(arg.trim())?.[1] || /^\s*(params|_params)\s*$/.exec(arg)?.[1];
    const touch = (k) => (fields[k] ??= null);
    keys.forEach(touch);
    if (paramsVar && !paramsVar.startsWith("_")) {
      for (const r of body.matchAll(new RegExp(String.raw`\b${paramsVar}\["([\w-]+)"\]|Map\.get\(\s*${paramsVar}\s*,\s*"([\w-]+)"`, "g"))) touch(r[1] || r[2]);
      followReads(file, body, paramsVar).forEach(touch);
    }
    for (const [, key, v] of bound) {
      if (!v || v.startsWith("_")) continue;
      for (const r of body.matchAll(new RegExp(String.raw`\b${v}\["([\w-]+)"\]|Map\.get\(\s*${v}\s*,\s*"([\w-]+)"`, "g"))) {
        const sub = r[1] || r[2];
        if (!(fields[key] instanceof Set)) fields[key] = new Set();
        fields[key].add(sub);
      }
    }
  }
  for (const p of pathParams) {
    delete fields[p];
    required?.delete(p);
  }
  const body = Object.fromEntries(Object.entries(fields).sort().map(([k, v]) => [k, v ? [...v].sort() : null]));
  return { required: [...(required || [])].sort(), body };
}

/** What the pipelines check, in the editor's words. */
function permOf(pipes) {
  if (pipes.includes("page_owner")) return "page owner";
  if (pipes.includes("can_edit")) return "page edit";
  if (pipes.includes("can_view") || pipes.includes("page_right")) return "page view";
  if (pipes.includes("team")) return "team member";
  if (pipes.includes("organization")) return "org member";
  return undefined;
}

// ── Assemble ────────────────────────────────────────────────────────────────────────────
const ops = [];
const seen = new Set();
let undescribed = 0;
for (const r of parseRouter()) {
  if (!r.pipes.includes("passport") || r.pipes.some((p) => UNREACHABLE_PIPES.has(p))) continue;
  if (HTML_ACTION.test(r.action) || r.path.includes("*")) continue;
  // Unscoped routes answer on api.webcake.io; `host: "builder."` ones only on builder.webcake.io.
  const base = r.host === undefined ? "api" : r.host.startsWith("builder.") ? "builder" : null;
  if (!base) continue;
  const id = `${r.method.toLowerCase()}:${r.path}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const controller = controllerOf(r.alias, r.ctrl);
  const pathParams = [...r.path.matchAll(PATH_PARAM)].map((m) => m[1]);
  const shape = bodyOf(controller, r.action, pathParams);
  if (!shape) undescribed++;
  const pipelines = r.pipes.filter((p) => !PLAIN_PIPES.has(p));
  const perm = permOf(pipelines);
  ops.push({
    id,
    method: r.method,
    base,
    path: r.path,
    handler: `${controller.replace(/^LandingPageWeb\.(V1\.)?/, "")}.${r.action}`,
    ...(pipelines.length ? { pipelines } : {}),
    ...(perm ? { perm } : {}),
    ...(shape && Object.keys(shape.body).length ? { params: shape.body } : {}),
    ...(shape?.required.length ? { required: shape.required } : {}),
  });
}
ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const git = (...a) => {
  try {
    return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
};
const meta = { generated_from: "landing_page_backend router + controllers (static)", backend: `${git("rev-parse", "--abbrev-ref", "HEAD")}@${git("rev-parse", "--short", "HEAD")}`, operations: ops.length, undescribed };
if (meta.backend && !/^(master|main)@/.test(meta.backend)) console.error(`warning: landing_page_backend is on ${meta.backend}, not master — routes may not exist on prod yet`);
writeFileSync(OUT, `{"meta":${JSON.stringify(meta)},"ops":[\n${ops.map((o) => JSON.stringify(o)).join(",\n")}\n]}\n`);
console.error(`${ops.length} operations (${undescribed} without a readable action) → ${OUT.pathname}`);
