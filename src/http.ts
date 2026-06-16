/**
 * Remote transport: a Streamable-HTTP server so the MCP can be added as a Claude
 * "custom connector" via a public URL — alongside the stdio mode in index.ts.
 *
 * Stateful sessions: an `initialize` POST (no session id) spins up a fresh
 * McpServer + transport and returns an `mcp-session-id`; later requests reuse it
 * via that header. Each request carries the caller's OWN Webcake JWT — via a header
 * (x-webcake-jwt / Authorization) OR a URL query param (.../mcp?jwt=<token>, for
 * clients like the claude.ai dialog that can't set headers; see applyQueryAuth +
 * persistence/config.ts#configFromHeaders). So a hosted server is multi-user.
 *
 * All logging stays on stderr (console.error), same as stdio mode.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { ICON_SVG, ICON_MIME } from "./branding.js";
import { guideHtml, ogImageSvg, normalizeLang } from "./web-guide.js";
import { privacyHtml, termsHtml } from "./legal.js";
import { searchPexels, resolvePexelsKey, type PexelsSearchParams } from "./persistence/pexels-client.js";
import { captureWithPlaywright, isAllowedScreenshotUrl } from "./persistence/screenshot-playwright.js";
import { resolveEnv, ENVIRONMENTS, stripTrailingSlash } from "./persistence/config.js";
import { buildConnectUrl } from "./auth/login.js";
import {
  registerClient,
  startAuthorize,
  completeAuthorize,
  exchangeToken,
  resolveAccessToken,
  revokeToken,
  authServerMetadata,
  protectedResourceMetadata,
  type TokenParams,
} from "./auth/oauth-server.js";

const MCP_PATH = "/mcp";
const IMAGES_PATH = "/api/images/search";
const RENDER_SCREENSHOT_PATH = "/api/render/screenshot";

// OAuth 2.1 endpoints (the embedded thin Authorization Server — see auth/oauth-server.ts).
const WELL_KNOWN_PR = "/.well-known/oauth-protected-resource";
const WELL_KNOWN_AS = "/.well-known/oauth-authorization-server";
const OAUTH_REGISTER = "/register";
const OAUTH_AUTHORIZE = "/authorize";
const OAUTH_CALLBACK = "/oauth/callback"; // where /mcp-connect bounces the user's ljwt back
const OAUTH_TOKEN = "/token";
const OAUTH_REVOKE = "/revoke";

// OAuth enforcement is ON by default so an OAuth-capable client (Claude/ChatGPT/
// MCP Inspector) gets the 401 + WWW-Authenticate it needs to START the OAuth flow.
// ALL credential types still pass straight through (?jwt= / x-webcake-jwt / a raw
// Bearer JWT / an OAuth access token) — only a request with NO credential at all is
// challenged. Opt OUT (allow anonymous /mcp, the old Level-A behavior) with
// WEBCAKE_OAUTH=0 (or false/no/off). The well-known + /register + /authorize +
// /token routes are always served regardless.
const OAUTH_ENFORCED = !/^(0|false|no|off)$/i.test(process.env.WEBCAKE_OAUTH ?? "");

// Social/search crawlers (Facebook, Zalo, Twitter/X, LinkedIn, Slack, Telegram,
// WhatsApp, Discord, Google, Bing…) fetch the root with `Accept: */*` rather than
// `text/html`, so they'd otherwise get the JSON health blob and never see the OG
// tags — links wouldn't unfurl and Facebook's debugger reports a missing og:image.
// Detect them by User-Agent so they get the full HTML <head>. (Programmatic MCP /
// healthcheck probes also send `*/*` but don't match, so they still get JSON.)
const BOT_UA =
  /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|slack-imgproxy|telegrambot|whatsapp|discordbot|pinterest|redditbot|googlebot|bingbot|applebot|yandexbot|baiduspider|embedly|quora link preview|outbrain|vkshare|w3c_validator|skypeuripreview|zalo/i;

// The raster social card (1200x630), pre-rendered and committed at src/og.png,
// mirrored to dist/og.png by copy-assets. Served at GET /og.png as the og:image —
// SVG OG images don't unfurl on Facebook/X/LinkedIn/Zalo. Read once, lazily.
let OG_PNG: Buffer | null = null;
function ogImagePng(): Buffer | null {
  if (OG_PNG) return OG_PNG;
  try {
    OG_PNG = readFileSync(new URL("./og.png", import.meta.url));
    return OG_PNG;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
}

// Map credentials passed in the URL query (e.g. .../mcp?jwt=<token>) onto the
// x-webcake-* headers so the normal per-request config path handles them. This is
// for clients that can't set custom headers — notably the claude.ai connector
// dialog, which only takes a URL. An explicit header always wins over the query.
// SECURITY: a token in the URL can land in access/proxy logs — prefer headers,
// require HTTPS, and disable query-string logging on your reverse proxy.
const QUERY_AUTH: Record<string, string> = {
  jwt: "x-webcake-jwt",
  env: "x-webcake-env",
  api_base: "x-webcake-api-base",
  org_id: "x-webcake-org-id",
  app_base: "x-webcake-app-base",
  builder_base: "x-webcake-builder-base",
};

function applyQueryAuth(req: IncomingMessage) {
  const q = (req.url ?? "").indexOf("?");
  if (q === -1) return;
  const params = new URLSearchParams((req.url ?? "").slice(q + 1));
  for (const [param, header] of Object.entries(QUERY_AUTH)) {
    const value = params.get(param);
    // Only fill in when there's no explicit header (header wins). The transport
    // builds its Request from `req.rawHeaders` (via @hono/node-server), so we MUST
    // push there — mutating `req.headers` alone is not seen by the tool handlers.
    if (value && req.headers[header] == null) {
      req.headers[header] = value;
      req.rawHeaders.push(header, value);
    }
  }
}

// The public origin of THIS server, honoring the reverse proxy (Coolify/Traefik/
// Cloudflare) so the OAuth metadata + redirect URIs are the externally-reachable
// URL, not localhost. Mirrors the logic used for the OG/landing page.
function publicBase(req: IncomingMessage): string {
  const fwdHost = req.headers["x-forwarded-host"];
  const host = (Array.isArray(fwdHost) ? fwdHost[0] : fwdHost) || req.headers.host || "localhost";
  const fwdProto = req.headers["x-forwarded-proto"];
  // Honor the reverse proxy's scheme; otherwise default to http for loopback hosts
  // (local testing) and https everywhere else (a public deploy is behind TLS).
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto)?.split(",")[0] || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

// The browser login page that returns the user's landing JWT (`ljwt`) — the SPA's
// /mcp-connect (see auth/login.ts). Resolved from the same env preset the rest of
// the server uses: explicit WEBCAKE_APP_BASE wins, else the --env/WEBCAKE_ENV preset,
// else prod. This is the consent step the OAuth /authorize flow delegates to.
function connectPageUrl(): string {
  const preset = resolveEnv(process.env.WEBCAKE_ENV) ?? ENVIRONMENTS.prod;
  const appBase = stripTrailingSlash(process.env.WEBCAKE_APP_BASE || preset.appBase)!;
  return `${appBase}/mcp-connect`;
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** Parse a request body that may be JSON or application/x-www-form-urlencoded. */
function parseBodyParams(raw: string, contentType: string): Record<string, string> {
  if (!raw) return {};
  if (contentType.includes("application/json")) {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? (o as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

function oauthError(res: ServerResponse, status: number, error: string, description: string) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error, error_description: description }));
}

function htmlError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;max-width:520px;margin:auto"><h2>Webcake connector</h2><p>${message}</p></body>`);
}

/**
 * Handle every OAuth 2.1 endpoint. Returns true when the request was an OAuth
 * route (and a response was sent), false to let the caller continue routing.
 */
async function handleOAuth(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const issuer = publicBase(req);

  // ---- Metadata (RFC 8414 / RFC 9728) ----
  if (req.method === "GET" && path === WELL_KNOWN_PR) {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(protectedResourceMetadata(`${issuer}${MCP_PATH}`, issuer)));
    return true;
  }
  if (req.method === "GET" && path === WELL_KNOWN_AS) {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(authServerMetadata(issuer)));
    return true;
  }

  // ---- Dynamic Client Registration ----
  if (path === OAUTH_REGISTER) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST,OPTIONS" });
      return res.end(), true;
    }
    if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "Use POST."), true;
    const raw = await readRawBody(req);
    const body = parseBodyParams(raw, String(req.headers["content-type"] ?? ""));
    const result = await registerClient(body);
    if (!result.ok) return oauthError(res, 400, result.error, result.error_description), true;
    res.writeHead(201, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end(
      JSON.stringify({
        client_id: result.client.client_id,
        client_id_issued_at: Math.floor(result.client.created_at / 1000),
        redirect_uris: result.client.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      })
    );
    return true;
  }

  // ---- Authorize: validate + delegate to the SPA login, parking the request ----
  if (req.method === "GET" && path === OAUTH_AUTHORIZE) {
    const sp = new URL(req.url ?? "/", "http://x").searchParams;
    const result = await startAuthorize({
      client_id: sp.get("client_id"),
      redirect_uri: sp.get("redirect_uri"),
      response_type: sp.get("response_type"),
      code_challenge: sp.get("code_challenge"),
      code_challenge_method: sp.get("code_challenge_method"),
      state: sp.get("state"),
      scope: sp.get("scope"),
    });
    if (!result.ok) {
      // Safe to bounce the error to the client only when redirect_uri is trusted.
      if (result.redirectable) {
        const r = new URL(sp.get("redirect_uri")!);
        r.searchParams.set("error", result.error);
        r.searchParams.set("error_description", result.error_description);
        const st = sp.get("state");
        if (st) r.searchParams.set("state", st);
        res.writeHead(302, { location: r.toString() });
        return res.end(), true;
      }
      return htmlError(res, 400, result.error_description), true;
    }
    // Send the user to the SPA login; it returns here with ?token=<ljwt>&state=<internalState>.
    const callback = `${issuer}${OAUTH_CALLBACK}`;
    const loginUrl = buildConnectUrl(connectPageUrl(), callback, result.internalState);
    res.writeHead(302, { location: loginUrl });
    return res.end(), true;
  }

  // ---- Login callback: the SPA handed back the user's ljwt → mint a code ----
  if (req.method === "GET" && path === OAUTH_CALLBACK) {
    const sp = new URL(req.url ?? "/", "http://x").searchParams;
    const done = await completeAuthorize(sp.get("state"), sp.get("token"));
    if (!done.ok) return htmlError(res, 400, done.error_description), true;
    const r = new URL(done.redirectUri);
    r.searchParams.set("code", done.code);
    if (done.state) r.searchParams.set("state", done.state);
    res.writeHead(302, { location: r.toString() });
    return res.end(), true;
  }

  // ---- Token ----
  if (path === OAUTH_TOKEN) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST,OPTIONS" });
      return res.end(), true;
    }
    if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "Use POST."), true;
    const raw = await readRawBody(req);
    const body = parseBodyParams(raw, String(req.headers["content-type"] ?? "")) as TokenParams;
    const result = await exchangeToken(body);
    if (!result.ok) return oauthError(res, result.status, result.error, result.error_description), true;
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end(JSON.stringify(result.body));
    return true;
  }

  // ---- Revoke (RFC 7009, best-effort) ----
  if (path === OAUTH_REVOKE) {
    if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "Use POST."), true;
    const raw = await readRawBody(req);
    const body = parseBodyParams(raw, String(req.headers["content-type"] ?? ""));
    await revokeToken(body.token);
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end("{}");
    return true;
  }

  return false;
}

/** Extract the Bearer token from the Authorization header, if any. */
function bearerFrom(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  const v = Array.isArray(auth) ? auth[0] : auth;
  if (!v || !/^Bearer\s+/i.test(v)) return undefined;
  return v.replace(/^Bearer\s+/i, "").trim() || undefined;
}

/**
 * Shared image proxy: GET /api/images/search?query=…&per_page=…&orientation=…
 * Holds the server's own PEXELS_API_KEY (from env/.env) and returns the normalized
 * search result, so `npx` clients without a key get images via this host. CORS is
 * permissive so a browser can call it too; the key is never sent to the client.
 */
async function handleImageSearch(req: IncomingMessage, res: ServerResponse) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  const sendImgJson = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify(body));
  };
  const key = resolvePexelsKey();
  if (!key) {
    return sendImgJson(503, { ok: false, reason: "proxy_no_key", error: "Image proxy has no PEXELS_API_KEY configured." });
  }
  const sp = new URL(req.url ?? "/", "http://x").searchParams;
  const query = sp.get("query")?.trim();
  if (!query) {
    return sendImgJson(400, { ok: false, reason: "missing_query", error: "Pass ?query=<subject>." });
  }
  const params: PexelsSearchParams = {
    query,
    perPage: sp.get("per_page") ? Number(sp.get("per_page")) : undefined,
    page: sp.get("page") ? Number(sp.get("page")) : undefined,
    orientation: (sp.get("orientation") as PexelsSearchParams["orientation"]) ?? undefined,
    size: (sp.get("size") as PexelsSearchParams["size"]) ?? undefined,
    color: sp.get("color") ?? undefined,
  };
  const result = await searchPexels(key, params);
  return sendImgJson(result.ok ? 200 : result.status || 502, result);
}

/**
 * Self-hosted screenshot route: GET /api/render/screenshot?url=…&full_page=…&width=…
 * Renders the target URL with Playwright (this VPS's own headless Chromium) and
 * returns the PNG bytes — the UNLIMITED engine `render_preview` falls over to when
 * Microlink's free quota is hit (point RENDER_SCREENSHOT_BASE at this host). Returns
 * 503 when Playwright isn't installed here. Blocks private/loopback targets (SSRF).
 */
async function handleRenderScreenshot(req: IncomingMessage, res: ServerResponse) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  const sendErr = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify(body));
  };
  const sp = new URL(req.url ?? "/", "http://x").searchParams;
  const target = sp.get("url")?.trim();
  if (!target) return sendErr(400, { ok: false, error: "Pass ?url=<public http(s) URL>." });
  const allow = isAllowedScreenshotUrl(target);
  if (!allow.ok) return sendErr(400, { ok: false, error: allow.error });

  const fullPage = sp.get("full_page") !== "false";
  const width = sp.get("width") ? Number(sp.get("width")) : undefined;
  const r = await captureWithPlaywright(target, { fullPage, width });
  if (!r.ok) {
    // 503 when the engine is absent (caller should fall back / skip), 502 otherwise.
    return sendErr(r.reason === "not_installed" ? 503 : 502, { ok: false, error: r.error });
  }
  res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store", ...cors });
  return res.end(r.png);
}

export async function startHttpServer(port: number): Promise<void> {
  // mcp-session-id -> live transport (each bound to its own McpServer instance).
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];

    // Brand icon — clients (e.g. the claude.ai connector) fetch a favicon from the
    // server origin; without one they show a generic globe. Served raw as SVG.
    if (req.method === "GET" && (path === "/favicon.ico" || path === "/favicon.svg" || path === "/icon.svg")) {
      res.writeHead(200, { "content-type": ICON_MIME, "cache-control": "public, max-age=86400" });
      return res.end(ICON_SVG);
    }

    // Social-card image referenced by the landing page's og:image / twitter:image.
    // PNG is the canonical og:image (unfurls everywhere); the SVG stays for clients
    // that prefer it (Slack/Telegram/Discord) and as a fallback if og.png is absent.
    if (req.method === "GET" && path === "/og.png") {
      const png = ogImagePng();
      if (png) {
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        return res.end(png);
      }
      // Fall back to the SVG card if the raster asset didn't ship.
      res.writeHead(200, { "content-type": ICON_MIME, "cache-control": "public, max-age=86400" });
      return res.end(ogImageSvg());
    }
    if (req.method === "GET" && path === "/og.svg") {
      res.writeHead(200, { "content-type": ICON_MIME, "cache-control": "public, max-age=86400" });
      return res.end(ogImageSvg());
    }

    // Public legal pages — required URLs for the Claude/ChatGPT directory submission.
    if (req.method === "GET" && (path === "/privacy" || path === "/privacy-policy")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
      return res.end(privacyHtml());
    }
    if (req.method === "GET" && (path === "/terms" || path === "/tos")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
      return res.end(termsHtml());
    }

    // Lightweight health check for hosting platforms.
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      // A browser/connector probing the root with `Accept: text/html` gets a tiny
      // page that links the favicon (helps icon discovery); programmatic probes
      // (the container healthcheck uses `Accept: */*`) still get the JSON health.
      const accept = String(req.headers["accept"] ?? "");
      const ua = String(req.headers["user-agent"] ?? "");
      if (path === "/" && (accept.includes("text/html") || BOT_UA.test(ua))) {
        // Public base URL, honoring the reverse proxy (Coolify/Traefik/Cloudflare).
        const fwdHost = req.headers["x-forwarded-host"];
        const host = (Array.isArray(fwdHost) ? fwdHost[0] : fwdHost) || req.headers.host || "localhost";
        const fwdProto = req.headers["x-forwarded-proto"];
        const proto = (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto)?.split(",")[0] || "https";
        // `?lang=en` switches the page language; anything else falls back to vi.
        const lang = normalizeLang(new URL(req.url ?? "/", "http://x").searchParams.get("lang"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(guideHtml(`${proto}://${host}`, lang));
      }
      return sendJson(res, 200, { ok: true, server: "webcake-landing", transport: "streamable-http", endpoint: MCP_PATH });
    }

    // Shared image proxy (for `npx` clients without their own Pexels key).
    if (path === IMAGES_PATH) return handleImageSearch(req, res);

    // Self-hosted screenshot engine (Playwright) — the unlimited fallback for render_preview.
    if (path === RENDER_SCREENSHOT_PATH) return handleRenderScreenshot(req, res);

    // OAuth 2.1 endpoints (always served; see handleOAuth). Returns true if handled.
    if (await handleOAuth(req, res, path)) return;

    if (path !== MCP_PATH) return rpcError(res, 404, `Not found. Send MCP requests to ${MCP_PATH}.`);

    // Accept credentials via ?jwt=/?api_base=/... (for clients that can't set headers).
    applyQueryAuth(req);

    // OAuth access token → resolve to the user's landing JWT and inject it as the
    // normal x-webcake-jwt header, so persistence/config.ts is unchanged. A legacy
    // raw JWT sent via x-webcake-jwt / ?jwt= still wins and passes straight through.
    const bearer = bearerFrom(req);
    const oauthLjwt = await resolveAccessToken(bearer);
    if (oauthLjwt && req.headers["x-webcake-jwt"] == null) {
      req.headers["x-webcake-jwt"] = oauthLjwt;
      req.rawHeaders.push("x-webcake-jwt", oauthLjwt);
    }

    // Enforcement (WEBCAKE_OAUTH=1): a request with NO recognized credential gets a
    // 401 + WWW-Authenticate so Claude/ChatGPT kick off the OAuth flow. Legacy creds
    // (x-webcake-jwt header or ?jwt= → mapped above) still pass; in enforced mode a
    // raw JWT must use those, since Bearer is reserved for OAuth access tokens.
    if (OAUTH_ENFORCED && !oauthLjwt && req.headers["x-webcake-jwt"] == null) {
      res.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${publicBase(req)}${WELL_KNOWN_PR}"`,
        "content-type": "application/json",
      });
      return res.end(JSON.stringify({ error: "invalid_token", error_description: "Authentication required — connect via OAuth." }));
    }

    const sidHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sidHeader) ? sidHeader[0] : sidHeader;

    try {
      // Existing session: delegate any method (POST/GET/DELETE) to its transport.
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        const body = req.method === "POST" ? await readBody(req) : undefined;
        await transport.handleRequest(req, res, body);
        return;
      }

      // New session: only a POST `initialize` may open one.
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!sessionId && isInitializeRequest(body)) {
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
              transports.set(id, transport);
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
          const server = createServer({ allowLocalFiles: false });
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }
        return rpcError(res, 400, "Bad Request: no valid mcp-session-id (send an initialize request first).");
      }

      return rpcError(res, 400, "Bad Request: missing or unknown mcp-session-id.");
    } catch (err) {
      console.error("[webcake-http] request error:", err);
      if (!res.headersSent) rpcError(res, 500, "Internal server error.");
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  // stderr only.
  console.error(`[webcake-elements] MCP Streamable-HTTP server ready on http://localhost:${port}${MCP_PATH}`);
}
