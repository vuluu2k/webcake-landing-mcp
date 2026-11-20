#!/usr/bin/env node
// Build a public-upload preparation ZIP. No network, credentials, or account mutation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "plugins/webcake-landing");
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `Symlinks are not allowed: ${path}`);
    if (stat.isDirectory()) walk(path);
    else {
      assert(stat.isFile(), `Unsupported file: ${path}`);
      files.push(relative(source, path));
    }
  }
}
function command(name, args, options = {}) {
  const result = spawnSync(name, args, { cwd: source, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${name} failed: ${result.stderr?.toString()}`);
  return result.stdout;
}
function httpsURL(value, label) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `${label} needs HTTPS`);
  assert(!url.username && !url.password && !url.search && !url.hash, `${label} contains unexpected URL data`);
  assert(value.length <= 1024, `${label} exceeds 1024 characters`);
}
function png(path, minSize) {
  const bytes = readFileSync(join(source, path));
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${path} is not PNG`);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert(width === height && width >= minSize && width <= 4096, `${path} has invalid dimensions`);
  assert(bytes.length <= 5 * 1024 * 1024, `${path} exceeds 5 MiB`);
}

walk(source);
assert.deepEqual(files.sort(), [
  "assets/icon-512.png", "assets/icon-64.png", "mcp.json", "plugin.json",
  "skills/webcake-landing/SKILL.md",
].sort(), "Unexpected package inventory; review and explicitly allow any new files");
const manifest = JSON.parse(readFileSync(join(source, "plugin.json"), "utf8"));
const mcp = JSON.parse(readFileSync(join(source, "mcp.json"), "utf8"));
assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
assert.equal(manifest.name, "webcake-landing");
assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
for (const key of ["apps", "hooks", "skills", "mcpServers", "interface"]) {
  assert(!(key in manifest), `Unexpected portable manifest field: ${key}`);
}
const openai = manifest.extensions["com.openai"];
assert(!("apps" in openai) && !("hooks" in openai));
const ui = openai.interface;
for (const [key, max] of [["displayName", 30], ["shortDescription", 30], ["longDescription", 4000], ["developerName", 80]]) {
  assert(typeof ui[key] === "string" && ui[key].trim() && ui[key].length <= max, `Invalid ${key}`);
}
assert.equal(ui.developerName, manifest.author.name);
assert.equal(ui.category, "Productivity");
for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) httpsURL(ui[key], key);
assert(Array.isArray(ui.defaultPrompt) && ui.defaultPrompt.length > 0 && ui.defaultPrompt.length <= 3);
assert.equal(new Set(ui.defaultPrompt.map(p => p.replace(/\s+/g, " ").trim())).size, ui.defaultPrompt.length);
for (const prompt of ui.defaultPrompt) assert(prompt.trim() && prompt.length <= 128 && !/[\r\n@]/.test(prompt));
assert.equal(ui.logo, "./assets/icon-512.png");
assert.equal(ui.composerIcon, "./assets/icon-64.png");
png(ui.logo, 256);
png(ui.composerIcon, 48);
assert.deepEqual(Object.keys(mcp.mcpServers), ["webcake-landing"]);
const server = mcp.mcpServers["webcake-landing"];
assert.equal(server.type, "streamable-http");
httpsURL(server.url, "MCP endpoint");
assert.equal(server.url, "https://mcp.toolvn.io.vn/mcp");
assert(!server.headers && !server.env);
assert.deepEqual(server.extensions["com.openai"].auth, {
  type: "oauth", client: { mode: "dcr" },
  baseScopes: ["landing:read", "landing:write"], defaultScopes: ["landing:read", "landing:write"],
});
assert.equal(openai.review.commerce, false);
assert(!("test_credentials" in openai.review) && !("reviewer_instructions" in openai.review));
assert.deepEqual(openai.publication.countries, []); // Confirmed: all available countries.
assert(openai.publication.release_notes?.trim());
const { positive, negative } = openai.review.test_cases;
assert.equal(positive.length, 5);
assert.equal(negative.length, 3);
for (const test of [...positive, ...negative]) {
  assert(typeof test.description === "string" && test.description.trim());
  assert(typeof test.prompt === "string" && test.prompt.trim());
}
for (const test of positive) {
  assert(typeof test.tools_triggered === "string" && test.tools_triggered.trim());
  assert(typeof test.expected_behavior === "string" && test.expected_behavior.trim());
}
const skill = readFileSync(join(source, "skills/webcake-landing/SKILL.md"), "utf8");
assert.match(skill, /^---\nname: webcake-landing\ndescription: .+\n---\n/);
const out = join(root, "artifacts/plugins");
mkdirSync(out, { recursive: true });
const archive = join(out, `${manifest.name}-${manifest.version}.zip`);
rmSync(archive, { force: true });
command("zip", ["-X", "-q", archive, ...files]);
const inventory = command("unzip", ["-Z1", archive]).toString().trim().split("\n").sort();
assert.deepEqual(inventory, files);
for (const file of files) {
  assert(command("unzip", ["-p", archive, file]).equals(readFileSync(join(source, file))), `ZIP differs: ${file}`);
}
command("unzip", ["-t", archive]);
console.log(`Package checks passed: ${files.length} files; 5 positive / 3 negative cases; subtitle ${ui.shortDescription.length}/30.`);
console.log(`ZIP: ${archive}`);
console.log(`SHA256: ${createHash("sha256").update(readFileSync(archive)).digest("hex")}`);
if (openai.review.demo_recording_url) {
  httpsURL(openai.review.demo_recording_url, "demo_recording_url");
  console.log("Recording URL declared; playback and access still require verification.");
} else {
  console.log("PREPARATION ONLY: demo_recording_url is missing. This ZIP is not ready to submit.");
}
console.log("Before submission, finish the review evidence and portal checks in docs/submission-packet.md.");
