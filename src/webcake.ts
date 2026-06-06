/**
 * Thin HTTP client to talk to a Webcake backend:
 *  - list the account's organizations (GET /api/v1/org/organizations)
 *  - persist a generated page source (POST /api/v1/ai/create_page_from_source,
 *    added in lib/landing_page_web/controllers/v1/ai/ai_controller.ex)
 *
 * The page lands in an organization when an `x-org-id` header is sent (resolved
 * by the backend `:org_check` plug). Without it the page is personal (org=null).
 *
 * Config via environment (set in the MCP server config):
 *   WEBCAKE_API_BASE  e.g. http://localhost:5800   (required to call the backend)
 *   WEBCAKE_JWT       the account JWT               (required to call the backend)
 *   WEBCAKE_ORG_ID    optional default organization id for create_page
 *   WEBCAKE_HOST      optional Host header override (Phoenix routes by host)
 *   WEBCAKE_APP_BASE  optional base for editor/preview URLs in the result
 */

export type WebcakeConfig = {
  base: string;
  jwt: string;
  orgId?: string;
  host?: string;
  appBase?: string;
};

const CREATE_ENDPOINT = "/api/v1/ai/create_page_from_source";
const ORGS_ENDPOINT = "/api/v1/org/organizations";
const PAGES_ENDPOINT = "/api/v1/ai/pages";
const PAGE_SOURCE_ENDPOINT = "/api/v1/ai/page_source";
const UPDATE_ENDPOINT = "/api/v1/ai/update_page_source";

export function readConfig(): { config: WebcakeConfig | null; missing: string[] } {
  const base = process.env.WEBCAKE_API_BASE;
  const jwt = process.env.WEBCAKE_JWT;
  const missing: string[] = [];
  if (!base) missing.push("WEBCAKE_API_BASE");
  if (!jwt) missing.push("WEBCAKE_JWT");
  if (missing.length) return { config: null, missing };
  return {
    config: {
      base: base!.replace(/\/+$/, ""),
      jwt: jwt!,
      orgId: process.env.WEBCAKE_ORG_ID,
      host: process.env.WEBCAKE_HOST,
      appBase: process.env.WEBCAKE_APP_BASE?.replace(/\/+$/, ""),
    },
    missing: [],
  };
}

function authHeaders(config: WebcakeConfig, orgId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${config.jwt}`,
    Cookie: `jwt=${config.jwt}`,
  };
  if (config.host) headers["Host"] = config.host;
  const org = orgId ?? config.orgId;
  if (org != null && `${org}` !== "") headers["x-org-id"] = `${org}`;
  return headers;
}

/** Build (but do not send) the create request — used for dry-run previews. */
export function buildRequest(config: WebcakeConfig, name: string, source: unknown, orgId?: string) {
  return {
    method: "POST",
    url: `${config.base}${CREATE_ENDPOINT}`,
    headers: authHeaders(config, orgId),
    body: JSON.stringify({ name, source }),
  };
}

/** Same as buildRequest but with the token masked, safe to show to the user. */
export function buildRequestRedacted(config: WebcakeConfig, name: string, source: unknown, orgId?: string) {
  const req = buildRequest(config, name, source, orgId);
  const mask = (s: string) => s.replace(config.jwt, "***JWT***");
  return {
    method: req.method,
    url: req.url,
    headers: { ...req.headers, Authorization: "Bearer ***JWT***", Cookie: "jwt=***JWT***" },
    body: mask(req.body).slice(0, 400) + (req.body.length > 400 ? `… (${req.body.length} bytes)` : ""),
  };
}

export type Organization = { id: number | string; name: string; type: number | null; is_default: boolean };

/** List the account's organizations. type===1 is the default ("personal") org. */
export async function listOrganizations(
  config: WebcakeConfig
): Promise<{ ok: boolean; status: number; organizations?: Organization[]; default_org_id?: number | string; error?: string }> {
  const url = `${config.base}${ORGS_ENDPOINT}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: authHeaders(config) });
  } catch (e: any) {
    return { ok: false, status: 0, error: `Network error calling ${url}: ${e?.message ?? e}` };
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `Backend returned ${res.status}: ${text.slice(0, 300)}` };
  }
  const list: any[] = json?.organizations ?? json?.data ?? [];
  const organizations: Organization[] = list.map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type ?? null,
    is_default: o.type === 1,
  }));
  const def = organizations.find((o) => o.is_default);
  return { ok: true, status: res.status, organizations, default_org_id: def?.id };
}

export type CreateOutcome = {
  ok: boolean;
  status: number;
  page_id?: string;
  editor_url?: string;
  preview_url?: string;
  organization_id?: number | string | null;
  raw?: unknown;
  error?: string;
};

/** Actually POST the source. Requires global fetch (Node 18+). */
export async function createPage(
  config: WebcakeConfig,
  name: string,
  source: unknown,
  orgId?: string
): Promise<CreateOutcome> {
  const req = buildRequest(config, name, source, orgId);
  let res: Response;
  try {
    res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  } catch (e: any) {
    return { ok: false, status: 0, error: `Network error calling ${req.url}: ${e?.message ?? e}` };
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }

  const data = json?.data ?? json;
  const pageId = data?.page_id;
  const editorPath = data?.editor_url;
  const previewPath = data?.preview_url;
  const app = config.appBase;

  if (!res.ok || !pageId) {
    // The backend's failure envelope is { success:false, message } on 422; auth
    // plugs return plain-text 401/403 (json is null). Surface the real reason
    // instead of a bare status so the user/LLM sees e.g. "Page not found…".
    const backendMsg = json?.message ?? json?.reason ?? (json ? undefined : text.slice(0, 200));
    return {
      ok: false,
      status: res.status,
      raw: json ?? text.slice(0, 600),
      error: `Backend returned ${res.status}${backendMsg ? `: ${backendMsg}` : pageId ? "" : " (no page_id in response)"}`,
    };
  }
  return {
    ok: true,
    status: res.status,
    page_id: pageId,
    editor_url: app && editorPath ? `${app}${editorPath}` : editorPath,
    preview_url: app && previewPath ? `${app}${previewPath}` : previewPath,
    organization_id: (orgId ?? config.orgId) ?? null,
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Read / list / edit existing pages
// ---------------------------------------------------------------------------

export type PageSummary = {
  id: string;
  name: string;
  organization_id: number | string | null;
  engine?: number;
  updated_at?: string;
};

async function getJson(url: string, config: WebcakeConfig) {
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: authHeaders(config) });
  } catch (e: any) {
    return { ok: false, status: 0, json: null, text: "", error: `Network error calling ${url}: ${e?.message ?? e}` };
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, json, text, error: res.ok ? undefined : `Backend returned ${res.status}: ${text.slice(0, 300)}` };
}

/** List pages owned by the account (most-recent first). */
export async function listPages(
  config: WebcakeConfig
): Promise<{ ok: boolean; status: number; pages?: PageSummary[]; error?: string }> {
  const r = await getJson(`${config.base}${PAGES_ENDPOINT}`, config);
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  const pages: PageSummary[] = r.json?.data?.pages ?? r.json?.pages ?? [];
  return { ok: true, status: r.status, pages };
}

/** Read a page's decoded source tree (must be owned by the account). */
export async function getPageSource(
  config: WebcakeConfig,
  pageId: string
): Promise<{ ok: boolean; status: number; page_id?: string; name?: string; organization_id?: number | string | null; source?: any; error?: string }> {
  const url = `${config.base}${PAGE_SOURCE_ENDPOINT}?page_id=${encodeURIComponent(pageId)}`;
  const r = await getJson(url, config);
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  const d = r.json?.data ?? r.json ?? {};
  return {
    ok: true,
    status: r.status,
    page_id: d.page_id,
    name: d.name,
    organization_id: d.organization_id ?? null,
    source: d.source,
  };
}

/** Build (but do not send) the update request — for dry-run previews. */
export function buildUpdateRequestRedacted(config: WebcakeConfig, pageId: string, source: unknown) {
  const body = JSON.stringify({ page_id: pageId, source });
  return {
    method: "POST",
    url: `${config.base}${UPDATE_ENDPOINT}`,
    headers: { ...authHeaders(config), Authorization: "Bearer ***JWT***", Cookie: "jwt=***JWT***" },
    body: body.replace(config.jwt, "***JWT***").slice(0, 400) + (body.length > 400 ? `… (${body.length} bytes)` : ""),
  };
}

/** Overwrite an existing page's source (source-only). */
export async function updatePageSource(
  config: WebcakeConfig,
  pageId: string,
  source: unknown
): Promise<CreateOutcome> {
  const url = `${config.base}${UPDATE_ENDPOINT}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({ page_id: pageId, source }),
    });
  } catch (e: any) {
    return { ok: false, status: 0, error: `Network error calling ${url}: ${e?.message ?? e}` };
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  const data = json?.data ?? json;
  const pageIdOut = data?.page_id;
  const app = config.appBase;
  if (!res.ok || !pageIdOut) {
    const backendMsg = json?.message ?? json?.reason ?? (json ? undefined : text.slice(0, 200));
    return {
      ok: false,
      status: res.status,
      raw: json ?? text.slice(0, 600),
      error: `Backend returned ${res.status}${backendMsg ? `: ${backendMsg}` : ""}`,
    };
  }
  return {
    ok: true,
    status: res.status,
    page_id: pageIdOut,
    editor_url: app && data?.editor_url ? `${app}${data.editor_url}` : data?.editor_url,
    preview_url: app && data?.preview_url ? `${app}${data.preview_url}` : data?.preview_url,
    organization_id: data?.organization_id ?? null,
    raw: data,
  };
}
