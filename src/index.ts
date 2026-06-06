#!/usr/bin/env node
/**
 * Webcake landing MCP server (stdio) — entry point.
 *
 * Thin dispatcher:
 *   - `webcake-landing-mcp install|uninstall|--help` → bundled IDE installer
 *   - `webcake-landing-mcp login` → grab the Webcake JWT via the browser and save it
 *     (~/.webcake-landing-mcp/auth.json); see ./auth/login.ts
 *   - `webcake-landing-mcp serve [--port N]` (or PORT env) → remote Streamable-HTTP
 *     server (for Claude "custom connector" via a public URL); see ./http.ts
 *   - no subcommand → stdio MCP server (the default; for desktop/CLI configs)
 * The server itself (McpServer + tool registration) is built in ./server.ts; the
 * knowledge, factory, validator, and HTTP client live under ./core, ./domains,
 * ./tools, and ./persistence.
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

  if (sub === "login") {
    const { runLogin } = await import("./auth/login.js");
    await runLogin(process.argv.slice(3));
    return;
  }

  if (sub === "serve" || sub === "http" || sub === "serve-http") {
    const { startHttpServer } = await import("./http.js");
    const flagIdx = process.argv.indexOf("--port");
    const raw = (flagIdx !== -1 ? process.argv[flagIdx + 1] : undefined) ?? process.env.PORT;
    const port = Number(raw);
    await startHttpServer(Number.isFinite(port) && port > 0 ? port : 8787);
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
