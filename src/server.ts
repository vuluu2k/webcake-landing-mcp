/**
 * Build the MCP server: instantiate McpServer with the landing domain's
 * instructions and register its tool groups. Kept separate from index.ts so the
 * entry point stays a thin dispatcher and the wiring is testable in isolation.
 *
 * To add another domain later: import its `Domain` object and call
 * registerTools(server, otherDomain) — no changes to core or the tool layer.
 */
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { landingDomain } from "./domains/landing/index.js";
import { registerTools } from "./tools/index.js";
import { ICON_DATA_URI, ICON_MIME, BRAND } from "./branding.js";

/**
 * The published package version, read at runtime from package.json so the MCP
 * serverInfo.version always matches what npm shipped (no hand-bumped constant to
 * drift). package.json sits at the package root — one level above dist/ at
 * runtime and above src/ in the tree — so the same relative URL resolves in both
 * the compiled build and a checked-out source tree. Falls back to "0.0.0" if it
 * can't be read (never block startup over a version string). Avoids a JSON import
 * (the repo deliberately uses readFileSync for runtime JSON — see validate.ts).
 */
export function pkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Create the MCP server.
 * @param allowLocalFiles Set to false in remote HTTP (serve) mode to prevent
 *   upload_images from reading arbitrary files off the host filesystem.
 *   Defaults to true (stdio / single-user mode on the user's own machine).
 */
export function createServer({ allowLocalFiles = true }: { allowLocalFiles?: boolean } = {}): McpServer {
  const server = new McpServer(
    {
      name: "webcake-landing",
      version: pkgVersion(),
      // Shown by MCP clients (e.g. the claude.ai connector) instead of a generic
      // globe. icons is per the MCP spec; the data URI keeps it self-contained.
      title: BRAND.title,
      websiteUrl: BRAND.websiteUrl,
      icons: [{ src: ICON_DATA_URI, mimeType: ICON_MIME, sizes: ["any"] }],
    },
    { instructions: landingDomain.instructions }
  );
  registerTools(server, landingDomain, { allowLocalFiles });
  return server;
}
