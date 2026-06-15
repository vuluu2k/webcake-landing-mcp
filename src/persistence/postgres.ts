/**
 * Lazy, shared Postgres pool used to PERSIST the OAuth 2.1 Authorization Server
 * state (clients, pending auths, codes, access + refresh tokens) so tokens
 * survive a `serve` restart and are shared across instances behind a load
 * balancer — unlike the caches (Redis/disposable), OAuth state is durable.
 *
 * Returns null when no DATABASE_URL is configured OR `pg` isn't installed — the
 * OAuth store then falls back to in-memory maps, so single-instance `serve`,
 * stdio/`npx`, and the offline smoke gate keep working with ZERO infra.
 *
 * `pg` is an OPTIONAL, CJS dependency (see package.json), required via
 * createRequire under ESM/Node16. The pool connects lazily per query.
 *
 * Configure with DATABASE_URL (or WEBCAKE_POSTGRES_URL / WEBCAKE_DATABASE_URL),
 * e.g. postgres://user:pw@host:5432/webcake_mcp
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** The minimal slice of node-postgres `Pool` the OAuth store uses. */
export type PgPool = {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
  on(ev: string, cb: (...a: any[]) => void): unknown;
  end(): Promise<void>;
};

let cached: PgPool | null | undefined; // undefined = not yet resolved

function redactUrl(u: string): string {
  try {
    const x = new URL(u);
    if (x.password) x.password = "***";
    return x.toString();
  } catch {
    return "postgres";
  }
}

/**
 * Returns the shared Postgres pool, or null if Postgres isn't configured/available.
 * Memoized: resolves the pool (or its absence) exactly once per process.
 */
export function getPg(): PgPool | null {
  if (cached !== undefined) return cached;
  const url =
    process.env.DATABASE_URL || process.env.WEBCAKE_POSTGRES_URL || process.env.WEBCAKE_DATABASE_URL;
  if (!url) return (cached = null);
  try {
    const { Pool } = require("pg");
    const pool: PgPool = new Pool({
      connectionString: url,
      max: Number(process.env.WEBCAKE_PG_POOL_MAX) || 5,
      // Managed Postgres (Supabase, Neon, …) often requires TLS; allow opting in
      // without verifying the chain via WEBCAKE_PG_SSL=1.
      ssl: /^(1|true|yes|on)$/i.test(process.env.WEBCAKE_PG_SSL ?? "")
        ? { rejectUnauthorized: false }
        : undefined,
    });
    pool.on("error", (e: any) => console.error("[pg] pool error:", e?.message ?? e));
    console.error(`[pg] OAuth store backend: ${redactUrl(url)}`);
    cached = pool;
  } catch (e: any) {
    console.error("[pg] unavailable, using in-memory OAuth store:", e?.message ?? e);
    cached = null;
  }
  return cached;
}

/**
 * Create the OAuth tables if absent. Idempotent and memoized to a single
 * in-flight promise per process, so concurrent callers share one round-trip. On
 * any failure it logs and resolves false; the caller degrades to in-memory.
 */
let schemaReady: Promise<boolean> | undefined;
export function ensureOAuthSchema(pool: PgPool): Promise<boolean> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS oauth_clients (
          client_id     text PRIMARY KEY,
          client_name   text,
          redirect_uris jsonb NOT NULL,
          created_at    bigint NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_pending (
          state         text PRIMARY KEY,
          client_id     text NOT NULL,
          redirect_uri  text NOT NULL,
          code_challenge text NOT NULL,
          client_state  text,
          scope         text,
          expires_at    bigint NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_codes (
          code          text PRIMARY KEY,
          client_id     text NOT NULL,
          redirect_uri  text NOT NULL,
          code_challenge text NOT NULL,
          scope         text,
          ljwt          text NOT NULL,
          expires_at    bigint NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_access_tokens (
          token       text PRIMARY KEY,
          ljwt        text NOT NULL,
          scope       text,
          expires_at  bigint NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
          token       text PRIMARY KEY,
          ljwt        text NOT NULL,
          client_id   text NOT NULL,
          scope       text,
          expires_at  bigint NOT NULL
        );
      `);
      return true;
    } catch (e: any) {
      console.error("[pg] OAuth schema init failed, using in-memory:", e?.message ?? e);
      return false;
    }
  })();
  return schemaReady;
}
