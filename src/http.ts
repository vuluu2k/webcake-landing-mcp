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
import { searchPexels, resolvePexelsKey, type PexelsSearchParams } from "./persistence/pexels-client.js";

const MCP_PATH = "/mcp";
const IMAGES_PATH = "/api/images/search";

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

    if (path !== MCP_PATH) return rpcError(res, 404, `Not found. Send MCP requests to ${MCP_PATH}.`);

    // Accept credentials via ?jwt=/?api_base=/... (for clients that can't set headers).
    applyQueryAuth(req);

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
          const server = createServer();
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
