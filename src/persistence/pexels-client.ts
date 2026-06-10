/**
 * Thin HTTP client to the Pexels stock-photo API (https://www.pexels.com/api/).
 * Lets the agent fetch REAL, relevant images for a landing page instead of the
 * grey https://placehold.co/ placeholders — the returned URLs drop straight into
 * an image element's `specials.src` (or a gallery item's `link`).
 *
 * The API key is a SECRET resolved exactly like the Webcake JWT (never hard-coded,
 * the repo is public): the `PEXELS_API_KEY` env var (stdio / single-user), or the
 * `x-pexels-key` header per request (remote / multi-user). Pexels allows hotlinking
 * its image URLs as long as attribution is shown — `normalizePhoto` carries the
 * photographer + page url so the agent can credit the source. Requires global
 * fetch (Node 18+). `normalizePhoto` is a pure function so it can be smoke-tested.
 *
 * SHARED PROXY: when no key is configured locally (e.g. a plain `npx` user),
 * `searchImagesViaProxy` calls a hosted endpoint (GET <base>/api/images/search,
 * default https://mcp.toolvn.io.vn) that holds a shared key and returns the SAME
 * normalized shape — so images work out of the box with zero setup. The proxy
 * route is served by this same server in `serve` mode (see src/http.ts).
 */
const PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";

/** Fetch timeout for Pexels/proxy calls — matches the Webcake client default. */
const PEXELS_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.WEBCAKE_HTTP_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
})();

/** Default hosted proxy that holds a shared Pexels key (override with PEXELS_PROXY_BASE). */
export const PEXELS_PROXY_DEFAULT = "https://mcp.toolvn.io.vn";

/** Path of the proxy's image-search route (served by this server in `serve` mode). */
export const PEXELS_PROXY_PATH = "/api/images/search";

/** A normalized photo result — only the fields a page builder needs. */
export type PexelsPhoto = {
  id: number;
  /** Alt text describing the photo (good for the element's alt / aria). */
  alt: string;
  width: number;
  height: number;
  /** Average color of the photo as a hex string — handy for a matching section bg. */
  avg_color: string | null;
  /** Attribution: the photographer + their Pexels page (show this when hotlinking). */
  photographer: string;
  photographer_url: string;
  /** The Pexels page for this photo (use for attribution links). */
  pexels_url: string;
  /**
   * Ready-to-use hotlink URLs at various sizes. Drop one into specials.src:
   *  - `large` (~940w) for a hero/banner, `medium` (~350w tall) for a card/thumb,
   *  - `original` for full-res, `landscape`/`portrait` for cropped aspect ratios.
   */
  src: Record<string, string>;
};

/** Resolve the Pexels API key: per-request override (header) wins over env. */
export function resolvePexelsKey(override?: string): string | undefined {
  const key = override ?? process.env.PEXELS_API_KEY;
  return key && key.trim() !== "" ? key.trim() : undefined;
}

/** Resolve the shared-proxy base URL: override → PEXELS_PROXY_BASE env → the default host. */
export function resolvePexelsProxyBase(override?: string): string {
  const base = override ?? process.env.PEXELS_PROXY_BASE ?? PEXELS_PROXY_DEFAULT;
  return base.replace(/\/+$/, "");
}

/** A header bag as Node delivers it (lowercased keys). */
type HeaderBag = Record<string, string | string[] | undefined> | undefined;

/** Pull the `x-pexels-key` header (remote/multi-user mode), if present. */
export function pexelsKeyFromHeaders(headers: HeaderBag): string | undefined {
  const v = headers?.["x-pexels-key"];
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

/** Map one raw Pexels API photo onto the trimmed PexelsPhoto shape (pure). */
export function normalizePhoto(p: any): PexelsPhoto {
  return {
    id: p?.id,
    alt: typeof p?.alt === "string" ? p.alt : "",
    width: p?.width,
    height: p?.height,
    avg_color: typeof p?.avg_color === "string" ? p.avg_color : null,
    photographer: p?.photographer ?? "",
    photographer_url: p?.photographer_url ?? "",
    pexels_url: p?.url ?? "",
    src: p?.src && typeof p.src === "object" ? p.src : {},
  };
}

export type PexelsSearchParams = {
  query: string;
  perPage?: number;
  page?: number;
  orientation?: "landscape" | "portrait" | "square";
  size?: "large" | "medium" | "small";
  color?: string;
};

export type PexelsSearchResult = {
  ok: boolean;
  status: number;
  query?: string;
  total_results?: number;
  photos?: PexelsPhoto[];
  /** "proxy" when served via the shared hosted proxy rather than a direct Pexels call. */
  via?: "proxy";
  error?: string;
};

/** Build the shared query string for both the direct Pexels call and the proxy. */
export function buildSearchQuery(params: PexelsSearchParams): URLSearchParams {
  const q = new URLSearchParams();
  q.set("query", params.query);
  q.set("per_page", String(Math.min(Math.max(params.perPage ?? 5, 1), 80)));
  if (params.page) q.set("page", String(params.page));
  if (params.orientation) q.set("orientation", params.orientation);
  if (params.size) q.set("size", params.size);
  if (params.color) q.set("color", params.color);
  return q;
}

/** Search Pexels DIRECTLY (needs a key). Returns normalized, hotlinkable URLs. */
export async function searchPexels(key: string, params: PexelsSearchParams): Promise<PexelsSearchResult> {
  const url = `${PEXELS_SEARCH_ENDPOINT}?${buildSearchQuery(params).toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: { Authorization: key }, signal: AbortSignal.timeout(PEXELS_TIMEOUT_MS) });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, status: 0, error: `request timed out after ${PEXELS_TIMEOUT_MS}ms calling Pexels` };
    }
    return { ok: false, status: 0, error: `Network error calling Pexels: ${e?.message ?? e}` };
  }
  const body = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = json?.error ?? body.slice(0, 200);
    const hint = res.status === 401 ? " (check PEXELS_API_KEY / x-pexels-key — it may be invalid)" : "";
    return { ok: false, status: res.status, error: `Pexels returned ${res.status}${msg ? `: ${msg}` : ""}${hint}` };
  }
  const photos: PexelsPhoto[] = (json?.photos ?? []).map(normalizePhoto);
  return { ok: true, status: res.status, query: params.query, total_results: json?.total_results, photos };
}

/**
 * Search via the SHARED PROXY (no local key needed): GET <base>/api/images/search.
 * The proxy returns the same normalized shape — we re-`normalizePhoto` defensively
 * so a slightly different payload still yields the page-builder fields.
 */
export async function searchImagesViaProxy(base: string, params: PexelsSearchParams): Promise<PexelsSearchResult> {
  const url = `${base.replace(/\/+$/, "")}${PEXELS_PROXY_PATH}?${buildSearchQuery(params).toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(PEXELS_TIMEOUT_MS) });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, status: 0, error: `request timed out after ${PEXELS_TIMEOUT_MS}ms calling image proxy ${base}` };
    }
    return { ok: false, status: 0, error: `Network error calling image proxy ${base}: ${e?.message ?? e}` };
  }
  const body = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = json?.error ?? json?.reason ?? body.slice(0, 200);
    return { ok: false, status: res.status, error: `Image proxy returned ${res.status}${msg ? `: ${msg}` : ""}` };
  }
  const photos: PexelsPhoto[] = (json?.photos ?? []).map(normalizePhoto);
  return { ok: json?.ok !== false, status: res.status, query: params.query, total_results: json?.total_results, photos, via: "proxy" };
}
