/**
 * Token expiry handling shared by every tool, applied once in createServer so no tool
 * file needs to know about it.
 *  - stdio: an expired (or backend-rejected) JWT reopens the browser Connect page; the
 *    new token is saved by runLogin, readConfig picks it up, and the tool is re-run once.
 *  - remote: the rejected JWT is marked dead, so the next /mcp request answers 401 and
 *    the client (claude.ai / ChatGPT) reopens Connect by itself.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closeSync, mkdirSync, openSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { configDir, configFromHeaders, jwtExpired, readConfig, readSavedConfig } from "../persistence/config.js";
import { markJwtDead } from "./oauth-server.js";
import { runLogin } from "./login.js";

// One browser Connect at a time — across every stdio process on this machine (several IDE
// windows share ~/.webcake-landing-mcp): the first takes a lock file and opens the browser,
// the others wait for the token it saves. After a failed/abandoned Connect, wait before
// reopening so a looping agent doesn't spam tabs.
const LOGIN_WAIT_MS = 185_000; // runLogin times out at 180s
const lockPath = () => join(configDir(), "renew.lock");
let renewing: Promise<boolean> | null = null;
let lastFail = 0;

/** auth.json holds a token newer than `stale` and not expired (another process renewed it). */
const savedFresh = (stale: string | undefined) => {
  const jwt = readSavedConfig().jwt;
  return !!jwt && jwt !== stale && !jwtExpired(jwt);
};

function takeLock(): boolean {
  try {
    mkdirSync(configDir(), { recursive: true });
    closeSync(openSync(lockPath(), "wx"));
    return true;
  } catch {
    try {
      if (Date.now() - statSync(lockPath()).mtimeMs > LOGIN_WAIT_MS) {
        unlinkSync(lockPath()); // left behind by a crashed process
        return takeLock();
      }
    } catch { /* raced with its owner releasing it */ }
    return false;
  }
}

async function renew(stale: string | undefined): Promise<boolean> {
  if (savedFresh(stale)) return true;
  if (!takeLock()) {
    // Someone else has the browser open — wait for the token they save.
    for (const until = Date.now() + LOGIN_WAIT_MS; Date.now() < until; ) {
      await new Promise((r) => setTimeout(r, 1000));
      if (savedFresh(stale)) return true;
      try { statSync(lockPath()); } catch { return savedFresh(stale); } // released without a token
    }
    return false;
  }
  try {
    console.error("[webcake-landing] Token hết hạn — mở trình duyệt để Kết nối lại…");
    await runLogin([]);
    return true;
  } finally {
    try { unlinkSync(lockPath()); } catch { /* already gone */ }
  }
}

export function renewInBrowser(staleJwt?: string): Promise<boolean> {
  if (!renewing && Date.now() - lastFail > 120_000) {
    renewing = renew(staleJwt)
      .then((ok) => {
        if (!ok) lastFail = Date.now();
        return ok;
      })
      .catch((e) => {
        lastFail = Date.now();
        console.error("[webcake-landing] gia hạn token thất bại:", e?.message || e);
        return false;
      })
      .finally(() => {
        renewing = null;
      });
  }
  return renewing ?? Promise.resolve(false);
}

/** Every backend call reports auth failures as "Backend returned 401…" in the tool result. */
export function isUnauthorized(result: any): boolean {
  return !!result?.content?.some((c: any) => typeof c?.text === "string" && /Backend returned 401\b/.test(c.text));
}

const jwtOf = (extra: any) => readConfig(configFromHeaders(extra?.requestInfo?.headers)).config?.jwt;

export function renewAuthOnExpiry(server: McpServer, stdio: boolean): void {
  const tool = server.tool.bind(server) as (...args: any[]) => any;
  (server as any).tool = (...args: any[]) => {
    const handler = args[args.length - 1];
    args[args.length - 1] = async (...call: any[]) => {
      const extra = call[call.length - 1];
      const before = jwtOf(extra);
      if (stdio && jwtExpired(before)) await renewInBrowser(before);
      const used = jwtOf(extra);
      const result = await handler(...call);
      if (!isUnauthorized(result)) return result;
      if (!stdio) {
        await markJwtDead(used);
        return result;
      }
      return (await renewInBrowser(used)) ? handler(...call) : result;
    };
    return tool(...args);
  };
}
