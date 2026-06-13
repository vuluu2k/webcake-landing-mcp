/**
 * Image re-host: find external image URLs anywhere in a page source and rewrite
 * them to Webcake-hosted URLs. This module is PURE (no network) — it only
 * collects URLs and applies a {original → hosted} map. The network upload pass
 * that produces the map lives in webcake-client (`rehostSourceImages`), which
 * runs on every real create/update/append save so a clone never stores a
 * hotlinked/expiring source URL and the model never has to pre-call
 * upload_images for reference images.
 *
 * What counts as a re-hostable image URL:
 *  - an http(s) URL whose path ends in a known image extension (covers
 *    specials.src, gallery item.link, video poster img — plain-string fields), OR
 *  - any http(s) URL inside a CSS `url(...)` token (covers the styles.background
 *    shorthand `… url(<x>) …` — a background image regardless of extension).
 * Already-hosted (statics.pancake.vn), data:, and deliberate-placeholder hosts
 * (placehold.co / placeholder.com / dummyimage) are left alone.
 */

/** Hosts we never re-host: our own CDN + deliberate placeholders. */
const SKIP_HOSTS = [
  "statics.pancake.vn",
  "placehold.co",
  "placeholder.com",
  "via.placeholder.com",
  "dummyimage.com",
];

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|svg|bmp|avif|ico|tiff?)(?:[?#]|$)/i;
/** All `url( … )` tokens in a CSS value (handles optional quotes; stops at `)`). */
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/**
 * Image CDNs that serve images WITHOUT a file extension in the path, so the
 * extension test alone would miss them. Google usercontent backs Google Stitch's
 * generated images (`lh3.googleusercontent.com/aida…` and `…/aida-public…`) — a
 * Stitch clone carries those bare URLs into specials.src, and without this they'd
 * be hotlinked into the saved page (and the ephemeral `aida/` ones soon 404)
 * instead of being re-hosted to the Webcake CDN like every other clone image.
 */
const EXTENSIONLESS_IMAGE_HOSTS = ["googleusercontent.com", "ggpht.com"];

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** A CDN that serves images without an extension (Google usercontent / Stitch). */
function isExtensionlessImageHost(host: string): boolean {
  return EXTENSIONLESS_IMAGE_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

/** http(s), not already-hosted/placeholder/data, and image-looking — by extension OR a known extensionless image host. */
export function isRehostableImageUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false; // skips data:, relative, blob:
  const host = hostOf(u);
  if (!host || host === "localhost" || host.startsWith("127.")) return false;
  if (SKIP_HOSTS.some((h) => host === h || host.endsWith("." + h))) return false;
  let pathname = "";
  try {
    pathname = new URL(u).pathname;
  } catch {
    return false;
  }
  return IMAGE_EXT_RE.test(pathname) || isExtensionlessImageHost(host);
}

/** Re-hostable if http(s) and not on a skip host — used for `url(...)` inners (a background image even without an extension). */
function isRehostableBgUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return false;
  const host = hostOf(u);
  if (!host || host === "localhost" || host.startsWith("127.")) return false;
  if (SKIP_HOSTS.some((h) => host === h || host.endsWith("." + h))) return false;
  return true;
}

/** Extract every re-hostable image URL contained in a single string value. */
function urlsInString(s: string, out: Set<string>): void {
  // 1) The whole value is itself an image URL (specials.src, gallery link, poster).
  if (isRehostableImageUrl(s)) out.add(s.trim());
  // 2) `url(...)` tokens inside a CSS value (background shorthand) — any image.
  CSS_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_URL_RE.exec(s)) !== null) {
    const inner = m[2]?.trim();
    if (inner && isRehostableBgUrl(inner)) out.add(inner);
  }
}

/** Walk every string in an arbitrary value, applying `visit` to each. */
function walkStrings(value: unknown, visit: (s: string) => void): void {
  if (typeof value === "string") {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const v of value) walkStrings(v, visit);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) walkStrings(v, visit);
  }
}

/** Distinct external image URLs anywhere in the page source (specials.src, backgrounds, gallery, posters). */
export function collectExternalImageUrls(source: unknown): string[] {
  const set = new Set<string>();
  walkStrings(source, (s) => urlsInString(s, set));
  return [...set];
}

/**
 * Deep-clone `source`, replacing every occurrence of each mapped URL — both when
 * a string value IS the URL and when it appears inside a `url(...)` token — with
 * its hosted replacement. Unmapped URLs are left untouched.
 */
export function rewriteImageUrls<T>(source: T, map: Map<string, string>): T {
  if (map.size === 0) return source;
  const rewriteOne = (s: string): string => {
    const direct = map.get(s.trim());
    if (direct && s.trim() === s) return direct;
    // Replace inside url(...) and any embedded exact occurrences.
    let out = s;
    for (const [from, to] of map) {
      if (out.includes(from)) out = out.split(from).join(to);
    }
    return out;
  };
  const recur = (v: unknown): unknown => {
    if (typeof v === "string") return rewriteOne(v);
    if (Array.isArray(v)) return v.map(recur);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = recur(val);
      return o;
    }
    return v;
  };
  return recur(source) as T;
}

/** Process-wide {original → hosted} cache so a URL reused across elements/saves uploads once. */
export const rehostCache = new Map<string, string>();

/** Hard cap on uploads per save — a runaway-safety backstop, far above a real page's image count. */
export const MAX_REHOST_PER_SAVE = 120;
