/**
 * A THIN OAuth 2.1 Authorization Server, embedded in the MCP server itself.
 *
 * Why this exists: to be listed in the Claude Connectors Directory (and ChatGPT
 * App Directory) the remote MCP must be an OAuth 2.1 *protected resource* — each
 * user completes a real consent/login flow and the connector gets a per-user
 * access token. The Webcake backend (landing_page_backend) has no OAuth endpoints,
 * so instead of building a full OAuth server in Elixir we wrap the login that
 * ALREADY exists: the browser "connect" page (builderx_spa `/mcp-connect`) that
 * hands back the user's landing JWT (`ljwt`). See ../auth/login.ts for that flow.
 *
 * The shape we implement (minimal but spec-conformant for the MCP clients):
 *   - Dynamic Client Registration  (POST /register)           — open, public clients
 *   - Authorization Code + PKCE S256 (GET /authorize)         — code_challenge required
 *   - Token endpoint (POST /token)  authorization_code + refresh_token
 *   - Authorization Server + Protected Resource metadata (the /.well-known docs)
 *
 * Access tokens are OPAQUE random strings mapped to the user's `ljwt` in this
 * store (so they can be revoked and the ljwt never leaves the server). The HTTP
 * layer resolves a Bearer access token to its ljwt and injects it as the normal
 * `x-webcake-jwt` header, so the rest of the server (persistence/config.ts) is
 * UNCHANGED and the legacy `?jwt=` / `x-webcake-jwt` paths keep working untouched.
 *
 * STORE: in-memory + single-process. Fine for one `serve` instance; move the maps
 * to Redis (same interface) before running multiple instances behind a load balancer.
 */
import { randomBytes, createHash } from "node:crypto";

// ---- TTLs (override via env where useful) ---------------------------------
const TEN_MIN = 10 * 60 * 1000;
const ACCESS_TTL = Number(process.env.WEBCAKE_OAUTH_ACCESS_TTL_MS) || 60 * 60 * 1000; // 1h
const REFRESH_TTL = Number(process.env.WEBCAKE_OAUTH_REFRESH_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 30d
const CODE_TTL = TEN_MIN;
const PENDING_TTL = TEN_MIN;

// ---- Records --------------------------------------------------------------
export type OAuthClient = {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  created_at: number;
};

/** A started /authorize request, parked while the user logs in via /mcp-connect. */
type PendingAuth = {
  client_id: string;
  redirect_uri: string; // the CLIENT's (Claude/ChatGPT) callback
  code_challenge: string;
  state?: string; // the CLIENT's state, echoed back verbatim
  scope?: string;
  expiresAt: number;
};

/** An issued authorization code, exchanged once at /token. */
type AuthCode = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope?: string;
  ljwt: string; // the user's resolved landing JWT
  expiresAt: number;
};

type AccessToken = { ljwt: string; scope?: string; expiresAt: number };
type RefreshToken = { ljwt: string; client_id: string; scope?: string; expiresAt: number };

// ---- In-memory maps -------------------------------------------------------
const clients = new Map<string, OAuthClient>();
const pending = new Map<string, PendingAuth>(); // key: internal state we send to /mcp-connect
const codes = new Map<string, AuthCode>(); // key: authorization code
const accessTokens = new Map<string, AccessToken>(); // key: access token
const refreshTokens = new Map<string, RefreshToken>(); // key: refresh token

function now(): number {
  return Date.now();
}

function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Lazy sweep of anything expired — cheap, called on the hot paths. */
function sweep(): void {
  const t = now();
  for (const [k, v] of pending) if (v.expiresAt < t) pending.delete(k);
  for (const [k, v] of codes) if (v.expiresAt < t) codes.delete(k);
  for (const [k, v] of accessTokens) if (v.expiresAt < t) accessTokens.delete(k);
  for (const [k, v] of refreshTokens) if (v.expiresAt < t) refreshTokens.delete(k);
}

// ---- PKCE -----------------------------------------------------------------
/** base64url( SHA256(verifier) ) — the S256 transform. */
export function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  // Constant-time-ish compare on equal-length base64url strings.
  const a = s256(verifier);
  if (a.length !== challenge.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ challenge.charCodeAt(i);
  return diff === 0;
}

// ---- Dynamic Client Registration -----------------------------------------
export type RegisterRequest = {
  redirect_uris?: unknown;
  client_name?: unknown;
  [k: string]: unknown;
};

export type RegisterResult =
  | { ok: true; client: OAuthClient }
  | { ok: false; error: string; error_description: string };

export function registerClient(body: RegisterRequest): RegisterResult {
  const uris = Array.isArray(body?.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u))
    : [];
  if (uris.length === 0) {
    return { ok: false, error: "invalid_redirect_uri", error_description: "redirect_uris must contain at least one absolute http(s) URI." };
  }
  const client: OAuthClient = {
    client_id: token(16),
    client_name: typeof body?.client_name === "string" ? body.client_name : undefined,
    redirect_uris: uris,
    created_at: now(),
  };
  clients.set(client.client_id, client);
  return { ok: true, client };
}

export function getClient(clientId: string | undefined | null): OAuthClient | undefined {
  return clientId ? clients.get(clientId) : undefined;
}

// ---- Authorize: park the request, then resolve it once the user logs in ---
export type StartAuthorizeParams = {
  client_id?: string | null;
  redirect_uri?: string | null;
  response_type?: string | null;
  code_challenge?: string | null;
  code_challenge_method?: string | null;
  state?: string | null;
  scope?: string | null;
};

export type StartAuthorizeResult =
  | { ok: true; internalState: string }
  | { ok: false; error: string; error_description: string; redirectable: boolean };

/**
 * Validate an /authorize request and park it. Returns an `internalState` to send
 * to the login page as its `state`; the callback uses it to find this request.
 * `redirectable: false` means the error must be shown as a page (we can't trust
 * the redirect_uri); `true` means it's safe to bounce the error to the client.
 */
export function startAuthorize(p: StartAuthorizeParams): StartAuthorizeResult {
  sweep();
  const client = getClient(p.client_id);
  if (!client) {
    return { ok: false, error: "invalid_client", error_description: "Unknown client_id. Register first via /register.", redirectable: false };
  }
  if (!p.redirect_uri || !client.redirect_uris.includes(p.redirect_uri)) {
    return { ok: false, error: "invalid_request", error_description: "redirect_uri does not match a registered URI.", redirectable: false };
  }
  // From here errors CAN go back to the client's redirect_uri.
  if (p.response_type !== "code") {
    return { ok: false, error: "unsupported_response_type", error_description: "Only response_type=code is supported.", redirectable: true };
  }
  if (!p.code_challenge || (p.code_challenge_method ?? "").toUpperCase() !== "S256") {
    return { ok: false, error: "invalid_request", error_description: "PKCE with code_challenge_method=S256 is required.", redirectable: true };
  }
  const internalState = token(24);
  pending.set(internalState, {
    client_id: client.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    state: p.state ?? undefined,
    scope: p.scope ?? undefined,
    expiresAt: now() + PENDING_TTL,
  });
  return { ok: true, internalState };
}

export type CompleteAuthorizeResult =
  | { ok: true; redirectUri: string; code: string; state?: string }
  | { ok: false; error: string; error_description: string };

/**
 * The login page (/mcp-connect) bounced back with the user's `ljwt` and our
 * `internalState`. Mint a one-time authorization code bound to that ljwt + the
 * parked PKCE challenge, and return where to redirect the user (the client's
 * redirect_uri with ?code=&state=).
 */
export function completeAuthorize(internalState: string | undefined | null, ljwt: string | undefined | null): CompleteAuthorizeResult {
  sweep();
  if (!internalState || !pending.has(internalState)) {
    return { ok: false, error: "invalid_request", error_description: "Authorization session expired or unknown — restart the connection." };
  }
  const p = pending.get(internalState)!;
  pending.delete(internalState);
  if (!ljwt) {
    return { ok: false, error: "access_denied", error_description: "No Webcake token returned from login." };
  }
  const code = token(32);
  codes.set(code, {
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    scope: p.scope,
    ljwt,
    expiresAt: now() + CODE_TTL,
  });
  return { ok: true, redirectUri: p.redirect_uri, code, state: p.state };
}

// ---- Token endpoint -------------------------------------------------------
export type TokenParams = {
  grant_type?: string | null;
  code?: string | null;
  redirect_uri?: string | null;
  client_id?: string | null;
  code_verifier?: string | null;
  refresh_token?: string | null;
};

export type TokenSuccess = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope?: string;
};
export type TokenResult = { ok: true; body: TokenSuccess } | { ok: false; status: number; error: string; error_description: string };

function issueTokens(ljwt: string, client_id: string, scope: string | undefined): TokenSuccess {
  const access = token(32);
  const refresh = token(32);
  accessTokens.set(access, { ljwt, scope, expiresAt: now() + ACCESS_TTL });
  refreshTokens.set(refresh, { ljwt, client_id, scope, expiresAt: now() + REFRESH_TTL });
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL / 1000), refresh_token: refresh, scope };
}

export function exchangeToken(p: TokenParams): TokenResult {
  sweep();
  if (p.grant_type === "authorization_code") {
    if (!p.code || !codes.has(p.code)) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "Unknown or expired authorization code." };
    }
    const c = codes.get(p.code)!;
    codes.delete(p.code); // one-time use
    if (c.client_id !== p.client_id) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "client_id does not match the authorization code." };
    }
    if (c.redirect_uri !== p.redirect_uri) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "redirect_uri does not match the authorization request." };
    }
    if (!p.code_verifier || !verifyPkce(p.code_verifier, c.code_challenge)) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "PKCE verification failed." };
    }
    return { ok: true, body: issueTokens(c.ljwt, c.client_id, c.scope) };
  }
  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token || !refreshTokens.has(p.refresh_token)) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "Unknown or expired refresh token." };
    }
    const r = refreshTokens.get(p.refresh_token)!;
    refreshTokens.delete(p.refresh_token); // rotate
    return { ok: true, body: issueTokens(r.ljwt, r.client_id, r.scope) };
  }
  return { ok: false, status: 400, error: "unsupported_grant_type", error_description: "grant_type must be authorization_code or refresh_token." };
}

// ---- Resource-server side: resolve a Bearer access token to its ljwt -------
/** Returns the user's ljwt for a valid, unexpired access token, else undefined. */
export function resolveAccessToken(accessToken: string | undefined | null): string | undefined {
  if (!accessToken) return undefined;
  const a = accessTokens.get(accessToken);
  if (!a) return undefined;
  if (a.expiresAt < now()) {
    accessTokens.delete(accessToken);
    return undefined;
  }
  return a.ljwt;
}

/** Revoke an access or refresh token (best-effort; for /revoke). */
export function revokeToken(t: string | undefined | null): void {
  if (!t) return;
  accessTokens.delete(t);
  refreshTokens.delete(t);
}

// ---- Metadata documents (RFC 8414 / RFC 9728) -----------------------------
/** /.well-known/oauth-authorization-server */
export function authServerMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["landing:read", "landing:write"],
  };
}

/** /.well-known/oauth-protected-resource */
export function protectedResourceMetadata(resource: string, issuer: string): Record<string, unknown> {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: ["landing:read", "landing:write"],
    bearer_methods_supported: ["header"],
  };
}
