/**
 * api_find / api_get / api_call: the whole landing_page_backend surface the account's JWT can
 * reach, from src/api-catalog.generated.json (scripts/gen-api-catalog.mjs reads the Phoenix router
 * and controllers). Ported from webcake_cms_mcp's storefront gateway.
 *
 * The dedicated tools stay the way to do anything they cover: a write to a route one of them owns
 * is refused here and names that tool, since those tools carry the guards (validation, layout
 * repair, image/font re-hosting, version conflict check, by_ai, publish build). Irreversible
 * account-level writes are refused outright. Every other write defaults to dry_run.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text } from "../mcp/response.js";
import { readConfig, configFromHeaders } from "../persistence/config.js";
import { apiRequest } from "../persistence/webcake-client.js";

export interface ApiOp {
  id: string;
  method: string;
  /** `api` = config.base (api.webcake.io), `builder` = config.builderBase (builder.webcake.io). */
  base: "api" | "builder";
  path: string;
  handler: string;
  /** Permission plugs the route runs through (org_check, page_right, can_edit, organization…). */
  pipelines?: string[];
  /** What the account needs on the page/org: page view | page edit | page owner | org member | team member. */
  perm?: string;
  /** Body (non-GET) or query (GET) keys the action reads; a key's array = its fields one level down. */
  params?: Record<string, string[] | null>;
  required?: string[];
}

let CATALOG: { meta: any; ops: ApiOp[] } = { meta: {}, ops: [] };
try {
  CATALOG = JSON.parse(readFileSync(new URL("../api-catalog.generated.json", import.meta.url), "utf8"));
} catch {
  /* catalog missing: the tools answer with an empty list */
}
export const API_OPS = CATALOG.ops;
const BY_ID = new Map(API_OPS.map((o) => [o.id, o]));

/** Routes a dedicated tool owns. Writes here are refused (the tool holds the guards); GETs just get a pointer. */
export const TOOL_FOR: Record<string, string> = {
  "post:/api/v1/ai/create_page_from_source": "create_page",
  "post:/api/v1/pages/create": "create_page",
  "post:/api/v1/ai/update_page_source": "update_page / patch_page",
  "put:/api/pages/:page_id/edit/save": "update_page / patch_page",
  "post:/api/v1/ai/append_section": "add_section",
  "post:/api/pages/:page_id/edit/publish": "publish_page",
  "post:/api/pages/:page_id/edit/publish_html": "publish_page",
  "post:/api/persona/upload": "upload_images",
  "post:/api/organization/upload": "upload_images",
  "post:/api/upload": "upload_images",
  "post:/api/v1/assets/upload": "upload_images",
  "post:/api/pages/:page_id/edit/upload": "upload_images",
  "post:/api/pages/:page_id/fonts/create_or_update_font_group": "update_page (a save syncs the page's font groups)",
  "post:/api/pages/:page_id/fonts/update_font_group_data": "update_page (a save syncs the page's font groups)",
  "post:/api/pages/:page_id/fonts/create_or_update_font": "update_page (a save syncs the page's font groups)",
  "post:/api/pages/:page_id/fonts/auto_group_fonts": "update_page (a save syncs the page's font groups)",
  "get:/api/v1/ai/pages": "list_pages",
  "get:/api/v1/ai/search_pages": "find_pages",
  "get:/api/v1/ai/page_source": "get_page",
  "get:/api/v1/org/organizations": "list_organizations",
};

/** Irreversible or account-level operations: never through the generic gateway (matched on the path). */
export const DENY: [RegExp, string][] = [
  [/^\/api\/v1\/admin\/|^\/susa|^\/webhook|^\/pos_api|^\/api\/v1\/external\/pages/, "needs a super-admin / service / webhook / POS / gateway credential, not the account token"],
  [/\/pages\/delete$|\/page\/:page_id\/delete$|\/page\/:page_id\/override_page$|delete_permanently/, "deleting or overwriting pages (and emptying the trash) is done by the user in the Webcake dashboard"],
  [/^\/api\/v1\/org\/:org_id\/|\/set_resource_participants$|\/account\/join_organization$|\/account\/invitations\//, "organization members, roles, teams, invitations and settings are managed by an org admin in the Webcake dashboard"],
  [/\/permissions\/|\/admin\/right$|\/edit\/invite$|\/leave_page$|\/tags\/permission$/, "page sharing and permissions are changed by the page owner in the Webcake editor"],
  [/transfer|move_all_to_org$|move_to_org$|move_pages/, "moving pages or resources between accounts / organizations is done in the Webcake dashboard"],
  [/\/subscriptions\/|\/stripe\/|\/payment\/|affiliate_payout|commission|gen_affiliate_code/, "billing, payments and subscriptions are handled in the Webcake dashboard"],
  [/\/domains\/delete$/, "deleting a domain is done in the Webcake dashboard"],
  [/\/account\/(logout_sessions|update_account|change_info|settings)$/, "account settings and sessions are changed by the user in Webcake (logout_sessions would also end this MCP's session)"],
  [/\/external\/api_keys\/|\/access\/(create_keys|create_key_manual|delete_keys)$/, "API / access keys are credentials — create or revoke them in the Webcake dashboard"],
  [/\/form_data\/delete$/, "deleting collected form submissions (customer leads) cannot be undone — do it in the Webcake dashboard"],
];
export const denyReason = (o: ApiOp) => (o.method === "GET" && !DENY[0][0].test(o.path) ? undefined : DENY.find(([re]) => re.test(o.path))?.[1]);

const pathParams = (path: string) => [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
const words = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** One line per operation — what api_find returns for a query. */
export function opLine(o: ApiOp): string {
  const keys = o.params ? Object.keys(o.params) : [];
  const shown = keys.slice(0, 6).map((k) => (o.required?.includes(k) ? `${k}*` : k));
  return `${o.id} — ${o.handler}${shown.length ? ` (${shown.join(", ")}${keys.length > 6 ? ", …" : ""})` : ""}${o.perm ? ` [${o.perm}]` : ""}${TOOL_FOR[o.id] ? ` ⇒ tool: ${TOOL_FOR[o.id]}` : ""}${o.method !== "GET" && denyReason(o) ? " ⛔ refused" : ""}`;
}

export function searchOps(query: string, limit = 15, method?: string): ApiOp[] {
  const terms = words(query);
  return API_OPS.filter((o) => !method || o.method === method.toUpperCase())
    .map((o) => {
      const segs = words(o.path.replace(/:\w+/g, ""));
      const hw = words(o.handler);
      const pw = Object.keys(o.params || {}).flatMap(words);
      let s = 0;
      for (const t of terms) {
        if (segs.includes(t)) s += 3;
        else if (segs.some((w) => w.startsWith(t) || (t.startsWith(w) && w.length > 3))) s += 2;
        if (hw.includes(t)) s += 2;
        if (pw.includes(t)) s += 1;
      }
      return { o, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.o.path.length - b.o.path.length)
    .slice(0, limit)
    .map((x) => x.o);
}

/** The call sheet: everything needed to call one operation correctly. */
export function describeOp(o: ApiOp) {
  const where = o.method === "GET" ? "query" : "body";
  const deny = denyReason(o);
  return {
    id: o.id,
    method: o.method,
    host: o.base === "builder" ? "builder host (builder.webcake.io)" : "API host (api.webcake.io)",
    path: o.path,
    handler: o.handler,
    path_params: pathParams(o.path),
    [where]: o.params || "not readable from the controller — send a modified copy of the matching GET",
    ...(o.required ? { required: o.required } : {}),
    ...(o.perm ? { needs_permission: o.perm } : {}),
    ...(o.pipelines?.includes("org_check") ? { organization: "x-org-id is sent from org_id (or the configured org); many org_check routes 500 without one" } : {}),
    ...(TOOL_FOR[o.id]
      ? { prefer_tool: TOOL_FOR[o.id], note: o.method === "GET" ? "A dedicated tool covers this route and returns a cleaner result." : "Writes to this route go through the dedicated tool (it carries the guards); api_call refuses them." }
      : {}),
    ...(deny ? { refused: deny } : {}),
  };
}

// Never hand a secret to the model: values under these keys are replaced in every result.
const SECRET_KEY = /secret|passw|token|jwt|cookie|api_?key|private_?key|access_?key|hash_?key|checksum|signature|credential|invite_code|(^|_)otp(_|$)/i;
/** On a route that hands out credentials (…/token, …/api_keys), a bare `key` / `value` is the secret too. */
const SECRET_ROUTE = /token|api_key|secret|credential|keys/i;
export function redactSecrets(v: any, secretRoute = false, depth = 0): any {
  if (depth > 12 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => redactSecrets(x, secretRoute, depth + 1));
  const out: Record<string, any> = {};
  for (const [k, x] of Object.entries(v)) {
    const secret = SECRET_KEY.test(k) || (secretRoute && /^(key|value)$/.test(k));
    out[k] = secret && x !== null && x !== "" && typeof x !== "boolean" && typeof x !== "object" ? "[redacted]" : redactSecrets(x, secretRoute, depth + 1);
  }
  return out;
}

/** Trim a response for the model: keep `pick` fields per item, cap list length. The list is the
 *  first array found at the top or one level down (`{ dataset_entities: { data: [...] } }`). */
export function trimResult(res: any, pick?: string[], maxItems = 50): any {
  const pickOne = (x: any) =>
    pick && x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(pick.filter((k) => k in x).map((k) => [k, x[k]])) : x;
  const trimList = (arr: any[]) => {
    const items = arr.slice(0, maxItems).map(pickOne);
    return arr.length > maxItems ? { items, total_items: arr.length, truncated: true } : items;
  };
  const isObj = (x: any) => x && typeof x === "object" && !Array.isArray(x);
  if (Array.isArray(res)) return trimList(res);
  if (!isObj(res)) return res;
  for (const [k, v] of Object.entries(res)) if (Array.isArray(v)) return { ...res, [k]: trimList(v) };
  for (const [k, v] of Object.entries(res))
    if (isObj(v)) for (const [k2, v2] of Object.entries(v as object)) if (Array.isArray(v2)) return { ...res, [k]: { ...(v as object), [k2]: trimList(v2) } };
  return pick ? pickOne(res) : res;
}

const MAX_CHARS = 30_000;

export function registerApiGatewayTools(server: McpServer) {
  const cfgFor = (extra: any) => readConfig(configFromHeaders(extra?.requestInfo?.headers));

  server.tool(
    "api_find",
    `Search the FULL Webcake landing backend API (${API_OPS.length} operations the account's token can call — datasets/records, domains, form data, tags, UTM, campaigns, media library, org/teams, page settings…, far more than the dedicated tools cover). With \`query\`: one line per match \`id — Controller.action (body/query keys, * = required) [permission] ⇒ tool: dedicated tool if one exists\`. With \`id\`: the call sheet (host, path params, body/query keys with nested fields, required keys, permission). Prefer a dedicated tool when one is listed; use api_get / api_call for the rest.`,
    {
      query: z.string().optional().describe("English keywords from the path/controller, e.g. 'dataset records', 'form data', 'domain verify', 'utm'"),
      id: z.string().optional().describe("Exact operation id from a previous search, e.g. 'get:/api/datasets/records'"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("Only this HTTP method"),
      limit: z.number().int().min(1).max(40).optional().describe("Max lines (default 15)"),
    },
    { title: "Find Webcake API Operations", readOnlyHint: true, openWorldHint: false },
    async ({ query, id, method, limit }) => {
      if (id) {
        const o = BY_ID.get(id);
        return text(o ? describeOp(o) : { ok: false, error: `Unknown operation "${id}". Search with api_find({ query }).` });
      }
      if (!query) return text({ ok: false, error: "Pass query (keywords) or id (an operation id)." });
      const hits = searchOps(query, limit ?? 15, method);
      return text(hits.length ? hits.map(opLine).join("\n") : `No operation matches "${query}". Try other English words from the path (e.g. 'dataset', 'domain', 'tag', 'form').`);
    }
  );

  const call = async (args: any, extra: any, readOnly: boolean) => {
    const o = args.id ? BY_ID.get(args.id) : API_OPS.find((x) => x.method === String(args.method || "").toUpperCase() && x.path === args.path);
    if (!o) return { ok: false, error: `Unknown operation${args.id ? ` "${args.id}"` : ""}. Find it with api_find({ query }) and pass its id.` };
    if (readOnly && o.method !== "GET") return { ok: false, error: `${o.id} is a ${o.method} — run it with api_call.` };
    const deny = denyReason(o);
    if (deny) return { ok: false, refused: true, error: `Refused: ${deny}.` };
    if (o.method !== "GET" && TOOL_FOR[o.id]) return { ok: false, refused: true, use_tool: TOOL_FOR[o.id], error: `Refused: ${o.id} is written through ${TOOL_FOR[o.id]} — that tool validates and guards this write. Use it instead.` };

    const { config, missing: missingEnv } = cfgFor(extra);
    if (!config) return { ok: false, reason: "missing_env", missing_env: missingEnv, hint: "Run `webcake-landing-mcp login` (stdio) or send the JWT via the x-webcake-jwt header (remote)." };
    // "personal" = no organization: an empty x-org-id is not sent.
    const orgId = args.org_id === "personal" ? "" : args.org_id ?? config.orgId;

    const params: Record<string, string> = { ...(args.path_params || {}) };
    if (params.org_id == null && orgId && pathParams(o.path).includes("org_id")) params.org_id = orgId;
    const missingPath = pathParams(o.path).filter((p) => params[p] == null || params[p] === "");
    if (missingPath.length) return { ok: false, error: `Missing path_params: ${missingPath.join(", ")}. Call sheet: api_find({ id: "${o.id}" }).` };
    const path = o.path.replace(/:(\w+)/g, (_, p) => encodeURIComponent(String(params[p])));

    const input = o.method === "GET" ? args.query || {} : args.body || {};
    const missing = (o.required || []).filter((k) => input[k] === undefined);
    if (missing.length) return { ok: false, error: `Missing required ${o.method === "GET" ? "query" : "body"} keys: ${missing.join(", ")}. Call sheet: api_find({ id: "${o.id}" }).` };
    const unknown = o.params ? Object.keys(input).filter((k) => !(k in o.params!)) : [];

    if (o.method !== "GET" && args.dry_run !== false)
      return {
        dry_run: true,
        would_send: { method: o.method, host: o.base === "builder" ? config.builderBase ?? config.base : config.base, path, ...(args.query ? { query: args.query } : {}), body: input, ...(orgId ? { "x-org-id": orgId } : {}) },
        ...(unknown.length ? { unknown_keys: unknown, note: "the action never reads these keys" } : {}),
        next: "Show the user what will change; on their OK call again with dry_run:false.",
      };

    let res;
    try {
      res = await apiRequest(config, { base: o.base, method: o.method, path, ...(o.method === "GET" ? { query: input } : { body: input, query: args.query }), orgId });
    } catch (e: any) {
      return { ok: false, error: `Network error: ${e?.message ?? e}` };
    }
    if (!res.ok) {
      const detail = res.json ?? (/^\s*</.test(res.text) ? "HTML error page — usually a missing/invalid param or organization (x-org-id)" : res.text.slice(0, 300));
      // An org_check route answers a bare 500 when no organization is sent: say what to pass.
      const hint =
        res.status === 403 && o.perm ? `needs ${o.perm} permission`
        : res.status >= 500 && !orgId && o.pipelines?.includes("org_check") ? "this route runs in an organization: call list_organizations and pass org_id"
        : undefined;
      return { ok: false, status: res.status, error: redactSecrets(detail), ...(hint ? { hint } : {}), call_sheet: `api_find({ id: "${o.id}" })` };
    }
    let data = res.json ?? res.text;
    // Some controllers send Jason.encode!(…) through json/2: the body is a JSON string of JSON.
    if (typeof data === "string") try { data = JSON.parse(data); } catch { /* plain text */ }
    const out = trimResult(redactSecrets(data, SECRET_ROUTE.test(o.path)), args.pick, args.max_items ?? 50);
    const body = JSON.stringify(out);
    return {
      ok: true,
      ...(unknown.length ? { unknown_keys: unknown } : {}),
      result: body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}… (cut at ${MAX_CHARS} chars — narrow with pick / max_items / query filters)` : out,
    };
  };

  const shared = {
    id: z.string().optional().describe("Operation id from api_find (preferred)"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("With path, when id is not given"),
    path: z.string().optional().describe("Catalog path with :params, e.g. /api/datasets/records"),
    path_params: z.record(z.string()).optional().describe("Values for :params in the path (page_id, org_id…); org_id defaults to the selected organization"),
    query: z.record(z.any()).optional().describe("Query-string values"),
    org_id: z.string().optional().describe("Organization sent as x-org-id ('personal' = none); default: the configured org. Many routes need it."),
    pick: z.array(z.string()).optional().describe("Keep only these fields on each item of a list result (or on a single object)"),
    max_items: z.number().int().min(1).max(500).optional().describe("Cap list results (default 50)"),
  };

  server.tool(
    "api_get",
    "Run a READ-ONLY (GET) operation from api_find by id. Use pick / max_items to keep the result small; pass org_id for organization-scoped data. Refuses anything that is not a GET.",
    shared,
    { title: "Webcake API GET", readOnlyHint: true, openWorldHint: true },
    async (args, extra) => text(await call(args, extra, true))
  );

  server.tool(
    "api_call",
    "Run any operation from api_find by id (GET, POST, PUT, PATCH, DELETE). Writes default to dry_run:true and return exactly what would be sent — show the user, then repeat with dry_run:false. Refuses writes to routes a dedicated tool owns (it names the tool) and irreversible account operations (page/domain deletion, org members/roles/transfers, permissions, billing, credentials). Required keys are checked against the call sheet before sending.",
    {
      ...shared,
      body: z.any().optional().describe("JSON body for POST/PUT/PATCH/DELETE (keys from the call sheet)"),
      dry_run: z.boolean().optional().describe("Default true for writes: describe, don't send"),
    },
    { title: "Webcake API Call", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async (args, extra) => text(await call(args, extra, false))
  );
}
