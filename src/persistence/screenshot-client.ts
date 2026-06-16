/**
 * Thin screenshot client for the clone-fidelity loop: render a public URL (a
 * page's /preview/<id>, or a reference page being cloned) to a PNG the model can
 * SEE and compare against the reference.
 *
 * CAPABILITY LADDER (decided by the caller, NOT this file):
 *   1. If the AGENT can screenshot itself (a shell + headless browser, e.g. Claude
 *      Code local), it should do that — fresh every time, no quota. The MCP
 *      `render_preview` tool is the FALLBACK for agents WITHOUT that ability
 *      (e.g. the claude.ai remote connector).
 *   2. This client's default engine is Microlink ZERO-CONFIG (no key) — but its
 *      free tier is rate-limited PER IP (~50/day). That's fine for a local stdio
 *      user (their own IP) but a SHARED quota behind the serve-host proxy, so for
 *      remote/multi-user the host should point RENDER_SCREENSHOT_BASE at a KEYED
 *      engine (a proxy route that holds a ScreenshotOne/ApiFlash/Microlink-Pro key).
 *   3. On quota/429 or any failure the caller SKIPS gracefully (never throws).
 *
 * Mirrors the Pexels client's direct-vs-proxy shape (see pexels-client.ts). The
 * secret (if any) is resolved like the JWT — env or per-request header, never
 * hard-coded (the repo is public). Requires global fetch (Node 18+).
 */

/** Microlink's free screenshot endpoint. `embed=screenshot.url` returns the PNG bytes directly. */
const MICROLINK_ENDPOINT = "https://api.microlink.io/";

/** Path of the keyed proxy's screenshot route (served by a host that holds a paid key). */
export const SCREENSHOT_PROXY_PATH = "/api/render/screenshot";

/** Fetch timeout — screenshots can be slow (full-page + webfont settle). */
const SCREENSHOT_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.WEBCAKE_HTTP_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
})();

export type ScreenshotOptions = {
  /** Capture the whole scrollable page (default true) rather than just the viewport. */
  fullPage?: boolean;
  /** Viewport width in px (default 1280). */
  width?: number;
};

export type ScreenshotResult = {
  ok: boolean;
  status: number;
  /** Base64-encoded image bytes (present when ok). */
  dataBase64?: string;
  mimeType?: string;
  bytes?: number;
  /** Which engine produced it. */
  via?: "microlink" | "proxy";
  /** True when the failure was a rate-limit / quota exhaustion (caller should SKIP, not retry). */
  quota_exhausted?: boolean;
  error?: string;
};

type HeaderBag = Record<string, string | string[] | undefined> | undefined;

/** Resolve the keyed-proxy base (host route that holds a paid screenshot key), if configured. */
export function resolveScreenshotProxyBase(override?: string): string | undefined {
  const base = override ?? process.env.RENDER_SCREENSHOT_BASE;
  return base && base.trim() !== "" ? base.replace(/\/+$/, "") : undefined;
}

/** Pull the per-request proxy base header (remote mode), if present. */
export function screenshotProxyBaseFromHeaders(headers: HeaderBag): string | undefined {
  const v = headers?.["x-render-screenshot-base"];
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

/** Which engine to try FIRST: "microlink" (free, default) or "proxy" (the keyed/self-hosted route). */
export function resolveScreenshotPrimary(override?: string): "microlink" | "proxy" {
  const v = (override ?? process.env.RENDER_SCREENSHOT_PRIMARY ?? "").toLowerCase();
  return v === "proxy" ? "proxy" : "microlink";
}

/** Optional Microlink Pro key (raises the free per-IP quota) — env or x-microlink-key header. */
export function resolveMicrolinkKey(override?: string): string | undefined {
  const key = override ?? process.env.MICROLINK_API_KEY;
  return key && key.trim() !== "" ? key.trim() : undefined;
}

export function microlinkKeyFromHeaders(headers: HeaderBag): string | undefined {
  const v = headers?.["x-microlink-key"];
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

/**
 * Build the Microlink request URL. We force a cache bypass (`force=true` AND a
 * nonce on the target URL) because the preview URL is stable across patch rounds
 * — without it Microlink serves a STALE shot of the pre-patch page. Pure so the
 * smoke test can assert the query shape without a network call.
 */
export function buildMicrolinkUrl(targetUrl: string, opts: ScreenshotOptions = {}, nonce = 0): string {
  // Nonce-bust the TARGET url itself (defends against any URL-keyed cache even if
  // `force` is restricted on the free tier).
  const bustTarget = targetUrl + (targetUrl.includes("?") ? "&" : "?") + "_=" + nonce;
  const q = new URLSearchParams();
  q.set("url", bustTarget);
  q.set("screenshot", "true");
  q.set("fullPage", String(opts.fullPage !== false));
  q.set("meta", "false");
  q.set("force", "true");
  q.set("embed", "screenshot.url"); // respond with the PNG bytes, not JSON
  if (opts.width && Number.isFinite(opts.width)) q.set("viewport.width", String(Math.round(opts.width)));
  return `${MICROLINK_ENDPOINT}?${q.toString()}`;
}

/** Read a fetch Response into a ScreenshotResult, classifying quota/errors. */
async function readImageResponse(res: Response, via: "microlink" | "proxy"): Promise<ScreenshotResult> {
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (res.ok && ct.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, status: res.status, dataBase64: buf.toString("base64"), mimeType: ct.split(";")[0].trim(), bytes: buf.length, via };
  }
  // Non-image → an error (JSON or text). 429 == rate limit / quota.
  const body = (await res.text()).slice(0, 300);
  const quota = res.status === 429;
  return {
    ok: false,
    status: res.status,
    via,
    quota_exhausted: quota,
    error: quota
      ? `screenshot quota/rate-limit hit (HTTP 429) via ${via} — skip the visual check this round or configure a keyed engine`
      : `${via} returned HTTP ${res.status}${body ? `: ${body}` : ""}`,
  };
}

/** Capture via Microlink directly (zero-config; per-IP free quota). */
export async function captureViaMicrolink(targetUrl: string, opts: ScreenshotOptions, key?: string, nonce = 0): Promise<ScreenshotResult> {
  const url = buildMicrolinkUrl(targetUrl, opts, nonce);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: key ? { "x-api-key": key } : undefined,
      signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT_MS),
    });
    return await readImageResponse(res, "microlink");
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, status: 0, via: "microlink", error: `screenshot timed out after ${SCREENSHOT_TIMEOUT_MS}ms` };
    }
    return { ok: false, status: 0, via: "microlink", error: `network error calling Microlink: ${e?.message ?? e}` };
  }
}

/** Capture via a keyed proxy route the host operates: GET <base>/api/render/screenshot?url=…&full_page=…&width=… */
export async function captureViaProxy(base: string, targetUrl: string, opts: ScreenshotOptions, nonce = 0): Promise<ScreenshotResult> {
  const q = new URLSearchParams();
  q.set("url", targetUrl + (targetUrl.includes("?") ? "&" : "?") + "_=" + nonce);
  q.set("full_page", String(opts.fullPage !== false));
  if (opts.width && Number.isFinite(opts.width)) q.set("width", String(Math.round(opts.width)));
  const url = `${base}${SCREENSHOT_PROXY_PATH}?${q.toString()}`;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT_MS) });
    return await readImageResponse(res, "proxy");
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, status: 0, via: "proxy", error: `screenshot timed out after ${SCREENSHOT_TIMEOUT_MS}ms calling proxy ${base}` };
    }
    return { ok: false, status: 0, via: "proxy", error: `network error calling screenshot proxy ${base}: ${e?.message ?? e}` };
  }
}

export type ScreenshotTile = { y: number; height: number; dataBase64: string };
export type ScreenshotTilesResult = {
  ok: boolean;
  status: number;
  mimeType?: string;
  pageHeight?: number;
  width?: number;
  truncated?: boolean;
  tiles?: ScreenshotTile[];
  via?: "proxy";
  quota_exhausted?: boolean;
  /** True when no Playwright host is configured (Microlink can't tile) — caller falls back to a single shot. */
  not_supported?: boolean;
  error?: string;
};

/**
 * Capture a tall page as horizontal BANDS via the self-hosted Playwright route
 * (`?tiles=1`) so the model reads each slice at a readable size. Microlink can't
 * tile, so this REQUIRES a proxy host (RENDER_SCREENSHOT_BASE); without one it
 * returns not_supported and the caller should fall back to a single full-page shot.
 * Never throws.
 */
export async function captureScreenshotTiles(
  targetUrl: string,
  opts: { width?: number; bandHeight?: number } = {},
  resolved: { proxyBase?: string } = {},
  nonce = 0
): Promise<ScreenshotTilesResult> {
  if (!resolved.proxyBase) {
    return { ok: false, status: 0, not_supported: true, error: "tiling needs a Playwright host (RENDER_SCREENSHOT_BASE); Microlink can't tile" };
  }
  const q = new URLSearchParams();
  q.set("url", targetUrl + (targetUrl.includes("?") ? "&" : "?") + "_=" + nonce);
  q.set("tiles", "1");
  q.set("full_page", "true");
  if (opts.width && Number.isFinite(opts.width)) q.set("width", String(Math.round(opts.width)));
  if (opts.bandHeight && Number.isFinite(opts.bandHeight)) q.set("band_height", String(Math.round(opts.bandHeight)));
  const url = `${resolved.proxyBase}${SCREENSHOT_PROXY_PATH}?${q.toString()}`;
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT_MS) });
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (res.ok && ct.includes("application/json")) {
      const j: any = await res.json();
      return {
        ok: true,
        status: res.status,
        mimeType: j.mimeType,
        pageHeight: j.page_height,
        width: j.width,
        truncated: j.truncated === true,
        tiles: (j.tiles ?? []).map((t: any) => ({ y: t.y, height: t.height, dataBase64: t.data })),
        via: "proxy",
      };
    }
    const body = (await res.text()).slice(0, 300);
    return { ok: false, status: res.status, quota_exhausted: res.status === 429, error: `tiles proxy returned HTTP ${res.status}${body ? `: ${body}` : ""}` };
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, status: 0, error: `tiles request timed out after ${SCREENSHOT_TIMEOUT_MS}ms` };
    }
    return { ok: false, status: 0, error: `network error calling tiles proxy ${resolved.proxyBase}: ${e?.message ?? e}` };
  }
}

/**
 * Capture a screenshot with AUTOMATIC FALLOVER between the two engines:
 *   - Microlink direct (free, zero-config) and
 *   - the proxy route (a keyed API or the VPS's self-hosted Playwright engine).
 * Tries `primary` first; if it fails — especially Microlink hitting its per-IP
 * quota (HTTP 429) — it retries the other engine. So a free quota is used up
 * first, then traffic auto-switches to the unlimited self-hosted route. With no
 * proxyBase configured it's Microlink only. Never throws; on total failure
 * returns the most informative error (quota_exhausted set when that was the cause).
 */
export async function captureScreenshot(
  targetUrl: string,
  opts: ScreenshotOptions = {},
  resolved: { proxyBase?: string; microlinkKey?: string; primary?: "microlink" | "proxy" } = {},
  nonce = 0
): Promise<ScreenshotResult> {
  const primary = resolved.primary ?? resolveScreenshotPrimary();
  const micro = () => captureViaMicrolink(targetUrl, opts, resolved.microlinkKey, nonce);
  const proxy = () => (resolved.proxyBase ? captureViaProxy(resolved.proxyBase, targetUrl, opts, nonce) : null);

  // No fallback engine available → single attempt.
  if (!resolved.proxyBase) return micro();

  const first = primary === "proxy" ? proxy()! : micro();
  const r1 = await first;
  if (r1.ok) return r1;

  // Primary failed (quota or error) → fall over to the other engine.
  const r2 = await (primary === "proxy" ? micro() : proxy()!);
  if (r2.ok) return r2;

  // Both failed → prefer the non-quota error (more actionable); else the quota one.
  return r1.quota_exhausted && !r2.quota_exhausted ? r2 : r1;
}
