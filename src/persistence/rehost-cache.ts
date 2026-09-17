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
import { createHash } from "node:crypto";
import { getRedis } from "./redis.js";

const REDIS_PREFIX = "wcl:rehost:";
// Hosted URLs are effectively permanent on the CDN; cap Redis growth with a long TTL.
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const memory = new Map<string, string>();

/**
 * A source "url" can be an INLINE BASE64 image — megabytes of payload, which is
 * unusable as a Redis key (and wasteful in the memory Map). Anything longer than
 * a normal URL is content-addressed instead; short URLs keep their readable key.
 */
const MAX_LITERAL_KEY = 256;
const keyPart = (url: string) =>
  url.length <= MAX_LITERAL_KEY ? url : `sha256:${createHash("sha256").update(url).digest("hex")}`;

/**
 * Entries are namespaced by SCOPE — `org:<id>` when the upload files an Asset
 * into that org's media collection, else `public`. The hosted URL is
 * content-addressed and would be byte-identical across orgs, but the Asset row
 * is per-org: sharing one key would let a second org hit the cache and skip the
 * upload, leaving the image absent from ITS collection.
 */
export const key = (url: string, scope: string) => `${REDIS_PREFIX}${scope}:${keyPart(url)}`;

/** Look up the hosted URL previously stored for `url` in `scope`, or null on a miss. */
export async function rehostGet(url: string, scope = "public"): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return await redis.get(key(url, scope));
    } catch (e: any) {
      console.error("[rehost-cache] redis get failed, using memory:", e?.message ?? e);
    }
  }
  return memory.get(key(url, scope)) ?? null;
}

/** Remember that `url` is now hosted at `hosted` within `scope`. */
export async function rehostSet(url: string, hosted: string, scope = "public"): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key(url, scope), hosted, "PX", TTL_MS);
      return;
    } catch (e: any) {
      console.error("[rehost-cache] redis set failed, using memory:", e?.message ?? e);
    }
  }
  memory.set(key(url, scope), hosted);
}
