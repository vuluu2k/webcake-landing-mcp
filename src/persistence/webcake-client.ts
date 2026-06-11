/**
 * Thin HTTP client to the Webcake backend:
 *  - list the account's organizations (GET /api/v1/org/organizations)
 *  - list / read / create / update the account's page sources (/api/v1/ai/*)
 *
 * A page lands in an organization when an `x-org-id` header is sent (resolved by
 * the backend `:org_check` plug). Without it the page is personal (org=null).
 * The build*Redacted helpers produce dry-run previews with the JWT masked.
 *
 * Endpoints live in the separate landing_page_backend repo
 * (LandingPageWeb.V1.AiController, scope /api/v1/ai). Requires global fetch (Node 18+).
 */
import type { WebcakeConfig, Organization, CreateOutcome, PageSummary } from "./types.js";

/** Default fetch timeout in ms. Override via WEBCAKE_HTTP_TIMEOUT_MS env. */
const HTTP_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.WEBCAKE_HTTP_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
})();

/** Build an AbortSignal that fires after `ms` milliseconds. */
function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/** Wrap a fetch error or AbortError in the standard {ok:false} shape. */
function timeoutOrNetworkError(url: string, e: any): { ok: false; status: number; error: string } {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return {
      ok: false,
      status: 0,
      error: `request timed out after ${HTTP_TIMEOUT_MS}ms — the backend may still complete it; check before re-creating to avoid duplicates`,
    };
  }
  return { ok: false, status: 0, error: `Network error calling ${url}: ${e?.message ?? e}` };
}

const UPLOAD_FILE_ENDPOINT = "/external/upload_file";
const BUILD_ENDPOINT = "/render/build";
const CREATE_ENDPOINT = "/api/v1/ai/create_page_from_source";
const ORGS_ENDPOINT = "/api/v1/org/organizations";
const PAGES_ENDPOINT = "/api/v1/ai/pages";
const SEARCH_PAGES_ENDPOINT = "/api/v1/ai/search_pages";
const PAGE_SOURCE_ENDPOINT = "/api/v1/ai/page_source";
const UPDATE_ENDPOINT = "/api/v1/ai/update_page_source";
const APPEND_ENDPOINT = "/api/v1/ai/append_section";
// The editor's own publish route (NOT under /api/v1/ai): saves the source as a
// new version and creates/updates the page_published record (+ optional custom
// domain/path) so the page goes live. NOTE: this scope is host-constrained to
// the BUILDER host (router scope `host: "builder."`), so the request goes to
// config.builderBase, not the API base.
const publishEndpoint = (pageId: string) => `/api/pages/${encodeURIComponent(pageId)}/edit/publish`;
const publishUrl = (config: WebcakeConfig, pageId: string) =>
  `${(config.builderBase ?? config.base).replace(/\/+$/, "")}${publishEndpoint(pageId)}`;

function authHeaders(config: WebcakeConfig, orgId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${config.jwt}`,
    Cookie: `jwt=${config.jwt}`,
  };
  const org = orgId ?? config.orgId;
  if (org != null && `${org}` !== "") headers["x-org-id"] = `${org}`;
  return headers;
}

/**
 * Resolve the editor/preview link the backend returns onto the page-builder host
 * (config.builderBase, e.g. builder.localhost:5800), NOT the API base. The backend
 * may return either a path (`/editor/v2/<id>`) or an absolute URL on its own host
 * (`http://localhost:5800/editor/v2/<id>`) — in both cases we keep only the
 * path+query and re-root it on the builder host.
 */
export function toEditorUrl(config: WebcakeConfig, raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const builder = config.builderBase ?? config.appBase;
  if (!builder) return raw;
  let pathQuery = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      pathQuery = u.pathname + u.search + u.hash;
    } catch {
      /* not a parseable URL — use as-is */
    }
  }
  if (!pathQuery.startsWith("/")) pathQuery = `/${pathQuery}`;
  return `${builder.replace(/\/+$/, "")}${pathQuery}`;
}

/**
 * Resolve the public preview link (`/preview/<page_id>`) onto the PREVIEW host
 * (config.previewBase) — NOT the builder subdomain. The /preview/:id route only
 * exists on the root preview hosts (preview.localhost:5800 local /
 * staging.webcake.me staging / www.webcake.me prod); the v4 renderer there serves
 * the STORED `app`/`app_css` build columns — an MCP-created page's preview is
 * blank until publish_page (with a build host) runs or the page is re-saved in
 * the Webcake editor.
 */
export function toPreviewUrl(config: WebcakeConfig, raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const preview = config.previewBase;
  if (!preview) return toEditorUrl(config, raw); // legacy fallback
  let pathQuery = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      pathQuery = u.pathname + u.search + u.hash;
    } catch {
      /* not a parseable URL — use as-is */
    }
  }
  if (!pathQuery.startsWith("/")) pathQuery = `/${pathQuery}`;
  return `${preview.replace(/\/+$/, "")}${pathQuery}`;
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

/** List the account's organizations. type===1 is the default ("personal") org. */
export async function listOrganizations(
  config: WebcakeConfig
): Promise<{ ok: boolean; status: number; organizations?: Organization[]; default_org_id?: number | string; error?: string }> {
  const url = `${config.base}${ORGS_ENDPOINT}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: authHeaders(config), signal: timeoutSignal(HTTP_TIMEOUT_MS) });
  } catch (e: any) {
    return timeoutOrNetworkError(url, e);
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
    res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: timeoutSignal(HTTP_TIMEOUT_MS) });
  } catch (e: any) {
    return timeoutOrNetworkError(req.url, e);
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
    editor_url: toEditorUrl(config, editorPath),
    preview_url: toPreviewUrl(config, previewPath),
    organization_id: (orgId ?? config.orgId) ?? null,
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Read / list / edit existing pages
// ---------------------------------------------------------------------------

async function getJson(url: string, config: WebcakeConfig) {
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: authHeaders(config), signal: timeoutSignal(HTTP_TIMEOUT_MS) });
  } catch (e: any) {
    const e2 = timeoutOrNetworkError(url, e);
    return { ok: false, status: 0, json: null, text: "", error: e2.error };
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

/**
 * Search the account's pages by name / domain / id via the dedicated backend
 * endpoint. Filters are AND-combined server-side; each row carries the page's
 * `custom_domain` + `default_domain` so the caller can disambiguate by URL.
 * Returns `endpoint_missing:true` on a 404 so the caller can fall back to
 * filtering `listPages` client-side against an older backend lacking the route.
 */
export async function searchPages(
  config: WebcakeConfig,
  filters: { name?: string; domain?: string; id?: string; limit?: number }
): Promise<{ ok: boolean; status: number; pages?: PageSummary[]; endpoint_missing?: boolean; error?: string }> {
  const qs = new URLSearchParams();
  if (filters.name) qs.set("name", filters.name);
  if (filters.domain) qs.set("domain", filters.domain);
  if (filters.id) qs.set("id", filters.id);
  if (filters.limit != null) qs.set("limit", `${filters.limit}`);
  const url = `${config.base}${SEARCH_PAGES_ENDPOINT}${qs.toString() ? `?${qs}` : ""}`;
  const r = await getJson(url, config);
  if (r.status === 404) return { ok: false, status: 404, endpoint_missing: true, error: "search_pages endpoint not found on backend" };
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

/** Build (but do not send) the append-section request — for dry-run previews. */
export function buildAppendRequestRedacted(config: WebcakeConfig, pageId: string, sections: unknown) {
  const body = JSON.stringify({ page_id: pageId, sections });
  return {
    method: "POST",
    url: `${config.base}${APPEND_ENDPOINT}`,
    headers: { ...authHeaders(config), Authorization: "Bearer ***JWT***", Cookie: "jwt=***JWT***" },
    body: body.replace(config.jwt, "***JWT***").slice(0, 400) + (body.length > 400 ? `… (${body.length} bytes)` : ""),
  };
}

/**
 * Append section(s) to a page server-side via the dedicated append endpoint —
 * ships ONLY the new section(s) (no whole-source get+put). The backend reads the
 * stored source, appends, guards duplicate ids, and saves. Returns
 * `endpoint_missing:true` on a 404 so the caller can fall back to get+merge+put
 * against an older backend that lacks the route.
 */
export async function appendSection(
  config: WebcakeConfig,
  pageId: string,
  sections: unknown
): Promise<CreateOutcome & { endpoint_missing?: boolean; section_count?: number; sections_added?: number }> {
  const url = `${config.base}${APPEND_ENDPOINT}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({ page_id: pageId, sections }),
      signal: timeoutSignal(HTTP_TIMEOUT_MS),
    });
  } catch (e: any) {
    return timeoutOrNetworkError(url, e);
  }
  // No such route on an older backend → Phoenix 404. Signal a fallback.
  if (res.status === 404) {
    return { ok: false, status: 404, endpoint_missing: true, error: "append_section endpoint not found on backend" };
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
    editor_url: toEditorUrl(config, data?.editor_url),
    preview_url: toPreviewUrl(config, data?.preview_url),
    organization_id: data?.organization_id ?? null,
    section_count: data?.section_count,
    sections_added: data?.sections_added,
    raw: data,
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
      signal: timeoutSignal(HTTP_TIMEOUT_MS),
    });
  } catch (e: any) {
    return timeoutOrNetworkError(url, e);
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
    editor_url: toEditorUrl(config, data?.editor_url),
    preview_url: toPreviewUrl(config, data?.preview_url),
    organization_id: data?.organization_id ?? null,
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Build (render/build — standalone render service)
// ---------------------------------------------------------------------------

/** Longer timeout for the build host — renders can take 30-90 s for a large page. */
const BUILD_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.WEBCAKE_BUILD_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 180_000;
})();

/**
 * Call the Webcake build host to produce rendered `app`/`app_css` HTML from a
 * page source. The build host is a standalone render service at
 * `POST <buildBase>/render/build`.
 *
 * Request body field renames (from page-source keys):
 *   source.popup      → popups
 *   source.cartConfigs → $cartConfigs   (REQUIRED — builder crashes if missing)
 *   source.svariations → $syncVariations
 *
 * Response (direct, no Elixir wrapper):
 *   { success: true, data: { app: "<html>", app_css: "<style>" } }
 *   { success: false, error: "…" }  on failure
 */
export async function buildPageApp(
  buildBase: string,
  pageId: string,
  source: any
): Promise<{ ok: boolean; app?: string; app_css?: string; status?: number; error?: string }> {
  const url = `${buildBase.replace(/\/+$/, "")}${BUILD_ENDPOINT}`;
  const body = JSON.stringify({
    settings: source.settings ?? {},
    page: source.page ?? [],
    popups: source.popup ?? [],
    options: source.options ?? {},
    pageId,
    $cartConfigs: source.cartConfigs ?? {},
    $syncVariations: source.svariations ?? [],
    products: [],
    domain: null,
    promotion_product: {},
  });
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(BUILD_TIMEOUT_MS),
    });
  } catch (e: any) {
    const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      error: isTimeout
        ? `build host timed out after ${BUILD_TIMEOUT_MS}ms`
        : `Network error calling build host ${url}: ${e?.message ?? e}`,
    };
  }
  const rawText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    /* non-JSON */
  }
  if (!res.ok || json?.success === false) {
    const reason = json?.error ?? json?.message ?? (json ? undefined : rawText.slice(0, 300));
    return {
      ok: false,
      status: res.status,
      error: `Build host returned ${res.status}${reason ? `: ${reason}` : ""}`,
    };
  }
  const app: string | undefined = json?.data?.app;
  const app_css: string | undefined = json?.data?.app_css;
  if (!app) {
    return { ok: false, status: res.status, error: "Build host returned success but no app in data" };
  }
  return { ok: true, app, app_css, status: res.status };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export type PublishOpts = { customDomain?: string; customPath?: string; app?: string; app_css?: string };

function publishBody(sourceString: string, opts: PublishOpts = {}): string {
  // The publish action expects `source` as a JSON STRING (it Jason.decode!s it),
  // plus optional custom_domain/custom_path. is_publish marks the save as a
  // publish in save_page_with_source. app/app_css are the rendered HTML produced
  // by the build host — when present the page renders without the editor.
  const payload: Record<string, unknown> = {
    source: sourceString,
    custom_domain: opts.customDomain ?? "",
    custom_path: opts.customPath ?? "",
    is_publish: true,
  };
  if (opts.app != null) payload["app"] = opts.app;
  if (opts.app_css != null) payload["app_css"] = opts.app_css;
  return JSON.stringify(payload);
}

/** Build (but do not send) the publish request with the token masked — for dry-run previews. */
export function buildPublishRequestRedacted(
  config: WebcakeConfig,
  pageId: string,
  sourceString: string,
  opts: PublishOpts = {}
) {
  // Build a preview body: replace actual app/app_css content with size hints so the
  // preview is readable while still showing whether rendered HTML is included.
  const previewOpts: PublishOpts = { ...opts };
  if (opts.app != null) previewOpts.app = `<${opts.app.length} bytes>` as any;
  if (opts.app_css != null) previewOpts.app_css = `<${opts.app_css.length} bytes>` as any;
  const body = publishBody(sourceString, previewOpts);
  return {
    method: "POST",
    url: publishUrl(config, pageId),
    headers: { ...authHeaders(config), Authorization: "Bearer ***JWT***", Cookie: "jwt=***JWT***" },
    body: body.replace(config.jwt, "***JWT***").slice(0, 600) + (body.length > 600 ? `… (${body.length} bytes)` : ""),
    rendered: opts.app != null,
  };
}

// ---------------------------------------------------------------------------
// Image upload (no JWT required — public /external endpoint)
// ---------------------------------------------------------------------------

/**
 * Upload an image to the Webcake backend as base64.
 * The /external/upload_file endpoint is public — no JWT required.
 * Returns `{ ok: true, url }` on success or `{ ok: false, error }` on failure.
 */
export async function uploadImageBase64(
  base: string,
  b64: string,
  ext: string,
  contentType: string
): Promise<{ ok: boolean; url?: string; status?: number; error?: string }> {
  const url = `${base.replace(/\/+$/, "")}${UPLOAD_FILE_ENDPOINT}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ type: "base64", base64: b64, ext, content_type: contentType }),
      signal: timeoutSignal(HTTP_TIMEOUT_MS),
    });
  } catch (e: any) {
    const e2 = timeoutOrNetworkError(url, e);
    return { ok: false, status: e2.status, error: e2.error };
  }
  const rawText = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    /* non-JSON */
  }
  if (!res.ok || json?.success === false) {
    const reason = json?.reason ?? json?.message ?? (json ? undefined : rawText.slice(0, 200));
    return {
      ok: false,
      status: res.status,
      error: `Backend returned ${res.status}${reason ? `: ${reason}` : ""}`,
    };
  }
  const hostedUrl: string | undefined = typeof json?.data === "string" ? json.data : undefined;
  if (!hostedUrl) {
    return { ok: false, status: res.status, error: "Backend returned success but no URL in data field" };
  }
  return { ok: true, url: hostedUrl, status: res.status };
}

/**
 * POST to a host-scoped route. Node's fetch cannot reach `*.localhost` hosts
 * (browsers special-case .localhost; Node's DNS does not, and undici forbids a
 * manual Host header) — so for those we connect to loopback via node:http and
 * carry the real host in the Host header. Everything else uses plain fetch.
 */
async function postToHost(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  if (!u.hostname.endsWith(".localhost")) {
    const res = await fetch(url, { method: "POST", headers, body, signal: timeoutSignal(HTTP_TIMEOUT_MS) });
    return { status: res.status, text: await res.text() };
  }
  const { request } = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: u.port || 80,
        path: u.pathname + u.search,
        method: "POST",
        headers: { ...headers, Host: u.host },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }));
      }
    );
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error(`request timed out after ${HTTP_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * Publish a page: saves the source as a new version and creates/updates the
 * page_published record (live status + optional custom domain/path). When
 * opts.app/app_css are provided (built by buildPageApp) the page renders
 * immediately without needing the editor. Returns the resulting public URL —
 * `https://<domain>/<path>` when a custom domain is attached, else the
 * preview-host link (`<previewBase>/preview/<page_id>`).
 */
export async function publishPage(
  config: WebcakeConfig,
  pageId: string,
  sourceString: string,
  opts: PublishOpts = {}
): Promise<{
  ok: boolean;
  status: number;
  page_id?: string;
  published_url?: string;
  preview_url?: string;
  domain?: string | null;
  path?: string | null;
  rendered?: boolean;
  raw?: unknown;
  error?: string;
}> {
  const url = publishUrl(config, pageId);
  let status: number;
  let text: string;
  try {
    // The builder-host pipeline runs an `accepts ["html"]` plug (it serves the
    // editor SPA); a literal application/json Accept gets a 406, so send */*
    // like the browser does — the action still returns JSON.
    ({ status, text } = await postToHost(url, { ...authHeaders(config), Accept: "*/*" }, publishBody(sourceString, opts)));
  } catch (e: any) {
    const e2 = timeoutOrNetworkError(url, e);
    return { ok: false, status: e2.status, error: e2.error };
  }
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  const resOk = status >= 200 && status < 300;
  const success = json?.success !== false && resOk;
  if (!success) {
    const backendMsg = json?.message ?? json?.reason ?? (json ? undefined : text.slice(0, 200));
    return {
      ok: false,
      status,
      raw: json ?? text.slice(0, 600),
      error: `Backend returned ${status}${backendMsg ? `: ${backendMsg}` : ""}`,
    };
  }
  const data = json?.data ?? json;
  const domain: string | null = data?.domain ?? null;
  const path: string | null = data?.path ?? null;
  const previewUrl = toPreviewUrl(config, `/preview/${pageId}`);
  const publishedUrl = domain ? `https://${domain}${path ? `/${String(path).replace(/^\/+/, "")}` : ""}` : previewUrl;
  return {
    ok: true,
    status,
    page_id: pageId,
    published_url: publishedUrl,
    preview_url: previewUrl,
    domain,
    path,
    rendered: opts.app != null,
    raw: data,
  };
}
