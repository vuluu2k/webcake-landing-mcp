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
    return {
      ok: false,
      status: res.status,
      raw: json ?? text.slice(0, 600),
      error: `Backend returned ${res.status}${pageId ? "" : " (no page_id in response)"}`,
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
