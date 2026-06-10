/**
 * Tiny in-memory store for page sources that FAILED create_page validation, so the
 * model can fix ONLY the broken elements (patch_page with a draft_id) instead of
 * re-emitting the whole source. The create-before-save gap: a failed create has no
 * page_id to patch against, so we hold the source here keyed by a random draft_id.
 *
 * Bounded + TTL'd; a lost draft (process restart, eviction, expiry) just means the
 * model falls back to re-sending the full source via create_page — never a failure.
 * Process-global, but draft_ids are random/unguessable AND persisting still uses the
 * CALLER's own creds, so a draft only ever yields a page in the caller's account.
 */
import { randomUUID } from "node:crypto";

export interface PageDraft {
  source: any; // the EXPANDED source that failed validation
  name?: string;
  organization_id?: string;
  created: number; // ms; refreshed on each patch so an actively-edited draft stays alive
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 50;
const store = new Map<string, PageDraft>();

function sweep(now: number): void {
  for (const [id, d] of store) if (now - d.created > TTL_MS) store.delete(id);
  while (store.size > MAX_ENTRIES) {
    let oldestId: string | undefined;
    let oldestTs = Infinity;
    for (const [id, d] of store) {
      if (d.created < oldestTs) {
        oldestTs = d.created;
        oldestId = id;
      }
    }
    if (oldestId) store.delete(oldestId);
    else break;
  }
}

/** Cache a failed source. Returns the draft_id to hand back to the model. */
export function putDraft(draft: Omit<PageDraft, "created">): string {
  const now = Date.now();
  sweep(now);
  const id = `draft_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  store.set(id, { ...draft, created: now });
  return id;
}

/** Replace a draft's source after applying patches (refreshes its TTL). */
export function updateDraft(id: string, source: any): void {
  const d = store.get(id);
  if (d) {
    d.source = source;
    d.created = Date.now();
  }
}

/** Fetch a live (non-expired) draft, or null if missing/expired. */
export function getDraft(id: string): PageDraft | null {
  sweep(Date.now());
  return store.get(id) ?? null;
}

export function deleteDraft(id: string): void {
  store.delete(id);
}
