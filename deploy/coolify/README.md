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
| `GET /api/images/search` | shared Pexels proxy for `search_images` (holds the host's `PEXELS_API_KEY`) |
| `GET /api/render/screenshot` | self-hosted Playwright screenshot engine for `render_preview` (see [Screenshot engine](#screenshot-engine-render_preview)) |

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
   `https://mcp.example.com`). Coolify fills `SERVICE_FQDN_MCP` from it, and the
   explicit Traefik labels in the compose file route + TLS-terminate (Let's Encrypt)
   it on port **8787**, with an HTTP→HTTPS redirect.
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

## Screenshot engine (`render_preview`)

The `render_preview` tool screenshots a page so the model can SEE it and compare it
to a reference (the clone-fidelity check). It picks an engine in this order:

1. **Microlink** (`api.microlink.io`) — zero-config, but its free tier is rate-limited
   **per IP**, so on a shared multi-user host it's exhausted almost immediately.
2. **This host's own Playwright route** (`GET /api/render/screenshot`) — unlimited.

The image **bundles Playwright + Chromium** so the route works out of the box. The
compose file wires the fallover and lets you pick which engine goes **first** — the
other is the automatic fallback:

```yaml
RENDER_SCREENSHOT_BASE: http://127.0.0.1:8787   # the container calls its own route
RENDER_SCREENSHOT_PRIMARY: microlink            # Microlink first, Playwright fallback
```

- `microlink` (the compose default) — try Microlink first, fall back to this host's
  Playwright. Microlink's free tier is **per IP**, so on a shared multi-user host it
  exhausts fast and every call then wastes a `429` before falling to Playwright — set
  `MICROLINK_API_KEY` for a real quota if you keep this order.
- `proxy` — try this host's Playwright first (unlimited), Microlink as fallback. Best
  for a shared host; avoids the wasted Microlink attempt.

**Build arg — install or skip Playwright.** `ENABLE_PLAYWRIGHT` (default `1`) controls
whether the build installs Playwright + Chromium (~+350 MB image). To skip it (smaller
image, Microlink-only), set the build arg to `0` in Coolify → the service → **Build →
Build Arguments**, and remove the two `RENDER_SCREENSHOT_*` lines from the compose env.
`PLAYWRIGHT_VERSION` (default pinned) sets the Playwright release; its bundled Chromium
always matches it.

| Variable | Default | Notes |
|----------|---------|-------|
| `RENDER_SCREENSHOT_BASE` | `http://127.0.0.1:8787` | host serving `/api/render/screenshot`; the container points at itself |
| `RENDER_SCREENSHOT_PRIMARY` | `microlink` | `microlink` (Microlink first) or `proxy` (Playwright first) |
| `MICROLINK_API_KEY` | optional | raises the Microlink per-IP free quota |
| `RENDER_ALLOW_PRIVATE` | unset | allow screenshotting private/loopback targets (off by default; SSRF guard) |
| `RENDER_SCREENSHOT_FORMAT` | `jpeg` | `jpeg` (default, ~5–10× smaller) or `png` — the Playwright engine's output the model receives |
| `RENDER_SCREENSHOT_QUALITY` | `72` | JPEG quality 1–100 |
| `RENDER_SCREENSHOT_SCALE` | `1` | deviceScaleFactor (0<s≤2); `<1` renders fewer pixels for a smaller image |

Verify after deploy:
`curl -o /tmp/s.png "https://mcp.example.com/api/render/screenshot?url=https://example.com&full_page=true"`
→ a PNG (HTTP 200, `image/png`). A `503` means the image was built with `ENABLE_PLAYWRIGHT=0`.

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

The compose file attaches to Coolify's external `coolify` network and uses Traefik
labels, neither of which exist on a plain Docker host — so for a local smoke test,
build and run the image directly instead:

```bash
docker build -f deploy/coolify/Dockerfile -t webcake-mcp .
docker run --rm -p 8787:8787 webcake-mcp
curl http://localhost:8787/health      # → {"ok":true,...}
```

(Or create the network once — `docker network create coolify` — uncomment the
`ports:` block, then run from the repo root with the project directory pinned there
so the build `context: .` resolves correctly:
`docker compose --project-directory . -f deploy/coolify/docker-compose.yml up --build`.
The Traefik labels are simply ignored without a Traefik instance.)

## Updating

Push to the deployed branch → Coolify rebuilds and redeploys (enable auto-deploy /
webhooks in the resource settings). The `smoke` gate in the Dockerfile blocks a
broken build from shipping.
