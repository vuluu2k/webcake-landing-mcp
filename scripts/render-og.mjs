/**
 * Pre-render the social-card OG image to a raster PNG, committed at src/og.png.
 *
 * WHY a committed PNG: og:image as an SVG does NOT unfurl on Facebook, X/Twitter,
 * LinkedIn or Zalo (they only render raster). So we ship a 1200x630 PNG as the
 * og:image / twitter:image (see web-guide.ts `ogImage`). copy-assets.mjs mirrors
 * src/og.png -> dist/og.png and http.ts serves it at GET /og.png.
 *
 * This is NOT part of `npm run build` (keeps the build + CI dependency-free and
 * deterministic — no font-rendering on CI). Run it by hand only when the card
 * design in `ogImageSvg()` changes:
 *
 *     npm i -D @resvg/resvg-js   # one-off; not kept in package.json
 *     npm run build              # so dist/web-guide.js is current
 *     node scripts/render-og.mjs
 *     npm install                # prune the ad-hoc dep back out
 *
 * Then commit the regenerated src/og.png.
 */
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { ogImageSvg } from "../dist/web-guide.js";

const svg = ogImageSvg();
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  // The card uses CSS generic `system-ui`; resvg can't resolve that, so give it a
  // concrete fallback and let it pull whatever sans-serif the OS has.
  font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
});
const png = resvg.render().asPng();
const out = new URL("../src/og.png", import.meta.url);
writeFileSync(out, png);
console.error(`[render-og] wrote ${out.pathname} (${png.length} bytes)`);
