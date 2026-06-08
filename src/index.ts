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
import { loadDotenv } from "./env.js";
import { ENVIRONMENTS, ENV_NAMES, isEnvName } from "./persistence/config.js";

/**
 * Global `--env <local|staging|prod>` flag (or `--env=<name>`): selects the API +
 * app base URLs from a named preset by setting WEBCAKE_ENV, which readConfig + login
 * then pick up. Explicit WEBCAKE_API_BASE / WEBCAKE_APP_BASE still win. An unknown
 * value from the flag fails fast; an unknown WEBCAKE_ENV is dropped so explicit
 * bases (or per-request headers) still resolve. stderr only — stdout is the MCP channel.
 */
function applyEnvFlag(argv: string[]): void {
  let fromFlag: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env") fromFlag = argv[i + 1];
    else if (a.startsWith("--env=")) fromFlag = a.slice("--env=".length);
  }
  const name = fromFlag ?? process.env.WEBCAKE_ENV;
  if (!name) return;
  if (!isEnvName(name)) {
    console.error(`[webcake] unknown environment "${name}". Valid: ${ENV_NAMES.join(", ")}.`);
    if (fromFlag) process.exit(1); // explicit flag typo → fail fast
    delete process.env.WEBCAKE_ENV; // bad WEBCAKE_ENV → ignore, fall through to explicit bases
    return;
  }
  process.env.WEBCAKE_ENV = name;
  const p = ENVIRONMENTS[name];
  console.error(`[webcake] environment "${name}" — api ${p.apiBase}, app ${p.appBase}`);
}

/** Top-level CLI help — overview of every subcommand (stdout; not used in MCP mode). */
function printHelp(): void {
  console.log(
    [
      "webcake-landing-mcp — MCP server for building Webcake landing pages",
      "",
      "Usage: npx -y webcake-landing-mcp [command] [options]",
      "",
      "Commands:",
      "  (none)             start the stdio MCP server (use this in IDE configs)",
      "  install            configure the server in your IDE(s) — interactive (env + login/JWT)",
      "  uninstall          remove the server from your IDE configs",
      "  login              grab your Webcake token via the browser (saved to ~/.webcake-landing-mcp/auth.json)",
      "  serve [--port N]   run the remote Streamable-HTTP server (default port 8787; or PORT env)",
      "  help, --help, -h   show this help",
      "",
      "Global options:",
      "  --env <local|staging|prod>   pick the API + app base URLs (default prod)",
      "",
      "More:",
      "  npx -y webcake-landing-mcp install --help   # install-specific flags",
      "  https://github.com/vuluu2k/webcake-landing-mcp",
    ].join("\n")
  );
}

async function main() {
  // Load `.env` (if any) before anything reads process.env — real env vars and
  // per-request headers still win over the file.
  loadDotenv();
  // Resolve the named environment (--env / WEBCAKE_ENV) before any config is read.
  applyEnvFlag(process.argv);

  // Subcommand dispatch: `webcake-landing-mcp install|uninstall` runs the
  // bundled IDE installer instead of starting the MCP server. Default (no
  // subcommand) starts the stdio server as usual.
  const sub = process.argv[2];
  if (sub === "help" || sub === "--help" || sub === "-h") {
    printHelp();
    return;
  }
  if (sub === "install" || sub === "uninstall") {
    const { runInstaller } = await import("./install.js");
    const rest = sub === "uninstall" ? ["--uninstall", ...process.argv.slice(3)] : process.argv.slice(3);
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
