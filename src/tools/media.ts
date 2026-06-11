/**
 * Media tools: fetch REAL stock images for a page instead of grey placeholders.
 * `search_images` queries the Pexels API and returns ready-to-hotlink URLs the
 * agent drops into an image element's `specials.src` (or a gallery item's `link`).
 * `upload_images` converts external image URLs (or data: URIs) into Webcake-hosted
 * URLs (statics.pancake.vn) so generated pages don't hotlink third-party hosts.
 *
 * The Pexels API key is a secret resolved per request: the `x-pexels-key` header
 * (remote / multi-user) wins, else the `PEXELS_API_KEY` env var (stdio). With a key
 * we call Pexels directly; WITHOUT one we fall back to the shared hosted proxy
 * (https://mcp.toolvn.io.vn) so `npx` users get images with zero setup. The page can
 * still fall back to placeholders if even the proxy is unreachable. No Webcake creds.
 *
 * `upload_images` needs only the Webcake API base (WEBCAKE_API_BASE / WEBCAKE_ENV
 * preset / x-webcake-api-base header); no JWT is required (the upload endpoint is
 * public). Defaults to dry_run=true.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text } from "../mcp/response.js";
import {
  searchPexels,
  searchImagesViaProxy,
  resolvePexelsKey,
  resolvePexelsProxyBase,
  pexelsKeyFromHeaders,
} from "../persistence/pexels-client.js";
import { uploadImageBase64 } from "../persistence/webcake-client.js";
import { configFromHeaders, ENVIRONMENTS, stripTrailingSlash } from "../persistence/config.js";

/** Resolve just the API base (no JWT required) from per-request headers → env → WEBCAKE_ENV preset → prod default. */
function resolveApiBase(headers: Record<string, string | string[] | undefined> | undefined): string {
  const overrides = configFromHeaders(headers);
  // Explicit header or env var wins first.
  if (overrides.base) return stripTrailingSlash(overrides.base)!;
  if (process.env.WEBCAKE_API_BASE) return stripTrailingSlash(process.env.WEBCAKE_API_BASE)!;
  // Named environment (from header or env) fills in the preset.
  const envName = overrides.env ?? process.env.WEBCAKE_ENV;
  if (envName && envName in ENVIRONMENTS) {
    return ENVIRONMENTS[envName as keyof typeof ENVIRONMENTS].apiBase;
  }
  // Default to prod.
  return ENVIRONMENTS.prod.apiBase;
}

const UPLOAD_TIMEOUT_MS = 20_000;
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/** Map a content_type to its canonical file extension. */
function extFromContentType(ct: string): string {
  const sub = ct.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  return map[sub] ?? (sub.replace("image/", "") || "jpg");
}

/** Derive file extension from a URL path when content-type is unavailable. */
function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf(".");
    if (dot >= 0) return pathname.slice(dot + 1).split("?")[0].toLowerCase();
  } catch {
    /* ignore */
  }
  return "jpg";
}

export function registerMediaTools(server: McpServer) {
  // 13) Search images ---------------------------------------------------------
  server.tool(
    "search_images",
    "Searches Pexels stock photos (see https://www.pexels.com/api/) by short English subject queries. Returns hotlinkable URLs at several sizes (src.large for heroes/banners, src.medium for cards/thumbs), `avg_color` for matching section backgrounds, plus photographer name and attribution URL. BATCH MODE: pass `queries: [...]` to fetch multiple subjects in PARALLEL — e.g. ['fresh coffee cup','barista pouring','interior cafe'] for hero + about + gallery — returns { queries: { [q]: result } } so the caller picks one image per slot in a single round-trip; default `pick='best'` returns only the top photo per query (compact, drop-in for specials.src), `pick='all'` returns the full list. `query` (single) returns the full result like before. Works out of the box via a shared hosted proxy; set PEXELS_API_KEY env or x-pexels-key header to use your own quota. ONLY for image slots with NO source image: when the user supplied images or the reference HTML/URL contains image URLs (ingest AST images/background_images/og_image), re-host THOSE via upload_images instead of searching stock photos.",
    {
      query: z.string().optional().describe("Single subject query — backward-compat. Prefer `queries` when the page needs 2+ images."),
      queries: z
        .array(z.string())
        .optional()
        .describe("Multiple subject queries (one per image slot) to run in parallel — recommended for a page with 2+ images so each only costs ONE round-trip."),
      per_page: z.number().int().min(1).max(80).optional().describe("Photos per query (default 5)."),
      pick: z
        .enum(["best", "all"])
        .optional()
        .describe("With `queries`, 'best' (default) returns only the top photo per query (compact, drop-in for specials.src); 'all' returns the full result. Single-query calls always return the full result."),
      orientation: z
        .enum(["landscape", "portrait", "square"])
        .optional()
        .describe("Preferred shape — 'landscape' for heroes/banners, 'portrait' for tall cards, 'square' for icons/avatars."),
      size: z.enum(["large", "medium", "small"]).optional().describe("Minimum photo size to return (default any)."),
      color: z.string().optional().describe("Optional color filter: a name (red, blue, …) or a hex like '6a8f3c'."),
      page: z.number().int().min(1).optional().describe("Result page for pagination (default 1)."),
    },
    { title: "Search Stock Images", readOnlyHint: true, openWorldHint: true },
    async ({ query, queries, per_page, pick, orientation, size, color, page }, extra) => {
      const list: string[] = queries && queries.length ? queries : query ? [query] : [];
      if (list.length === 0) {
        return text({ ok: false, error: "Pass `query` or `queries`." });
      }
      const key = resolvePexelsKey(pexelsKeyFromHeaders(extra?.requestInfo?.headers));
      const base = resolvePexelsProxyBase();
      const runOne = (q: string) => {
        const params = { query: q, perPage: per_page, page, orientation, size, color };
        return key ? searchPexels(key, params) : searchImagesViaProxy(base, params);
      };
      // Dedup + parallelize so two slots asking for the same subject only cost one call.
      const unique = [...new Set(list)];
      const results = await Promise.all(unique.map(runOne));

      // Single-query mode → return the result directly (backward-compat shape).
      if (!queries && query) {
        const r = results[0];
        if (!r.ok) {
          return text({
            ...r,
            hint: "Couldn't fetch images — set PEXELS_API_KEY (env) or the x-pexels-key header for your own Pexels key (free at https://www.pexels.com/api/), or fall back to https://placehold.co/<width>x<height> placeholders.",
          });
        }
        return text(r);
      }

      // Batch mode → { queries: { [q]: best-photo-or-full } }.
      const mode = pick ?? "best";
      const out: Record<string, any> = {};
      for (let i = 0; i < unique.length; i++) {
        const q = unique[i];
        const r = results[i];
        if (!r.ok) {
          out[q] = { ok: false, error: r.error, status: r.status };
          continue;
        }
        out[q] =
          mode === "all"
            ? r
            : { ok: true, photo: r.photos?.[0] ?? null, total_results: r.total_results };
      }
      return text({ queries: out });
    }
  );

  // 14) Upload images to Webcake -----------------------------------------------
  server.tool(
    "upload_images",
    "Converts external image URLs (typically collected from ingest_html/ingest_url results) or data: URIs into Webcake-hosted URLs (statics.pancake.vn) by downloading each image and re-uploading it to the Webcake backend. Use this whenever the page is built from a reference HTML/URL (BOTH intents — adapt AND clone) or the user supplies their own image URLs: reference images are the user's assets, so re-host and reuse them rather than replacing them with stock photos, and never hotlink third-party hosts that may block hotlinking or disappear. The returned URLs go directly into specials.src — same as search_images results. Processes up to 20 URLs per call in parallel, with an 8 MB per-image cap. No Webcake credentials required (the upload endpoint is public). DEFAULTS to dry_run=true (returns a preview of what would be uploaded, no network calls); set dry_run=false to actually upload. Use search_images instead when you need stock photos.",
    {
      urls: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe("External http(s) image URLs or data:image/...;base64,... URIs to upload. 1–20 per call."),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default TRUE — return a preview of the endpoint and URLs that WOULD be processed, without any network activity. Set false to actually download and upload."),
    },
    { title: "Upload Images to Webcake", readOnlyHint: false, openWorldHint: true },
    async ({ urls, dry_run }, extra) => {
      const isDry = dry_run !== false;
      const base = resolveApiBase(extra?.requestInfo?.headers);

      // Deduplicate input URLs.
      const deduped = [...new Set(urls)];

      if (isDry) {
        return text({
          ok: true,
          dry_run: true,
          endpoint: `${base}/external/upload_file`,
          urls_to_upload: deduped,
          hint: "Re-call with dry_run:false to actually download and upload these images.",
        });
      }

      // Process each URL in parallel; per-URL failures don't fail the whole call.
      const results = await Promise.all(
        deduped.map(async (originalUrl): Promise<[string, { ok: true; url: string } | { ok: false; error: string }]> => {
          try {
            let b64: string;
            let contentType: string;

            if (originalUrl.startsWith("data:")) {
              // data:image/<subtype>;base64,<data>
              const match = originalUrl.match(/^data:(image\/[^;,]+);base64,(.+)$/s);
              if (!match) {
                return [originalUrl, { ok: false, error: "Malformed data: URI — expected data:image/<type>;base64,<data>" }];
              }
              contentType = match[1].toLowerCase();
              b64 = match[2];
            } else {
              // Fetch the remote image.
              let res: Response;
              try {
                res = await fetch(originalUrl, {
                  signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
                  headers: {
                    "User-Agent": "Mozilla/5.0 (compatible; webcake-landing-mcp/1.0; +https://webcake.io)",
                  },
                });
              } catch (e: any) {
                return [originalUrl, { ok: false, error: `Fetch failed: ${e?.message ?? e}` }];
              }
              if (!res.ok) {
                return [originalUrl, { ok: false, error: `Remote returned HTTP ${res.status}` }];
              }

              // Reject oversized images early via Content-Length.
              const cl = res.headers.get("content-length");
              if (cl && parseInt(cl, 10) > UPLOAD_MAX_BYTES) {
                return [originalUrl, { ok: false, error: `Image exceeds 8 MB limit (Content-Length: ${cl})` }];
              }

              // Determine content-type; reject non-images (also catches html error pages).
              const rawCt = res.headers.get("content-type") ?? "";
              contentType = rawCt.split(";")[0].trim().toLowerCase() || `image/${extFromUrl(originalUrl)}`;
              if (!contentType.startsWith("image/")) {
                return [originalUrl, { ok: false, error: `Not an image — content-type: ${contentType || "(empty)"}` }];
              }

              const buf = await res.arrayBuffer();
              if (buf.byteLength > UPLOAD_MAX_BYTES) {
                return [originalUrl, { ok: false, error: `Image exceeds 8 MB limit (actual: ${buf.byteLength} bytes)` }];
              }
              b64 = Buffer.from(buf).toString("base64");
            }

            if (!contentType.startsWith("image/")) {
              return [originalUrl, { ok: false, error: `Not an image — content-type: ${contentType}` }];
            }

            const ext = extFromContentType(contentType);
            const result = await uploadImageBase64(base, b64, ext, contentType);
            if (!result.ok) {
              return [originalUrl, { ok: false, error: result.error ?? "Upload failed" }];
            }
            return [originalUrl, { ok: true, url: result.url! }];
          } catch (e: any) {
            return [originalUrl, { ok: false, error: `Unexpected error: ${e?.message ?? e}` }];
          }
        })
      );

      const images: Record<string, { ok: true; url: string } | { ok: false; error: string }> = {};
      let uploaded = 0;
      let failed = 0;
      for (const [url, result] of results) {
        images[url] = result;
        if (result.ok) uploaded++;
        else failed++;
      }

      return text({ ok: true, images, uploaded, failed });
    }
  );
}
