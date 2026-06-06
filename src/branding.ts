/**
 * Brand icon for the MCP server, shared by both transports.
 *
 * Why this exists: an MCP client (e.g. the claude.ai custom-connector UI) shows
 * a generic globe when it can't find an icon for the server. Two mechanisms can
 * supply one, so we feed BOTH from this single source:
 *   1. A favicon served over HTTP (`/favicon.ico` / `/favicon.svg`) — what
 *      favicon-style clients fetch from the server's origin.
 *   2. `serverInfo.icons` in the `initialize` result (MCP spec) — a self-contained
 *      data URI so it works without the server knowing its own public URL.
 *
 * The mark is the Webcake green lightning bolt (matches the SPA's McpConnect page).
 */

// A rounded-square Webcake-green tile with a white lightning bolt. Kept tiny and
// dependency-free so it can be both served raw and inlined as a data URI.
export const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#14a547"/>' +
  '<path d="M17.5 5 9 17.2h5.6L13 27l9.5-12.2h-5.6L17.5 5Z" fill="#fff"/>' +
  "</svg>";

export const ICON_MIME = "image/svg+xml";

// Self-contained data URI for serverInfo.icons (no public URL required).
export const ICON_DATA_URI = `data:${ICON_MIME};base64,${Buffer.from(ICON_SVG).toString("base64")}`;

// Public-facing identity reused across the server metadata.
export const BRAND = {
  title: "Webcake Landing",
  websiteUrl: "https://webcake.io",
} as const;
