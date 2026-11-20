// The write path against the backend's versioned AI endpoints (a fake backend speaking their
// contract): only changed sections travel (patch_page_source), the base version rides along, a
// page_changed refusal surfaces as such, and an older backend without the route gets the whole tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { updatePageSource, appendSection, sourceOps, applyOps } from "../dist/persistence/webcake-client.js";

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

const show = (ops) => ops.map((o) => `${o.op}:${o.id ?? o.node?.id ?? o.key}${o.parent_id ? ">" + o.parent_id : ""}${o.index != null ? "@" + o.index : ""}`);
test("sourceOps: down to the changed node; removes, then sets, then inserts; applyOps replays it", () => {
  const a = { page: [sec("a", "1"), sec("b", "2")], popup: [], settings: { t: 1 } };
  const b = { page: [sec("a", "1"), sec("n", "3"), sec("b", "9")], popup: [], settings: { t: 2 } };
  assert.deepEqual(show(sourceOps(a, b)), ["set:bt", "insert:n@1", "top:settings"], "only the text node of b, not the section");
  assert.deepEqual(applyOps(a, sourceOps(a, b)), b);
  assert.deepEqual(sourceOps(a, { ...a, page: [a.page[1]] }).map((o) => o.op), ["remove"]);
  assert.equal(sourceOps(a, { ...a, page: [a.page[1], a.page[0]] }), undefined, "top-level reorder → whole tree");
  assert.deepEqual(sourceOps(a, structuredClone(a)), []);
  // children reordered → the parent is set; a child moved to another section → remove + insert there
  const r = structuredClone(a);
  r.page[0].children.push({ id: "a2", type: "button" });
  const r2 = structuredClone(r);
  r2.page[0].children.reverse();
  assert.deepEqual(show(sourceOps(r, r2)), ["set:a"]);
  const m = structuredClone(r);
  m.page[1].children.unshift(m.page[0].children.pop());
  assert.deepEqual(show(sourceOps(r, m)), ["remove:a2", "insert:a2>b@0"]);
  assert.deepEqual(applyOps(r, sourceOps(r, m)), m);
  // page ↔ popup: removes run first, so the node is never in two places
  const pop = { page: [sec("a", "1")], popup: [{ id: "pp01", type: "popup", children: [{ id: "xx01", type: "button" }] }] };
  const moved = { page: [{ ...sec("a", "1"), children: [...sec("a", "1").children, { id: "xx01", type: "button" }] }], popup: [{ id: "pp01", type: "popup", children: [] }] };
  assert.deepEqual(applyOps(pop, sourceOps(pop, moved)), moved);
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
  assert.deepEqual(calls[0].body.ops.map((o) => [o.op, o.id]), [["set", "s4t"]], "the one text node, not its section");
  assert.ok(Buffer.byteLength(JSON.stringify(calls[0].body)) < 1500, `${Buffer.byteLength(JSON.stringify(calls[0].body))} bytes`);
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

test("an invalid_ops refusal falls back to the whole tree", async () => {
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
  assert.equal(calls.length, 2);
  server.closeAllConnections();
  server.close();
});

test("update_page with a tree older than this session's own patch / an editor save is refused; a fresh one goes through as a 1-node patch", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { landingDomain: D } = await import("../dist/domains/landing/index.js");
  const crypto = await import("node:crypto");
  const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
  const src = D.createPageSource({});
  src.page = [0, 1, 2].map((i) => {
    const s = D.createElement("section");
    s.id = `sect${i}`;
    const t = D.createElement("text-block");
    t.id = `text${i}`;
    t.specials.text = `<p>t${i}</p>`;
    s.children = [t];
    return s;
  });
  let stored = JSON.stringify(D.expand(src));
  const log = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (st, j) => (res.writeHead(st, { "Content-Type": "application/json" }), res.end(JSON.stringify(j)));
      const p = new URL(req.url, "http://x").pathname.replace("/api/v1/ai/", "");
      const b = body ? JSON.parse(body) : {};
      log.push({ p, up: body.length });
      const meta = () => ({ page_id: "pg9", name: "P", organization_id: 1, updated_at: "2026-11-20T00:00:00", source_hash: md5(stored) });
      if (p === "page_source") return send(200, { success: true, data: { ...meta(), source: JSON.parse(stored) } });
      if (p === "page_version") return send(200, { success: true, data: meta() });
      if (b.base_source_hash && b.base_source_hash !== md5(stored)) return send(422, { success: false, message: "changed", reason: { code: "page_changed", source_hash: md5(stored) } });
      if (p === "patch_page_source") stored = JSON.stringify(applyOps(JSON.parse(stored), b.ops));
      else if (p === "update_page_source") stored = JSON.stringify(b.source);
      send(200, { success: true, data: meta() });
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const env = { base: process.env.WEBCAKE_API_BASE, jwt: process.env.WEBCAKE_JWT };
  process.env.WEBCAKE_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.WEBCAKE_JWT = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.y`;
  try {
    const { createServer } = await import("../dist/server.js");
    const [a, bb] = InMemoryTransport.createLinkedPair();
    await createServer().connect(a);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(bb);
    const call = async (name, args) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
    const tree = (await call("get_page", { page_id: "pg9", compact: false })).source;
    // the session's own patch: 1 request (cached tree, no probe), one node
    let n = log.length;
    assert.equal((await call("patch_page", { page_id: "pg9", patches: [{ op: "update", id: "text1", specials: { text: "<p>patched</p>" } }], dry_run: false })).patched, true);
    assert.deepEqual(log.slice(n).map((r) => r.p), ["patch_page_source"]);
    assert.ok(log.at(-1).up < 1500);
    // a second patch: still 1 request — the cache followed the first one
    n = log.length;
    assert.equal((await call("patch_page", { page_id: "pg9", patches: [{ op: "update", id: "text2", specials: { text: "<p>again</p>" } }], dry_run: false })).patched, true);
    assert.deepEqual(log.slice(n).map((r) => r.p), ["patch_page_source"]);
    // the get_page tree does not contain those patches → refused, nothing written
    const old = structuredClone(tree);
    old.page[0].children[0].specials.text = "<p>stale</p>";
    const u = await call("update_page", { page_id: "pg9", source: old, dry_run: false });
    assert.equal(u.updated, false);
    assert.equal(u.reason, "page_changed_externally");
    assert.match(stored, /patched/);
    // re-read, edit, save: one node patch
    const fresh = (await call("get_page", { page_id: "pg9", compact: false })).source;
    fresh.page[0].children[0].specials.text = "<p>fresh</p>";
    const u2 = await call("update_page", { page_id: "pg9", source: fresh, dry_run: false });
    assert.equal(u2.updated, true, JSON.stringify(u2).slice(0, 300));
    assert.equal(u2.via, "patch");
    assert.match(stored, /fresh/);
    assert.match(stored, /again/);
    // an "editor" save behind the cache: the trusted-cache patch is refused, re-read, re-applied
    const ed = JSON.parse(stored);
    ed.page[2].children[0].specials.text = "<p>EDITOR</p>";
    stored = JSON.stringify(ed);
    const p3 = await call("patch_page", { page_id: "pg9", patches: [{ op: "update", id: "text0", specials: { text: "<p>after editor</p>" } }], dry_run: false });
    assert.equal(p3.patched, true, JSON.stringify(p3).slice(0, 300));
    assert.match(stored, /EDITOR/);
    assert.match(stored, /after editor/);
  } finally {
    if (env.base === undefined) delete process.env.WEBCAKE_API_BASE; else process.env.WEBCAKE_API_BASE = env.base;
    if (env.jwt === undefined) delete process.env.WEBCAKE_JWT; else process.env.WEBCAKE_JWT = env.jwt;
    server.closeAllConnections();
    server.close();
  }
});

test("review cases: duplicate ids → whole tree; applyOps walks like the backend", () => {
  const dup = { page: [{ id: "sect1", type: "section", children: [{ id: "grp1", type: "group", children: [{ id: "dupx", type: "button", specials: { t: 1 } }] }] }, { id: "sect2", type: "section", children: [{ id: "dupx", type: "button", specials: { t: 2 } }] }], popup: [] };
  const edited = structuredClone(dup);
  edited.page[1].children[0].specials.t = 9;
  assert.equal(sourceOps(dup, edited), undefined, "the backend would edit the FIRST dupx (inside sect1)");
  // depth-first pre-order: the nested dupx in sect1 comes before sect2's
  const out = applyOps(dup, [{ op: "set", id: "dupx", node: { type: "button", specials: { t: 7 } } }]);
  assert.equal(out.page[0].children[0].children[0].specials.t, 7);
  assert.equal(out.page[1].children[0].specials.t, 2);
  assert.throws(() => applyOps(dup, [{ op: "insert", parent_id: "dupx", node: { id: "zzzz", type: "button" } }]), /no children list/);
  assert.throws(() => applyOps(dup, [{ op: "set", id: "sect1", node: { type: "text-block" } }]), /cannot turn section/);
});

test("review cases via the tools: stale cache + empty diff, outline reads, draft base, a save that already landed", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { landingDomain: D } = await import("../dist/domains/landing/index.js");
  const crypto = await import("node:crypto");
  const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
  const src = D.createPageSource({});
  src.page = [0, 1].map((i) => {
    const s = D.createElement("section");
    s.id = `sect${i}`;
    const t = D.createElement("text-block");
    t.id = `text${i}`;
    t.specials.text = `<p>t${i}</p>`;
    s.children = [t];
    return s;
  });
  let stored = JSON.stringify(D.expand(src));
  const log = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (st, j) => (res.writeHead(st, { "Content-Type": "application/json" }), res.end(JSON.stringify(j)));
      const p = new URL(req.url, "http://x").pathname.replace("/api/v1/ai/", "");
      const b = body ? JSON.parse(body) : {};
      log.push(p);
      const meta = () => ({ page_id: "pgR", name: "P", organization_id: 1, updated_at: "2026-11-20T00:00:00", source_hash: md5(stored) });
      if (p === "page_source") return send(200, { success: true, data: { ...meta(), source: JSON.parse(stored) } });
      if (p === "page_version") return send(200, { success: true, data: meta() });
      if (b.base_source_hash && b.base_source_hash !== md5(stored)) return send(422, { success: false, message: "changed", reason: { code: "page_changed", source_hash: md5(stored) } });
      if (p === "patch_page_source") stored = JSON.stringify(applyOps(JSON.parse(stored), b.ops));
      else if (p === "update_page_source") stored = JSON.stringify(b.source);
      send(200, { success: true, data: meta() });
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const env = { base: process.env.WEBCAKE_API_BASE, jwt: process.env.WEBCAKE_JWT };
  process.env.WEBCAKE_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.WEBCAKE_JWT = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.z`;
  const editorSets = (id, text) => {
    const t = JSON.parse(stored);
    for (const s of t.page) for (const k of s.children) if (k.id === id) k.specials.text = text;
    stored = JSON.stringify(t);
  };
  const textOf = (id) => JSON.parse(stored).page.flatMap((s) => s.children).find((k) => k.id === id).specials.text;
  try {
    const { createServer } = await import("../dist/server.js");
    const [a, bb] = InMemoryTransport.createLinkedPair();
    await createServer().connect(a);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(bb);
    const call = async (name, args) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
    const patch = (id, text) => call("patch_page", { page_id: "pgR", patches: [{ op: "update", id, specials: { text } }], dry_run: false });
    const tree = (await call("get_page", { page_id: "pgR", compact: false })).source;
    // (2) cache says A, the editor made it B, the model asks for A again: must reach the page
    assert.equal((await patch("text0", "<p>A</p>")).patched, true);
    editorSets("text0", "<p>B</p>");
    assert.equal((await patch("text0", "<p>A</p>")).patched, true);
    assert.equal(textOf("text0"), "<p>A</p>", "an empty diff against a stale cache is not a success");
    // (3) an outline read does not make an older full tree acceptable
    await call("get_page", { page_id: "pgR", outline: true });
    const old = structuredClone(tree);
    old.page[1].children[0].specials.text = "<p>stale</p>";
    assert.equal((await call("update_page", { page_id: "pgR", source: old, dry_run: false })).reason, "page_changed_externally");
    // (8) a save that already landed: the retry with the old base is done, not refused
    const fresh = (await call("get_page", { page_id: "pgR", compact: false })).source;
    fresh.page[1].children[0].specials.text = "<p>landed</p>";
    const base = (await call("get_page", { page_id: "pgR", compact: false })).source_version;
    assert.equal((await call("update_page", { page_id: "pgR", source: fresh, base_version: base, dry_run: false })).updated, true);
    const again = await call("update_page", { page_id: "pgR", source: fresh, base_version: base, dry_run: false });
    assert.equal(again.updated, true, JSON.stringify(again).slice(0, 300));
    // (6) a draft cached with no base does not borrow a later get_page's version
    const bad = structuredClone(fresh);
    bad.page[1].children[0].specials.text = "<p>draft</p>";
    bad.page[1].children[0].type = "nope-type";
    const failed = await call("update_page", { page_id: "pgR", source: bad, base_version: undefined, dry_run: false });
    assert.equal(failed.updated, false);
  } finally {
    if (env.base === undefined) delete process.env.WEBCAKE_API_BASE; else process.env.WEBCAKE_API_BASE = env.base;
    if (env.jwt === undefined) delete process.env.WEBCAKE_JWT; else process.env.WEBCAKE_JWT = env.jwt;
    server.closeAllConnections();
    server.close();
  }
});
