/**
 * Remote transport: a Streamable-HTTP server so the MCP can be added as a Claude
 * "custom connector" via a public URL — alongside the stdio mode in index.ts.
 *
 * Stateful sessions: an `initialize` POST (no session id) spins up a fresh
 * McpServer + transport and returns an `mcp-session-id`; later requests reuse it
 * via that header. Every request's headers carry the caller's OWN Webcake JWT
 * (see persistence/config.ts#configFromHeaders), so a hosted server is multi-user
 * and never bakes a shared token into env.
 *
 * All logging stays on stderr (console.error), same as stdio mode.
 */
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";

const MCP_PATH = "/mcp";

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

export async function startHttpServer(port: number): Promise<void> {
  // mcp-session-id -> live transport (each bound to its own McpServer instance).
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];

    // Lightweight health check for hosting platforms.
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      return sendJson(res, 200, { ok: true, server: "webcake-landing", transport: "streamable-http", endpoint: MCP_PATH });
    }
    if (path !== MCP_PATH) return rpcError(res, 404, `Not found. Send MCP requests to ${MCP_PATH}.`);

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
