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
 *   GET <connect-url>?redirect_uri=<loopback>&state=<s>   (connect-url = appBase + /mcp-connect)
 *     → read cookie `jwt` → 302 to <redirect_uri>?token=<jwt>&state=<s>
 *       (or 302 to the login page first, then back). Restrict redirect_uri to
 *       http://127.0.0.1:* / http://localhost:* for safety.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { saveSavedConfig, resolveEnv, ENVIRONMENTS, stripTrailingSlash } from "../persistence/config.js";

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
  try {
    if (platform === "win32") {
      // `cmd /c start` parses an unquoted `&` as a command separator, which cuts
      // the connect URL right before `&state=...` (the login then bounces back to
      // the loopback without state and is rejected). Pass the args verbatim with
      // the URL double-quoted so cmd hands `start` the full URL. The first quoted
      // arg ("") is `start`'s window title.
      spawn("cmd", ["/c", "start", '""', `"${url}"`], {
        stdio: "ignore",
        detached: true,
        windowsVerbatimArguments: true,
      }).unref();
      return;
    }
    const cmd = platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore — the URL is also printed */
  }
}

// Chrome won't let a page close a tab it didn't open (window.close() is blocked),
// so instead we bring the user's terminal back to the foreground from Node. We
// snapshot whatever app is frontmost just before opening the browser (that's the
// terminal that ran the command) and re-activate it once the token arrives.
// macOS only (AppleScript); a no-op elsewhere — the success page still shows.
function captureFrontmostApp(): Promise<string | undefined> {
  if (process.platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | undefined) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const child = execFile(
      "osascript",
      ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'],
      (err, stdout) => finish(err ? undefined : stdout.trim() || undefined),
    );
    // Never let login stall: the first run may hang on the macOS Automation
    // permission prompt. Give up after 2s (re-focus is just a nicety).
    setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      finish(undefined);
    }, 2000).unref();
  });
}

function activateApp(name: string | undefined) {
  if (!name || process.platform !== "darwin") return;
  // Re-focus by process name via System Events (works for terminals whose app
  // name differs from the process, e.g. iTerm/Terminal/Warp/VS Code).
  execFile(
    "osascript",
    ["-e", `tell application "System Events" to set frontmost of (first application process whose name is "${name.replace(/"/g, '\\"')}") to true`],
    () => {},
  );
}

const SUCCESS_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected to Webcake</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:linear-gradient(135deg,#eef2ff 0%,#faf5ff 100%);color:#1e293b}
  @media(prefers-color-scheme:dark){body{background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);color:#e2e8f0}}
  .card{background:#fff;border-radius:20px;padding:48px 40px;max-width:420px;width:calc(100% - 32px);
    text-align:center;box-shadow:0 20px 60px rgba(79,70,229,.18);animation:rise .5s cubic-bezier(.2,.8,.2,1)}
  @media(prefers-color-scheme:dark){.card{background:#1e293b;box-shadow:0 20px 60px rgba(0,0,0,.5)}}
  @keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
  .badge{width:84px;height:84px;margin:0 auto 24px;border-radius:50%;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 8px 24px rgba(34,197,94,.4);animation:pop .45s .15s both cubic-bezier(.2,1.4,.4,1)}
  @keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
  .badge svg{width:44px;height:44px;stroke:#fff;stroke-width:3.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
  .badge path{stroke-dasharray:32;stroke-dashoffset:32;animation:draw .4s .4s forwards ease-out}
  @keyframes draw{to{stroke-dashoffset:0}}
  h1{margin:0 0 10px;font-size:1.55rem;font-weight:700}
  p{margin:0;font-size:1rem;line-height:1.6;color:#64748b}
  @media(prefers-color-scheme:dark){p{color:#94a3b8}}
  .hint{margin-top:24px;display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;
    background:#f1f5f9;font-size:.9rem;color:#475569}
  @media(prefers-color-scheme:dark){.hint{background:#0f172a;color:#94a3b8}}
  .hint code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:#4f46e5}
  @media(prefers-color-scheme:dark){.hint code{color:#a5b4fc}}
</style></head>
<body>
  <main class="card">
    <div class="badge"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></div>
    <h1>Connected to Webcake</h1>
    <p>Your account is linked. You can close this tab now.</p>
    <div class="hint">👉 Return to your <code>terminal</code> to continue</div>
  </main>
  <script>
    // The terminal is re-focused from the CLI side. Still try window.close() for
    // browsers that allow it (no-op in Chrome for tabs it didn't open) — no alert,
    // which would only steal focus back from the terminal.
    setTimeout(function(){ try { window.close(); } catch (e) {} }, 800);
  </script>
</body></html>`;

function resolveConnectUrl(opts: LoginOpts, appBase: string): string {
  if (opts.connectUrl) return opts.connectUrl; // explicit --connect-url override
  // The connect page is on the SPA (appBase, from the env preset), NOT the API base.
  return `${stripTrailingSlash(appBase)}/mcp-connect`;
}

/**
 * The full browser URL for the connect page. The redirect_uri is percent-encoded;
 * `state` rides as a separate query param — if a shell mangles the URL (see
 * openBrowser's Windows note) the state is what goes missing, and parseCallback
 * rejects the round-trip. Pure + exported so smoke can pin the contract.
 */
export function buildConnectUrl(connectUrl: string, redirectUri: string, state: string): string {
  const sep = connectUrl.includes("?") ? "&" : "?";
  return `${connectUrl}${sep}redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
}

export type CallbackResult =
  | { ok: true; token: string }
  | { ok: false; status: 400 | 404; reason: string };

/** Decide what a loopback request means. Pure + exported so smoke can test it. */
export function parseCallback(reqUrl: string | undefined, expectedState: string): CallbackResult {
  const url = new URL(reqUrl || "/", "http://127.0.0.1");
  if (url.pathname !== "/callback") return { ok: false, status: 404, reason: "Not found" };
  const token = url.searchParams.get("token");
  if (!token) return { ok: false, status: 400, reason: "no token in the callback — re-run the command" };
  if (url.searchParams.get("state") !== expectedState)
    return { ok: false, status: 400, reason: "state mismatch (login link truncated or expired) — re-run the command" };
  return { ok: true, token };
}

export async function runLogin(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  if (opts.port !== undefined && !Number.isInteger(opts.port)) {
    throw new Error(`--port must be a number, got "${argv[argv.indexOf("--port") + 1]}"`);
  }
  // Named environment (set by the global --env flag / WEBCAKE_ENV); prod is the
  // zero-config default. Explicit --api-base / WEBCAKE_APP_BASE still win per field.
  const preset = resolveEnv(process.env.WEBCAKE_ENV) ?? ENVIRONMENTS.prod;
  const apiBase = opts.apiBase || process.env.WEBCAKE_API_BASE || preset.apiBase;
  const appBase = process.env.WEBCAKE_APP_BASE || preset.appBase;
  const connectUrl = resolveConnectUrl(opts, appBase);
  const state = randomBytes(16).toString("hex");
  // Remember the terminal that's frontmost now, so we can re-focus it once the
  // browser hands the token back (Chrome can't auto-close its own tab).
  const terminalApp = await captureFrontmostApp();

  await new Promise<void>((resolve, reject) => {
    // `close()` only stops NEW connections; a browser keep-alive socket would
    // keep the event loop (and the CLI) alive, so drop the live ones too.
    const shutdown = () => {
      server.close();
      server.closeAllConnections();
    };

    const server = createServer((req, res) => {
      const cb = parseCallback(req.url, state);
      if (!cb.ok) {
        res.writeHead(cb.status, { "content-type": "text/html" }).end(`<p>${cb.reason}</p>`);
        return; // keep listening — the user can retry until the timeout
      }
      let path: string;
      try {
        path = saveSavedConfig({
          jwt: cb.token,
          base: stripTrailingSlash(apiBase),
          appBase: stripTrailingSlash(appBase),
          ...(opts.orgId ? { orgId: opts.orgId } : {}),
          savedAt: new Date().toISOString(),
        });
      } catch (e: any) {
        // Surface the real write error (EPERM/ENOSPC/AV lock…) instead of
        // crashing the process from inside the request handler.
        res.writeHead(500, { "content-type": "text/html" }).end("<p>Login succeeded but saving credentials failed — check the terminal.</p>");
        shutdown();
        reject(new Error(`could not save credentials to ${process.env.WEBCAKE_CONFIG_DIR || "~/.webcake-landing-mcp"}/auth.json: ${e?.message ?? e}`));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(SUCCESS_HTML);
      console.error(`\n✓ Connected. Token saved to ${path} (api ${apiBase}).`);
      // Pull the terminal back to the front (best-effort; no-op off macOS).
      activateApp(terminalApp);
      shutdown();
      resolve();
    });

    server.on("error", reject);

    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      const full = buildConnectUrl(connectUrl, `http://127.0.0.1:${port}/callback`, state);
      console.error("Opening your browser to connect to Webcake (log in there if prompted):");
      console.error("  " + full + "\n");
      if (opts.open) openBrowser(full);
    });

    setTimeout(() => {
      shutdown();
      reject(new Error("login timed out after 180s."));
    }, 180_000).unref();
  });
}
