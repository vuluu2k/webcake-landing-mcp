#!/usr/bin/env node
/**
 * Build the MCPB desktop-extension bundle (webcake-landing-mcp.mcpb).
 *
 * Flow: sync manifest version ← package.json → build → prune devDeps →
 * `mcpb pack` → ALWAYS restore devDeps (even on failure).
 *
 * The bundle ships dist/ + production node_modules so Claude Desktop can run
 * `node dist/index.js` over stdio. devDeps (typescript/fontkit/@types) are
 * pruned for size, then reinstalled so the local dev tree is left intact.
 *
 * Usage: npm run pack:mcpb
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
const OUT = "webcake-landing-mcp.mcpb";

// 1. Keep manifest.json version in lockstep with package.json.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.error(`[pack:mcpb] synced manifest version -> ${pkg.version}`);
}

// 2. Build (tsc + copy JSON assets into dist/).
run("npm run build");

// 3. Validate the manifest before packing (fail fast on schema errors).
run(`npx -y @anthropic-ai/mcpb validate manifest.json`);

// 4. Prune to production deps, pack, then ALWAYS restore the dev tree.
let packErr;
try {
  run("npm prune --omit=dev");
  run(`npx -y @anthropic-ai/mcpb pack . ${OUT}`);
} catch (e) {
  packErr = e;
} finally {
  console.error("[pack:mcpb] restoring devDependencies...");
  run("npm install");
}
if (packErr) {
  console.error("[pack:mcpb] pack FAILED");
  process.exit(1);
}
console.error(`[pack:mcpb] done -> ${OUT}`);
