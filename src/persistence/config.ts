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
 *   WEBCAKE_APP_BASE  optional SPA base (used for the login connect page)
 *   WEBCAKE_BUILDER_BASE  optional builder host for the editor URLs in the result
 *                     (defaults to the env preset, else derived from the API host)
 *   WEBCAKE_PREVIEW_BASE  optional public preview host for the /preview/<id> links —
 *                     NOT the builder subdomain (defaults to the env preset:
 *                     preview.localhost:5800 / staging.webcake.me / www.webcake.me)
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
 * the preset. `apiBase` is the backend; `appBase` is the SPA (login connect page);
 * `builderBase` is the page builder host that serves the `/editor/v2` URL returned
 * after create/update (a distinct host — NOT the API and NOT the SPA).
 */
export const ENVIRONMENTS = {
  local: { apiBase: "http://localhost:5800", appBase: "http://localhost:5173", builderBase: "http://builder.localhost:5800", previewBase: "http://preview.localhost:5800" },
  staging: { apiBase: "https://api.staging.webcake.io", appBase: "https://staging.webcake.io", builderBase: "https://builder.staging.webcake.io", previewBase: "https://staging.webcake.me" },
  prod: { apiBase: "https://api.webcake.io", appBase: "https://webcake.io", builderBase: "https://builder.webcake.io", previewBase: "https://www.webcake.me" },
} as const;

/** Strip trailing slashes from a base URL (undefined passes through). */
export function stripTrailingSlash(s: string): string;
export function stripTrailingSlash(s: string | undefined): string | undefined;
export function stripTrailingSlash(s: string | undefined): string | undefined {
  return s?.replace(/\/+$/, "");
}

export type EnvName = keyof typeof ENVIRONMENTS;
export const ENV_NAMES = Object.keys(ENVIRONMENTS) as EnvName[];

/** True when `v` names a known environment (local|staging|prod). */
export function isEnvName(v: unknown): v is EnvName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ENVIRONMENTS, v);
}

/** The base URLs for a named environment, or undefined when the name is absent/unknown. */
export function resolveEnv(
  name: string | undefined
): { apiBase: string; appBase: string; builderBase: string; previewBase: string } | undefined {
  return isEnvName(name) ? ENVIRONMENTS[name] : undefined;
}

/**
 * Derive the page-builder host from the API base when no preset / explicit value is
 * given: `api.<domain>` → `builder.<domain>`, otherwise `builder.<host>` (so
 * `http://localhost:5800` → `http://builder.localhost:5800`, matching the presets).
 */
export function deriveBuilderBase(apiBase: string | undefined): string | undefined {
  if (!apiBase) return undefined;
  try {
    const u = new URL(apiBase);
    u.hostname = u.hostname.startsWith("api.") ? `builder.${u.hostname.slice(4)}` : `builder.${u.hostname}`;
    return u.origin;
  } catch {
    return undefined;
  }
}

/** Request-scoped overrides for the env config (used by the HTTP transport). */
export type ConfigOverrides = Partial<Pick<WebcakeConfig, "base" | "jwt" | "orgId" | "appBase" | "builderBase" | "previewBase">> & {
  /** Named environment (local|staging|prod) — fills in base/appBase/builderBase/previewBase when not given explicitly. */
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
  const cleanBase = stripTrailingSlash(base!);
  // The editor/preview URL lives on the builder host (e.g. builder.localhost:5800),
  // not the API base (5800) nor the SPA (5173). Resolve it explicitly so the link
  // returned to the user opens in the page builder.
  const builderBase = stripTrailingSlash(
    overrides.builderBase ??
    process.env.WEBCAKE_BUILDER_BASE ??
    preset?.builderBase ??
    saved.builderBase ??
    deriveBuilderBase(cleanBase)
  );
  // The public preview link (/preview/<id>) is served on its OWN root host — NOT
  // the builder subdomain (preview.localhost:5800 / staging.webcake.me /
  // www.webcake.me). When nothing matches, default to the backend's own preview
  // domain (its @preview_domain) so the link still lands on a host that serves
  // the /preview/:id route.
  const previewBase = stripTrailingSlash(
    overrides.previewBase ??
    process.env.WEBCAKE_PREVIEW_BASE ??
    preset?.previewBase ??
    saved.previewBase ??
    "https://www.webcake.me"
  );
  return {
    config: {
      base: cleanBase,
      jwt: jwt!,
      orgId: overrides.orgId ?? process.env.WEBCAKE_ORG_ID ?? saved.orgId,
      appBase: stripTrailingSlash(overrides.appBase ?? process.env.WEBCAKE_APP_BASE ?? preset?.appBase ?? saved.appBase),
      builderBase,
      previewBase,
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
 *   x-webcake-app-base   SPA base used for the login connect page (overrides the preset)
 *   x-webcake-builder-base  builder host for editor URLs (overrides the preset)
 *   x-webcake-preview-base  public preview host for /preview/<id> links (overrides the preset)
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
    builderBase: header(headers, "x-webcake-builder-base"),
    previewBase: header(headers, "x-webcake-preview-base"),
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
  builderBase?: string;
  previewBase?: string;
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
