/**
 * Build the MCP server: instantiate McpServer with the landing domain's
 * instructions and register its tool groups. Kept separate from index.ts so the
 * entry point stays a thin dispatcher and the wiring is testable in isolation.
 *
 * To add another domain later: import its `Domain` object and call
 * registerTools(server, otherDomain) — no changes to core or the tool layer.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { landingDomain } from "./domains/landing/index.js";
import { registerTools } from "./tools/index.js";
import { ICON_DATA_URI, ICON_MIME, BRAND } from "./branding.js";

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
      version: "1.0.0",
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
