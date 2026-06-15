/**
 * The {original URL → Webcake-hosted URL} dedup cache for image re-hosting, so a
 * URL reused across elements/saves uploads to the CDN only once.
 *
 * BACKEND: Redis when REDIS_URL is set (dedup shared across `serve` instances and
 * surviving restarts), else an in-memory Map (stdio/`npx`/offline smoke). Purely
 * an optimization — a miss just re-uploads, never a failure — so any Redis error
 * silently degrades to memory.
 *
 * Lives apart from rehost.ts on purpose: that module is PURE (URL collect/rewrite,
 * no IO) and must not import a network client. This one holds the only stateful
 * piece. It imports redis.ts but NOT webcake-client.ts, so no import cycle.
 */
import { getRedis } from "./redis.js";

const REDIS_PREFIX = "wcl:rehost:";
// Hosted URLs are effectively permanent on the CDN; cap Redis growth with a long TTL.
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const memory = new Map<string, string>();

/** Look up the hosted URL previously stored for `url`, or null on a miss. */
export async function rehostGet(url: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return await redis.get(REDIS_PREFIX + url);
    } catch (e: any) {
      console.error("[rehost-cache] redis get failed, using memory:", e?.message ?? e);
    }
  }
  return memory.get(url) ?? null;
}

/** Remember that `url` is now hosted at `hosted`. */
export async function rehostSet(url: string, hosted: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(REDIS_PREFIX + url, hosted, "PX", TTL_MS);
      return;
    } catch (e: any) {
      console.error("[rehost-cache] redis set failed, using memory:", e?.message ?? e);
    }
  }
  memory.set(url, hosted);
}
