# Deploy webcake-landing-mcp to Coolify

Run the MCP server as a **remote Streamable-HTTP** endpoint (a Claude "custom
connector") on your own [Coolify](https://coolify.io) instance. Build is straight
from this git repo — no npm publish required.

```
deploy/coolify/
├── Dockerfile              # multi-stage build → `node dist/index.js serve`
├── Dockerfile.dockerignore # trims the build context (BuildKit-scoped)
├── docker-compose.yml      # the Coolify resource (service `webcake-mcp`, port 8787)
├── .env.example            # optional server-wide Webcake defaults
└── README.md               # this file
```

## What gets deployed

`node dist/index.js serve` — the Streamable-HTTP transport from [`src/http.ts`](../../src/http.ts):

| Route | Purpose |
|-------|---------|
| `POST /mcp` | MCP endpoint (an `initialize` opens a session; reuse the returned `mcp-session-id`) |
| `GET /mcp` · `DELETE /mcp` | session stream / teardown |
| `GET /health` · `GET /` | health probe → `{ "ok": true, … }` (used by the container healthcheck) |

The server is **multi-user**: every request carries its own Webcake credentials, so
no secret is baked into the image (see [Authentication](#authentication)).

## Deploy steps

1. **Push this repo** to GitHub/GitLab (or use Coolify's private-repo / deploy-key flow).
2. In Coolify: **+ New → Docker Compose**, choose the repository, and set:
   - **Base Directory:** `/`
   - **Docker Compose Location:** `/deploy/coolify/docker-compose.yml`
3. **Deploy.** Coolify builds the Dockerfile (the offline `smoke` test gates the
   build — it must print `ALL GOOD`) and starts the `webcake-mcp` service.
4. Open the **`webcake-mcp` service → Domains**, add a domain (e.g.
   `https://mcp.example.com`), and confirm the port is **8787**. Coolify provisions
   the Traefik route + TLS automatically.
5. Verify: `curl https://mcp.example.com/health` → `{"ok":true,…}`.

Your MCP URL is **`https://mcp.example.com/mcp`**.

## Authentication

Persistence tools (`create_page`, `list_pages`, …) need a Webcake JWT + API base.
Reference/generation tools need nothing. Credentials resolve **per request** (see
[`src/persistence/config.ts`](../../src/persistence/config.ts)), so each client supplies its own:

- **Header (preferred):** `x-webcake-jwt: <token>` (or `Authorization: Bearer <token>`),
  plus optional `x-webcake-env`, `x-webcake-api-base`, `x-webcake-org-id`, `x-webcake-app-base`.
- **URL query (for clients that can't set headers, e.g. the claude.ai dialog):**
  `https://mcp.example.com/mcp?jwt=<token>&env=staging`.
  ⚠️ Tokens in URLs can land in proxy/access logs — require HTTPS and disable
  query-string logging on your proxy.

### Environments

`WEBCAKE_ENV` (or `--env`) picks the API + app base URLs by name — one source of truth
(see [`ENVIRONMENTS` in config.ts](../../src/persistence/config.ts)):

| `WEBCAKE_ENV` | API base (`WEBCAKE_API_BASE`) | App base (`WEBCAKE_APP_BASE`) |
|---------------|-------------------------------|-------------------------------|
| `local` | `http://localhost:5800` | `http://localhost:5173` |
| `staging` | `https://api.staging.webcake.io` | `https://staging.webcake.io` |
| `prod` *(default)* | `https://api.webcake.io` | `https://webcake.io` |

The `docker-compose.yml` sets `WEBCAKE_ENV: prod`. A client can override the server's
choice per request with the `x-webcake-env` header or `?env=` query (e.g. one user hits
staging while the server defaults to prod).

Set values in Coolify's **Environment Variables** UI (never commit secrets):

| Variable | Required? | Notes |
|----------|-----------|-------|
| `PORT` | preset `8787` | must match the service `expose` / domain port |
| `WEBCAKE_ENV` | preset `prod` | `local` \| `staging` \| `prod` — fills in both base URLs |
| `WEBCAKE_API_BASE` | optional | overrides the `WEBCAKE_ENV` API base |
| `WEBCAKE_APP_BASE` | optional | overrides the `WEBCAKE_ENV` app base (editor/preview links) |
| `WEBCAKE_ORG_ID` | optional | default organization for `create_page` |
| `WEBCAKE_JWT` | optional | **single-tenant only** — a shared server secret; omit for multi-user |

## Connect a client

**Claude (custom connector / MCP):** add the URL `https://mcp.example.com/mcp`
(append `?jwt=<token>` if the client can't send headers).

**`.mcp.json` (Claude Code, etc.):**

```json
{
  "mcpServers": {
    "webcake-landing": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "x-webcake-jwt": "<your-webcake-jwt>" }
    }
  }
}
```

## Test locally (without Coolify)

From the repo root, uncomment the `ports:` block in `docker-compose.yml`, then:

```bash
docker compose -f deploy/coolify/docker-compose.yml up --build
curl http://localhost:8787/health      # → {"ok":true,...}
```

## Updating

Push to the deployed branch → Coolify rebuilds and redeploys (enable auto-deploy /
webhooks in the resource settings). The `smoke` gate in the Dockerfile blocks a
broken build from shipping.
