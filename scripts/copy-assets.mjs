/**
 * Copy runtime JSON assets from src/ into dist/, mirroring the directory tree.
 *
 * The build is `tsc` (which only emits .js) PLUS this step: any *.json under
 * src/ (e.g. domains/landing/page-schema.json, loaded at runtime via readFileSync)
 * is copied to the matching dist/ path. Globbing the tree means new domains'
 * schemas are picked up automatically — no per-file copy line to maintain.
 */
import { readdirSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";

const SRC = "src";
const DIST = "dist";

let count = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (name.endsWith(".json")) {
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
