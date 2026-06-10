# <img src="docs/assets/webcake-icon.svg" alt="Webcake" width="26" height="26" align="absmiddle"> WebCake Landing MCP

**English** · [Tiếng Việt](./README.vi.md)

[![npm version](https://img.shields.io/npm/v/webcake-landing-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/webcake-landing-mcp)
[![npm downloads](https://img.shields.io/npm/dm/webcake-landing-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/webcake-landing-mcp)
[![GitHub stars](https://img.shields.io/github/stars/vuluu2k/webcake-landing-mcp?style=social)](https://github.com/vuluu2k/webcake-landing-mcp/stargazers)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-server-6E56CF)](https://modelcontextprotocol.io)

> **Describe a landing page in plain words — your AI builds it, checks it, and ships it straight to WebCake.**

> ⭐ **If this saves you an afternoon of dragging boxes, [give it a star](https://github.com/vuluu2k/webcake-landing-mcp) — it's a one-dev project and every star keeps it alive.**

> *"Build a landing page for my coffee shop — a hero with a sign-up button, a 3-feature section, and a lead form. Save it to my workspace."*

…and a real, **editable** WebCake page appears in your account. No dragging boxes, no learning the schema, no hand-writing JSON.

---

## 🧩 How it works

This server is the **bridge** between your AI assistant and WebCake. The AI never *guesses* what a WebCake
page looks like — it asks this MCP, which knows the entire element model, validates the result, and saves it for you.

```text
   You              AI assistant            webcake-landing MCP            WebCake
  ┌──────┐  prompt  ┌────────────┐  tools  ┌──────────────────────┐  API  ┌──────────┐
  │ idea │ ───────► │  Claude /  │ ──────► │ • knows the element  │ ────► │  a real  │
  │      │          │  Cursor /  │         │   model + AI hints   │       │ editable │
  │      │ ◄─────── │  Windsurf  │ ◄────── │ • builds + validates │ ◄──── │  page in │
  └──────┘ page URL └────────────┘ result  │ • saves to your acct │       │  WebCake │
                                           └──────────────────────┘       └──────────┘
```

1. **You ask** in plain language — goal, brand, sections, CTA, form fields.
2. **The AI learns the model** from the MCP: the element catalog, the absolute-positioning canvas, the event vocabulary — so it builds a *real* WebCake page, not a guess.
3. **It assembles + validates** the full `{ page, popup, settings, options }` JSON. `validate_page` catches off-canvas boxes, dangling CTAs, and missing form fields **before** anything is saved.
4. **It persists** to your WebCake account — dry-run preview first, then for real.
5. **You get an editor link** — open it, tweak, publish. The AI did the heavy lifting.

### Why it's reliable

| | |
|---|---|
| 📚 **Knows the real model** | Serves WebCake's actual element catalog (40+ types — hero, form, countdown, gallery, product list…), each with its exact `specials` and AI hints, drawn straight from the editor's renderers. |
| ✅ **Validates before saving** | Structural + semantic checks (unique ids, on-canvas layout, working CTAs, unique form fields) so the page isn't broken when it lands. |
| 🛡️ **Safe by default** | Every write is **dry-run first** (preview the request, token masked) — nothing touches your account until you confirm. |
| ✏️ **Edits surgically** | Ask for one change ("make the CTA green") and it edits *only* that element — every other id, coordinate, and block stays exactly as it was. |

> 💡 **Lead-gen, events, invitations, app promos** — or **selling COD/online**? It speaks WebCake's commerce model too (product lists, variations, cart).

---

## ✨ What you can build

One sentence to your AI → a finished, **editable** WebCake page. A taste of what people ship with it:

| | Just say… |
|---|---|
| 🧲 **Lead-gen landing** | *"A SaaS waitlist page — hero, 3 benefits, an email-capture form."* |
| 🛒 **COD / online store** | *"A one-product page for my skincare serum — gallery, price, variations, an order form with cart."* |
| 🎟️ **Event / webinar** | *"A registration page for Saturday's webinar — countdown, agenda, sign-up form."* |
| 💌 **Invitation** | *"A wedding invite — names, date, a map, an RSVP form."* |
| 📱 **App promo** | *"A page for my fitness app — phone mockups, feature list, App Store + Google Play buttons."* |
| ⚡ **Flash sale** | *"A flash-sale page — big countdown, discounted product grid, a sticky Buy button."* |
| 🔗 **Link-in-bio** | *"A link-in-bio for my creator profile — avatar, short bio, 5 link buttons, socials."* |
| 🎉 **Product launch** | *"A launch page for v2 — hero, what's-new list, an early-access form."* |

…then **"make the CTA green"** or **"add a 4th feature"** and it edits *only* that block — every other id and coordinate stays exactly where it was.

> 🤖 Works in **Claude Desktop, Claude Code, Cursor, Windsurf, Augment, Codex**, or any MCP-capable client — and the **reference + generation tools need zero setup**, so you can try it before ever pasting a token.

---

## Under the hood

MCP (Model Context Protocol) server that teaches AI agents how to build a complete
**WebCake landing-page source JSON** from a requirement — and persist it to a WebCake backend.

It exposes the element catalog, per-element usage hints + `specials`, the full page JSON Schema,
valid element/page skeletons, a page validator, and tools to create or edit pages on the backend.
The AI agent produces the full `{ page, popup, settings, options, cartConfigs }` JSON; `create_page`
persists it (source-only — the page opens in the editor where re-saving renders it).

## Two ways to run

| Method | Best for | Auth |
|--------|----------|------|
| **npx (local)** — runs on your machine | Personal daily use, full control | browser `login`, a JWT, or none (reference tools) |
| **Hosted URL** — use our live server, nothing to install | No Node.js, teams, the claude.ai dialog | your personal `?jwt=` link / `x-webcake-jwt` header |

The **reference + generation tools** (`get_generation_guide`, `list_elements`, `validate_page`, …) and the **ingest tools** (`ingest_html`, `ingest_url` — turn an existing HTML or URL into a layout anchor so the AI can recreate or adapt it) work with **zero config**; only the **persistence tools** (`create_page`, `update_page`, `add_section`, `patch_page`, `publish_page`, `list_pages`, `find_pages`, `get_page`, `list_organizations`) need a token. Credentials resolve in order: **per-request header → env var → saved `auth.json`** (`login`).

> 🛠️ Prefer a shell-script installer (`install.sh`/`install.ps1`), a cloned local build, or hand-written per-IDE config? See **[docs/manual-install.md](docs/manual-install.md)**.

## 🚀 Get connected — the 2 main ways

Pick **one**. Both hand your AI tool (Claude, Cursor, …) the full Webcake landing toolkit. No coding.

### ① `npx` — runs on your machine (recommended for personal use)

Zero install, always the latest version. **One line** grabs your token *and* writes the IDE config:

```bash
npx -y webcake-landing-mcp install
```

Just want to run the server (configure by hand later)?

```bash
npx -y webcake-landing-mcp
```

✅ Best for: daily personal use, local development, full control. Needs Node.js 18+.

### ② Remote URL `…/mcp?jwt=` — hosted, nothing to install

Use the server we already host. Grab **your personal link** (your token is baked in) and paste it into your client's *Add custom connector* / config:

```
https://mcp.toolvn.io.vn/mcp?jwt=<YOUR_TOKEN>
```

Two ways to get the link:
- **Easiest** — open **<https://webcake.io/mcp-remote>** in your Webcake dashboard → it builds & copies the link for you.
- **By hand** — see the step-by-step guide below.

You can also add extra params: `&env=prod`, `&org_id=…`, `&api_base=…`.

✅ Best for: no Node.js, team/shared use, the **claude.ai** connector dialog (URL-only, no headers).
⚠️ The link contains your personal token — treat it like a password, always use **HTTPS**.

> 📖 **Full hand-config for every IDE** (Claude Desktop, Claude Code, Cursor, Windsurf, claude.ai…) is in the
> step-by-step guide → **[docs/connect-mcp.md](docs/connect-mcp.md)** · Tiếng Việt: **[docs/ket-noi-mcp.md](docs/ket-noi-mcp.md)**.

## Install (npx)

Once published to npm, the server runs straight from the registry — no clone, no build:

```bash
npx -y webcake-landing-mcp
```

Or run the latest from GitHub (npx clones + builds via the `prepare` script on the fly):

```bash
npx -y github:vuluu2k/webcake-landing-mcp
```

### Auto-configure your IDE (`install` subcommand)

`npx` only **runs** the server — unlike the [shell installers](docs/manual-install.md), it does not
write the MCP config into your IDE. The bundled `install` subcommand does that step for you, no clone needed:

```bash
# Interactive — pick environment, log in via browser (or paste a JWT), pick IDE(s)
npx -y webcake-landing-mcp install

# Non-interactive — configure every supported IDE at once (env + token via flags)
npx -y webcake-landing-mcp install --ide all --env prod --jwt <your-jwt>

# Local dev — point at your local stack (localhost:5800 / :5173)
npx -y webcake-landing-mcp install --ide cursor --env local --jwt <your-jwt>

# Remove the server from every IDE config
npx -y webcake-landing-mcp uninstall
```

It writes a `webcake-landing` entry (using the `npx` launch form below) into the right config file
for each target: `claude-desktop`, `claude-code`, `cursor`, `windsurf`, `augment` (VS Code), `codex`,
or `all`. Interactively it asks for the **environment** (`local`/`staging`/`prod`, which sets the API +
app URLs) and whether to **log in via the browser or paste a JWT**. Flags: `--ide`, `--env`, `--jwt`,
`--org-id`, `--api-base`/`--app-base` (advanced overrides), `--npx`/`--local`, `-y`. Run
`npx -y webcake-landing-mcp install --help` for the full list.

### Manual config

The MCP config is the same as the local one, but `command`/`args` point at `npx` instead of a built file:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "npx",
      "args": ["-y", "webcake-landing-mcp"],
      "env": {
        "WEBCAKE_ENV": "prod",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

> npx caches the package after the first run, so subsequent launches are fast. Use a pinned version
> (`webcake-landing-mcp@1.0.0`) if you need a reproducible build.

## Use the hosted server — nothing to install

It's **already live** at **`https://mcp.toolvn.io.vn/mcp`** — we run it for you. No server to set up, no
machine to keep awake. Just point your AI client at the URL and go.

**Grab your personal link** (your token is baked in) the easy way → open **<https://webcake.io/mcp-remote>**
and hit **Copy**:

```
https://mcp.toolvn.io.vn/mcp?jwt=<YOUR_TOKEN>
```

Optional extras: `&env=prod`, `&org_id=…`, `&api_base=…`. Hand each teammate a link with their own `jwt` →
per-user, no OAuth. ⚠️ The link carries your personal token — treat it like a password, always over **HTTPS**.

### Sending the token as a header (safer)

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

> 📖 **Full step-by-step for every IDE** (Claude Desktop, Claude Code, Cursor, Windsurf, claude.ai) →
> **[docs/connect-mcp.md](docs/connect-mcp.md)** · Tiếng Việt: **[docs/ket-noi-mcp.md](docs/ket-noi-mcp.md)**.

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
> user sends their own token via the `x-webcake-jwt` header (see the hosted-server section above).

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

### Environments (`--env` / `WEBCAKE_ENV`)

Instead of setting both base URLs by hand, pick a named environment — one source of
truth for the API + app bases:

| `--env` / `WEBCAKE_ENV` | API base (`WEBCAKE_API_BASE`) | App base (`WEBCAKE_APP_BASE`) | Builder base (`WEBCAKE_BUILDER_BASE`) |
|-------------------------|-------------------------------|-------------------------------|----------------------------------------|
| `local` | `http://localhost:5800` | `http://localhost:5173` | `http://builder.localhost:5800` |
| `staging` | `https://api.staging.webcake.io` | `https://staging.webcake.io` | `https://builder.staging.webcake.io` |
| `prod` | `https://api.webcake.io` | `https://webcake.io` | `https://builder.webcake.io` |

> The **editor/preview link** returned after `create_page`/`update_page` opens on the **builder host** (above), not the API or SPA base.

```bash
npx -y webcake-landing-mcp login --env local       # connect against your local SPA + API
WEBCAKE_ENV=staging npx -y webcake-landing-mcp      # run against the staging backend
WEBCAKE_ENV=prod npx -y webcake-landing-mcp         # prod (env var form)
```

Explicit `WEBCAKE_API_BASE` / `WEBCAKE_APP_BASE` (or `--api-base`) still override the preset, field
by field. On the hosted server you can override the environment per request with the
**`x-webcake-env`** header or **`?env=`** query (e.g. `…/mcp?jwt=<token>&env=staging`).

### How to get `WEBCAKE_JWT`

1. Open the WebCake builder dashboard and log in
2. Open DevTools (`F12` or `Cmd + Option + I`)
3. Go to the **Network** tab > click any page
4. Find an API request (e.g. `@me`, `organizations`…)
5. In **Request Headers**, copy the value after `Authorization: Bearer ` → this is your `WEBCAKE_JWT`
6. Use the `list_organizations` tool to list orgs and pick `WEBCAKE_ORG_ID`

---

## Per-IDE config

The npx **`install`** subcommand (above) writes the right config for each IDE automatically. For
hand-written config (Claude Desktop, Claude Code, Cursor, Windsurf, Augment, Codex) and the
cloned-build variants, see **[docs/manual-install.md](docs/manual-install.md#configuration-by-ide--ai-tool)**.

## Usage Examples

Three end-to-end walkthroughs — build a page from a brief, edit one surgically, and inspect
an element type — live in **[docs/usage-examples.md](docs/usage-examples.md)**.

---

## Detailed Tool Usage Guide

The tools split into three groups: **reference** (learn the model — no config needed),
**generation** (build valid nodes), and **persistence** (save to the backend — needs env vars).

### Step 1: Read the guide first — `get_generation_guide`

Always call this **first**. It returns the output shape, coordinate system (desktop ≈ 960px,
mobile ≈ 420px), event vocabulary, and the end-to-end workflow.

```
get_generation_guide({})
→ "## Output shape… ## Canvas… ## Events… ## Workflow…"
```

### Step 2: Browse the element catalog — `list_elements` / `get_element`

```
# All element types by category (summary + when-to-use + is it a container?)
list_elements({})
→ { categories: { layout: [...], content: [...], form: [...], ... } }

# Deep-dive one type — hints, key specials, default skeleton, filled example
get_element({ type: "button" })
```

### Step 3: Get valid building blocks — `new_element` / `new_page_skeleton`

```
# A structurally-valid default node for a type (fresh id)
new_element({ type: "section" })

# An empty but complete top-level source
new_page_skeleton({})
→ { page: [], popup: [], settings: {…}, options: { currency, mobileOnly, versionID }, cartConfigs: {} }
```

### Step 4: Inspect / validate — `get_page_schema` / `validate_page`

```
# Full JSON Schema (Draft 2020-12) of a page source
get_page_schema({})

# Structural + semantic validation — fix every error before persisting
validate_page({ source })
→ { ok: false, errors: [...], warnings: [...] }
```

`validate_page` **errors are blocking**; warnings (dangling event target, missing `field_name`) are advisory.

### Step 5: Persist — `list_organizations` / `create_page` / `update_page`

```
# List the account's organizations — ask which to use; default = the is_default org
list_organizations({})
→ [{ id: "org_1", name: "Acme", is_default: true }, ...]

# Create a NEW page (source-only). Defaults to dry_run=true.
create_page({ source, organization_id: "org_1" })       # preview
create_page({ source, dry_run: false })                  # actually create

# Edit an EXISTING page
list_pages({})                                           # find the page
get_page({ page_id })                                    # fetch decoded source
update_page({ page_id, source, dry_run: false })         # overwrite (dry_run=true by default)

# Build a LARGE page incrementally (avoids the giant single create_page payload
# that can drop the connection): small skeleton first, then one section at a time.
create_page({ source: smallSkeleton, dry_run: false })   # → page_id
add_section({ page_id, sections: heroSection })          # dry_run=true → validates + returns draft_id
add_section({ page_id, draft_id, dry_run: false })       # re-run with draft_id — no re-send of sections
add_section({ page_id, sections: [formSection, footerSection], dry_run: false })  # or skip dry-run entirely

# Go LIVE (the preview link works without this — publish to attach a domain / set live status)
publish_page({ page_id, custom_domain: "shop.example.com", custom_path: "sale", dry_run: false })
```

`create_page` calls **`POST {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source`** on the backend.
Both `create_page` and `update_page` **default to `dry_run=true`** (validate and return the request they
*would* send, JWT masked); set `dry_run=false` to actually write. The result returns `page_id` + editor/preview URLs.

---

## Suggested prompt

> Build me a WebCake landing page for &lt;brand/offer&gt;. Use the webcake-landing MCP:
> call `get_generation_guide`, `new_page_skeleton`, then `get_element` for each element type you use,
> assemble the `{ page, popup, settings, options }` JSON, `validate_page` until zero errors,
> then `create_page` (dry-run first).

---

## Available Tools

### Reference (no config needed)
| Tool | Description |
|------|-------------|
| `get_generation_guide` | **Read FIRST.** Output shape, coordinate system, event vocabulary, workflow. |
| `list_elements` | All element types by category (summary + when-to-use + container?). |
| `get_element` | One type (or many at once): hints, key `specials`, a SPARSE skeleton (the exact shape to emit — the server hydrates omitted boilerplate), filled example. |
| `get_page_schema` | Full JSON Schema (Draft 2020-12) of a page source. |

### Generation
| Tool | Description |
|------|-------------|
| `new_element` | A default node for a type (fresh id) in the SPARSE authoring shape — copy it as-is; omitted boilerplate is hydrated server-side. |
| `new_page_skeleton` | An empty but complete top-level source `{ page, popup, settings, options, cartConfigs }`. |
| `validate_page` | Structural + semantic validation (ids, event targets, containers, `field_name`). |

### Media (works out of the box; optional Pexels key)
| Tool | Description |
|------|-------------|
| `search_images` | Find REAL stock photos (Pexels) for a page — returns hotlinkable URLs at several sizes to drop into an image element's `specials.src`. Works with **no setup** (a shared hosted proxy supplies images); set `PEXELS_API_KEY` env or the `x-pexels-key` header to use your own [free Pexels key](https://www.pexels.com/api/) / quota. |

### Persistence (needs `WEBCAKE_API_BASE` + `WEBCAKE_JWT`)
| Tool | Description |
|------|-------------|
| `list_organizations` | List the account's organizations (id, name, is_default). Default = the `is_default` org. |
| `create_page` | Persist a generated source as a new page (source-only). Validates, caches the source as `draft_id`, then creates. On validation failure, timeout, or network error the draft is kept — retry via `create_page({ draft_id, dry_run:false })` or fix via `patch_page({ draft_id, patches })`. **Defaults to `dry_run=true`.** |
| `list_pages` | List the account's pages (id, name, organization_id, updated_at) to pick one to edit. |
| `find_pages` | Search the account's pages by name, domain, and/or page id (AND-combined) to locate one to edit; returns id, name, org, custom/default domain, updated_at. |
| `get_page` | Fetch an existing page's decoded source tree, COMPACTED to the sparse authoring shape (factory-default boilerplate stripped — far fewer tokens; `compact:false` for the raw tree). Edit and send back as-is. |
| `update_page` | Overwrite an existing page's source with an edited tree. Validates, caches the source as `draft_id`, then saves. On timeout or failure the draft is kept — retry via `update_page({ draft_id, dry_run:false })` or `patch_page({ draft_id, dry_run:false })` (no patches). **Defaults to `dry_run=true`.** |
| `add_section` | Append section(s) to an existing page without re-sending the whole source (incremental-build path). Always caches the batch as `draft_id`; re-run with `{ page_id, draft_id, dry_run:false }` — no need to re-send sections. Validation failure, timeout, or network error also keeps the draft — fix via `patch_page({ draft_id, patches })` or retry `patch_page({ draft_id, dry_run:false })` with no patches. **Defaults to `dry_run=true`.** |
| `patch_page` | Edit a page by element id without re-sending the whole source. Targets a live page (`page_id`) OR a cached draft (`draft_id`). Draft kinds: `create_page` (creates page once valid), `add_section` (appends once valid), `update_page`/live-patch (retries updatePageSource). **Empty/omitted patches + `draft_id` = commit-as-is (the universal timeout-retry path).** Live-page path pre-caches the patched source before the network call and returns `draft_id` for recovery. **Defaults to `dry_run=true`.** |
| `publish_page` | Publish a page (live status, optional custom domain/path). The preview link works WITHOUT publishing — publish only to go live. **Defaults to `dry_run=true`.** |

---

## Model notes

- **Absolute-positioning canvas:** every child carries numeric `top/left/width/height` per breakpoint;
  sections stack vertically and own a `height`. Content lives in `specials` (`text`, `src`, …), never in `styles`.
- **Top-level source:** `{ page: [sections], popup: [popups], settings: {…}, options: { currency, mobileOnly, versionID }, cartConfigs: {} }`.
  Popups are a **separate** top-level array, not nested in `page`.
- Per-breakpoint animation lives in `config.animation = { name, delay, duration, repeat }`.
- Colors are `rgba()`; `top/left/width/height/fontSize` are numbers (px); form inputs need a unique `specials.field_name`.

Reference: [docs/page-element-schema.md](docs/page-element-schema.md) and
[src/domains/landing/page-schema.json](src/domains/landing/page-schema.json) (the bundled JSON Schema, Draft 2020-12). The schema mirrors
the real editor `page_source` shape.

---

## ⭐ Like the idea? Drop a star

This is a solo, open-source project — every ⭐ genuinely keeps it moving and helps other builders discover it.

- ⭐ **[Star the repo](https://github.com/vuluu2k/webcake-landing-mcp)** — 2 seconds, huge motivation.
- 🐛 **[Open an issue](https://github.com/vuluu2k/webcake-landing-mcp/issues)** — a bug, a missing element type, or just an idea.
- 🔁 **Share it** with anyone still building landing pages box by box.

[![Star History Chart](https://api.star-history.com/svg?repos=vuluu2k/webcake-landing-mcp&type=Date)](https://star-history.com/#vuluu2k/webcake-landing-mcp&Date)

> Built with ❤️ for the WebCake community. Thanks for being here.
