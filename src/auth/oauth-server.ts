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
 * Access tokens are OPAQUE random strings mapped to the user's `ljwt` in the
 * store (so they can be revoked and the ljwt never leaves the server). The HTTP
 * layer resolves a Bearer access token to its ljwt and injects it as the normal
 * `x-webcake-jwt` header, so the rest of the server (persistence/config.ts) is
 * UNCHANGED and the legacy `?jwt=` / `x-webcake-jwt` paths keep working untouched.
 *
 * STORE: Postgres when DATABASE_URL is set (tokens survive a `serve` restart and
 * are shared across instances behind a load balancer), else in-memory maps
 * (single-instance `serve`, stdio/`npx`, offline tests). Both implement the same
 * async `OAuthStore` interface; the rest of this module is backend-agnostic. All
 * exported state functions are async — callers (src/http.ts) `await` them.
 */
import { randomBytes, createHash } from "node:crypto";
import { getPg, ensureOAuthSchema, type PgPool } from "../persistence/postgres.js";

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

function now(): number {
  return Date.now();
}

function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

// ===========================================================================
// Store abstraction: one async interface, two backends (memory + Postgres).
// ===========================================================================
interface OAuthStore {
  putClient(c: OAuthClient): Promise<void>;
  getClient(id: string): Promise<OAuthClient | undefined>;

  putPending(state: string, p: PendingAuth): Promise<void>;
  takePending(state: string): Promise<PendingAuth | undefined>; // get + delete (one-time)

  putCode(code: string, c: AuthCode): Promise<void>;
  takeCode(code: string): Promise<AuthCode | undefined>; // get + delete (one-time)

  putAccess(t: string, a: AccessToken): Promise<void>;
  getAccess(t: string): Promise<AccessToken | undefined>;

  putRefresh(t: string, r: RefreshToken): Promise<void>;
  takeRefresh(t: string): Promise<RefreshToken | undefined>; // get + delete (rotated)

  revoke(t: string): Promise<void>; // best-effort: drop an access AND/OR refresh token
}

// ---- In-memory store (default; no DATABASE_URL) ---------------------------
class MemoryStore implements OAuthStore {
  private clients = new Map<string, OAuthClient>();
  private pending = new Map<string, PendingAuth>();
  private codes = new Map<string, AuthCode>();
  private access = new Map<string, AccessToken>();
  private refresh = new Map<string, RefreshToken>();

  /** Lazy sweep of anything expired — cheap, called on the hot paths. */
  private sweep(): void {
    const t = now();
    for (const [k, v] of this.pending) if (v.expiresAt < t) this.pending.delete(k);
    for (const [k, v] of this.codes) if (v.expiresAt < t) this.codes.delete(k);
    for (const [k, v] of this.access) if (v.expiresAt < t) this.access.delete(k);
    for (const [k, v] of this.refresh) if (v.expiresAt < t) this.refresh.delete(k);
  }

  async putClient(c: OAuthClient) {
    this.clients.set(c.client_id, c);
  }
  async getClient(id: string) {
    return this.clients.get(id);
  }
  async putPending(state: string, p: PendingAuth) {
    this.sweep();
    this.pending.set(state, p);
  }
  async takePending(state: string) {
    this.sweep();
    const p = this.pending.get(state);
    this.pending.delete(state);
    return p && p.expiresAt >= now() ? p : undefined;
  }
  async putCode(code: string, c: AuthCode) {
    this.codes.set(code, c);
  }
  async takeCode(code: string) {
    this.sweep();
    const c = this.codes.get(code);
    this.codes.delete(code);
    return c && c.expiresAt >= now() ? c : undefined;
  }
  async putAccess(t: string, a: AccessToken) {
    this.access.set(t, a);
  }
  async getAccess(t: string) {
    const a = this.access.get(t);
    if (a && a.expiresAt < now()) {
      this.access.delete(t);
      return undefined;
    }
    return a;
  }
  async putRefresh(t: string, r: RefreshToken) {
    this.refresh.set(t, r);
  }
  async takeRefresh(t: string) {
    this.sweep();
    const r = this.refresh.get(t);
    this.refresh.delete(t);
    return r && r.expiresAt >= now() ? r : undefined;
  }
  async revoke(t: string) {
    this.access.delete(t);
    this.refresh.delete(t);
  }
}

// ---- Postgres store (when DATABASE_URL is set) ----------------------------
class PgStore implements OAuthStore {
  constructor(private pool: PgPool) {}

  async putClient(c: OAuthClient) {
    await this.pool.query(
      `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (client_id) DO UPDATE SET client_name=$2, redirect_uris=$3`,
      [c.client_id, c.client_name ?? null, JSON.stringify(c.redirect_uris), c.created_at]
    );
  }
  async getClient(id: string) {
    const { rows } = await this.pool.query(
      `SELECT client_id, client_name, redirect_uris, created_at FROM oauth_clients WHERE client_id=$1`,
      [id]
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      client_id: r.client_id,
      client_name: r.client_name ?? undefined,
      redirect_uris: Array.isArray(r.redirect_uris) ? r.redirect_uris : JSON.parse(r.redirect_uris),
      created_at: Number(r.created_at),
    } as OAuthClient;
  }
  async putPending(state: string, p: PendingAuth) {
    await this.pool.query(
      `INSERT INTO oauth_pending (state, client_id, redirect_uri, code_challenge, client_state, scope, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [state, p.client_id, p.redirect_uri, p.code_challenge, p.state ?? null, p.scope ?? null, p.expiresAt]
    );
  }
  async takePending(state: string) {
    const { rows } = await this.pool.query(
      `DELETE FROM oauth_pending WHERE state=$1 RETURNING client_id, redirect_uri, code_challenge, client_state, scope, expires_at`,
      [state]
    );
    const r = rows[0];
    if (!r || Number(r.expires_at) < now()) return undefined;
    return {
      client_id: r.client_id,
      redirect_uri: r.redirect_uri,
      code_challenge: r.code_challenge,
      state: r.client_state ?? undefined,
      scope: r.scope ?? undefined,
      expiresAt: Number(r.expires_at),
    } as PendingAuth;
  }
  async putCode(code: string, c: AuthCode) {
    await this.pool.query(
      `INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, scope, ljwt, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [code, c.client_id, c.redirect_uri, c.code_challenge, c.scope ?? null, c.ljwt, c.expiresAt]
    );
  }
  async takeCode(code: string) {
    const { rows } = await this.pool.query(
      `DELETE FROM oauth_codes WHERE code=$1 RETURNING client_id, redirect_uri, code_challenge, scope, ljwt, expires_at`,
      [code]
    );
    const r = rows[0];
    if (!r || Number(r.expires_at) < now()) return undefined;
    return {
      client_id: r.client_id,
      redirect_uri: r.redirect_uri,
      code_challenge: r.code_challenge,
      scope: r.scope ?? undefined,
      ljwt: r.ljwt,
      expiresAt: Number(r.expires_at),
    } as AuthCode;
  }
  async putAccess(t: string, a: AccessToken) {
    await this.pool.query(
      `INSERT INTO oauth_access_tokens (token, ljwt, scope, expires_at) VALUES ($1,$2,$3,$4)`,
      [t, a.ljwt, a.scope ?? null, a.expiresAt]
    );
  }
  async getAccess(t: string) {
    const { rows } = await this.pool.query(
      `SELECT ljwt, scope, expires_at FROM oauth_access_tokens WHERE token=$1`,
      [t]
    );
    const r = rows[0];
    if (!r) return undefined;
    if (Number(r.expires_at) < now()) {
      await this.pool.query(`DELETE FROM oauth_access_tokens WHERE token=$1`, [t]);
      return undefined;
    }
    return { ljwt: r.ljwt, scope: r.scope ?? undefined, expiresAt: Number(r.expires_at) } as AccessToken;
  }
  async putRefresh(t: string, r: RefreshToken) {
    await this.pool.query(
      `INSERT INTO oauth_refresh_tokens (token, ljwt, client_id, scope, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [t, r.ljwt, r.client_id, r.scope ?? null, r.expiresAt]
    );
  }
  async takeRefresh(t: string) {
    const { rows } = await this.pool.query(
      `DELETE FROM oauth_refresh_tokens WHERE token=$1 RETURNING ljwt, client_id, scope, expires_at`,
      [t]
    );
    const r = rows[0];
    if (!r || Number(r.expires_at) < now()) return undefined;
    return {
      ljwt: r.ljwt,
      client_id: r.client_id,
      scope: r.scope ?? undefined,
      expiresAt: Number(r.expires_at),
    } as RefreshToken;
  }
  async revoke(t: string) {
    await this.pool.query(`DELETE FROM oauth_access_tokens WHERE token=$1`, [t]);
    await this.pool.query(`DELETE FROM oauth_refresh_tokens WHERE token=$1`, [t]);
  }
}

// ---- Backend selection (memoized) -----------------------------------------
const memoryStore = new MemoryStore();
let storePromise: Promise<OAuthStore> | undefined;

/** Resolve the active store ONCE: Postgres if configured + schema ready, else memory. */
function getStore(): Promise<OAuthStore> {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    const pool = getPg();
    if (pool && (await ensureOAuthSchema(pool))) return new PgStore(pool);
    return memoryStore;
  })().catch((e) => {
    console.error("[oauth] store init failed, using in-memory:", e?.message ?? e);
    return memoryStore;
  });
  return storePromise;
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

export async function registerClient(body: RegisterRequest): Promise<RegisterResult> {
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
  (await getStore()).putClient(client).catch((e) => console.error("[oauth] putClient:", e?.message ?? e));
  return { ok: true, client };
}

export async function getClient(clientId: string | undefined | null): Promise<OAuthClient | undefined> {
  if (!clientId) return undefined;
  return (await getStore()).getClient(clientId);
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
export async function startAuthorize(p: StartAuthorizeParams): Promise<StartAuthorizeResult> {
  const store = await getStore();
  const client = p.client_id ? await store.getClient(p.client_id) : undefined;
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
  await store.putPending(internalState, {
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
export async function completeAuthorize(
  internalState: string | undefined | null,
  ljwt: string | undefined | null
): Promise<CompleteAuthorizeResult> {
  const store = await getStore();
  const p = internalState ? await store.takePending(internalState) : undefined;
  if (!p) {
    return { ok: false, error: "invalid_request", error_description: "Authorization session expired or unknown — restart the connection." };
  }
  if (!ljwt) {
    return { ok: false, error: "access_denied", error_description: "No Webcake token returned from login." };
  }
  const code = token(32);
  await store.putCode(code, {
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

async function issueTokens(
  store: OAuthStore,
  ljwt: string,
  client_id: string,
  scope: string | undefined
): Promise<TokenSuccess> {
  const access = token(32);
  const refresh = token(32);
  await store.putAccess(access, { ljwt, scope, expiresAt: now() + ACCESS_TTL });
  await store.putRefresh(refresh, { ljwt, client_id, scope, expiresAt: now() + REFRESH_TTL });
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL / 1000), refresh_token: refresh, scope };
}

export async function exchangeToken(p: TokenParams): Promise<TokenResult> {
  const store = await getStore();
  if (p.grant_type === "authorization_code") {
    const c = p.code ? await store.takeCode(p.code) : undefined; // one-time use
    if (!c) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "Unknown or expired authorization code." };
    }
    if (c.client_id !== p.client_id) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "client_id does not match the authorization code." };
    }
    if (c.redirect_uri !== p.redirect_uri) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "redirect_uri does not match the authorization request." };
    }
    if (!p.code_verifier || !verifyPkce(p.code_verifier, c.code_challenge)) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "PKCE verification failed." };
    }
    return { ok: true, body: await issueTokens(store, c.ljwt, c.client_id, c.scope) };
  }
  if (p.grant_type === "refresh_token") {
    const r = p.refresh_token ? await store.takeRefresh(p.refresh_token) : undefined; // rotate
    if (!r) {
      return { ok: false, status: 400, error: "invalid_grant", error_description: "Unknown or expired refresh token." };
    }
    return { ok: true, body: await issueTokens(store, r.ljwt, r.client_id, r.scope) };
  }
  return { ok: false, status: 400, error: "unsupported_grant_type", error_description: "grant_type must be authorization_code or refresh_token." };
}

// ---- Resource-server side: resolve a Bearer access token to its ljwt -------
/** Returns the user's ljwt for a valid, unexpired access token, else undefined. */
export async function resolveAccessToken(accessToken: string | undefined | null): Promise<string | undefined> {
  if (!accessToken) return undefined;
  const a = await (await getStore()).getAccess(accessToken);
  return a?.ljwt;
}

/** Revoke an access or refresh token (best-effort; for /revoke). */
export async function revokeToken(t: string | undefined | null): Promise<void> {
  if (!t) return;
  await (await getStore()).revoke(t);
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
