# Configuration — environments, tokens & `login`

**English** · [Tiếng Việt](./configuration.vi.md) · back to the [README](../README.md)

How the server finds your WebCake backend and account token. Credentials resolve in order:
**per-request header → env var → saved `auth.json`** (written by `login`). Only the
**persistence tools** (`create_page`, `update_page`, …) need any of this — the reference,
generation, media, and ingest tools run with zero config.

---

## Connect once — grab your token automatically (`login`)

Instead of copying a JWT by hand, run:

```bash
# Production — zero config (defaults: connect via webcake.io, API via api.webcake.io):
npx -y webcake-landing-mcp login

# Local dev / staging — pick a named environment (see Environments below):
node dist/index.js login --env local      # SPA :5173 + API :5800
node dist/index.js login --env staging    # staging.webcake.io + api.staging.webcake.io

# …or point at custom URLs explicitly (these override --env):
node dist/index.js login \
  --connect-url http://localhost:5173/mcp-connect \
  --api-base http://localhost:5800
```

It opens your browser → (log into Webcake if needed) → the token is saved to
`~/.webcake-landing-mcp/auth.json`, which the server then reads automatically.

You're already logged in to Webcake in your browser, so `login` just opens a Webcake "connect"
page that reads your **`ljwt`** (landing) cookie and hands the token back to a localhost callback —
no copy-paste. The saved token is then read automatically (env vars still take precedence).
The landing JWT lasts ~90 days, so you rarely reconnect.

Two URLs, don't mix them up:

- **Connect page = the SPA** (`--connect-url`): derived from the `--env` app base + `/mcp-connect`
  (`https://webcake.io/mcp-connect` for prod, `http://localhost:5173/mcp-connect` for local). Override with `--connect-url`.
- **API base = the backend** (`--api-base` / `WEBCAKE_API_BASE`): `https://api.webcake.io` in prod,
  `http://localhost:5800` locally. Defaults to `https://api.webcake.io`.

Other flags: `--org-id`, `--port`, `--no-open`. Saved-file dir: `WEBCAKE_CONFIG_DIR` (default
`~/.webcake-landing-mcp`).

**Backend endpoint to add** (in your Webcake backend — it owns the session cookie):

```
GET /mcp-connect?redirect_uri=<loopback>&state=<s>
   → read the `ljwt` cookie (the logged-in user's landing token)
   → 302 to  <redirect_uri>?token=<ljwt>&state=<s>
   (if there's no cookie: 302 to the login page first, then back here)
```

For safety, only honor `redirect_uri` values on `http://127.0.0.1:*` / `http://localhost:*`.
(Reference implementation: `builderx_spa/src/views/McpConnect.vue` reads `cookies.get('ljwt')` — so this
flow can also be done entirely in the SPA, no backend route needed.)

> Multi-user remote (the claude.ai connector dialog) can't do this browser loopback — there each
> user sends their own token via the `x-webcake-jwt` header (see [Per-request headers](#per-request-headers-hosted--remote-server) below).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBCAKE_ENV` | No | Named environment: `local` \| `staging` \| `prod`. Fills in `WEBCAKE_API_BASE` + `WEBCAKE_APP_BASE` from a preset (see table below). Also settable with the `--env <name>` flag. Explicit vars win. |
| `WEBCAKE_API_BASE` | No* | Backend base URL, e.g. `http://localhost:5800`. Required to persist (or set `WEBCAKE_ENV`). |
| `WEBCAKE_JWT` | No* | Account JWT (dashboard auth). Required to persist — expires, refresh when needed. |
| `WEBCAKE_ORG_ID` | No | Default organization id for `create_page` (overridden by its `organization_id` arg). Omit → personal page. |
| `WEBCAKE_APP_BASE` | No | Optional SPA base — used for the browser `login` connect page. |
| `WEBCAKE_BUILDER_BASE` | No | Optional builder host for the editor links in the result. Defaults to the env preset, else derived from the API host (`api.x`→`builder.x`). |
| `WEBCAKE_PREVIEW_BASE` | No | Optional public preview host for the `/preview/<id>` links — NOT the builder subdomain. Defaults to the env preset (`preview.localhost:5800` local / `staging.webcake.me` staging / `www.webcake.me` prod). |
| `WEBCAKE_CONFIG_DIR` | No | Dir for the saved `auth.json` written by `login` (default `~/.webcake-landing-mcp`). |

> \* `WEBCAKE_API_BASE` and `WEBCAKE_JWT` are only needed for the persistence tools. The reference and
> validation tools (`get_generation_guide`, `list_elements`, `get_element`, `validate_page`, …) work without them.

> Persisting writes a real page to whatever `WEBCAKE_API_BASE` points at, using the JWT as that account.
> Start against local/staging.

## Environments (`--env` / `WEBCAKE_ENV`)

Instead of setting both base URLs by hand, pick a named environment — one source of
truth for the API + app bases:

| `--env` / `WEBCAKE_ENV` | API base (`WEBCAKE_API_BASE`) | App base (`WEBCAKE_APP_BASE`) | Builder base (`WEBCAKE_BUILDER_BASE`) |
|-------------------------|-------------------------------|-------------------------------|----------------------------------------|
| `local` | `http://localhost:5800` | `http://localhost:5173` | `http://builder.localhost:5800` |
| `staging` | `https://api.staging.webcake.io` | `https://staging.webcake.io` | `https://builder.staging.webcake.io` |
| `prod` *(default)* | `https://api.webcake.io` | `https://webcake.io` | `https://builder.webcake.io` |

> The **editor/preview link** returned after `create_page`/`update_page` opens on the **builder host** (above), not the API or SPA base.

```bash
npx -y webcake-landing-mcp login --env local       # connect against your local SPA + API
WEBCAKE_ENV=staging npx -y webcake-landing-mcp      # run against the staging backend
WEBCAKE_ENV=prod npx -y webcake-landing-mcp         # prod (env var form)
```

Explicit `WEBCAKE_API_BASE` / `WEBCAKE_APP_BASE` (or `--api-base`) still override the preset, field
by field. On the hosted server you can override the environment per request with the
**`x-webcake-env`** header or **`?env=`** query (e.g. `…/mcp?jwt=<token>&env=staging`).

## How to get `WEBCAKE_JWT`

1. Open the WebCake builder dashboard and log in
2. Open DevTools (`F12` or `Cmd + Option + I`)
3. Go to the **Network** tab > click any page
4. Find an API request (e.g. `@me`, `organizations`…)
5. In **Request Headers**, copy the value after `Authorization: Bearer ` → this is your `WEBCAKE_JWT`
6. Use the `list_organizations` tool to list orgs and pick `WEBCAKE_ORG_ID`

## Per-request headers (hosted / remote server)

Clients that support headers should send the token as a header instead of putting it in the URL (so it never
lands in logs). Any header that's missing falls back to the matching env var:

| Header | Maps to | Notes |
|--------|---------|-------|
| `x-webcake-jwt` (or `Authorization: Bearer <jwt>`) | `WEBCAKE_JWT` | the account token — sent per request |
| `x-webcake-env` | `WEBCAKE_ENV` | named environment (`local`/`staging`/`prod`) |
| `x-webcake-org-id` | `WEBCAKE_ORG_ID` | default org |
| `x-webcake-api-base` | `WEBCAKE_API_BASE` | overrides the env preset's API base |
| `x-webcake-app-base` | `WEBCAKE_APP_BASE` | overrides the env preset's SPA base (login connect page) |
| `x-webcake-builder-base` | `WEBCAKE_BUILDER_BASE` | overrides the builder host used for editor links |
| `x-webcake-preview-base` | `WEBCAKE_PREVIEW_BASE` | overrides the public preview host used for `/preview/<id>` links |

> The reference + generation tools (`get_generation_guide`, `list_elements`, `validate_page`, …) need **no
> token** — only the persistence tools (`create_page`, `update_page`, …) use it. Without a JWT, those return
> `missing_env` instead of touching the network.

> 📖 Connecting an IDE or claude.ai to the hosted server, step by step → **[docs/connect-mcp.md](./connect-mcp.md)**.
