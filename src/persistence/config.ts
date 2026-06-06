/**
 * Resolve the persistence config. Three sources, in priority order:
 *  1. per-request `overrides` (remote/Streamable-HTTP mode: each client sends its
 *     OWN Webcake JWT via HTTP headers — see `configFromHeaders` — so a hosted
 *     server is multi-user and never bakes a shared secret into env), then
 *  2. environment variables (stdio / single-user mode), then
 *  3. the saved credentials file written by `webcake-landing-mcp login`
 *     (~/.webcake-landing-mcp/auth.json) — so a user can connect once via the
 *     browser instead of pasting a token.
 *
 * The JWT is never hard-coded (the repo is public). `readConfig` returns
 * { config: null, missing } when required values are absent so the persistence
 * tools can report exactly what to provide.
 *
 *   WEBCAKE_API_BASE  e.g. http://localhost:5800   (required to call the backend)
 *   WEBCAKE_JWT       the account JWT               (required to call the backend)
 *   WEBCAKE_ORG_ID    optional default organization id for create_page
 *   WEBCAKE_HOST      optional Host header override (Phoenix routes by host)
 *   WEBCAKE_APP_BASE  optional base for editor/preview URLs in the result
 *   WEBCAKE_CONFIG_DIR  optional dir for the saved auth.json (default ~/.webcake-landing-mcp)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { WebcakeConfig } from "./types.js";

/** Request-scoped overrides for the env config (used by the HTTP transport). */
export type ConfigOverrides = Partial<Pick<WebcakeConfig, "base" | "jwt" | "orgId" | "host" | "appBase">>;

export function readConfig(overrides: ConfigOverrides = {}): { config: WebcakeConfig | null; missing: string[] } {
  const saved = readSavedConfig();
  const base = overrides.base ?? process.env.WEBCAKE_API_BASE ?? saved.base;
  const jwt = overrides.jwt ?? process.env.WEBCAKE_JWT ?? saved.jwt;
  const missing: string[] = [];
  if (!base) missing.push("WEBCAKE_API_BASE");
  if (!jwt) missing.push("WEBCAKE_JWT");
  if (missing.length) return { config: null, missing };
  return {
    config: {
      base: base!.replace(/\/+$/, ""),
      jwt: jwt!,
      orgId: overrides.orgId ?? process.env.WEBCAKE_ORG_ID ?? saved.orgId,
      host: overrides.host ?? process.env.WEBCAKE_HOST ?? saved.host,
      appBase: (overrides.appBase ?? process.env.WEBCAKE_APP_BASE ?? saved.appBase)?.replace(/\/+$/, ""),
    },
    missing: [],
  };
}

/** A header bag as Node delivers it (lowercased keys) — also the SDK's IsomorphicHeaders shape. */
type HeaderBag = Record<string, string | string[] | undefined> | undefined;

function header(headers: HeaderBag, name: string): string | undefined {
  const v = headers?.[name];
  return Array.isArray(v) ? v[0] : v ?? undefined;
}

/**
 * Build request-scoped config overrides from HTTP headers. Lets a remote client
 * send its own credentials per request instead of a server-wide env token:
 *   x-webcake-jwt        the account JWT (or `Authorization: Bearer <jwt>`)
 *   x-webcake-org-id     organization id
 *   x-webcake-api-base   backend base URL (usually set once via env instead)
 *   x-webcake-host       Host header override
 *   x-webcake-app-base   editor/preview URL base
 * Any header that is absent falls back to the corresponding env var in readConfig.
 */
export function configFromHeaders(headers: HeaderBag): ConfigOverrides {
  const auth = header(headers, "authorization");
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : undefined;
  return {
    base: header(headers, "x-webcake-api-base"),
    jwt: header(headers, "x-webcake-jwt") ?? bearer,
    orgId: header(headers, "x-webcake-org-id"),
    host: header(headers, "x-webcake-host"),
    appBase: header(headers, "x-webcake-app-base"),
  };
}

// ---------------------------------------------------------------------------
// Saved credentials file — written by `webcake-landing-mcp login` (browser flow),
// read here as the lowest-priority source so a one-time connect replaces pasting.
// ---------------------------------------------------------------------------

export type SavedConfig = {
  base?: string;
  jwt?: string;
  orgId?: string;
  host?: string;
  appBase?: string;
  savedAt?: string;
};

/** Directory for the saved auth file (override with WEBCAKE_CONFIG_DIR). */
export function configDir(): string {
  return process.env.WEBCAKE_CONFIG_DIR || join(homedir(), ".webcake-landing-mcp");
}

export function savedConfigPath(): string {
  return join(configDir(), "auth.json");
}

/** Read the saved credentials; {} when the file is absent or unreadable. */
export function readSavedConfig(): SavedConfig {
  try {
    const parsed = JSON.parse(readFileSync(savedConfigPath(), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as SavedConfig) : {};
  } catch {
    return {};
  }
}

/** Merge + persist credentials to the saved file (0600). Returns the path written. */
export function saveSavedConfig(partial: SavedConfig): string {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const path = savedConfigPath();
  writeFileSync(path, JSON.stringify({ ...readSavedConfig(), ...partial }, null, 2), { mode: 0o600 });
  return path;
}
