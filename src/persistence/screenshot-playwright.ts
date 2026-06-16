/**
 * Self-hosted screenshot engine (Playwright) for the serve-host's
 * GET /api/render/screenshot route — the UNLIMITED fallback the `render_preview`
 * tool falls over to when Microlink's free per-IP quota is exhausted.
 *
 * Playwright is NOT a package dependency (keeps `npx webcake-landing-mcp` light —
 * no Chromium download for stdio users). It is loaded LAZILY at runtime; absent →
 * captureWithPlaywright returns ok:false and the route replies 503. Install it
 * ONLY on the VPS that runs `serve`:
 *
 *   npm i playwright && npx playwright install --with-deps chromium
 *   # or, to reuse an already-installed Chrome/Chromium without the download:
 *   npm i playwright-core   and set CHROME_BIN=/path/to/chrome
 *
 * Launch uses CHROME_BIN / PLAYWRIGHT_CHROMIUM_PATH as executablePath when set
 * (so playwright-core can drive a system browser); otherwise Playwright's own
 * bundled Chromium. One browser is launched and reused; a fresh context per shot.
 */

let pwModule: any = null;
let triedLoad = false;
let browserPromise: Promise<any> | null = null;

/** Lazy-load `playwright` (then `playwright-core`); cache the result (incl. the not-installed case). */
async function loadPlaywright(): Promise<any> {
  if (triedLoad) return pwModule;
  triedLoad = true;
  // Variable specifier so tsc treats import() as `any` and does NOT require the
  // module to be installed at build time.
  for (const spec of ["playwright", "playwright-core"]) {
    try {
      pwModule = await import(spec);
      break;
    } catch {
      /* not installed — try next */
    }
  }
  return pwModule;
}

/** True when a Playwright package is importable on this host. */
export async function playwrightInstalled(): Promise<boolean> {
  return !!(await loadPlaywright());
}

/** Launch (once) and reuse a headless Chromium. Returns null when unavailable. */
async function getBrowser(): Promise<any | null> {
  const pw = await loadPlaywright();
  if (!pw) return null;
  if (!browserPromise) {
    const launchOpts: any = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
    const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.CHROME_BIN;
    if (exe) launchOpts.executablePath = exe;
    browserPromise = pw.chromium.launch(launchOpts).catch((e: any) => {
      browserPromise = null; // allow a later retry
      throw e;
    });
  }
  try {
    return await browserPromise;
  } catch {
    return null;
  }
}

export type PwShotResult =
  | { ok: true; data: Buffer; mimeType: string }
  | { ok: false; error: string; reason?: "not_installed" };

/**
 * Output tuning (env-controlled, so the VPS operator picks the size/quality
 * tradeoff). Default JPEG — a full-page landing screenshot is ~5–10× smaller as
 * JPEG than PNG with no loss that matters for a layout/colour comparison, which
 * shrinks the base64 the model receives. `scale` (deviceScaleFactor) renders at a
 * lower pixel density to cut dimensions too; 1 = crisp, 0.5 = quarter the pixels.
 */
function outputOpts(): { type: "jpeg" | "png"; quality?: number; scale: number } {
  const fmt = (process.env.RENDER_SCREENSHOT_FORMAT ?? "jpeg").toLowerCase();
  const type = fmt === "png" ? "png" : "jpeg";
  const q = parseInt(process.env.RENDER_SCREENSHOT_QUALITY ?? "", 10);
  const quality = type === "jpeg" ? (Number.isFinite(q) && q >= 1 && q <= 100 ? q : 72) : undefined;
  const s = parseFloat(process.env.RENDER_SCREENSHOT_SCALE ?? "");
  const scale = Number.isFinite(s) && s > 0 && s <= 2 ? s : 1;
  return { type, quality, scale };
}

/** Default band height (CSS px) for tiling a tall page; env-tunable. */
function resolveBandHeight(): number {
  const b = parseInt(process.env.RENDER_SCREENSHOT_BAND_HEIGHT ?? "", 10);
  return Number.isFinite(b) && b >= 200 ? b : 1400;
}

/**
 * Run `fn` against a fresh browser context (viewport width + deviceScaleFactor),
 * with a single self-heal retry if the cached browser died (crash, or a system
 * Chrome that closed). Always closes the context. Never throws — the shared
 * lifecycle for both single-shot and tiled capture.
 */
async function withContext<T>(
  width: number,
  scale: number,
  fn: (ctx: any) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string; reason?: "not_installed" }> {
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      ok: false,
      reason: "not_installed",
      error: "playwright is not installed on this host (run: npm i playwright && npx playwright install chromium)",
    };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let browser = await getBrowser();
    if (!browser) return { ok: false, error: "failed to launch headless chromium (check CHROME_BIN / playwright install)" };
    if (typeof browser.isConnected === "function" && !browser.isConnected()) {
      browserPromise = null;
      browser = await getBrowser();
      if (!browser) return { ok: false, error: "failed to relaunch headless chromium" };
    }
    let ctx: any;
    try {
      ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: scale });
      const value = await fn(ctx);
      return { ok: true, value };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const dead = /closed|disconnected|crash|Target page, context or browser/i.test(msg);
      if (dead && attempt === 0) {
        browserPromise = null;
        continue;
      }
      return { ok: false, error: `playwright capture failed: ${msg}` };
    } finally {
      if (ctx) await ctx.close().catch(() => {});
    }
  }
  return { ok: false, error: "playwright capture failed after retry" };
}

/** Load a page in `ctx`, wait for it to settle, return the page handle. */
async function openSettledPage(ctx: any, url: string): Promise<any> {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForTimeout(1200); // let webfonts/lazy images settle
  return page;
}

/** Screenshot a URL with Playwright (one image — full page or viewport). Never throws. */
export async function captureWithPlaywright(
  url: string,
  opts: { fullPage?: boolean; width?: number } = {}
): Promise<PwShotResult> {
  const out = outputOpts();
  const width = opts.width && Number.isFinite(opts.width) ? Math.round(opts.width) : 1280;
  const r = await withContext(width, out.scale, async (ctx) => {
    const page = await openSettledPage(ctx, url);
    return Buffer.from(
      await page.screenshot({
        fullPage: opts.fullPage !== false,
        type: out.type,
        ...(out.type === "jpeg" ? { quality: out.quality } : {}),
      })
    );
  });
  if (!r.ok) return r;
  return { ok: true, data: r.value, mimeType: out.type === "png" ? "image/png" : "image/jpeg" };
}

export type PwTilesResult =
  | { ok: true; mimeType: string; pageHeight: number; width: number; truncated: boolean; tiles: { y: number; height: number; data: Buffer }[] }
  | { ok: false; error: string; reason?: "not_installed" };

/**
 * Capture a tall page as a STACK of horizontal bands (top→bottom) via Playwright
 * `clip` — so the model sees each slice at a readable aspect ratio instead of one
 * giant image squished (and blurred) to the vision input's long-edge cap. No image
 * library needed: each band is its own screenshot. Bands are capped at `maxTiles`
 * (truncated:true when the page is taller than that).
 */
export async function captureTilesWithPlaywright(
  url: string,
  opts: { width?: number; bandHeight?: number; maxTiles?: number } = {}
): Promise<PwTilesResult> {
  const out = outputOpts();
  const width = opts.width && Number.isFinite(opts.width) ? Math.round(opts.width) : 1280;
  const bandH = opts.bandHeight && opts.bandHeight >= 200 ? Math.round(opts.bandHeight) : resolveBandHeight();
  const maxTiles = opts.maxTiles && opts.maxTiles > 0 ? Math.round(opts.maxTiles) : 8;
  const r = await withContext(width, out.scale, async (ctx) => {
    const page = await openSettledPage(ctx, url);
    // String form so tsc doesn't type-check `document` against the Node libs.
    const pageHeight = Math.ceil(
      Number(await page.evaluate("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)")) || 0
    );
    const total = Math.max(1, Math.ceil(pageHeight / bandH));
    const n = Math.min(total, maxTiles);
    // `clip` is measured against the VIEWPORT, so grow the viewport to cover the
    // bands we'll capture before clipping (Chromium caps a single shot at ~16384px).
    const captureHeight = Math.min(pageHeight, n * bandH, 16000);
    await page.setViewportSize({ width, height: Math.max(captureHeight, 1) });
    await page.waitForTimeout(300); // reflow after the resize
    const tiles: { y: number; height: number; data: Buffer }[] = [];
    for (let i = 0; i < n; i++) {
      const y = i * bandH;
      let h = Math.min(bandH, pageHeight - y);
      if (y + h > captureHeight) h = captureHeight - y; // never clip past the viewport
      if (h <= 0) break;
      const shot = await page.screenshot({
        clip: { x: 0, y, width, height: h },
        type: out.type,
        ...(out.type === "jpeg" ? { quality: out.quality } : {}),
      });
      tiles.push({ y, height: h, data: Buffer.from(shot) });
    }
    return { pageHeight, width, tiles, truncated: total > maxTiles };
  });
  if (!r.ok) return r;
  return { ok: true, mimeType: out.type === "png" ? "image/png" : "image/jpeg", ...r.value };
}

// ---------------------------------------------------------------------------
// SSRF guard — this route fetches an arbitrary `url`, so block private/loopback
// targets (someone could otherwise screenshot internal services). Pure + exported
// for smoke coverage. Opt out with RENDER_ALLOW_PRIVATE=1 (e.g. local dev).
// ---------------------------------------------------------------------------

/** True when `hostname` resolves to a loopback / link-local / RFC-1918 private host. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0") return true;
  if (/^127\./.test(h)) return true; // loopback
  if (/^10\./.test(h)) return true; // private A
  if (/^192\.168\./.test(h)) return true; // private C
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // private B
  if (/^169\.254\./.test(h)) return true; // link-local
  if (/^0\./.test(h)) return true; // "this" network
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // IPv6 ULA
  if (h.startsWith("fe80")) return true; // IPv6 link-local
  return false;
}

/** Validate a screenshot target URL: http(s) only, no private host (unless RENDER_ALLOW_PRIVATE). */
export function isAllowedScreenshotUrl(raw: string): { ok: boolean; error?: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "invalid url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "only http(s) urls are allowed" };
  if (!process.env.RENDER_ALLOW_PRIVATE && isPrivateHost(u.hostname)) {
    return { ok: false, error: "private/loopback hosts are blocked (set RENDER_ALLOW_PRIVATE=1 to allow)" };
  }
  return { ok: true };
}
