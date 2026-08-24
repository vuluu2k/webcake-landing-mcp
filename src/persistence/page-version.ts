/**
 * Optimistic-concurrency guard for whole-source overwrites.
 *
 * THE PROBLEM. `update_page` (and a committed `kind:'update'` draft) REPLACES a
 * page's stored source with a tree the model read earlier — from `get_page`, or
 * from a draft the MCP cached minutes/hours ago. If the user opens the Webcake
 * editor in between and moves an element, retypes a headline or adds a section,
 * that overwrite silently reverts their work: the snapshot wins and the UI edit
 * is gone. The backend cannot help — `/api/v1/ai/update_page_source` is a blind
 * `update_source(record, %{source: …})` with no version column and no ETag
 * (LandingPageWeb.V1.AiController.update_page_source), so last-write-wins is the
 * only semantics it offers.
 *
 * THE FIX. Fingerprint the STORED source and remember it per page:
 *   - every READ we do (`get_page`, the live read inside `patch_page`) records a
 *     TRUSTED baseline — the exact bytes the backend just handed us;
 *   - every WRITE records an UNTRUSTED baseline — our prediction of what the page
 *     now holds. It should match a later read, but the backend re-encodes the JSON
 *     on the way in and out, so a mismatch here must never be read as "someone
 *     else edited the page";
 *   - a server-side append (`add_section`) FORGETS it — the backend rewrote the
 *     tree behind our back, so nothing we hold is a baseline any more.
 * Before a blind overwrite we re-read the page and compare (see decideOverwrite).
 *
 * The fingerprint is content-based (canonical key-sorted JSON → sha256), so it
 * survives the backend's decode→re-encode round-trip and needs no schema change.
 *
 * The store is per-process and bounded. Losing it (restart, a second `serve`
 * instance) is safe: with no baseline the caller falls back to the element-id
 * loss check, which still catches the destructive case.
 */
import { createHash } from "node:crypto";

/** Canonical JSON: object keys sorted recursively so two equal trees hash equal. */
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
    return out;
  }
  return v;
}

/** Short content fingerprint of a page source (object or JSON string). */
export function sourceFingerprint(source: unknown): string {
  let v: any = source;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      /* not JSON — hash the raw string */
    }
  }
  return createHash("sha256").update(JSON.stringify(canonical(v) ?? null)).digest("hex").slice(0, 16);
}

/** Every element id in a source tree (page + popup + dynamic_pages, recursively). */
export function collectElementIds(source: any): Set<string> {
  const ids = new Set<string>();
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (typeof node.id === "string" && typeof node.type === "string") ids.add(node.id);
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  };
  let v: any = source;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return ids;
    }
  }
  for (const arr of ["page", "popup", "dynamic_pages"]) {
    if (Array.isArray(v?.[arr])) for (const n of v[arr]) walk(n);
  }
  return ids;
}

// ---- baseline store -------------------------------------------------------

/**
 * `read`  — the fingerprint of bytes the backend handed us. A live page that no
 *           longer matches it was provably changed by someone else.
 * `write` — our prediction after a save. A mismatch is inconclusive (the backend
 *           re-encodes JSON), so it only downgrades to the element-id check.
 */
export type BaselineOrigin = "read" | "write";
export type Baseline = { fp: string; origin: BaselineOrigin };

const MAX_PAGES = 100;
const versions = new Map<string, Baseline & { at: number }>();

/** Record what the page holds now, and whether we KNOW it (read) or predict it (write). */
export function rememberPageVersion(pageId: string | undefined, fp: string, origin: BaselineOrigin): void {
  if (!pageId) return;
  versions.delete(pageId); // re-insert so Map iteration order = LRU
  versions.set(pageId, { fp, origin, at: Date.now() });
  while (versions.size > MAX_PAGES) {
    const oldest = versions.keys().next().value;
    if (oldest === undefined) break;
    versions.delete(oldest);
  }
}

/** Drop the baseline — the stored tree changed in a way we cannot predict. */
export function forgetPageVersion(pageId: string | undefined): void {
  if (pageId) versions.delete(pageId);
}

/** The baseline we hold for this page, or undefined if we hold none. */
export function lastKnownPageVersion(pageId: string | undefined): Baseline | undefined {
  if (!pageId) return undefined;
  const v = versions.get(pageId);
  return v ? { fp: v.fp, origin: v.origin } : undefined;
}

/** Test hook — clears the baseline store. */
export function resetPageVersions(): void {
  versions.clear();
}

// ---- the decision ---------------------------------------------------------

export type OverwriteDecision =
  | { allow: true; liveVersion: string; unverified?: true }
  | {
      allow: false;
      reason: "page_changed_externally" | "unverified_overwrite";
      liveVersion: string;
      baseVersion?: string;
      dropped: string[];
    };

/**
 * Pure verdict for "may this whole-source overwrite proceed?" — the network read
 * lives in the caller so this stays testable.
 *
 *   trusted baseline matches live            → allow (any deletions are deliberate)
 *   trusted baseline differs                 → refuse: edited outside this session
 *   no/untrusted baseline, live ids dropped  → refuse: provable destruction
 *   no/untrusted baseline, nothing dropped   → allow, flagged unverified
 */
export function decideOverwrite(liveSource: unknown, incoming: unknown, baseline?: Baseline): OverwriteDecision {
  const liveVersion = sourceFingerprint(liveSource);
  if (baseline && baseline.fp === liveVersion) return { allow: true, liveVersion };

  const liveIds = collectElementIds(liveSource);
  const incomingIds = collectElementIds(incoming);
  const dropped = [...liveIds].filter((id) => !incomingIds.has(id));

  // A stale READ baseline is proof the page moved under us — refuse even when the
  // overwrite drops nothing, because it would still revert the edits it does touch.
  if (baseline?.origin === "read") {
    return { allow: false, reason: "page_changed_externally", liveVersion, baseVersion: baseline.fp, dropped };
  }
  // No baseline, or one we only PREDICTED after a write: a mismatch proves nothing,
  // so fall back to the check that is always sound — does this save destroy content?
  if (dropped.length === 0) return { allow: true, liveVersion, unverified: true };
  return { allow: false, reason: "unverified_overwrite", liveVersion, baseVersion: baseline?.fp, dropped };
}

// ---- version-keyed source cache -------------------------------------------
//
// The concurrency check must never be served from a cache — a cached answer
// cannot see an edit made after it was written, which is the whole bug. What IS
// cacheable is the SOURCE, validated by the backend's own version token: ask
// `GET /api/v1/ai/page_version` for `updated_at` (a few hundred bytes), and only
// re-download the tree when it moved. Unchanged page ⇒ no download at all; the
// freshness guarantee is identical because the token comes from the server.
//
// Entries are keyed by credentials as well as page id, so a hosted `serve`
// instance can never hand one caller a tree fetched with another caller's JWT.
// Bounded to a handful of pages — a source can be megabytes.

const MAX_CACHED_SOURCES = 6;
const sources = new Map<string, { version: string; result: any; at: number }>();

/** Cache key: the page plus a short digest of the credentials it was fetched with. */
export function sourceCacheKey(pageId: string, jwt: string | undefined): string {
  const who = createHash("sha256").update(jwt ?? "").digest("hex").slice(0, 12);
  return `${who}:${pageId}`;
}

/** Store a full getPageSource outcome under the backend version it was read at. */
export function cachePageSource(key: string, version: string | undefined, result: any): void {
  if (!version) return; // no server token ⇒ nothing to validate a hit against
  sources.delete(key);
  sources.set(key, { version, result, at: Date.now() });
  while (sources.size > MAX_CACHED_SOURCES) {
    const oldest = sources.keys().next().value;
    if (oldest === undefined) break;
    sources.delete(oldest);
  }
}

/** The version a cached entry was read at, or undefined when nothing is cached. */
export function cachedPageSourceVersion(key: string): string | undefined {
  return sources.get(key)?.version;
}

/** The cached outcome IF it was read at exactly this version, else undefined. */
export function cachedPageSource(key: string, version: string | undefined): any | undefined {
  if (!version) return undefined;
  const hit = sources.get(key);
  if (!hit || hit.version !== version) return undefined;
  sources.delete(key); // refresh LRU position
  sources.set(key, { ...hit, at: Date.now() });
  return hit.result;
}

/** Drop a page's cached source (e.g. after our own write changed it). */
export function dropCachedPageSource(key: string): void {
  sources.delete(key);
}

/** Test hook — clears the source cache. */
export function resetPageSourceCache(): void {
  sources.clear();
}
