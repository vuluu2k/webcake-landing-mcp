// Default `install` asks nothing: prod connect page → every detected IDE. --dev opens the wizard.
// Run after build: node --test test/install-flow.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NAME = "webcake-landing";
const CONNECT = /^https:\/\/webcake\.io\/mcp-connect\?/;
const ENTRY = join(import.meta.dirname, "..", "dist", "index.js");
const FAKE_TTY = "data:text/javascript,process.stdin.isTTY=process.stdout.isTTY=true";
const posixOnly = { skip: process.platform === "win32" };

function stub(bin, name, body) {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
}

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "wc-landing-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  // Stands in for the user clicking Connect: records the URL, calls the loopback back.
  const click = `echo "$1" > "${home}/opened"
exec "${process.execPath}" -e 'const u=new URL(process.argv[1]);fetch(u.searchParams.get("redirect_uri")+"?token=tok&wsid=sid&state="+u.searchParams.get("state"))' "$1"`;
  stub(bin, "open", click);
  stub(bin, "xdg-open", click);
  return { home, bin, env: { HOME: home, USERPROFILE: home, PATH: bin } };
}

function run(args, env, { tty = true, until } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...(tty ? ["--import", FAKE_TTY] : []), ENTRY, ...args], {
      env,
      cwd: env.HOME,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    const onData = (d) => {
      out += d;
      if (until && out.includes(until)) child.kill();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => resolve({ out, code }));
    setTimeout(() => child.kill(), 20_000).unref();
  });
}

const json = (...p) => JSON.parse(readFileSync(join(...p), "utf8"));

for (const tty of [true, false]) {
  test(`install (tty=${tty}) asks nothing: prod connect page, detected IDE only`, posixOnly, async () => {
    const { home, env } = sandbox();
    mkdirSync(join(home, ".cursor"));
    const { out, code } = await run(["install"], env, { tty });

    assert.equal(code, 0);
    assert.doesNotMatch(out, /Select/);
    assert.match(readFileSync(join(home, "opened"), "utf8"), CONNECT);
    assert.equal(json(home, ".cursor", "mcp.json").mcpServers[NAME].env.WEBCAKE_ENV, "prod");
    assert.equal(existsSync(join(home, ".codeium")), false); // not installed → untouched
    assert.equal(existsSync(join(home, ".claude.json")), false);
  });
}

test("keeps the user's other servers and a backup; a re-run changes nothing", posixOnly, async () => {
  const { home, env } = sandbox();
  mkdirSync(join(home, ".cursor"));
  const file = join(home, ".cursor", "mcp.json");
  const original = JSON.stringify({ mcpServers: { mine: { command: "x" } } });
  writeFileSync(file, original);

  await run(["install"], env);
  assert.equal(json(file).mcpServers.mine.command, "x");
  assert.equal(readFileSync(`${file}.${NAME}-backup`, "utf8"), original);

  await run(["install"], env);
  assert.equal(readFileSync(`${file}.${NAME}-backup`, "utf8"), original); // not overwritten
});

test("VS Code gets `servers` with type stdio", posixOnly, async () => {
  const { home, env } = sandbox();
  const dir = process.platform === "darwin" ? join(home, "Library", "Application Support", "Code", "User") : join(home, ".config", "Code", "User");
  mkdirSync(dir, { recursive: true });
  await run(["install"], env);
  const cfg = json(dir, "mcp.json");
  assert.equal(cfg.servers[NAME].type, "stdio");
  assert.equal(cfg.mcpServers, undefined);
});

test("Claude Code is registered at user scope, not just the current folder", posixOnly, async () => {
  const { home, bin, env } = sandbox();
  stub(bin, "which", '[ "$1" = claude ]');
  stub(bin, "claude", `echo "$@" >> "${home}/claude-args"`);
  await run(["install"], env);
  assert.match(readFileSync(join(home, "claude-args"), "utf8"), new RegExp(`mcp add --scope user ${NAME} `));
});

test("no AI app found: says so and fails without asking", posixOnly, async () => {
  const { env } = sandbox();
  const { out, code } = await run(["install"], env);
  assert.equal(code, 1);
  assert.match(out, /No AI app found/);
  assert.doesNotMatch(out, /Select/);
});

test("install --dev opens the environment step", posixOnly, async () => {
  const { env } = sandbox();
  const { out } = await run(["install", "--dev"], env, { until: "Select [1=prod" });
  assert.match(out, /1\) Environment/);
});
