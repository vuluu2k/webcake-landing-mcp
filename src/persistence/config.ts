/**
 * Read the persistence config from the environment. The JWT comes ONLY from
 * WEBCAKE_JWT (the repo is public — never hard-code a token). `readConfig`
 * returns { config: null, missing } when required vars are absent so the
 * persistence tools can report exactly what to set.
 *
 *   WEBCAKE_API_BASE  e.g. http://localhost:5800   (required to call the backend)
 *   WEBCAKE_JWT       the account JWT               (required to call the backend)
 *   WEBCAKE_ORG_ID    optional default organization id for create_page
 *   WEBCAKE_HOST      optional Host header override (Phoenix routes by host)
 *   WEBCAKE_APP_BASE  optional base for editor/preview URLs in the result
 */
import type { WebcakeConfig } from "./types.js";

export function readConfig(): { config: WebcakeConfig | null; missing: string[] } {
  const base = process.env.WEBCAKE_API_BASE;
  const jwt = process.env.WEBCAKE_JWT;
  const missing: string[] = [];
  if (!base) missing.push("WEBCAKE_API_BASE");
  if (!jwt) missing.push("WEBCAKE_JWT");
  if (missing.length) return { config: null, missing };
  return {
    config: {
      base: base!.replace(/\/+$/, ""),
      jwt: jwt!,
      orgId: process.env.WEBCAKE_ORG_ID,
      host: process.env.WEBCAKE_HOST,
      appBase: process.env.WEBCAKE_APP_BASE?.replace(/\/+$/, ""),
    },
    missing: [],
  };
}
