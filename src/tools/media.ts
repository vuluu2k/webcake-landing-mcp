/**
 * Media tools: fetch REAL stock images for a page instead of grey placeholders.
 * `search_images` queries the Pexels API and returns ready-to-hotlink URLs the
 * agent drops into an image element's `specials.src` (or a gallery item's `link`).
 *
 * The Pexels API key is a secret resolved per request: the `x-pexels-key` header
 * (remote / multi-user) wins, else the `PEXELS_API_KEY` env var (stdio). With a key
 * we call Pexels directly; WITHOUT one we fall back to the shared hosted proxy
 * (https://mcp.toolvn.io.vn) so `npx` users get images with zero setup. The page can
 * still fall back to placeholders if even the proxy is unreachable. No Webcake creds.
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

export function registerMediaTools(server: McpServer) {
  // 13) Search images ---------------------------------------------------------
  server.tool(
    "search_images",
    "Searches Pexels stock photos (see https://www.pexels.com/api/) by short English subject queries. Returns hotlinkable URLs at several sizes (src.large for heroes/banners, src.medium for cards/thumbs), `avg_color` for matching section backgrounds, plus photographer name and attribution URL. BATCH MODE: pass `queries: [...]` to fetch multiple subjects in PARALLEL — e.g. ['fresh coffee cup','barista pouring','interior cafe'] for hero + about + gallery — returns { queries: { [q]: result } } so the caller picks one image per slot in a single round-trip; default `pick='best'` returns only the top photo per query (compact, drop-in for specials.src), `pick='all'` returns the full list. `query` (single) returns the full result like before. Works out of the box via a shared hosted proxy; set PEXELS_API_KEY env or x-pexels-key header to use your own quota.",
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
}
