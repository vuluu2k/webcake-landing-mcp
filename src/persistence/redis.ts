/**
 * Lazy, shared ioredis client used for the CACHES (draft sources + image rehost
 * dedup map). Returns null when no REDIS_URL is configured OR ioredis isn't
 * installed — every caller then falls back to an in-memory Map, so stdio/`npx`
 * users and the offline `npm run smoke` gate keep working with ZERO infra.
 *
 * Caches are intentionally disposable: losing the Redis (restart, eviction,
 * expiry) only makes the model re-send a source or re-upload an image — never a
 * failure. So we never block startup on the connection and tolerate command
 * errors by degrading to memory on a per-call basis at the call sites.
 *
 * ioredis is an OPTIONAL, CJS dependency (see package.json), so we require it via
 * createRequire under ESM/Node16. `new Redis(url)` returns immediately and
 * connects in the background; commands queue until the socket is up.
 *
 * Configure with REDIS_URL (or WEBCAKE_REDIS_URL), e.g. redis://default:pw@host:6379/0
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** The minimal slice of the ioredis surface the caches use. */
export type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, val: string, mode?: string, ttl?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  pexpire(key: string, ms: number): Promise<unknown>;
  on(ev: string, cb: (...a: any[]) => void): unknown;
};

let cached: RedisLike | null | undefined; // undefined = not yet resolved

function redactUrl(u: string): string {
  try {
    const x = new URL(u);
    if (x.password) x.password = "***";
    return x.toString();
  } catch {
    return "redis";
  }
}

/**
 * Returns the shared Redis client, or null if Redis isn't configured/available.
 * Memoized: resolves the connection (or its absence) exactly once per process.
 */
export function getRedis(): RedisLike | null {
  if (cached !== undefined) return cached;
  const url = process.env.REDIS_URL || process.env.WEBCAKE_REDIS_URL;
  if (!url) return (cached = null);
  try {
    const mod = require("ioredis");
    const Redis = mod.default ?? mod;
    const client: RedisLike = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      // Never let a connection blip crash the process — log and keep retrying.
      retryStrategy: (times: number) => Math.min(times * 200, 3000),
    });
    client.on("error", (e: any) => console.error("[redis] error:", e?.message ?? e));
    console.error(`[redis] cache backend: ${redactUrl(url)}`);
    cached = client;
  } catch (e: any) {
    console.error("[redis] unavailable, using in-memory cache:", e?.message ?? e);
    cached = null;
  }
  return cached;
}

/** True when a Redis cache backend is configured (used for log/diagnostics). */
export function redisEnabled(): boolean {
  return getRedis() !== null;
}
