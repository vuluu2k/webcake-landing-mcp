// api_find / api_get / api_call over the generated landing_page_backend catalog. fetch is mocked:
// nothing here reaches a backend.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.WEBCAKE_API_BASE = "https://api.test";
process.env.WEBCAKE_BUILDER_BASE = "https://builder.test";
process.env.WEBCAKE_JWT = "test-jwt";
process.env.WEBCAKE_ORG_ID = "42";

const { API_OPS, TOOL_FOR, searchOps, redactSecrets, registerApiGatewayTools } = await import("../dist/tools/api-gateway.js");

const tools = {};
registerApiGatewayTools({ tool: (name, ...rest) => (tools[name] = rest[rest.length - 1]) });
const run = async (name, args) => {
  const out = (await tools[name](args, {})).content[0].text;
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
};

let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), ...init });
  return new Response(JSON.stringify({ success: true, records: { data: [{ id: 1, name: "a", access_token: "s3cret" }, { id: 2, name: "b" }] } }), { status: 200 });
};

test("catalog loads: API + builder hosts, no super-admin routes", () => {
  assert.ok(API_OPS.length > 300, `only ${API_OPS.length} ops`);
  assert.ok(API_OPS.some((o) => o.base === "builder") && API_OPS.some((o) => o.base === "api"));
  assert.ok(!API_OPS.some((o) => o.path.startsWith("/api/v1/admin/")));
  for (const id of Object.keys(TOOL_FOR)) assert.ok(API_OPS.some((o) => o.id === id), `TOOL_FOR names a route not in the catalog: ${id}`);
});

test("search finds the dataset records routes", async () => {
  assert.ok(searchOps("dataset records").some((o) => o.id === "get:/api/datasets/records"));
  const lines = await run("api_find", { query: "dataset records" });
  assert.match(lines, /get:\/api\/datasets\/records — DatasetController\.get_records \(entity_id\*/);
  const sheet = await run("api_find", { id: "get:/api/datasets/records" });
  assert.deepEqual(sheet.required, ["entity_id"]);
});

test("DENY: page / domain deletion, org members, billing are refused before any request", async () => {
  sent = [];
  for (const id of ["post:/api/v1/pages/delete", "post:/api/v1/domains/delete", "post:/api/v1/org/:org_id/members/remove_members", "post:/api/v1/subscriptions/create", "post:/api/v1/account/logout_sessions"]) {
    const r = await run("api_call", { id, path_params: { org_id: "42" }, body: {}, dry_run: false });
    assert.equal(r.refused, true, id);
  }
  assert.equal(sent.length, 0);
});

test("a write a dedicated tool owns is refused and names the tool", async () => {
  const r = await run("api_call", { id: "post:/api/v1/ai/update_page_source", body: { page_id: "p", source: {} }, dry_run: false });
  assert.equal(r.refused, true);
  assert.match(r.error, /update_page/);
  assert.match((await run("api_call", { id: "post:/api/pages/:page_id/edit/publish_html", path_params: { page_id: "p" } })).error, /publish_page/);
});

test("writes default to dry_run and send nothing", async () => {
  sent = [];
  const r = await run("api_call", { id: "post:/api/datasets/records/delete", body: { ids: ["x"] } });
  assert.equal(r.dry_run, true);
  assert.equal(r.would_send.host, "https://builder.test");
  assert.equal(r.would_send["x-org-id"], "42");
  assert.equal(sent.length, 0);
});

test("api_get: right host, auth + org headers, Accept the builder scope takes; secrets redacted, list trimmed", async () => {
  sent = [];
  const r = await run("api_get", { id: "get:/api/datasets/records", query: { entity_id: "e1" }, max_items: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://builder.test/api/datasets/records?entity_id=e1");
  assert.equal(sent[0].headers.Authorization, "Bearer test-jwt");
  assert.equal(sent[0].headers["x-org-id"], "42");
  assert.match(sent[0].headers.Accept, /\*\/\*/);
  assert.equal(r.result.records.data.total_items, 2);
  assert.equal(r.result.records.data.items[0].access_token, "[redacted]");
  assert.match((await run("api_get", { id: "post:/api/datasets/records/delete" })).error, /api_call/);
  assert.match((await run("api_get", { id: "get:/api/datasets/records" })).error, /entity_id/);
});

test("redactSecrets keeps non-secret look-alikes", () => {
  assert.deepEqual(redactSecrets({ footprint: "x", otp_code: "1", invite_code: "c", key: "k" }), { footprint: "x", otp_code: "[redacted]", invite_code: "[redacted]", key: "k" });
});
