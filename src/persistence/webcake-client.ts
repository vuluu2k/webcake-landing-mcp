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

const CREATE_ENDPOINT = "/api/v1/ai/create_page_from_source";
const ORGS_ENDPOINT = "/api/v1/org/organizations";
const PAGES_ENDPOINT = "/api/v1/ai/pages";
const SEARCH_PAGES_ENDPOINT = "/api/v1/ai/search_pages";
const PAGE_SOURCE_ENDPOINT = "/api/v1/ai/page_source";
const UPDATE_ENDPOINT = "/api/v1/ai/update_page_source";
const APPEND_ENDPOINT = "/api/v1/ai/append_section";

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
    preview_url: toEditorUrl(config, previewPath),
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
    });
  } catch (e: any) {
    return { ok: false, status: 0, error: `Network error calling ${url}: ${e?.message ?? e}` };
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
    preview_url: toEditorUrl(config, data?.preview_url),
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
    preview_url: toEditorUrl(config, data?.preview_url),
    organization_id: data?.organization_id ?? null,
    raw: data,
  };
}
