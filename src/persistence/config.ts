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
 *   WEBCAKE_ENV       optional named environment (local|staging|prod) — fills in the
 *                     API + app base URLs from a preset (see ENVIRONMENTS below). An
 *                     explicit WEBCAKE_API_BASE / WEBCAKE_APP_BASE still wins over it.
 *   WEBCAKE_API_BASE  e.g. http://localhost:5800   (required to call the backend)
 *   WEBCAKE_JWT       the account JWT               (required to call the backend)
 *   WEBCAKE_ORG_ID    optional default organization id for create_page
 *   WEBCAKE_APP_BASE  optional base for editor/preview URLs in the result
 *   WEBCAKE_CONFIG_DIR  optional dir for the saved auth.json (default ~/.webcake-landing-mcp)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { WebcakeConfig } from "./types.js";

/**
 * Named deployment environments — the single source of truth for the API + app
 * base URLs. Selecting one (via the `--env` flag, WEBCAKE_ENV, the `x-webcake-env`
 * header, or `?env=` in the URL) fills in both bases so callers don't repeat them.
 * Explicit WEBCAKE_API_BASE / WEBCAKE_APP_BASE (or per-request overrides) win over
 * the preset. `apiBase` is the backend; `appBase` is the SPA (editor/preview/connect).
 */
export const ENVIRONMENTS = {
  local: { apiBase: "http://localhost:5800", appBase: "http://localhost:5173" },
  staging: { apiBase: "https://api.staging.webcake.io", appBase: "https://staging.webcake.io" },
  prod: { apiBase: "https://api.webcake.io", appBase: "https://webcake.io" },
} as const;

export type EnvName = keyof typeof ENVIRONMENTS;
export const ENV_NAMES = Object.keys(ENVIRONMENTS) as EnvName[];

/** True when `v` names a known environment (local|staging|prod). */
export function isEnvName(v: unknown): v is EnvName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ENVIRONMENTS, v);
}

/** The base URLs for a named environment, or undefined when the name is absent/unknown. */
export function resolveEnv(name: string | undefined): { apiBase: string; appBase: string } | undefined {
  return isEnvName(name) ? ENVIRONMENTS[name] : undefined;
}

/** Request-scoped overrides for the env config (used by the HTTP transport). */
export type ConfigOverrides = Partial<Pick<WebcakeConfig, "base" | "jwt" | "orgId" | "appBase">> & {
  /** Named environment (local|staging|prod) — fills in base/appBase when not given explicitly. */
  env?: string;
};

export function readConfig(overrides: ConfigOverrides = {}): { config: WebcakeConfig | null; missing: string[] } {
  const saved = readSavedConfig();
  // A named environment supplies default base URLs; explicit values still win.
  const preset = resolveEnv(overrides.env ?? process.env.WEBCAKE_ENV);
  const base = overrides.base ?? process.env.WEBCAKE_API_BASE ?? preset?.apiBase ?? saved.base;
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
      appBase: (overrides.appBase ?? process.env.WEBCAKE_APP_BASE ?? preset?.appBase ?? saved.appBase)?.replace(/\/+$/, ""),
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
 *   x-webcake-env        named environment (local|staging|prod) for the base URLs
 *   x-webcake-api-base   backend base URL (overrides the env preset)
 *   x-webcake-app-base   editor/preview URL base (overrides the env preset)
 * Any header that is absent falls back to the corresponding env var in readConfig.
 */
export function configFromHeaders(headers: HeaderBag): ConfigOverrides {
  const auth = header(headers, "authorization");
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : undefined;
  return {
    base: header(headers, "x-webcake-api-base"),
    jwt: header(headers, "x-webcake-jwt") ?? bearer,
    orgId: header(headers, "x-webcake-org-id"),
    appBase: header(headers, "x-webcake-app-base"),
    env: header(headers, "x-webcake-env"),
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
