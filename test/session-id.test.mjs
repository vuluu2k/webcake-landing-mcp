// The landing session id (`wsid`, the SPA's `lwsid` cookie) rides next to the ljwt end to end:
// ?wsid= / x-webcake-session-id → config.sessionId → `x-session-id` on every backend call, and
// through the OAuth code → access → refresh chain. Missing wsid must behave exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { applyQueryAuth } from "../dist/http.js";
import { configFromHeaders, readConfig } from "../dist/persistence/config.js";
import { listOrganizations, buildRequestRedacted } from "../dist/persistence/webcake-client.js";
import { parseCallback } from "../dist/auth/login.js";
import { registerClient, startAuthorize, completeAuthorize, exchangeToken, resolveAccessToken } from "../dist/auth/oauth-server.js";

const fakeReq = (url, headers = {}) => ({ url, headers: { ...headers }, rawHeaders: [] });

test("?wsid= / ?session_id= map onto x-webcake-session-id; an explicit header wins", () => {
  const a = fakeReq("/mcp?jwt=j&wsid=w1");
  applyQueryAuth(a);
  assert.equal(a.headers["x-webcake-session-id"], "w1");
  assert.deepEqual(a.rawHeaders.slice(-2), ["x-webcake-session-id", "w1"]);
  const b = fakeReq("/mcp?jwt=j&session_id=w2");
  applyQueryAuth(b);
  assert.equal(b.headers["x-webcake-session-id"], "w2");
  const c = fakeReq("/mcp?wsid=q", { "x-webcake-session-id": "h" });
  applyQueryAuth(c);
  assert.equal(c.headers["x-webcake-session-id"], "h");
  const d = fakeReq("/mcp?jwt=j");
  applyQueryAuth(d);
  assert.equal(d.headers["x-webcake-session-id"], undefined);
});

test("configFromHeaders + readConfig carry sessionId; absent stays undefined", () => {
  const o = configFromHeaders({ "x-webcake-jwt": "j", "x-webcake-session-id": "w" });
  assert.equal(o.sessionId, "w");
  assert.equal(readConfig({ ...o, env: "prod" }).config.sessionId, "w");
  assert.equal(readConfig({ ...configFromHeaders({ "x-webcake-jwt": "j" }), env: "prod" }).config.sessionId, undefined);
});

test("login callback picks up wsid / session_id, optional", () => {
  assert.equal(parseCallback("/callback?token=t&wsid=w&state=s", "s").sessionId, "w");
  assert.equal(parseCallback("/callback?token=t&session_id=w&state=s", "s").sessionId, "w");
  const none = parseCallback("/callback?token=t&state=s", "s");
  assert.ok(none.ok && none.sessionId === undefined);
});

test("backend calls send x-session-id only when a session id is set", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ organizations: [] }));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.ok((await listOrganizations({ base, jwt: "j", sessionId: "w" })).ok);
    assert.ok((await listOrganizations({ base, jwt: "j" })).ok);
  } finally {
    server.close();
  }
  assert.equal(seen[0]["x-session-id"], "w");
  assert.equal(seen[0].authorization, "Bearer j");
  assert.equal("x-session-id" in seen[1], false);
  // dry-run previews mask it like the JWT
  assert.equal(buildRequestRedacted({ base, jwt: "j", sessionId: "w" }, "n", {}).headers["x-session-id"], "***");
  assert.equal("x-session-id" in buildRequestRedacted({ base, jwt: "j" }, "n", {}).headers, false);
});

async function oauthRoundTrip(wsid) {
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const verifier = randomBytes(40).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const reg = await registerClient({ redirect_uris: [redirect] });
  const client_id = reg.client.client_id;
  const auth = await startAuthorize({ client_id, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
  const done = await completeAuthorize(auth.internalState, "lj", wsid);
  assert.ok(done.ok);
  const tok = await exchangeToken({ grant_type: "authorization_code", code: done.code, redirect_uri: redirect, client_id, code_verifier: verifier });
  assert.ok(tok.ok);
  const refreshed = await exchangeToken({ grant_type: "refresh_token", refresh_token: tok.body.refresh_token });
  assert.ok(refreshed.ok);
  return [await resolveAccessToken(tok.body.access_token), await resolveAccessToken(refreshed.body.access_token)];
}

test("OAuth code → access → refresh keeps the wsid", async () => {
  delete process.env.DATABASE_URL; // in-memory store
  for (const cred of await oauthRoundTrip("w")) assert.deepEqual(cred, { ljwt: "lj", wsid: "w" });
});

test("OAuth without wsid still works (wsid reads as \"\")", async () => {
  for (const cred of await oauthRoundTrip(null)) assert.deepEqual(cred, { ljwt: "lj", wsid: "" });
});
