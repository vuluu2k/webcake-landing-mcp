/**
 * `webcake-landing-mcp login` — grab the user's Webcake JWT automatically via the
 * browser, no copy-paste.
 *
 * Flow (works for local stdio AND a single-user remote deploy):
 *   1. open a loopback server on 127.0.0.1:<port>,
 *   2. open the browser to the Webcake "connect" URL with redirect_uri=<loopback>,
 *   3. the user is already logged in to Webcake, so Webcake reads their `jwt`
 *      cookie server-side and 302s back to the loopback with ?token=<jwt>,
 *   4. we save it to the credentials file (persistence/config.ts#saveSavedConfig),
 *      which the stdio/http server then reads automatically.
 *
 * Backend contract (added to landing_page_backend — owned by the user):
 *   GET {WEBCAKE_CONNECT_URL}?redirect_uri=<loopback>&state=<s>
 *     → read cookie `jwt` → 302 to <redirect_uri>?token=<jwt>&state=<s>
 *       (or 302 to the login page first, then back). Restrict redirect_uri to
 *       http://127.0.0.1:* / http://localhost:* for safety.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { saveSavedConfig, resolveEnv, ENVIRONMENTS } from "../persistence/config.js";

// Base URLs come from the named environment (the global --env flag / WEBCAKE_ENV),
// defaulting to prod so zero-config `login` still connects via webcake.io. Override
// per field with --connect-url / --api-base or WEBCAKE_APP_BASE / WEBCAKE_API_BASE.
// The connect page lives on the SPA (appBase + /mcp-connect); the API lives on apiBase.

type LoginOpts = { connectUrl?: string; apiBase?: string; orgId?: string; port?: number; open: boolean };

function parseArgs(argv: string[]): LoginOpts {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    connectUrl: get("--connect-url"),
    apiBase: get("--api-base"),
    orgId: get("--org-id"),
    port: get("--port") ? Number(get("--port")) : undefined,
    open: !argv.includes("--no-open"),
  };
}

function openBrowser(url: string) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore — the URL is also printed */
  }
}

const SUCCESS_HTML = `<!doctype html><meta charset="utf-8"><title>Connected</title>
<body style="font-family:system-ui;text-align:center;padding:48px">
<h2>✓ Connected to Webcake</h2><p>You can close this tab and return to your terminal.</p></body>`;

function resolveConnectUrl(opts: LoginOpts, appBase: string): string {
  if (opts.connectUrl) return opts.connectUrl;
  if (process.env.WEBCAKE_CONNECT_URL) return process.env.WEBCAKE_CONNECT_URL;
  // The connect page is on the SPA (appBase, from the env preset), NOT the API base.
  return `${appBase.replace(/\/+$/, "")}/mcp-connect`;
}

export async function runLogin(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  // Named environment (set by the global --env flag / WEBCAKE_ENV); prod is the
  // zero-config default. Explicit --api-base / WEBCAKE_APP_BASE still win per field.
  const preset = resolveEnv(process.env.WEBCAKE_ENV) ?? ENVIRONMENTS.prod;
  const apiBase = opts.apiBase || process.env.WEBCAKE_API_BASE || preset.apiBase;
  const appBase = process.env.WEBCAKE_APP_BASE || preset.appBase;
  const connectUrl = resolveConnectUrl(opts, appBase);
  const state = randomBytes(16).toString("hex");

  await new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const token = url.searchParams.get("token");
      if (!token || url.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/html" }).end("<p>Invalid or expired login — re-run the command.</p>");
        return;
      }
      const path = saveSavedConfig({
        jwt: token,
        base: apiBase.replace(/\/+$/, ""),
        appBase: appBase.replace(/\/+$/, ""),
        ...(opts.orgId ? { orgId: opts.orgId } : {}),
        savedAt: new Date().toISOString(),
      });
      res.writeHead(200, { "content-type": "text/html" }).end(SUCCESS_HTML);
      console.error(`\n✓ Connected. Token saved to ${path} (api ${apiBase}).`);
      server.close();
      resolve();
    });

    server.on("error", reject);

    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const sep = connectUrl.includes("?") ? "&" : "?";
      const full = `${connectUrl}${sep}redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
      console.error("Opening your browser to connect to Webcake (log in there if prompted):");
      console.error("  " + full + "\n");
      if (opts.open) openBrowser(full);
    });

    setTimeout(() => {
      server.close();
      reject(new Error("login timed out after 180s."));
    }, 180_000).unref();
  });
}
