#!/usr/bin/env node
/**
 * Webcake landing MCP server (stdio) — entry point.
 *
 * Thin dispatcher: `webcake-landing-mcp install|uninstall|--help` runs the
 * bundled IDE installer; otherwise it starts the stdio MCP server. The server
 * itself (McpServer + tool registration) is built in ./server.ts; the knowledge,
 * factory, validator, and HTTP client live under ./core, ./domains, ./tools, and
 * ./persistence.
 *
 * stdout is the MCP channel — all logging goes to stderr (console.error) only.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  // Subcommand dispatch: `webcake-landing-mcp install|uninstall` runs the
  // bundled IDE installer instead of starting the MCP server. Default (no
  // subcommand) starts the stdio server as usual.
  const sub = process.argv[2];
  if (sub === "install" || sub === "uninstall" || sub === "--help" || sub === "-h") {
    const { runInstaller } = await import("./install.js");
    const rest =
      sub === "uninstall"
        ? ["--uninstall", ...process.argv.slice(3)]
        : sub === "--help" || sub === "-h"
          ? ["--help"]
          : process.argv.slice(3);
    await runInstaller(rest);
    return;
  }

  const transport = new StdioServerTransport();
  const server = createServer();
  await server.connect(transport);
  // stderr only — stdout is the MCP channel.
  console.error("[webcake-elements] MCP server ready on stdio.");
}

main().catch((err) => {
  console.error("[webcake-elements] fatal:", err);
  process.exit(1);
});
