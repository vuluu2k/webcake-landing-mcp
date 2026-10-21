/**
 * Match a publish domain against the domains the account actually added (PURE — no network,
 * smoke-tested). The editor's publish modal only lets the user PICK from that list, so its
 * publishes always carry the stored form; publish_page used to take `custom_domain` verbatim,
 * so an AI that wrote `xsummit.vn` published a page the customer had added as `www.xsummit.vn`
 * — the page lived on a domain record that doesn't exist, and Dynamic campaigns on it failed.
 *
 * www and non-www are DIFFERENT domain records, so neither form is "the right one" in general:
 * the stored form wins. Exact match → keep; the www-toggled form is stored → use that;
 * neither → not in the account (the caller refuses rather than publishing to a phantom domain).
 */

/** Lowercase host only: strips scheme, path/query, port, trailing dot and whitespace. */
export function normalizeDomain(d: string): string {
  return String(d ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

export type DomainMatch =
  | { ok: true; domain: string; adjusted: boolean }
  | { ok: false; candidates: string[] };

export function matchAccountDomain(requested: string, accountDomains: string[]): DomainMatch {
  const want = normalizeDomain(requested);
  const stored = new Map<string, string>();
  for (const d of accountDomains) {
    const n = normalizeDomain(d);
    if (n && !stored.has(n)) stored.set(n, n);
  }
  if (want && stored.has(want)) return { ok: true, domain: want, adjusted: requested.trim() !== want };
  const toggled = want.startsWith("www.") ? want.slice(4) : `www.${want}`;
  if (want && stored.has(toggled)) return { ok: true, domain: toggled, adjusted: true };
  return { ok: false, candidates: [...stored.keys()].slice(0, 20) };
}
