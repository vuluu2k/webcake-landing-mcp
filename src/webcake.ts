/**
 * Thin HTTP client to persist a generated page source to a Webcake backend.
 * Targets the dedicated endpoint `POST {base}/api/v1/ai/create_page_from_source`
 * (added in lib/landing_page_web/controllers/v1/ai/ai_controller.ex), which does
 * Pages.create_page + Pages.create_source and returns {page_id, editor_url}.
 *
 * Config via environment (set in the MCP server config):
 *   WEBCAKE_API_BASE  e.g. http://localhost:5800   (required to actually save)
 *   WEBCAKE_JWT       the account JWT               (required to actually save)
 *   WEBCAKE_HOST      optional Host header override (Phoenix routes by host)
 *   WEBCAKE_APP_BASE  optional base for editor/preview URLs in the result
 */

export type WebcakeConfig = { base: string; jwt: string; host?: string; appBase?: string };

const ENDPOINT = "/api/v1/ai/create_page_from_source";

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
      host: process.env.WEBCAKE_HOST,
      appBase: process.env.WEBCAKE_APP_BASE?.replace(/\/+$/, ""),
    },
    missing: [],
  };
}

/** Build (but do not send) the HTTP request — used for dry-run previews. */
export function buildRequest(config: WebcakeConfig, name: string, source: unknown) {
  const url = `${config.base}${ENDPOINT}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${config.jwt}`,
    Cookie: `jwt=${config.jwt}`,
  };
  if (config.host) headers["Host"] = config.host;
  const body = JSON.stringify({ name, source });
  return { method: "POST", url, headers, body };
}

/** Same as buildRequest but with the token masked, safe to show to the user. */
export function buildRequestRedacted(config: WebcakeConfig, name: string, source: unknown) {
  const req = buildRequest(config, name, source);
  const mask = (s: string) => s.replace(config.jwt, "***JWT***");
  return {
    method: req.method,
    url: req.url,
    headers: { ...req.headers, Authorization: "Bearer ***JWT***", Cookie: "jwt=***JWT***" },
    body: mask(req.body).slice(0, 400) + (req.body.length > 400 ? `… (${req.body.length} bytes)` : ""),
  };
}

export type CreateOutcome = {
  ok: boolean;
  status: number;
  page_id?: string;
  editor_url?: string;
  preview_url?: string;
  raw?: unknown;
  error?: string;
};

/** Actually POST the source. Requires global fetch (Node 18+). */
export async function createPage(
  config: WebcakeConfig,
  name: string,
  source: unknown
): Promise<CreateOutcome> {
  const req = buildRequest(config, name, source);
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
    raw: data,
  };
}
