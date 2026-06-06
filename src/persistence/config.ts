/**
 * Resolve the persistence config. Two sources, in priority order:
 *  1. per-request `overrides` (remote/Streamable-HTTP mode: each client sends its
 *     OWN Webcake JWT via HTTP headers — see `configFromHeaders` — so a hosted
 *     server is multi-user and never bakes a shared secret into env), then
 *  2. environment variables (stdio / single-user mode).
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
 */
import type { WebcakeConfig } from "./types.js";

/** Request-scoped overrides for the env config (used by the HTTP transport). */
export type ConfigOverrides = Partial<Pick<WebcakeConfig, "base" | "jwt" | "orgId" | "host" | "appBase">>;

export function readConfig(overrides: ConfigOverrides = {}): { config: WebcakeConfig | null; missing: string[] } {
  const base = overrides.base ?? process.env.WEBCAKE_API_BASE;
  const jwt = overrides.jwt ?? process.env.WEBCAKE_JWT;
  const missing: string[] = [];
  if (!base) missing.push("WEBCAKE_API_BASE");
  if (!jwt) missing.push("WEBCAKE_JWT");
  if (missing.length) return { config: null, missing };
  return {
    config: {
      base: base!.replace(/\/+$/, ""),
      jwt: jwt!,
      orgId: overrides.orgId ?? process.env.WEBCAKE_ORG_ID,
      host: overrides.host ?? process.env.WEBCAKE_HOST,
      appBase: (overrides.appBase ?? process.env.WEBCAKE_APP_BASE)?.replace(/\/+$/, ""),
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
