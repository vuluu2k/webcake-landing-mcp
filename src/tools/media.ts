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
    "Find REAL stock photos (Pexels) for a page so images aren't grey placeholders. Works out of the box (a shared hosted proxy supplies images; set PEXELS_API_KEY env or the x-pexels-key header to use your own Pexels quota — free at https://www.pexels.com/api/). Pass a short English subject query (e.g. 'fresh coffee cup', 'modern office team'). Returns hotlinkable URLs at several sizes — put `src.large` (hero/banner) or `src.medium` (card/thumb) into an image element's specials.src, or a gallery item's `link`; `avg_color` helps pick a matching section background. Show photographer attribution when you use a photo.",
    {
      query: z.string().describe("Short English subject to search for, e.g. 'fresh coffee cup', 'spa massage room'."),
      per_page: z.number().int().min(1).max(80).optional().describe("How many results to return (default 5)."),
      orientation: z
        .enum(["landscape", "portrait", "square"])
        .optional()
        .describe("Preferred shape — 'landscape' for heroes/banners, 'portrait' for tall cards, 'square' for icons/avatars."),
      size: z.enum(["large", "medium", "small"]).optional().describe("Minimum photo size to return (default any)."),
      color: z.string().optional().describe("Optional color filter: a name (red, blue, …) or a hex like '6a8f3c'."),
      page: z.number().int().min(1).optional().describe("Result page for pagination (default 1)."),
    },
    async ({ query, per_page, orientation, size, color, page }, extra) => {
      const params = { query, perPage: per_page, page, orientation, size, color };
      const key = resolvePexelsKey(pexelsKeyFromHeaders(extra?.requestInfo?.headers));
      // With a key → call Pexels directly; without one → the shared hosted proxy.
      const result = key
        ? await searchPexels(key, params)
        : await searchImagesViaProxy(resolvePexelsProxyBase(), params);
      if (!result.ok) {
        return text({
          ...result,
          hint: "Couldn't fetch images — set PEXELS_API_KEY (env) or the x-pexels-key header for your own Pexels key (free at https://www.pexels.com/api/), or fall back to https://placehold.co/<width>x<height> placeholders.",
        });
      }
      return text(result);
    }
  );
}
