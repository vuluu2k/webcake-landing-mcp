/**
 * Token expiry handling shared by every tool, applied once in createServer so no tool
 * file needs to know about it.
 *  - stdio: an expired (or backend-rejected) JWT reopens the browser Connect page; the
 *    new token is saved by runLogin, readConfig picks it up, and the tool is re-run once.
 *  - remote: the rejected JWT is marked dead, so the next /mcp request answers 401 and
 *    the client (claude.ai / ChatGPT) reopens Connect by itself.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configFromHeaders, jwtExpired, readConfig } from "../persistence/config.js";
import { markJwtDead } from "./oauth-server.js";
import { runLogin } from "./login.js";

// One browser Connect at a time; after a failed/abandoned one, wait before reopening so a
// looping agent doesn't spam tabs. ponytail: process-wide, fine for one stdio user.
let renewing: Promise<boolean> | null = null;
let lastFail = 0;

export function renewInBrowser(): Promise<boolean> {
  if (!renewing && Date.now() - lastFail > 120_000) {
    console.error("[webcake-landing] Token hết hạn — mở trình duyệt để Kết nối lại…");
    renewing = runLogin([])
      .then(() => true)
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
      if (stdio && jwtExpired(jwtOf(extra))) await renewInBrowser();
      const result = await handler(...call);
      if (!isUnauthorized(result)) return result;
      if (!stdio) {
        markJwtDead(jwtOf(extra));
        return result;
      }
      return (await renewInBrowser()) ? handler(...call) : result;
    };
    return tool(...args);
  };
}
