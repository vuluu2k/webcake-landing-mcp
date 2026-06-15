/**
 * Icon resolver: turn an icon-font NAME (Material Symbols / Font Awesome, the form
 * ingest surfaces as block.icon "ms:<name>" / "fa:<name>") into a real inline SVG,
 * via the public Iconify API (https://iconify.design — unifies both icon sets).
 *
 * This is what lets a clone reproduce a Stitch icon FAITHFULLY and SELF-CONTAINED:
 * the SVG is embedded straight into a text-block (fill="currentColor", colored by
 * the element's styles.color) — no webfont to load, no svg-mask background trap.
 *
 * Pure network helper (no Webcake creds). Mirrors the search_images pattern.
 */

const ICONIFY_BASE = "https://api.iconify.design";
const ICON_FETCH_TIMEOUT_MS = 8_000;

/** Normalize a Material/FA icon name to the Iconify token form (underscores → hyphens, lowercased, trimmed). */
function normName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/**
 * Ordered Iconify "prefix/name" candidates for an icon reference. Tries the most
 * faithful variant first, then sensible fallbacks:
 *  - ms:NAME           → material-symbols/NAME-outline (the "-outlined" class look), then the filled base
 *  - fa:NAME / fas:    → fa6-solid, fa-solid
 *  - far: / fab:       → regular / brands variants
 *  - prefix:NAME       → used as-is (already an Iconify id)
 *  - NAME (bare)       → assumed Material Symbols
 */
export function iconifyCandidates(ref: string): string[] {
  const raw = ref.trim();
  // Already an Iconify id "prefix:name" (but NOT our ms:/fa: shorthands).
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*):(.+)$/i.exec(raw);
  const kind = m ? m[1].toLowerCase() : "";
  const rest = m ? normName(m[2]) : normName(raw);
  if (!rest) return [];

  if (kind === "ms" || kind === "material-symbols" || kind === "msr") {
    return [`material-symbols/${rest}-outline`, `material-symbols/${rest}`];
  }
  if (kind === "fa" || kind === "fas" || kind === "fa-solid" || kind === "fa6-solid") {
    return [`fa6-solid/${rest}`, `fa-solid/${rest}`, `fa6-regular/${rest}`, `fa6-brands/${rest}`];
  }
  if (kind === "far" || kind === "fa-regular") return [`fa6-regular/${rest}`, `fa-regular/${rest}`];
  if (kind === "fab" || kind === "fa-brands") return [`fa6-brands/${rest}`, `fa-brands/${rest}`];
  // A real Iconify prefix (e.g. mdi:home, lucide:check) → use verbatim, then bare-as-material.
  if (kind) return [`${kind}/${rest}`];
  // Bare name → assume Material Symbols (the Stitch default).
  return [`material-symbols/${rest}-outline`, `material-symbols/${rest}`];
}

export type IconResult = { ok: true; svg: string; iconify: string } | { ok: false; error: string };

/** Fetch one Iconify "prefix/name" → SVG string, or null when it 404s / isn't an SVG. */
async function fetchOne(prefixName: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${ICONIFY_BASE}/${prefixName}.svg`, { signal: AbortSignal.timeout(ICON_FETCH_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.text()).trim();
  // Unknown icons return a non-SVG body ("404"/"Not found"); only accept real SVG markup.
  return body.startsWith("<svg") ? body : null;
}

/**
 * Resolve an icon reference ("ms:verified" / "fa:chart-line" / "mdi:home" / a bare
 * name) to an inline SVG. The SVG keeps fill="currentColor" so the embedding
 * element's styles.color decides the icon color.
 */
export async function resolveIconSvg(ref: string): Promise<IconResult> {
  const candidates = iconifyCandidates(ref);
  if (!candidates.length) return { ok: false, error: `Empty/invalid icon ref: "${ref}"` };
  for (const c of candidates) {
    const svg = await fetchOne(c);
    if (svg) return { ok: true, svg, iconify: c };
  }
  return { ok: false, error: `No icon found for "${ref}" (tried: ${candidates.join(", ")})` };
}
