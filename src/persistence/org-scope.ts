/**
 * Organization scope for the page tools (list/find/get/update/add_section/patch/publish).
 *
 * The backend scopes pages by the `x-org-id` header, so a page that lives in an
 * organization is "Page not found" when asked for without it. Every page tool
 * therefore settles the org up front, with the same policy as create_page /
 * upload_images:
 *   1. explicit `organization_id` ('personal' = send no x-org-id)
 *   2. the org remembered for this page (from get_page / a previous call)
 *   3. WEBCAKE_ORG_ID / x-webcake-org-id (config.orgId)
 *   4. exactly ONE organization → auto-selected
 *   5. 2+ organizations and none chosen → ok:false reason:"organization_required"
 * No HTTP function needs a new parameter: the resolved org is stamped onto the
 * per-call config (`authHeaders` reads config.orgId).
 */
import { createHash } from "node:crypto";
import { listOrganizations } from "./webcake-client.js";
import type { WebcakeConfig } from "./types.js";

type OrgRow = { id: number | string; name?: string; is_default: boolean };

const ORG_MEMO_TTL_MS = 5 * 60 * 1000;
const orgMemo = new Map<string, { at: number; orgs: OrgRow[] | null }>();
const pageOrg = new Map<string, string | null>(); // null = personal
const MAX_PAGE_ORG = 500;

const jwtKey = (config: WebcakeConfig) => createHash("sha256").update(`${config.jwt}`).digest("hex").slice(0, 16);
const pageKey = (config: WebcakeConfig, pageId: string) => `${config.base}|${jwtKey(config)}|${pageId}`;

/** list_organizations memoized per (api base, jwt). null = the lookup failed (not memoized for long). */
async function orgsOf(config: WebcakeConfig): Promise<OrgRow[] | null> {
  const key = `${config.base}|${jwtKey(config)}`;
  const hit = orgMemo.get(key);
  if (hit && Date.now() - hit.at < ORG_MEMO_TTL_MS) return hit.orgs;
  const res = await listOrganizations(config).catch(() => null);
  const orgs = res?.ok && res.organizations ? res.organizations.map((o) => ({ id: o.id, name: o.name, is_default: o.is_default })) : null;
  if (orgs) orgMemo.set(key, { at: Date.now(), orgs });
  return orgs;
}

/** Remember which org a page lives in (from get_page's organization_id) so later calls need no question. */
export function rememberPageOrg(config: WebcakeConfig, pageId: string, organizationId: unknown): void {
  const org = organizationId == null || `${organizationId}` === "" ? null : `${organizationId}`;
  if (pageOrg.size >= MAX_PAGE_ORG) pageOrg.delete(pageOrg.keys().next().value as string);
  pageOrg.set(pageKey(config, pageId), org);
}

export type OrgScope =
  | { ok: true; config: WebcakeConfig; org_id?: string; via: string; auto_selected?: boolean }
  | { ok: false; response: Record<string, unknown> };

/**
 * Resolve the org for a page-tool call. `pageId` lets a page already seen reuse its org.
 * A failed org lookup never blocks: the call proceeds with the config as it is.
 */
export async function resolveOrgScope(
  config: WebcakeConfig,
  organization_id: string | number | undefined,
  opts: { pageId?: string; retryTool?: string } = {}
): Promise<OrgScope> {
  const withOrg = (org: string | undefined): WebcakeConfig => ({ ...config, orgId: org });
  if (organization_id != null && `${organization_id}` !== "") {
    if (`${organization_id}`.toLowerCase() === "personal") return { ok: true, config: withOrg(undefined), via: "explicit_personal" };
    return { ok: true, config: withOrg(`${organization_id}`), org_id: `${organization_id}`, via: "explicit" };
  }
  if (opts.pageId) {
    const k = pageKey(config, opts.pageId);
    if (pageOrg.has(k)) {
      const org = pageOrg.get(k) ?? undefined;
      return { ok: true, config: withOrg(org), ...(org ? { org_id: org } : {}), via: "page_cache" };
    }
  }
  if (config.orgId != null && `${config.orgId}` !== "") return { ok: true, config, org_id: `${config.orgId}`, via: "env" };

  const orgs = await orgsOf(config);
  if (!orgs || orgs.length === 0) return { ok: true, config, via: "none" };
  if (orgs.length === 1) return { ok: true, config: withOrg(`${orgs[0].id}`), org_id: `${orgs[0].id}`, via: "auto", auto_selected: true };
  return {
    ok: false,
    response: {
      ok: false,
      reason: "organization_required",
      organizations: orgs.map((o) => ({ id: o.id, name: o.name, is_default: o.is_default })),
      error: "This account has multiple organizations and pages are scoped per organization. Re-call with organization_id set to one of the listed ids (or 'personal' for pages outside any organization).",
      hint: `Ask the user which organization the page belongs to (list_organizations), then re-call${opts.retryTool ? ` ${opts.retryTool}` : ""} with organization_id.`,
    },
  };
}

/** Does this account have 2+ organizations? (memoized) — for the "Page not found" hint. */
export async function hasMultipleOrgs(config: WebcakeConfig): Promise<boolean> {
  const orgs = await orgsOf(config);
  return !!orgs && orgs.length > 1;
}

/** Extra hint for a not-found read when the org may simply be wrong. */
export async function notFoundOrgHint(config: WebcakeConfig, status?: number, error?: string): Promise<{ organization_hint?: string }> {
  const nf = status === 404 || /not found/i.test(error ?? "");
  if (!nf || !(await hasMultipleOrgs(config))) return {};
  return {
    organization_hint:
      "Page not found — this account has several organizations and pages are scoped per organization. Re-check organization_id (list_organizations; a page in an org is invisible without it, and 'personal' only sees pages outside any org).",
  };
}
