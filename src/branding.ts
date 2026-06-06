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
 * The mark is the official Webcake logo — a green-gradient rounded tile with a
 * white "W" and a peach accent dot (source: the Webcake brand icon).
 */

// The official Webcake icon: a green-gradient (#3FBB57 → #108B67) rounded tile,
// a white "W" mark and a peach (#FFD591) accent dot. Kept inline (dependency-free)
// so it can be served raw AND inlined as a data URI. The gradient id is unique
// to avoid clashing when this SVG is inlined into a page.
export const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">' +
  '<path d="M0 16C0 8.598 0 4.89699 2.23049 2.54229C2.33157 2.43558 2.43552 2.33163 2.54223 2.23055C4.89692 6.10352e-05 8.59793 6.10352e-05 16 6.10352e-05C23.402 6.10352e-05 27.103 6.10352e-05 29.4577 2.23055C29.5644 2.33163 29.6683 2.43558 29.7694 2.54229C31.9999 4.89699 31.9999 8.598 31.9999 16C31.9999 23.402 31.9999 27.103 29.7694 29.4577C29.6683 29.5645 29.5644 29.6684 29.4577 29.7695C27.103 32 23.402 32 16 32C8.59793 32 4.89692 32 2.54223 29.7695C2.43552 29.6684 2.33157 29.5645 2.23049 29.4577C0 27.103 0 23.402 0 16Z" fill="url(#wc_grad)"/>' +
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.3011 11.3523C14.395 12.3191 14.4157 12.0816 15.0571 13.6768C15.0571 21.9423 13.5334 16.5399 12.2589 13.6732C11.4363 11.7505 10.7943 9.30526 8.74858 9.1988C7.57201 9.1623 6.51244 9.98392 6.47107 11.062C6.44377 11.4475 6.49804 11.8319 6.64075 12.191C7.2016 13.6024 8.65083 17.1402 8.92789 17.7945C9.36942 18.8396 9.77116 19.8691 10.1854 20.8761C10.6124 21.9109 11.0522 22.8274 12.5529 22.8274H12.8564C13.9412 22.8274 15.026 21.8587 15.4402 21.1763C16.0707 20.1346 15.8417 17.4106 16.1743 16.3166C16.2961 16.756 17.7389 20.1485 17.9731 20.6986C18.3873 21.6795 18.8071 22.8271 20.23 22.8271H20.686C21.8473 22.8271 22.8155 21.7767 22.8155 20.6483V20.5753C22.7647 19.951 20.713 15.1116 20.3587 14.2785C19.9081 13.2212 19.5137 12.2125 19.0666 11.1569C18.6251 10.1118 18.1725 9.17255 16.6572 9.17255H16.4281C15.2651 9.17255 14.3004 10.209 14.3004 11.3513L14.3011 11.3523Z" fill="white"/>' +
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M23.4118 9.17242C22.2193 9.17242 21.252 10.1378 21.252 11.3277C21.252 12.5177 22.2193 13.4818 23.4118 13.4818C24.6042 13.4818 25.5703 12.5177 25.5703 11.3277C25.5703 10.1378 24.6042 9.17242 23.4118 9.17242Z" fill="#FFD591"/>' +
  '<defs><linearGradient id="wc_grad" x1="16" y1="0" x2="16" y2="32" gradientUnits="userSpaceOnUse"><stop stop-color="#3FBB57"/><stop offset="1" stop-color="#108B67"/></linearGradient></defs>' +
  "</svg>";

export const ICON_MIME = "image/svg+xml";

// Self-contained data URI for serverInfo.icons (no public URL required).
export const ICON_DATA_URI = `data:${ICON_MIME};base64,${Buffer.from(ICON_SVG).toString("base64")}`;

// Public-facing identity reused across the server metadata.
export const BRAND = {
  title: "Webcake Landing",
  websiteUrl: "https://webcake.io",
} as const;
