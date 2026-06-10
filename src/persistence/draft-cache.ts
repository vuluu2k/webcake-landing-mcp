/**
 * Tiny in-memory store for sources that need a cache — three kinds:
 *
 *  - 'page'    (default/absent): a full page source whose create_page FAILED validation
 *              OR whose create_page network call failed/timed-out after validation passed.
 *              The create-before-save gap: a failed create has no page_id to patch
 *              against, so we hold the source here keyed by a random draft_id.
 *              Commit path: create_page({draft_id, dry_run:false}) or
 *              patch_page({draft_id, patches?, dry_run:false}).
 *
 *  - 'sections': the expanded throwaway shell built by add_section when dry_run=true
 *              or when section validation fails / the append network call fails, so the
 *              model never has to re-send the section payload between dry-run → real call
 *              or after a fix/timeout round.
 *              `source` holds the shell { page:[<new sections>], … }; `page_id` is
 *              the live page the sections will be appended to.
 *              Commit path: add_section({page_id, draft_id, dry_run:false}) or
 *              patch_page({draft_id, patches?, dry_run:false}).
 *
 *  - 'update' : a full page source for updatePageSource on an EXISTING page whose
 *              update_page/patch_page network call failed or timed-out after validation
 *              passed. `page_id` is the live page to overwrite.
 *              Commit path: update_page({draft_id, dry_run:false}) or
 *              patch_page({draft_id, patches?, dry_run:false}).
 *
 * Bounded + TTL'd; a lost draft (process restart, eviction, expiry) just means the
 * model falls back to re-sending the full source — never a failure.
 * Process-global, but draft_ids are random/unguessable AND persisting still uses the
 * CALLER's own creds, so a draft only ever yields a page in the caller's account.
 */
import { randomUUID } from "node:crypto";

export interface PageDraft {
  source: any; // the EXPANDED source (full page for 'page'/'update'; shell for 'sections')
  name?: string;
  organization_id?: string;
  /** 'page' = failed/timed-out create_page; 'sections' = cached add_section payload;
   *  'update' = failed/timed-out update on an existing page. Default: 'page'. */
  kind?: "page" | "sections" | "update";
  /** For kind='sections': the live page id the sections will be appended to.
   *  For kind='update': the live page id to overwrite. */
  page_id?: string;
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
