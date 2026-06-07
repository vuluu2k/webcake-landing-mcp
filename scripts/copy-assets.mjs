/**
 * Copy runtime JSON assets from src/ into dist/, mirroring the directory tree.
 *
 * The build is `tsc` (which only emits .js) PLUS this step: any *.json or *.png
 * under src/ (e.g. domains/landing/page-schema.json loaded via readFileSync, or
 * og.png served at GET /og.png) is copied to the matching dist/ path. Globbing
 * the tree means new domains' schemas/assets are picked up automatically — no
 * per-file copy line to maintain.
 */
import { readdirSync, statSync, mkdirSync, copyFileSync, chmodSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const SRC = "src";
const DIST = "dist";

let count = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (name.endsWith(".json") || name.endsWith(".png")) {
      const dest = join(DIST, p.slice(SRC.length + 1));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(p, dest);
      count++;
      console.error(`[copy-assets] ${p} -> ${dest}`);
    }
  }
}

walk(SRC);
console.error(`[copy-assets] copied ${count} asset(s).`);

// The CLI entry is a `bin` — it must be executable. `tsc` emits 0644, and npx /
// `npm link` exec the file directly (no npm bin-link chmod), so a non-executable
// dist/index.js fails with "Permission denied". Mark it +x here (preserved in the
// published tarball too).
const bin = join(DIST, "index.js");
if (existsSync(bin)) {
  chmodSync(bin, 0o755);
  console.error(`[copy-assets] chmod +x ${bin}`);
}
