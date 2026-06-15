/**
 * Media tools: fetch REAL stock images for a page instead of grey placeholders.
 * `search_images` queries the Pexels API and returns ready-to-hotlink URLs the
 * agent drops into an image element's `specials.src` (or a gallery item's `link`).
 * `upload_images` converts external image URLs (or data: URIs) OR LOCAL FILE PATHS
 * (absolute POSIX, ~/…, file://, Windows drive paths) into Webcake-hosted URLs
 * (statics.pancake.vn) so generated pages don't hotlink third-party hosts and the
 * AI never needs to proxy the user's files through a third-party service.
 * Uses multipart/form-data upload (200 MB backend limit).
 *
 * LOCAL FILE PATHS are only allowed on the stdio transport (server running on the
 * user's own machine). On the remote HTTP transport (serve mode, multi-user) every
 * local-path entry is rejected per-entry to prevent arbitrary-file-read attacks.
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
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { text } from "../mcp/response.js";
import {
  searchPexels,
  searchImagesViaProxy,
  resolvePexelsKey,
  resolvePexelsProxyBase,
  pexelsKeyFromHeaders,
} from "../persistence/pexels-client.js";
import { uploadImageMultipart } from "../persistence/webcake-client.js";
import { resolveIconSvg } from "../persistence/icon-client.js";
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

const UPLOAD_FETCH_TIMEOUT_MS = 60_000; // 60 s — large bodies can be slow to transfer
const UPLOAD_MAX_BYTES = 200_000_000; // 200 MB — mirrors the backend multipart Plug.Parsers limit

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

// ---------------------------------------------------------------------------
// Local-path helpers (exported for smoke-test coverage)
// ---------------------------------------------------------------------------

/** Windows drive-letter path pattern, e.g. C:\…  or  C:/… */
const WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/;

/**
 * Return true when `entry` looks like a local file path (not a URL / data URI).
 * Recognised forms: file://, absolute POSIX (/…), home-dir (~/…), Windows drive (C:\…).
 * Exported so the smoke test can assert the pure logic without a transport.
 */
export function isLocalPath(entry: string): boolean {
  return (
    entry.startsWith("file://") ||
    entry.startsWith("/") ||
    entry.startsWith("~/") ||
    WIN_DRIVE_RE.test(entry)
  );
}

/**
 * Resolve a local-path entry to an absolute POSIX path.
 * - file://… → fileURLToPath
 * - ~/…      → expand homedir
 * - /…       → unchanged
 * - C:\…     → unchanged (Windows absolute)
 */
export function resolveLocalPath(entry: string): string {
  if (entry.startsWith("file://")) return fileURLToPath(entry);
  if (entry.startsWith("~/")) return homedir() + entry.slice(1);
  return entry;
}

/** Map a file extension (lowercased, no dot) to its MIME type. */
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
};

/**
 * Sniff the MIME type of a Buffer from its magic bytes.
 * Returns undefined when the signature isn't recognised.
 * Exported for smoke-test coverage.
 */
export function sniffMime(buf: Buffer): string | undefined {
  if (buf.length < 4) return undefined;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // GIF: 47 49 46 38 (GIF87a / GIF89a)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  // WEBP: RIFF????WEBP  (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return "image/webp";
  }
  return undefined;
}

/**
 * Derive the content-type for a local file: sniff magic bytes first, then fall
 * back to the extension. Returns undefined when both fail (unrecognised format).
 * Exported for smoke-test coverage.
 */
export function localContentType(ext: string, buf: Buffer): string | undefined {
  const sniffed = sniffMime(buf);
  const fromExt = EXT_TO_MIME[ext.toLowerCase()] as string | undefined;
  // Prefer sniffed (more reliable); fall back to extension when sniff fails.
  return sniffed ?? fromExt;
}

export function registerMediaTools(server: McpServer, allowLocalFiles = true) {
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

  // 13b) Resolve icon-font names to real inline SVGs --------------------------
  server.tool(
    "get_icon_svg",
    "Resolves icon-font NAMES into real inline SVG markup via the public Iconify API — so a clone reproduces a reference's icons (esp. Google Stitch, which renders icons with a Material Symbols / Font Awesome CLASS, not an image). ingest_html/ingest_url surface those icons as block.icon \"ms:<name>\" (Material Symbols) / \"fa:<name>\" (Font Awesome); pass them here to get the SVG. ACCEPTS: \"ms:verified\", \"fa:chart-line\", a real Iconify id (\"mdi:home\"), or a bare name (assumed Material Symbols); underscores are normalized to hyphens, and Material Symbols resolve to the OUTLINED variant (the Stitch look) with a filled fallback. Returns { icons: { \"<ref>\": { ok, svg, iconify } } }. RENDER each svg as Webcake's native icon element — a RECTANGLE: put the svg in BOTH responsive.desktop.config.svgMask AND responsive.mobile.config.svgMask, set styles.background = the icon color, and keep the box SQUARE (width === height). The svg is only a MASK (its own fill is ignored), so the icon is BLANK without a solid styles.background; the renderer reads each breakpoint's svgMask separately (no fallback) and forces preserveAspectRatio='none' (a non-square box stretches it). No Webcake credentials needed.",
    {
      icons: z
        .array(z.string())
        .min(1)
        .max(40)
        .describe("Icon references to resolve (1–40), e.g. [\"ms:verified\", \"ms:support_agent\", \"fa:chart-line\"] — typically the block.icon values from an ingest result."),
    },
    { title: "Resolve Icon SVGs", readOnlyHint: true, openWorldHint: true },
    async ({ icons }) => {
      const unique = [...new Set(icons)];
      const results = await Promise.all(unique.map(async (ref) => [ref, await resolveIconSvg(ref)] as const));
      const out: Record<string, any> = {};
      let resolved = 0;
      let failed = 0;
      for (const [ref, r] of results) {
        if (r.ok) {
          resolved++;
          out[ref] = { ok: true, svg: r.svg, iconify: r.iconify };
        } else {
          failed++;
          out[ref] = { ok: false, error: r.error };
        }
      }
      return text({
        icons: out,
        resolved,
        failed,
        usage:
          "For each icons[<ref>].svg, make a rectangle in that card's icon slot: copy the svg into BOTH responsive.desktop.config.svgMask AND responsive.mobile.config.svgMask, set styles.background to the icon color, and keep the box SQUARE (width === height) — without styles.background the masked icon is invisible, and a non-square box stretches it. For any ok:false ref, fall back to an emoji inline or skip — never leave a feature card iconless.",
      });
    }
  );

  // 14) Upload images to Webcake -----------------------------------------------
  server.tool(
    "upload_images",
    "Converts external image URLs (typically collected from ingest_html/ingest_url results), data: URIs, or LOCAL FILE PATHS from the user's computer into Webcake-hosted URLs (statics.pancake.vn) by reading/downloading each image and re-uploading it to the Webcake backend via multipart upload (200 MB backend limit). Use this whenever the page is built from a reference HTML/URL (BOTH intents — adapt AND clone), the user supplies their own image URLs, OR the user provides local image files from their machine — pass the path directly in `urls`; NEVER upload a user's local file to a third-party host (catbox, imgur, transfer.sh…) to obtain a URL first. The returned URLs go directly into specials.src — same as search_images results. Processes up to 20 entries per call in parallel, with a 200 MB per-image cap. No Webcake credentials required (the upload endpoint is public). UPLOADS BY DEFAULT (dry_run defaults to FALSE — unlike the page-persistence tools, this touches no account data, so the default is the real upload): the call downloads/reads each entry, uploads it, and returns the images map (original URL → hosted URL); WAIT for that map before assembling the page and never fall back to a placeholder for a slot whose upload succeeded. Pass dry_run:true only to preview what would be processed without any network/filesystem activity. Use search_images instead when you need stock photos. Local file paths are only permitted when the MCP server runs locally (stdio mode); on the remote HTTP transport they are rejected per-entry.",
    {
      urls: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe(
          "Image sources to upload — 1–20 per call. Accepted formats:\n" +
          "• http(s) URLs (remote images to download and re-host)\n" +
          "• data:image/...;base64,... URIs (inline image data)\n" +
          "• Local file paths from the user's machine: absolute POSIX paths (/home/user/photo.jpg), home-dir paths (~/Pictures/logo.png), file:// URIs, or Windows drive paths (C:\\Users\\…). Local paths are only allowed when the server runs in stdio mode (the user's own machine); they are rejected on the remote HTTP transport.\n" +
          "Up to 200 MB per image (the backend multipart limit)."
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe("Default FALSE — the call actually reads/downloads and uploads, returning hosted URLs. Set true to only preview the endpoint and entries that WOULD be processed, without any network or filesystem activity (local paths: reports whether the file exists and its size)."),
    },
    { title: "Upload Images to Webcake", readOnlyHint: false, openWorldHint: true },
    async ({ urls, dry_run }, extra) => {
      const isDry = dry_run === true;
      const base = resolveApiBase(extra?.requestInfo?.headers);

      // Stdio transport: extra.requestInfo is undefined (no HTTP request headers).
      // HTTP transport: extra.requestInfo is always present.
      // We derive allowLocalFiles from the parameter passed into registerMediaTools
      // (true for stdio, false for the HTTP serve mode — see registerTools / http.ts).
      const localAllowed = allowLocalFiles;

      // Deduplicate input entries while preserving original strings as keys.
      const deduped = [...new Set(urls)];

      if (isDry) {
        // For local paths: stat the file so the model catches typos before the real call.
        const urlsInfo = await Promise.all(
          deduped.map(async (entry) => {
            if (isLocalPath(entry)) {
              if (!localAllowed) {
                return { entry, local: true, allowed: false, error: "Local file paths are only supported when the MCP server runs locally (stdio). Send a public URL or data: URI instead." };
              }
              try {
                const resolved = resolveLocalPath(entry);
                const st = await fs.stat(resolved);
                return { entry, local: true, allowed: true, exists: true, size_bytes: st.size, exceeds_limit: st.size > UPLOAD_MAX_BYTES, limit_bytes: UPLOAD_MAX_BYTES };
              } catch {
                return { entry, local: true, allowed: true, exists: false };
              }
            }
            return { entry, local: false };
          })
        );
        return text({
          ok: true,
          dry_run: true,
          endpoint: `${base}/external/upload_file`,
          urls_to_upload: urlsInfo,
          action_required:
            "DRY RUN ONLY — nothing was uploaded and NO hosted URLs exist yet. Do NOT build the page and do NOT fall back to placeholders: re-call upload_images WITHOUT dry_run (uploads by default; batch >20 entries into multiple calls) and WAIT for the returned images map before filling any specials.src / gallery link / background.",
        });
      }

      // Process each entry in parallel; per-entry failures don't fail the whole call.
      const results = await Promise.all(
        deduped.map(async (originalEntry): Promise<[string, { ok: true; url: string } | { ok: false; error: string }]> => {
          try {
            let bytes: Buffer;
            let contentType: string;

            if (isLocalPath(originalEntry)) {
              // --- LOCAL FILE PATH ---
              if (!localAllowed) {
                return [originalEntry, { ok: false, error: "Local file paths are only supported when the MCP server runs locally (stdio). Send a public URL or data: URI instead." }];
              }
              const resolved = resolveLocalPath(originalEntry);

              // Stat first — size check before reading the whole file.
              let stat: Awaited<ReturnType<typeof fs.stat>>;
              try {
                stat = await fs.stat(resolved);
              } catch (e: any) {
                const msg = (e?.code === "ENOENT") ? `File not found: ${resolved}` : `Cannot read file: ${e?.message ?? e}`;
                return [originalEntry, { ok: false, error: msg }];
              }
              if (stat.size > UPLOAD_MAX_BYTES) {
                return [originalEntry, { ok: false, error: `Image exceeds the 200 MB backend limit (file size: ${stat.size} bytes)` }];
              }

              // Read file contents.
              let fileBuf: Buffer;
              try {
                fileBuf = await fs.readFile(resolved);
              } catch (e: any) {
                return [originalEntry, { ok: false, error: `Cannot read file: ${e?.message ?? e}` }];
              }

              // Derive extension from path, sniff MIME from bytes.
              const dotIdx = resolved.lastIndexOf(".");
              const extRaw = dotIdx >= 0 ? resolved.slice(dotIdx + 1).replace(/[?#].*$/, "").toLowerCase() : "";
              const ct = localContentType(extRaw, fileBuf);
              if (!ct) {
                return [originalEntry, { ok: false, error: `Not a recognized image file: ${resolved}` }];
              }
              contentType = ct;
              bytes = fileBuf;

            } else if (originalEntry.startsWith("data:")) {
              // --- DATA URI ---
              const match = originalEntry.match(/^data:(image\/[^;,]+);base64,(.+)$/s);
              if (!match) {
                return [originalEntry, { ok: false, error: "Malformed data: URI — expected data:image/<type>;base64,<data>" }];
              }
              contentType = match[1].toLowerCase();
              bytes = Buffer.from(match[2], "base64");

            } else {
              // --- REMOTE HTTP(S) URL ---
              let res: Response;
              try {
                res = await fetch(originalEntry, {
                  signal: AbortSignal.timeout(UPLOAD_FETCH_TIMEOUT_MS),
                  headers: {
                    "User-Agent": "Mozilla/5.0 (compatible; webcake-landing-mcp/1.0; +https://webcake.io)",
                  },
                });
              } catch (e: any) {
                return [originalEntry, { ok: false, error: `Fetch failed: ${e?.message ?? e}` }];
              }
              if (!res.ok) {
                return [originalEntry, { ok: false, error: `Remote returned HTTP ${res.status}` }];
              }

              // Reject oversized images early via Content-Length.
              const cl = res.headers.get("content-length");
              if (cl && parseInt(cl, 10) > UPLOAD_MAX_BYTES) {
                return [originalEntry, { ok: false, error: `Image exceeds the 200 MB backend limit (Content-Length: ${cl})` }];
              }

              // Determine content-type; reject non-images (also catches html error pages).
              const rawCt = res.headers.get("content-type") ?? "";
              contentType = rawCt.split(";")[0].trim().toLowerCase() || `image/${extFromUrl(originalEntry)}`;
              if (!contentType.startsWith("image/")) {
                return [originalEntry, { ok: false, error: `Not an image — content-type: ${contentType || "(empty)"}` }];
              }

              const buf = await res.arrayBuffer();
              if (buf.byteLength > UPLOAD_MAX_BYTES) {
                return [originalEntry, { ok: false, error: `Image exceeds the 200 MB backend limit (actual: ${buf.byteLength} bytes)` }];
              }
              bytes = Buffer.from(buf);
            }

            if (!contentType.startsWith("image/")) {
              return [originalEntry, { ok: false, error: `Not an image — content-type: ${contentType}` }];
            }

            const ext = extFromContentType(contentType);
            const filename = `upload.${ext}`;
            const result = await uploadImageMultipart(base, bytes, filename, contentType);
            if (!result.ok) {
              return [originalEntry, { ok: false, error: result.error ?? "Upload failed" }];
            }
            return [originalEntry, { ok: true, url: result.url! }];
          } catch (e: any) {
            return [originalEntry, { ok: false, error: `Unexpected error: ${e?.message ?? e}` }];
          }
        })
      );

      const images: Record<string, { ok: true; url: string } | { ok: false; error: string }> = {};
      let uploaded = 0;
      let failed = 0;
      for (const [entry, result] of results) {
        images[entry] = result;
        if (result.ok) uploaded++;
        else failed++;
      }

      return text({
        ok: true,
        images,
        uploaded,
        failed,
        usage:
          "Put images[<original>].url into EVERY element that used <original> (image specials.src, gallery item.link, section/box background url(...)). Slots whose entry uploaded ok MUST use the hosted URL — never a placeholder. Only for entries marked ok:false, fall back to the image-source chain (search_images → your own web search + re-upload → placeholder LAST)." +
          (failed > 0 ? ` ${failed} entr${failed === 1 ? "y" : "ies"} failed — handle them via that fallback chain now.` : ""),
      });
    }
  );
}
