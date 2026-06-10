/**
 * Self-installer for webcake-landing-mcp.
 *
 * Runs when the server is invoked as `webcake-landing-mcp install` (e.g. via
 * `npx -y webcake-landing-mcp install`). It collects env config and writes the
 * MCP server block into each selected IDE/agent config file — the same job the
 * standalone install.sh / install.ps1 do, but bundled so npx users don't need
 * to clone anything.
 *
 * Two modes:
 *   - Interactive (a TTY and no --ide flag): asks step by step.
 *   - Flag-driven (--ide present, or no TTY): non-interactive.
 *
 * The launch command written into configs is `npx -y webcake-landing-mcp` when
 * this installer itself was run via npx (path-independent), or
 * `node <abs path>/dist/index.js` when run from a local clone. Override with
 * --npx / --local.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { ENVIRONMENTS, isEnvName, type EnvName } from "./persistence/config.js";
import { runLogin } from "./auth/login.js";

const NAME = "webcake-landing";
const PKG = "webcake-landing-mcp";
const HOME = homedir();
const PLAT = platform(); // 'darwin' | 'linux' | 'win32'
const APPDATA = process.env.APPDATA || join(HOME, "AppData", "Roaming");
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const log = (m = "", color = "") => console.log(`${color}${m}${c.reset}`);
const info = (m: string) => log(`  ${c.cyan}›${c.reset} ${m}`);
const ok = (m: string) => log(`  ${c.green}✓${c.reset} ${m}`);
const warn = (m: string) => log(`  ${c.yellow}!${c.reset} ${m}`);

type Env = Record<string, string>;
type Launch = { command: string; args: string[] };

interface Opts {
  ide?: string;
  apiBase?: string;
  jwt?: string;
  orgId?: string;
  appBase?: string;
  yes: boolean;
  npx?: boolean;
  local?: boolean;
  uninstall: boolean;
}

// ── arg parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Opts {
  const o: Opts = { yes: false, uninstall: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Match `--flag value` and `--flag=value` (but not `--flagXYZ`).
    const is = (...names: string[]) => names.some((n) => a === n || a.startsWith(n + "="));
    const next = () => (a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i]);
    if (a === "--uninstall" || a === "uninstall") o.uninstall = true;
    else if (a === "-y" || a === "--yes") o.yes = true;
    else if (a === "--npx") o.npx = true;
    else if (a === "--local") o.local = true;
    else if (is("--ide")) o.ide = next();
    else if (is("--api-base")) o.apiBase = next();
    else if (is("--jwt", "--token")) o.jwt = next();
    else if (is("--org-id", "--org")) o.orgId = next();
    else if (is("--app-base")) o.appBase = next();
    else if (a === "--help" || a === "-h") o.ide = "__help__";
  }
  return o;
}

// ── readline prompt ──────────────────────────────────────────────────────────
function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── launch command (npx vs local node) ───────────────────────────────────────
function resolveLaunch(o: Opts): Launch {
  const self = fileURLToPath(import.meta.url); // .../dist/install.js
  const ranViaNpx = self.includes(`${"/"}_npx${"/"}`) || self.includes("\\_npx\\");
  const useLocal = o.local ?? (!o.npx && !ranViaNpx);
  if (useLocal) {
    const indexPath = join(dirname(self), "index.js");
    return { command: process.execPath, args: [indexPath] };
  }
  return { command: "npx", args: ["-y", PKG] };
}

// ── JSON config (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code) ──────
function mergeJson(file: string, launch: Launch, env: Env): boolean {
  mkdirSync(dirname(file), { recursive: true });
  let cfg: any = {};
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8").trim();
    if (raw) {
      try {
        cfg = JSON.parse(raw);
      } catch (e: any) {
        warn(`Skip ${file} (invalid JSON: ${e.message})`);
        return false;
      }
    }
  }
  if (typeof cfg.mcpServers !== "object" || !cfg.mcpServers) cfg.mcpServers = {};
  cfg.mcpServers[NAME] = {
    command: launch.command,
    args: launch.args,
    ...(Object.keys(env).length ? { env } : {}),
  };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  return true;
}

// ── OpenCode config (its own shape, not mcpServers) ─────────────────────────
// { "mcp": { "<name>": { "type": "local", "command": [cmd, ...args], "environment": {…} } } }
function mergeOpencodeJson(file: string, launch: Launch, env: Env): boolean {
  mkdirSync(dirname(file), { recursive: true });
  let cfg: any = {};
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8").trim();
    if (raw) {
      try {
        cfg = JSON.parse(raw);
      } catch (e: any) {
        warn(`Skip ${file} (invalid JSON: ${e.message})`);
        return false;
      }
    }
  }
  if (typeof cfg.mcp !== "object" || !cfg.mcp) cfg.mcp = {};
  cfg.mcp[NAME] = {
    type: "local",
    command: [launch.command, ...launch.args],
    enabled: true,
    ...(Object.keys(env).length ? { environment: env } : {}),
  };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  return true;
}

// ── TOML config (Codex) ──────────────────────────────────────────────────────
function configureCodex(launch: Launch, env: Env) {
  const dir = join(HOME, ".codex");
  const cfg = join(dir, "config.toml");
  mkdirSync(dir, { recursive: true });
  const argsToml = launch.args.map((a) => `"${a}"`).join(", ");
  const envParts = Object.entries(env)
    .map(([k, v]) => `"${k}" = "${v}"`)
    .join(", ");
  const envLine = envParts ? `env = { ${envParts} }\n` : "";
  const block = `\n[mcp_servers.${NAME}]\ncommand = "${launch.command}"\nargs = [${argsToml}]\n${envLine}`;
  let content = existsSync(cfg) ? readFileSync(cfg, "utf8") : "# Webcake Landing MCP\n";
  content = content.replace(
    new RegExp(`\\n?\\[mcp_servers\\.${NAME}\\][\\s\\S]*?(?=\\n\\[|$)`),
    ""
  );
  content = content.trimEnd() + "\n" + block;
  writeFileSync(cfg, content);
}

// ── IDE config-file locations ────────────────────────────────────────────────
function claudeDesktopPath(): string {
  if (PLAT === "win32") {
    // Microsoft Store build is MSIX-sandboxed: it reads/writes config inside
    // its package container, NOT %APPDATA%\Claude. Detect that container first
    // (the package name is Claude_<publisher-hash>, e.g. Claude_pzs8sxrjxfjjc)
    // so installs land in the file the Store app actually loads.
    const packages = join(LOCALAPPDATA, "Packages");
    if (existsSync(packages)) {
      try {
        const pkg = readdirSync(packages).find((n) => /^Claude_/i.test(n));
        if (pkg) {
          return join(packages, pkg, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json");
        }
      } catch {
        /* fall through to the Win32 default */
      }
    }
    return join(APPDATA, "Claude", "claude_desktop_config.json");
  }
  const mac = join(HOME, "Library", "Application Support", "Claude");
  const dir = existsSync(mac) ? mac : join(HOME, ".config", "Claude");
  return join(dir, "claude_desktop_config.json");
}
function vscodeUserDir(): string {
  if (PLAT === "win32") return join(APPDATA, "Code", "User");
  const mac = join(HOME, "Library", "Application Support", "Code", "User");
  if (existsSync(mac)) return mac;
  const lin = join(HOME, ".config", "Code", "User");
  if (existsSync(lin)) return lin;
  return join(HOME, ".vscode");
}
const vscodeUserPath = () => join(vscodeUserDir(), "mcp.json");
const cursorPath = () => join(HOME, ".cursor", "mcp.json");
const windsurfPath = () => join(HOME, ".codeium", "windsurf", "mcp_config.json");
const claudeJsonPath = () => join(HOME, ".claude.json");
// Antigravity (Google) reads ~/.gemini/antigravity/mcp_config.json (Agent Manager
// → Manage MCP Servers → View raw config); same mcpServers shape as Claude Desktop.
const antigravityPath = () => join(HOME, ".gemini", "antigravity", "mcp_config.json");
// Gemini CLI keeps mcpServers inside its general settings file.
const geminiPath = () => join(HOME, ".gemini", "settings.json");
const kiroPath = () => join(HOME, ".kiro", "settings", "mcp.json");
// Cline (VS Code extension) stores MCP config in the extension's globalStorage.
const clinePath = () =>
  join(vscodeUserDir(), "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
const opencodePath = () => join(HOME, ".config", "opencode", "opencode.json");

function hasClaudeCli(): boolean {
  const probe = spawnSync(PLAT === "win32" ? "where" : "which", ["claude"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

// ── per-IDE configure ────────────────────────────────────────────────────────
function configureClaudeCode(launch: Launch, env: Env) {
  info("Claude Code…");
  if (hasClaudeCli()) {
    spawnSync("claude", ["mcp", "remove", NAME], { stdio: "ignore" });
    const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const r = spawnSync(
      "claude",
      ["mcp", "add", NAME, ...envFlags, "--", launch.command, ...launch.args],
      { stdio: "inherit" }
    );
    if (r.status === 0) {
      ok("Claude Code configured via CLI — verify: claude mcp list");
      return;
    }
    warn("claude CLI failed — falling back to ~/.claude.json");
  }
  if (mergeJson(claudeJsonPath(), launch, env)) ok(`Claude Code configured (${claudeJsonPath()})`);
}
function configureClaudeDesktop(launch: Launch, env: Env) {
  info("Claude Desktop…");
  if (mergeJson(claudeDesktopPath(), launch, env)) {
    ok(`Claude Desktop configured (${claudeDesktopPath()})`);
    warn("Restart Claude Desktop to load the server.");
  }
}
function configureCursor(launch: Launch, env: Env) {
  info("Cursor…");
  if (mergeJson(cursorPath(), launch, env)) ok(`Cursor configured (${cursorPath()})`);
}
function configureWindsurf(launch: Launch, env: Env) {
  info("Windsurf…");
  if (mergeJson(windsurfPath(), launch, env)) ok(`Windsurf configured (${windsurfPath()})`);
}
function configureAugment(launch: Launch, env: Env) {
  info("Augment / VS Code…");
  if (mergeJson(vscodeUserPath(), launch, env)) ok(`VS Code configured (${vscodeUserPath()})`);
}
function configureCodexIde(launch: Launch, env: Env) {
  info("Codex…");
  configureCodex(launch, env);
  ok(`Codex configured (${join(HOME, ".codex", "config.toml")}) — restart Codex.`);
}
function configureAntigravity(launch: Launch, env: Env) {
  info("Antigravity…");
  if (mergeJson(antigravityPath(), launch, env)) {
    ok(`Antigravity configured (${antigravityPath()})`);
    warn("In Antigravity: Agent Manager → Manage MCP Servers → Refresh (or restart).");
  }
}
function configureGemini(launch: Launch, env: Env) {
  info("Gemini CLI…");
  if (mergeJson(geminiPath(), launch, env)) ok(`Gemini CLI configured (${geminiPath()})`);
}
function configureCline(launch: Launch, env: Env) {
  info("Cline…");
  if (mergeJson(clinePath(), launch, env)) ok(`Cline configured (${clinePath()})`);
}
function configureKiro(launch: Launch, env: Env) {
  info("Kiro…");
  if (mergeJson(kiroPath(), launch, env)) ok(`Kiro configured (${kiroPath()})`);
}
function configureOpencode(launch: Launch, env: Env) {
  info("OpenCode…");
  if (mergeOpencodeJson(opencodePath(), launch, env)) ok(`OpenCode configured (${opencodePath()})`);
}

const IDE_ALIASES: Record<string, string> = {
  "claude-desktop": "claude-desktop",
  desktop: "claude-desktop",
  "claude-code": "claude-code",
  claude: "claude-code",
  code: "claude-code",
  cursor: "cursor",
  windsurf: "windsurf",
  augment: "augment",
  vscode: "augment",
  codex: "codex",
  antigravity: "antigravity",
  gemini: "gemini",
  "gemini-cli": "gemini",
  cline: "cline",
  kiro: "kiro",
  opencode: "opencode",
  all: "all",
};

const CONFIGURATORS: Record<string, (launch: Launch, env: Env) => void> = {
  "claude-desktop": configureClaudeDesktop,
  "claude-code": configureClaudeCode,
  cursor: configureCursor,
  windsurf: configureWindsurf,
  augment: configureAugment,
  codex: configureCodexIde,
  antigravity: configureAntigravity,
  gemini: configureGemini,
  cline: configureCline,
  kiro: configureKiro,
  opencode: configureOpencode,
};

function runConfigure(ides: string[], launch: Launch, env: Env) {
  const set = new Set(ides);
  const targets = set.has("all") ? Object.keys(CONFIGURATORS) : [...set];
  for (const id of targets) {
    const configure = CONFIGURATORS[id];
    if (configure) configure(launch, env);
    else warn(`Unknown IDE: ${id}`);
  }
}

// ── uninstall ────────────────────────────────────────────────────────────────
function removeFromJson(file: string) {
  if (!existsSync(file)) return;
  try {
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    if (cfg.mcpServers && cfg.mcpServers[NAME]) {
      delete cfg.mcpServers[NAME];
      writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
      ok(`Cleaned ${file}`);
    }
  } catch {
    /* ignore unparseable files */
  }
}
function uninstall() {
  log(`\n${c.bold}Uninstalling ${PKG}${c.reset}\n`);
  if (hasClaudeCli()) spawnSync("claude", ["mcp", "remove", NAME], { stdio: "ignore" });
  [
    claudeJsonPath(),
    claudeDesktopPath(),
    join(HOME, ".config", "Claude", "claude_desktop_config.json"),
    cursorPath(),
    windsurfPath(),
    vscodeUserPath(),
    antigravityPath(),
    geminiPath(),
    clinePath(),
    kiroPath(),
  ].forEach(removeFromJson);
  // OpenCode keeps the server under its own `mcp` key, not `mcpServers`.
  const oc = opencodePath();
  if (existsSync(oc)) {
    try {
      const cfg = JSON.parse(readFileSync(oc, "utf8"));
      if (cfg.mcp && cfg.mcp[NAME]) {
        delete cfg.mcp[NAME];
        writeFileSync(oc, JSON.stringify(cfg, null, 2) + "\n");
        ok(`Cleaned ${oc}`);
      }
    } catch {
      /* ignore unparseable files */
    }
  }
  const codex = join(HOME, ".codex", "config.toml");
  if (existsSync(codex)) {
    let content = readFileSync(codex, "utf8");
    content = content.replace(
      new RegExp(`\\n?\\[mcp_servers\\.${NAME}\\][\\s\\S]*?(?=\\n\\[|$)`),
      ""
    );
    writeFileSync(codex, content.trimEnd() + "\n");
    ok("Cleaned Codex config.toml");
  }
  log(`\n${c.green}Done. Restart your IDE.${c.reset}\n`);
}

function printHelp() {
  log(`
${c.bold}webcake-landing-mcp install${c.reset} — configure the MCP server in your IDE(s)

${c.bold}Usage${c.reset}
  npx -y ${PKG} install                 # interactive: pick environment, log in (or paste a JWT), pick IDEs
  npx -y ${PKG} install --ide all       # non-interactive, all IDEs (defaults to --env prod)
  npx -y ${PKG} install --ide claude-code --env local --jwt <JWT>
  npx -y ${PKG} uninstall               # remove from every IDE config

${c.bold}Flags${c.reset}
  --ide <list>      comma list: claude-desktop, claude-code, cursor, windsurf, augment,
                    codex, antigravity, gemini, cline, kiro, opencode, all
  --env <name>      WEBCAKE_ENV: local | staging | prod (default prod) — sets the API + app base URLs
  --jwt <token>     WEBCAKE_JWT (account token; optional — or log in via the browser interactively)
  --org-id <id>     WEBCAKE_ORG_ID (optional default organization)
  --api-base <url>  override the --env API base (advanced)
  --app-base <url>  override the --env app base (advanced)
  --npx | --local   force the launch command form (default: auto-detect)
  -y, --yes         accept defaults, skip confirmations
  --uninstall       remove the server from all IDE configs
`);
}

// ── main ─────────────────────────────────────────────────────────────────────
export async function runInstaller(argv: string[]): Promise<void> {
  const o = parseArgs(argv);
  if (o.ide === "__help__") return printHelp();
  if (o.uninstall) return uninstall();

  log(`\n${c.cyan}${c.bold}Webcake Landing MCP — installer${c.reset}`);
  log(`${c.gray}Build & edit Webcake landing pages from a prompt.${c.reset}`);

  const interactive = !o.ide && process.stdin.isTTY && process.stdout.isTTY;

  // 1) environment — one choice sets the API + app base URLs (replaces the old
  //    separate WEBCAKE_API_BASE / WEBCAKE_APP_BASE prompts). The global --env flag
  //    / WEBCAKE_ENV is already validated in index.ts (applyEnvFlag).
  let envName: EnvName = isEnvName(process.env.WEBCAKE_ENV) ? process.env.WEBCAKE_ENV : "prod";
  if (interactive && !isEnvName(process.env.WEBCAKE_ENV)) {
    log(`\n${c.bold}1) Environment${c.reset} ${c.gray}(sets the Webcake API + app URLs)${c.reset}`);
    log(`  1) prod      ${c.gray}${ENVIRONMENTS.prod.apiBase}${c.reset}  ${c.gray}(default)${c.reset}`);
    log(`  2) staging   ${c.gray}${ENVIRONMENTS.staging.apiBase}${c.reset}`);
    log(`  3) local     ${c.gray}${ENVIRONMENTS.local.apiBase}${c.reset}`);
    const pick = (await ask("  Select [1=prod, Enter to accept]: ")).trim();
    envName = ({ "1": "prod", "2": "staging", "3": "local" } as Record<string, EnvName>)[pick] ?? "prod";
  }
  process.env.WEBCAKE_ENV = envName; // so `login` below connects to the same environment
  const preset = ENVIRONMENTS[envName];

  // 2) authentication — interactively ASK how to authenticate: browser login (token
  //    saved to ~/.webcake-landing-mcp/auth.json) or a pasted JWT. An explicit --jwt
  //    skips the prompt; a non-TTY falls back to the WEBCAKE_JWT env var (for scripted
  //    installs). Reference/validation tools work with no auth at all.
  let jwt = o.jwt ?? "";
  let authNote = jwt ? "JWT (from --jwt)" : "";
  if (interactive && !jwt) {
    log(`\n${c.bold}2) Authentication${c.reset} ${c.gray}(only needed to save pages to your account)${c.reset}`);
    log(`  1) Log in via browser   ${c.gray}(recommended — opens Webcake, saves a token)${c.reset}`);
    log(`  2) Paste a JWT token`);
    log(`  3) Skip for now         ${c.gray}(reference/validation tools still work)${c.reset}`);
    const pick = (await ask("  Select [1]: ")).trim() || "1";
    if (pick === "1") {
      info(`Connecting to ${preset.appBase} …`);
      try {
        await runLogin([]); // reads WEBCAKE_ENV for the connect URL + API base; saves auth.json
        authNote = "browser login (saved to auth.json)";
      } catch (e: any) {
        warn(`Login didn't complete (${e?.message ?? e}). Paste a JWT now, or run \`${PKG} login\` later.`);
        jwt = (await ask("  WEBCAKE_JWT (or Enter to skip): ")).trim();
      }
    } else if (pick === "2") {
      jwt = (await ask("  WEBCAKE_JWT: ")).trim();
    }
  } else if (!interactive) {
    jwt = jwt || process.env.WEBCAKE_JWT || ""; // scripted / CI: fall back to ambient env
  }
  if (!authNote) authNote = jwt ? "JWT" : "none — reference tools only";

  // 3) optional default organization for create_page
  let orgId = o.orgId ?? process.env.WEBCAKE_ORG_ID ?? "";
  if (interactive && !orgId) {
    orgId = (await ask(`\n${c.bold}3) WEBCAKE_ORG_ID${c.reset} ${c.gray}(optional, Enter to skip): ${c.reset}`)).trim();
  }

  // env block written into IDE configs: WEBCAKE_ENV drives the URLs. A pasted JWT is
  // written too; a browser login lives in auth.json instead. --api-base/--app-base/
  // --host stay as advanced overrides for non-standard setups.
  const env: Env = { WEBCAKE_ENV: envName };
  if (jwt) env.WEBCAKE_JWT = jwt;
  if (orgId) env.WEBCAKE_ORG_ID = orgId;
  if (o.apiBase) env.WEBCAKE_API_BASE = o.apiBase;
  if (o.appBase) env.WEBCAKE_APP_BASE = o.appBase;

  // 4) which IDEs
  let ides: string[] = [];
  if (o.ide) {
    ides = o.ide
      .split(",")
      .map((s) => IDE_ALIASES[s.trim().toLowerCase()])
      .filter(Boolean);
  } else if (interactive) {
    log(`\n${c.bold}4) Which IDE(s) to configure?${c.reset}`);
    log("  1) Claude Desktop   2) Claude Code (CLI)   3) Cursor");
    log("  4) Windsurf         5) Augment (VS Code)   6) Codex");
    log("  7) Antigravity      8) Gemini CLI          9) Cline");
    log("  10) Kiro            11) OpenCode");
    log("  12) All             0) Skip");
    const pick = await ask("  Select (comma-separated, e.g. 1,2): ");
    const map: Record<string, string> = {
      "1": "claude-desktop",
      "2": "claude-code",
      "3": "cursor",
      "4": "windsurf",
      "5": "augment",
      "6": "codex",
      "7": "antigravity",
      "8": "gemini",
      "9": "cline",
      "10": "kiro",
      "11": "opencode",
      "12": "all",
    };
    ides = pick
      .split(",")
      .map((s) => map[s.trim()])
      .filter(Boolean);
  } else {
    warn("No --ide given and not a TTY. Nothing to configure.");
    printHelp();
    return;
  }

  if (!ides.length) {
    warn("No IDE selected — skipping configuration.");
    return;
  }

  // 5) write
  const launch = resolveLaunch(o);
  log(`\n${c.bold}5) Writing config${c.reset} ${c.gray}(launch: ${launch.command} ${launch.args.join(" ")})${c.reset}`);
  runConfigure(ides, launch, env);

  // 6) summary
  log(`\n${c.green}${c.bold}✓ Done.${c.reset}`);
  log(`  ${c.gray}Environment : ${envName}  (api ${o.apiBase || preset.apiBase})${c.reset}`);
  log(`  ${c.gray}Auth        : ${authNote}${c.reset}`);
  log(`  Restart your IDE, then ask the AI: “Build a Webcake landing page”.\n`);
}
