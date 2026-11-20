// The write path against the backend's versioned AI endpoints (a fake backend speaking their
// contract): only changed sections travel (patch_page_source), the base version rides along, a
// page_changed refusal surfaces as such, and an older backend without the route gets the whole tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { updatePageSource, appendSection, sourceOps } from "../dist/persistence/webcake-client.js";

const H = (n) => String(n).padStart(32, "0"); // md5-shaped version tokens
function fakeBackend({ patchRoute = true, current = H(0) } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = body ? JSON.parse(body) : {};
      calls.push({ path: req.url, body: b });
      const send = (status, json) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(json)));
      if (req.url === "/api/v1/ai/patch_page_source" && !patchRoute) return send(404, { message: "not found" });
      if (b.base_source_hash && b.base_source_hash !== current)
        return send(422, { success: false, message: "changed", reason: { code: "page_changed", source_hash: current, updated_at: "2026-11-20T00:00:00" } });
      current = H(calls.length);
      send(200, { success: true, data: { page_id: b.page_id, source_hash: current, updated_at: "2026-11-20T00:00:01", section_count: 2 } });
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}
const sec = (id, text) => ({ id, type: "section", children: [{ id: `${id}t`, type: "text-block", specials: { text } }] });
const big = (n) => Array.from({ length: n }, (_, i) => sec(`s${i}`, "x".repeat(200)));

test("sourceOps: set / insert / remove / top; a reorder is not expressible", () => {
  const a = { page: [sec("a", "1"), sec("b", "2")], popup: [], settings: { t: 1 } };
  const b = { page: [sec("a", "1"), sec("n", "3"), sec("b", "9")], popup: [], settings: { t: 2 } };
  assert.deepEqual(sourceOps(a, b).map((o) => `${o.op}:${o.id ?? o.node?.id ?? o.key}${o.index != null ? "@" + o.index : ""}`), ["insert:n@1", "set:b", "top:settings"]);
  assert.deepEqual(sourceOps(a, { ...a, page: [a.page[1]] }).map((o) => o.op), ["remove"]);
  assert.equal(sourceOps(a, { ...a, page: [a.page[1], a.page[0]] }), undefined);
  assert.deepEqual(sourceOps(a, structuredClone(a)), []);
});

test("a known base sends only the changed section, with the base hash; the new version comes back", async () => {
  const { server, calls, base } = await fakeBackend();
  const cfg = { base, jwt: "j" };
  const before = { page: big(30), popup: [], settings: {} };
  const after = structuredClone(before);
  after.page[4].children[0].specials.text = "changed";
  const out = await updatePageSource(cfg, "pg1", after, { base: H(0), before });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.via, "patch");
  assert.equal(out.patch_ops, 1);
  assert.equal(calls[0].path, "/api/v1/ai/patch_page_source");
  assert.equal(calls[0].body.base_source_hash, H(0));
  assert.deepEqual(calls[0].body.ops.map((o) => [o.op, o.id]), [["set", "s4"]]);
  assert.equal(out.version, H(1));
  // the same edit against a stale base: refused as page_changed, with the live version
  const stale = await updatePageSource(cfg, "pg1", after, { base: H(0), before });
  assert.equal(stale.ok, false);
  assert.equal(stale.page_changed, true);
  assert.equal(stale.live_version, H(1));
  // no change at all: nothing is sent
  const n = calls.length;
  assert.equal((await updatePageSource(cfg, "pg1", before, { base: H(1), before })).patch_ops, 0);
  assert.equal(calls.length, n);
  server.closeAllConnections();
  server.close();
});

test("an older backend (404 on patch) gets the whole tree once, then always", async () => {
  const { server, calls, base } = await fakeBackend({ patchRoute: false });
  const cfg = { base, jwt: "j" };
  const before = { page: big(10), popup: [] };
  const after = structuredClone(before);
  after.page[0].children[0].specials.text = "y";
  const out = await updatePageSource(cfg, "pg2", after, { base: H(0), before });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.via, "update");
  assert.deepEqual(calls.map((c) => c.path), ["/api/v1/ai/patch_page_source", "/api/v1/ai/update_page_source"]);
  assert.equal(calls[1].body.base_source_hash, H(0));
  await updatePageSource(cfg, "pg2", after, { base: out.version, before: after });
  assert.equal(calls.length, 2, "nothing changed → nothing sent");
  const after2 = structuredClone(after);
  after2.page[1].children[0].specials.text = "z";
  await updatePageSource(cfg, "pg2", after2, { base: out.version, before: after });
  assert.equal(calls.at(-1).path, "/api/v1/ai/update_page_source", "the 404 is remembered");
  // append carries the base too, and maps page_changed
  const ap = await appendSection(cfg, "pg2", [sec("new", "n")], { base: H(99) });
  assert.equal(ap.page_changed, true);
  server.closeAllConnections();
  server.close();
});

test("patch_page: a dry run, then the real run, writes the edit (the cached live tree is never edited in place)", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { landingDomain: D } = await import("../dist/domains/landing/index.js");
  const crypto = await import("node:crypto");
  const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
  const src = D.createPageSource({});
  const s = D.createElement("section");
  const t = D.createElement("text-block");
  Object.assign(t, { id: "txt1" });
  t.specials.text = "<p>old</p>";
  Object.assign(s, { id: "sec1", children: [t] });
  src.page = [s];
  const stored = JSON.stringify(D.expand(src));
  const writes = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (st, j) => (res.writeHead(st, { "Content-Type": "application/json" }), res.end(JSON.stringify(j)));
      const p = new URL(req.url, "http://x").pathname;
      const meta = { page_id: "pg1", name: "P", organization_id: 1, updated_at: "2026-11-20T00:00:00", source_hash: md5(stored) };
      if (p.endsWith("/page_source")) return send(200, { success: true, data: { ...meta, source: JSON.parse(stored) } });
      if (p.endsWith("/page_version")) return send(200, { success: true, data: meta });
      writes.push({ p, body });
      send(200, { success: true, data: { ...meta, source_hash: md5(body) } });
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const env = { base: process.env.WEBCAKE_API_BASE, jwt: process.env.WEBCAKE_JWT };
  process.env.WEBCAKE_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.WEBCAKE_JWT = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
  try {
    const { createServer } = await import("../dist/server.js");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer().connect(a);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(b);
    const call = async (args) => JSON.parse((await c.callTool({ name: "patch_page", arguments: args })).content[0].text);
    const patches = [{ op: "update", id: "txt1", specials: { text: "<p>NEW</p>" } }];
    assert.equal((await call({ page_id: "pg1", patches, dry_run: true })).dry_run, true);
    const real = await call({ page_id: "pg1", patches, dry_run: false });
    assert.equal(real.patched, true, JSON.stringify(real).slice(0, 300));
    assert.equal(writes.length, 1, "the real run writes");
    assert.match(writes[0].body, /NEW/);
  } finally {
    if (env.base === undefined) delete process.env.WEBCAKE_API_BASE; else process.env.WEBCAKE_API_BASE = env.base;
    if (env.jwt === undefined) delete process.env.WEBCAKE_JWT; else process.env.WEBCAKE_JWT = env.jwt;
    server.closeAllConnections();
    server.close();
  }
});

test("an invalid_ops refusal falls back to the whole tree; a page ↔ popup move is never a patch", async () => {
  const { server, calls, base } = await (async () => {
    const calls = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls.push({ path: req.url, body: JSON.parse(body || "{}") });
        const send = (st, j) => (res.writeHead(st, { "Content-Type": "application/json" }), res.end(JSON.stringify(j)));
        if (req.url.endsWith("/patch_page_source")) return send(422, { success: false, message: "ops[0]: not found", reason: "invalid_ops" });
        send(200, { success: true, data: { page_id: "pg3", source_hash: H(7) } });
      });
    });
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    return { server, calls, base: `http://127.0.0.1:${server.address().port}` };
  })();
  const before = { page: big(10), popup: [] };
  const after = structuredClone(before);
  after.page[2].children[0].specials.text = "q";
  const out = await updatePageSource({ base, jwt: "j" }, "pg3", after, { base: H(0), before });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(calls.map((c) => c.path), ["/api/v1/ai/patch_page_source", "/api/v1/ai/update_page_source"]);
  assert.equal(calls[1].body.base_source_hash, H(0));
  const pop = { page: [sec("a", "1")], popup: [{ id: "x", type: "popup" }] };
  assert.equal(sourceOps(pop, { page: [sec("a", "1"), { id: "x", type: "popup" }], popup: [] }), undefined);
  server.closeAllConnections();
  server.close();
});
