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
import type { WebcakeConfig, Organization, CreateOutcome, PageSummary, RehostReport } from "./types.js";
import { collectExternalImageUrls, rewriteImageUrls, MAX_REHOST_PER_SAVE } from "./rehost.js";
import { rehostGet, rehostSet } from "./rehost-cache.js";

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
/**
 * The builder's OWN media-library upload (AssetsController.upload, router scope
 * `host: "builder."` → `/api/persona/upload`, piped through :org_check). This is
 * the "bộ sưu tập" route the editor's media picker calls. Unlike the public
 * /external/upload_file — which only PUTs bytes to S3 and hands back a CDN URL —
 * this one also creates the `Image` row AND the `Asset` row in the org's folder,
 * so the image shows up in the user's collection and can be re-picked later.
 * Requires a JWT and an `x-org-id` (the controller drops the asset in the org
 * folder resolved by :org_check; with no org it cannot file the asset).
 */
const ASSET_UPLOAD_ENDPOINT = "/api/persona/upload";
/**
 * The org's folder listing (AssetsController.get_all_folders_organization_by_type,
 * builder host, behind :org_check). Needed because `AssetsController.upload`
 * defaults `folder_id` to the account's PERSONA folder — sending only `x-org-id`
 * would stamp the asset `organization_id: <org>` while filing it in the personal
 * folder, and the collection listings query by `folder_id`, so the image would
 * surface in neither. The editor avoids this by resolving the org's ROOT folder
 * (`type == -1`) and posting it as `in_folder` (builderx_spa: landingLibrary.js
 * `folders.find(f => f.type == -1)` → personalApi.upload). We mirror that.
 */
const ORG_FOLDERS_ENDPOINT = "/api/organization/folders/all";
/** The org root folder's `type` discriminator in the folder listing. */
const ORG_ROOT_FOLDER_TYPE = -1;
const BUILD_ENDPOINT = "/render/build";
const CREATE_ENDPOINT = "/api/v1/ai/create_page_from_source";
/**
 * Marker sent on every MCP-originated create so the backend can stamp the page's
 * `by_ai` column — it records that the page was generated through this MCP server
 * (the backend reads `by_ai` from the create body; the column lives in the
 * separate landing_page_backend repo). Override via WEBCAKE_BY_AI env if a host
 * wants a more specific tag.
 */
const BY_AI = process.env.WEBCAKE_BY_AI || "mcp";
const ORGS_ENDPOINT = "/api/v1/org/organizations";
const PAGES_ENDPOINT = "/api/v1/ai/pages";
const SEARCH_PAGES_ENDPOINT = "/api/v1/ai/search_pages";
const PAGE_SOURCE_ENDPOINT = "/api/v1/ai/page_source";
const UPDATE_ENDPOINT = "/api/v1/ai/update_page_source";
const APPEND_ENDPOINT = "/api/v1/ai/append_section";
// The editor's own publish routes (NOT under /api/v1/ai). Both scopes are
// host-constrained to the BUILDER host (router scope `host: "builder."`), so
// requests go to config.builderBase, not the API base.
//
// /edit/publish_html is what the editor's publish button calls and the ONLY
// route that creates/updates the PagePublishedV2 record — the record EVERY
// public serving path reads (render_custom_domain → get_published_by_domain_path_v2
// → serves page_published_v2.app). It expects the rendered app/app_css in the body.
//
// /edit/publish is LEGACY: it saves the source (+app/app_css onto the page_source
// row, which only the ~10-minute /preview/:id window serves) and writes a
// PagePublished v1 record that no serving path reads. Kept only as the
// source-only fallback when no build host is available.
const publishHtmlEndpoint = (pageId: string) => `/api/pages/${encodeURIComponent(pageId)}/edit/publish_html`;
const legacyPublishEndpoint = (pageId: string) => `/api/pages/${encodeURIComponent(pageId)}/edit/publish`;
const publishUrl = (config: WebcakeConfig, pageId: string, rendered: boolean) =>
  `${(config.builderBase ?? config.base).replace(/\/+$/, "")}${rendered ? publishHtmlEndpoint(pageId) : legacyPublishEndpoint(pageId)}`;

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
 * Build a SELF-LOGGING-IN editor link. The bare `/editor/v2/<id>` route sits
 * behind the backend's `:passport` pipeline (jwt COOKIE or Bearer header), so a
 * plain editor URL 401s ("Token not found") in any browser that isn't already
 * logged in to Webcake. The builder host exposes `GET /transport?token=&redirect_uri=`
 * (public; AuthController.transport) which sets the `jwt` cookie and redirects —
 * so we wrap the editor URL in it, carrying the SAME jwt the MCP call used
 * (env / auth.json / per-request header). The token is the caller's own
 * credential, but the link logs into their account — share it with the page
 * owner only, never publish it. Preview links stay UNWRAPPED (they're public).
 */
export function toEditorLoginUrl(config: WebcakeConfig, raw: string | undefined): string | undefined {
  const editor = toEditorUrl(config, raw);
  if (!editor || !config.jwt) return editor;
  const builder = config.builderBase ?? config.appBase;
  if (!builder) return editor;
  return `${builder.replace(/\/+$/, "")}/transport?token=${encodeURIComponent(config.jwt)}&redirect_uri=${encodeURIComponent(editor)}`;
}

/**
 * Resolve the public preview link (`/preview/<page_id>`) onto the PREVIEW host
 * (config.previewBase) — NOT the builder subdomain. The /preview/:id route only
 * exists on the root preview hosts (preview.localhost:5800 local /
 * staging.webcake.me staging / www.webcake.me prod); the v4 renderer there
 * serves the page_source row's STORED `app`/`app_css` build columns, and only
 * for ~10 minutes after the last source save (then "Preview page is expired").
 * An MCP-created page's preview is blank until a rendered publish_page runs or
 * the page is re-saved in the Webcake editor — and even then the link is
 * ephemeral; only a custom_domain publish gives a permanent URL.
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
    // by_ai marks the page as MCP-generated for the backend's `by_ai` column.
    body: JSON.stringify({ name, source, by_ai: BY_AI }),
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
  // Host external image URLs to the Webcake CDN before storing, so a clone never
  // keeps hotlinked/expiring source URLs. Failures keep the original URL.
  // `orgId` is the org resolved for THIS create and outranks config.orgId, so the
  // images are filed into the same collection the page itself lands in.
  const { source: hostedSource, report: rehost } = await rehostSourceImages(
    orgId ? { ...config, orgId } : config,
    source
  );
  const req = buildRequest(config, name, hostedSource, orgId);
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
    editor_url: toEditorLoginUrl(config, editorPath),
    preview_url: toPreviewUrl(config, previewPath),
    organization_id: (orgId ?? config.orgId) ?? null,
    raw: data,
    ...(rehost ? { rehost, rehosted_source: hostedSource } : {}),
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
): Promise<{ ok: boolean; status: number; page_id?: string; name?: string; organization_id?: number | string | null; custom_domain?: string | null; custom_path?: string | null; source?: any; error?: string }> {
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
    // The page's currently-attached domain, when the record carries it — lets
    // publish_page reuse it instead of dropping to a domain-less preview.
    custom_domain: d.custom_domain ?? null,
    custom_path: d.custom_path ?? null,
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
  const { source: hostedSections, report: rehost } = await rehostSourceImages(config, sections);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({ page_id: pageId, sections: hostedSections }),
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
    editor_url: toEditorLoginUrl(config, data?.editor_url),
    preview_url: toPreviewUrl(config, data?.preview_url),
    organization_id: data?.organization_id ?? null,
    section_count: data?.section_count,
    sections_added: data?.sections_added,
    raw: data,
    ...(rehost ? { rehost, rehosted_source: hostedSections } : {}),
  };
}

/** Overwrite an existing page's source (source-only). */
export async function updatePageSource(
  config: WebcakeConfig,
  pageId: string,
  source: unknown
): Promise<CreateOutcome> {
  const url = `${config.base}${UPDATE_ENDPOINT}`;
  const { source: hostedSource, report: rehost } = await rehostSourceImages(config, source);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({ page_id: pageId, source: hostedSource }),
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
    editor_url: toEditorLoginUrl(config, data?.editor_url),
    preview_url: toPreviewUrl(config, data?.preview_url),
    organization_id: data?.organization_id ?? null,
    raw: data,
    ...(rehost ? { rehost, rehosted_source: hostedSource } : {}),
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

/**
 * Body for the editor's /edit/publish_html route — mirrors the payload the
 * editor's PublishModal sends (see landing_page_backend assets/editor
 * PublishModal.vue): the saved source rides as the `data_node` JSON STRING (the
 * route Jason.decode!s it and stores it via save_page_with_source), there is NO
 * `source` key, and `settings` (with `mobile_only` folded in from
 * options.mobileOnly) is stored on the PagePublishedV2 record the public
 * serving paths read. `render_type: "v4"` only when a domain is attached —
 * exactly what the editor sends. `auto: false` so the publish creates a version.
 */
function publishHtmlBody(source: any, opts: PublishOpts = {}): string {
  const hasDomain = !!opts.customDomain;
  return JSON.stringify({
    custom_domain: opts.customDomain ?? "",
    custom_path: opts.customPath ?? "",
    selected_custom_domain: hasDomain,
    data_node: JSON.stringify(source),
    render_type: hasDomain ? "v4" : null,
    app: opts.app,
    app_css: opts.app_css ?? "",
    settings: { ...(source?.settings ?? {}), mobile_only: source?.options?.mobileOnly ?? false },
    type: 1,
    auto: false,
  });
}

/**
 * Body for the LEGACY /edit/publish route (source-only fallback): `source` as a
 * JSON STRING plus custom_domain/custom_path; is_publish marks the save as a
 * publish in save_page_with_source. No PagePublishedV2 record is written, so
 * nothing goes live — the page only renders in the editor / the short-lived
 * /preview window after a build.
 */
function legacyPublishBody(source: any, opts: PublishOpts = {}): string {
  return JSON.stringify({
    source: JSON.stringify(source),
    custom_domain: opts.customDomain ?? "",
    custom_path: opts.customPath ?? "",
    is_publish: true,
  });
}

function publishRequestBody(source: any, opts: PublishOpts, rendered: boolean): string {
  return rendered ? publishHtmlBody(source, opts) : legacyPublishBody(source, opts);
}

/**
 * Build (but do not send) the publish request with the token masked — for
 * dry-run previews. `willRender` says whether the real run will call the build
 * host and take the publish_html path (dry_run itself never builds, so the
 * preview stands in a size hint / placeholder for app/app_css).
 */
export function buildPublishRequestRedacted(
  config: WebcakeConfig,
  pageId: string,
  source: any,
  opts: PublishOpts = {},
  willRender = opts.app != null
) {
  // Replace actual app/app_css content with size hints (or a placeholder when
  // the build runs later) so the preview stays readable.
  const previewOpts: PublishOpts = { ...opts };
  if (willRender) {
    previewOpts.app = opts.app != null ? `<${opts.app.length} bytes>` : "<built by the build host on dry_run=false>";
    previewOpts.app_css = opts.app_css != null ? `<${opts.app_css.length} bytes>` : "<built by the build host on dry_run=false>";
  }
  const body = publishRequestBody(source, previewOpts, willRender);
  return {
    method: "POST",
    url: publishUrl(config, pageId, willRender),
    headers: { ...authHeaders(config), Authorization: "Bearer ***JWT***", Cookie: "jwt=***JWT***" },
    body: body.replace(config.jwt, "***JWT***").slice(0, 600) + (body.length > 600 ? `… (${body.length} bytes)` : ""),
    rendered: willRender,
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

/** Timeout used for multipart uploads — generous to accommodate large files. */
const UPLOAD_MULTIPART_TIMEOUT_MS = 120_000;

/**
 * Upload an image to the Webcake backend via multipart/form-data.
 * The /external/upload_file endpoint is public — no JWT required.
 * The backend derives `ext` from the last dot segment of `filename` and uses
 * `file.content_type` from the part headers — so `filename` must carry the
 * correct extension and `contentType` must be set explicitly.
 * Supports up to 200 MB (the backend's multipart Plug.Parsers limit).
 * Returns `{ ok: true, url }` on success or `{ ok: false, error }` on failure.
 */
export async function uploadImageMultipart(
  base: string,
  bytes: Uint8Array | Buffer,
  filename: string,
  contentType: string
): Promise<{ ok: boolean; url?: string; status?: number; error?: string }> {
  const url = `${base.replace(/\/+$/, "")}${UPLOAD_FILE_ENDPOINT}`;
  const form = new FormData();
  // Attach the blob with an explicit content type so the backend picks it up
  // from file.content_type, and a filename so it can derive the extension.
  form.append("file", new Blob([bytes], { type: contentType }), filename);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      // Do NOT set Content-Type manually — fetch sets it with the correct
      // multipart boundary when the body is a FormData instance.
      headers: { Accept: "application/json" },
      body: form,
      signal: timeoutSignal(UPLOAD_MULTIPART_TIMEOUT_MS),
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
 * Upload an image into the account's MEDIA COLLECTION (bộ sưu tập) via the
 * builder's own media route — the same one the editor's media picker uses.
 * Creates the Image + Asset rows in the org folder, so the image is re-pickable
 * in the editor instead of being a loose CDN URL.
 *
 * Needs `config.jwt` AND an org — the org is REQUIRED, by project policy: an
 * image must land in the collection of the org the page belongs to, so the org
 * is settled up front rather than guessed at upload time.
 *
 * The org must reach the backend TWO ways, and both matter:
 *  1. `x-org-id` — :org_check assigns the organization, stamping the Asset's
 *     `organization_id`.
 *  2. `in_folder` — the org's ROOT folder. Without it the controller defaults
 *     `folder_id` to the persona folder, and since the library lists by
 *     `folder_id` the asset would appear in NO collection. Passing only the
 *     header is the subtle failure this guards against.
 *
 * `folderId` overrides (1) with an explicit sub-folder. Callers without a
 * JWT/org should use `uploadImageMultipart` (public, no collection entry).
 */
export async function uploadImageToCollection(
  config: WebcakeConfig,
  bytes: Uint8Array | Buffer,
  filename: string,
  contentType: string,
  opts: { orgId?: string; folderId?: string } = {}
): Promise<{ ok: boolean; url?: string; asset_id?: string | number; status?: number; error?: string }> {
  const builder = config.builderBase ?? config.base;
  const org = opts.orgId ?? config.orgId;
  if (!config.jwt) return { ok: false, status: 0, error: "no JWT — cannot upload to the collection" };
  if (org == null || `${org}` === "") {
    return { ok: false, status: 0, error: "no org id — an organization must be chosen before uploading to the collection" };
  }
  // File into the org's own library. An explicit folderId wins; otherwise resolve
  // the org root — never let the backend default to the persona folder, which
  // would strand the asset outside every collection listing.
  const folderId = opts.folderId ?? (await resolveOrgRootFolderId(config, `${org}`));
  if (!folderId) {
    return {
      ok: false,
      status: 0,
      error: `could not resolve the root collection folder for org ${org} — uploading without it would file the image outside the org's collection`,
    };
  }
  const url = `${builder.replace(/\/+$/, "")}${ASSET_UPLOAD_ENDPOINT}`;
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), filename);
  form.append("in_folder", `${folderId}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      // No Content-Type — fetch sets the multipart boundary from the FormData.
      // Auth mirrors authHeaders() but without its JSON Content-Type.
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.jwt}`,
        Cookie: `jwt=${config.jwt}`,
        "x-org-id": `${org}`,
      },
      body: form,
      signal: timeoutSignal(UPLOAD_MULTIPART_TIMEOUT_MS),
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
    return { ok: false, status: res.status, error: `Collection upload returned ${res.status}${reason ? `: ${reason}` : ""}` };
  }
  // AssetsController returns {success:true, asset: Asset.json(asset+image)} —
  // the CDN link is the asset's txtdata, with the joined image row as a backup.
  const asset = json?.asset ?? json?.data?.asset ?? json?.data;
  const hostedUrl: string | undefined =
    (typeof asset?.txtdata === "string" ? asset.txtdata : undefined) ??
    (typeof asset?.image?.link === "string" ? asset.image.link : undefined);
  if (!hostedUrl) {
    return { ok: false, status: res.status, error: "Collection upload succeeded but returned no URL" };
  }
  return { ok: true, url: hostedUrl, asset_id: asset?.id, status: res.status };
}

/**
 * Memo of {jwt+base → resolved org id} so a multi-image save resolves the org
 * once instead of calling list_organizations per image. Keyed by JWT so a
 * multi-user `serve` process never leaks one caller's org to another.
 */
const uploadOrgMemo = new Map<string, string | undefined>();

/** Memo of {jwt+builder+org → org root folder id}, same rationale as uploadOrgMemo. */
const orgFolderMemo = new Map<string, string | undefined>();

/**
 * Resolve an org's ROOT collection folder id (`type === -1`) — the folder the
 * editor's media picker treats as that org's library. Uploads must carry it as
 * `in_folder`, otherwise the backend files the asset in the account's persona
 * folder and it shows up in neither library (see ORG_FOLDERS_ENDPOINT).
 *
 * Returns undefined when the listing fails or has no root folder; the caller
 * then has no verified org folder to file into.
 */
export async function resolveOrgRootFolderId(
  config: WebcakeConfig,
  orgId: string
): Promise<string | undefined> {
  const builder = config.builderBase ?? config.base;
  const memoKey = `${builder}|${config.jwt}|${orgId}`;
  if (orgFolderMemo.has(memoKey)) return orgFolderMemo.get(memoKey);
  // `type` is required by the controller; organization-image is the media library.
  const url = `${builder.replace(/\/+$/, "")}${ORG_FOLDERS_ENDPOINT}?type=organization-image`;
  let resolved: string | undefined;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { ...authHeaders(config, orgId) },
      signal: timeoutSignal(HTTP_TIMEOUT_MS),
    });
    if (res.ok) {
      const json: any = await res.json().catch(() => null);
      const folders: any[] = Array.isArray(json?.folders) ? json.folders : [];
      const root = folders.find((f) => Number(f?.type) === ORG_ROOT_FOLDER_TYPE);
      if (root?.id != null) resolved = `${root.id}`;
    }
  } catch {
    /* leave undefined — the caller decides how to proceed */
  }
  orgFolderMemo.set(memoKey, resolved);
  return resolved;
}

/**
 * Resolve the org to file uploaded assets into — the collection route cannot
 * file an asset without one (:org_check assigns the organization only when
 * `x-org-id` is present).
 *
 * Mirrors create_page's org policy: an explicit `config.orgId` wins; otherwise
 * an account with exactly ONE org has it auto-selected. With 0 orgs, or 2+ (too
 * ambiguous to guess), this returns undefined and the caller uploads to the
 * public CDN endpoint instead — an image never blocks on an org prompt.
 */
export async function resolveCollectionOrgId(config: WebcakeConfig): Promise<string | undefined> {
  if (config.orgId != null && `${config.orgId}` !== "") return `${config.orgId}`;
  if (!config.jwt) return undefined;
  const memoKey = `${config.base}|${config.jwt}`;
  if (uploadOrgMemo.has(memoKey)) return uploadOrgMemo.get(memoKey);
  const res = await listOrganizations(config);
  let resolved: string | undefined;
  if (res.ok && res.organizations && res.organizations.length === 1) {
    resolved = `${res.organizations[0].id}`;
  }
  uploadOrgMemo.set(memoKey, resolved);
  return resolved;
}

/**
 * Upload an image, PREFERRING the media collection and falling back to the
 * public CDN endpoint. This is the single entry point every upload path uses so
 * that images land in the user's bộ sưu tập whenever we have the credentials to
 * file them, while a credential-less run (`npx`, no env) still works exactly as
 * before. A collection failure is never fatal — it degrades to the public upload
 * and reports which route produced the URL.
 *
 * Requires a JWT AND an org: by policy the org is settled up front and the image
 * belongs in THAT org's collection. Without either, the public endpoint is used
 * (the URL works but no Asset row exists) — callers that must not silently skip
 * the collection should check the org themselves and refuse first.
 */
export async function uploadImagePreferCollection(
  config: WebcakeConfig,
  bytes: Uint8Array | Buffer,
  filename: string,
  contentType: string,
  opts: { orgId?: string; folderId?: string } = {}
): Promise<{ ok: boolean; url?: string; asset_id?: string | number; collection: boolean; status?: number; error?: string }> {
  const org = opts.orgId ?? config.orgId;
  if (config.jwt && org != null && `${org}` !== "") {
    const viaCollection = await uploadImageToCollection(config, bytes, filename, contentType, opts);
    if (viaCollection.ok) return { ...viaCollection, collection: true };
    console.error(
      `[upload] collection upload failed (${viaCollection.error}) — falling back to the public CDN endpoint`
    );
  }
  const viaPublic = await uploadImageMultipart(config.base, bytes, filename, contentType);
  return { ...viaPublic, collection: false };
}

// ---------------------------------------------------------------------------
// Server-side image re-host (runs on every real create/update/append save)
// ---------------------------------------------------------------------------

const REHOST_FETCH_TIMEOUT_MS = 60_000;
const REHOST_MAX_BYTES = 200_000_000; // mirrors the backend multipart limit
const REHOST_CONCURRENCY = 8;

function rehostExtFromContentType(ct: string): string {
  const sub = ct.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp", "image/tiff": "tiff",
  };
  return map[sub] ?? (sub.replace("image/", "") || "jpg");
}

/**
 * Download one remote image and re-upload it to Webcake; returns the hosted URL
 * or null. Prefers the media collection (so auto-hosted images join the user's
 * bộ sưu tập) and degrades to the public CDN endpoint without creds/org.
 */
async function fetchAndHostOne(config: WebcakeConfig, src: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(src, {
      signal: timeoutSignal(REHOST_FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; webcake-landing-mcp/1.0; +https://webcake.io)" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const cl = res.headers.get("content-length");
  if (cl && parseInt(cl, 10) > REHOST_MAX_BYTES) return null;
  let contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    // Some CDNs send octet-stream for images — trust the URL extension instead of rejecting.
    const extGuess = (() => { try { const p = new URL(src).pathname; const d = p.lastIndexOf("."); return d >= 0 ? p.slice(d + 1).split(/[?#]/)[0].toLowerCase() : ""; } catch { return ""; } })();
    if (!extGuess) return null;
    contentType = `image/${extGuess === "jpg" ? "jpeg" : extGuess}`;
  }
  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    return null;
  }
  if (buf.byteLength > REHOST_MAX_BYTES) return null;
  const ext = rehostExtFromContentType(contentType);
  // Name the asset from the source URL so the collection shows something
  // recognisable instead of a wall of "rehost.jpg" rows.
  const filename = rehostFilename(src, ext);
  const up = await uploadImagePreferCollection(config, Buffer.from(buf), filename, contentType);
  return up.ok && up.url ? up.url : null;
}

/** Derive a human-readable collection filename from the source URL. */
function rehostFilename(src: string, ext: string): string {
  let stem = "";
  try {
    const p = new URL(src).pathname;
    stem = decodeURIComponent(p.slice(p.lastIndexOf("/") + 1)).replace(/\.[^.]*$/, "");
  } catch {
    /* fall through to the generic name */
  }
  stem = stem.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${stem || "rehost"}.${ext}`;
}

/**
 * Upload every external image URL in `source` to the Webcake CDN and return the
 * source with those URLs rewritten in place (specials.src, `url(...)`
 * backgrounds, gallery links, video posters). Idempotent and cached: a URL
 * already on the CDN is skipped, and a URL seen in a previous save is reused
 * from the rehost cache (Redis-or-memory, ./rehost-cache.ts). A per-URL failure leaves the original URL untouched and
 * never throws — the save proceeds either way. Returns `{ source }` unchanged
 * with no report when the source has no external images.
 *
 * Uploads go to the account's media collection when the config carries a JWT and
 * an org, else to the public CDN endpoint. The cache is therefore keyed PER ORG:
 * the hosted URL is content-addressed and identical across orgs, but the Asset
 * row is per-org, so a shared key would let org B reuse org A's URL and never get
 * the image filed into its own collection.
 */
export async function rehostSourceImages(
  config: WebcakeConfig,
  source: unknown
): Promise<{ source: unknown; report?: RehostReport }> {
  const candidates = collectExternalImageUrls(source);
  if (candidates.length === 0) return { source };

  const capped = candidates.slice(0, MAX_REHOST_PER_SAVE);
  const skipped = candidates.length - capped.length;

  // Resolve the collection org ONCE for the whole save, then pin it onto the
  // config every upload sees — otherwise each image would re-resolve it.
  // No org resolvable → the images take the public endpoint rather than the
  // collection. This never blocks the save: a page's images are not worth
  // failing a write over, and create_page already refuses to save at all when
  // the org is ambiguous, so by this point an org is normally settled.
  const orgId = config.jwt ? await resolveCollectionOrgId(config) : undefined;
  if (orgId) config = { ...config, orgId };
  const scope = config.jwt && orgId ? `org:${orgId}` : "public";

  // Resolve from cache first; upload the rest with a small concurrency pool.
  const cacheHits = await Promise.all(capped.map((u) => rehostGet(u, scope)));
  const toUpload = capped.filter((_, i) => !cacheHits[i]);
  for (let i = 0; i < toUpload.length; i += REHOST_CONCURRENCY) {
    const batch = toUpload.slice(i, i + REHOST_CONCURRENCY);
    const hosted = await Promise.all(batch.map((u) => fetchAndHostOne(config, u)));
    await Promise.all(
      batch.map((u, j) => (hosted[j] ? rehostSet(u, hosted[j]!, scope) : Promise.resolve()))
    );
  }

  const map = new Map<string, string>();
  const failed: string[] = [];
  for (const u of capped) {
    const h = await rehostGet(u, scope);
    if (h) map.set(u, h);
    else failed.push(u);
  }

  const rewritten = rewriteImageUrls(source, map);
  const report: RehostReport = {
    candidates: candidates.length,
    rehosted: map.size,
    failed: failed.length,
    skipped,
    collection: Boolean(config.jwt && orgId),
    ...(orgId ? { collection_org_id: orgId } : {}),
    ...(failed.length ? { failed_urls: failed.slice(0, 8) } : {}),
  };
  return { source: rewritten, report };
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
 * Publish a page. With opts.app/app_css (built by buildPageApp) it POSTs the
 * editor's /edit/publish_html route, which creates/updates the PagePublishedV2
 * record — the one the public serving paths read — so the page actually goes
 * LIVE. Without them it falls back to the legacy /edit/publish route, which
 * only saves the source as a new version (nothing goes live).
 *
 * Returns the resulting public URL — `https://<domain>/<path>` when a custom
 * domain is attached, else the preview-host link
 * (`<previewBase>/preview/<page_id>`), which the backend only serves for ~10
 * minutes after the publish (then "Preview page is expired").
 */
export async function publishPage(
  config: WebcakeConfig,
  pageId: string,
  source: any,
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
  live?: boolean;
  raw?: unknown;
  error?: string;
}> {
  const rendered = opts.app != null;
  const url = publishUrl(config, pageId, rendered);
  let status: number;
  let text: string;
  try {
    // The builder-host pipeline runs an `accepts ["html"]` plug (it serves the
    // editor SPA); a literal application/json Accept gets a 406, so send */*
    // like the browser does — the action still returns JSON.
    ({ status, text } = await postToHost(url, { ...authHeaders(config), Accept: "*/*" }, publishRequestBody(source, opts, rendered)));
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
  // The publish_html response data is PagePublishedV2.json — it carries the full
  // app/app_css/source/data_node columns. Keep only the small identifying fields.
  const raw =
    data && typeof data === "object"
      ? {
          id: data.id,
          page_id: data.page_id,
          domain: data.domain,
          path: data.path,
          status: data.status,
          version_id: data.version_id,
          render_type: data.render_type,
          type: data.type,
        }
      : data;
  return {
    ok: true,
    status,
    page_id: pageId,
    published_url: publishedUrl,
    preview_url: previewUrl,
    domain,
    path,
    rendered,
    live: rendered,
    raw,
  };
}
