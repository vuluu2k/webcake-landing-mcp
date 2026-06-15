// Ad-hoc end-to-end test of the embedded OAuth 2.1 flow (run against a serve instance).
// Simulates Claude's DCR + PKCE handshake AND the SPA login callback, then checks
// that the minted access token resolves to the ljwt on /mcp.
import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.BASE || "http://localhost:8799";
const b64url = (b) => b.toString("base64url");
const verifier = b64url(randomBytes(40));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const CLIENT_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const FAKE_LJWT = "fake.ljwt.token-for-test";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? (pass++, console.log("  ok  " + name)) : (fail++, console.log("  FAIL " + name + " " + extra))); };

// 1. metadata
const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
ok("protected-resource metadata", prm.resource?.endsWith("/mcp") && Array.isArray(prm.authorization_servers));
const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
ok("auth-server metadata S256", asm.code_challenge_methods_supported?.includes("S256") && !!asm.authorization_endpoint);

// 2. DCR
const reg = await (await fetch(`${BASE}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Test", redirect_uris: [CLIENT_REDIRECT] }) })).json();
ok("dynamic client registration", !!reg.client_id, JSON.stringify(reg));
const clientId = reg.client_id;

// 3. authorize → 302 to SPA login; capture internalState
const authUrl = `${BASE}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(CLIENT_REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=claude-state-123&scope=landing:write`;
const authRes = await fetch(authUrl, { redirect: "manual" });
const loginLoc = authRes.headers.get("location") || "";
ok("authorize redirects to /mcp-connect", authRes.status === 302 && loginLoc.includes("/mcp-connect"), loginLoc);
const internalState = new URL(loginLoc).searchParams.get("state");
const cbInLogin = new URL(loginLoc).searchParams.get("redirect_uri");
ok("login carries our callback + state", !!internalState && cbInLogin?.endsWith("/oauth/callback"));

// 3b. PKCE enforcement: authorize without code_challenge bounces an error to client
const noPkce = await fetch(`${BASE}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(CLIENT_REDIRECT)}&state=x`, { redirect: "manual" });
ok("authorize without PKCE errors", noPkce.status === 302 && (noPkce.headers.get("location") || "").includes("error=invalid_request"));

// 4. simulate SPA returning the ljwt to our callback
const cbRes = await fetch(`${BASE}/oauth/callback?token=${encodeURIComponent(FAKE_LJWT)}&state=${internalState}`, { redirect: "manual" });
const clientLoc = cbRes.headers.get("location") || "";
ok("callback redirects back to client with code", cbRes.status === 302 && clientLoc.startsWith(CLIENT_REDIRECT) && clientLoc.includes("code="), clientLoc);
const code = new URL(clientLoc).searchParams.get("code");
ok("client state echoed back", new URL(clientLoc).searchParams.get("state") === "claude-state-123");

// 5. token exchange (wrong verifier fails, right verifier works)
const badTok = await fetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CLIENT_REDIRECT, client_id: clientId, code_verifier: "wrong" }) });
ok("token rejects bad PKCE verifier", badTok.status === 400);

// NOTE: code is one-time; the bad attempt consumed it. Re-run authorize+callback for the good path.
const authRes2 = await fetch(authUrl, { redirect: "manual" });
const internalState2 = new URL(authRes2.headers.get("location")).searchParams.get("state");
const cbRes2 = await fetch(`${BASE}/oauth/callback?token=${encodeURIComponent(FAKE_LJWT)}&state=${internalState2}`, { redirect: "manual" });
const code2 = new URL(cbRes2.headers.get("location")).searchParams.get("code");
const tok = await (await fetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: code2, redirect_uri: CLIENT_REDIRECT, client_id: clientId, code_verifier: verifier }) })).json();
ok("token exchange returns access+refresh", !!tok.access_token && !!tok.refresh_token && tok.token_type === "Bearer", JSON.stringify(tok));

// 6. refresh
const refreshed = await (await fetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token }) })).json();
ok("refresh_token returns a new access token", !!refreshed.access_token && refreshed.access_token !== tok.access_token);

// 7. enforcement: /mcp without creds → 401 + WWW-Authenticate
const noAuth = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
ok("/mcp without creds → 401", noAuth.status === 401 && (noAuth.headers.get("www-authenticate") || "").includes("resource_metadata"), `status=${noAuth.status}`);

// 8. /mcp WITH the access token → NOT 401 (initialize proceeds; tools then use the ljwt)
const withAuth = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
ok("/mcp with access token → accepted (not 401)", withAuth.status !== 401, `status=${withAuth.status}`);

console.log(`\n${fail === 0 ? "OAUTH OK" : "OAUTH FAILED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
