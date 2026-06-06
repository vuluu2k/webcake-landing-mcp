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

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "webcake-landing", version: "1.0.0" },
    { instructions: landingDomain.instructions }
  );
  registerTools(server, landingDomain);
  return server;
}
