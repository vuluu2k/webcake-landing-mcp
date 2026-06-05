# WebCake Landing MCP Server

MCP (Model Context Protocol) server that teaches AI agents how to build a complete
**WebCake landing-page source JSON** from a requirement — and persist it to a WebCake backend.

It exposes the element catalog, per-element usage hints + `specials`, the full page JSON Schema,
valid element/page skeletons, a page validator, and tools to create or edit pages on the backend.
The AI agent produces the full `{ page, popup, settings, options, cartConfigs }` JSON; `create_page`
persists it (source-only — the page opens in the editor where re-saving renders it).

## Two ways to run

| Mode | Command | When |
|------|---------|------|
| **CDN / npx** (no clone) | `npx -y webcake-landing-mcp` | Fastest start — npm fetches & runs it, no clone or build. Auto-updates to the latest published version. |
| **Local** (cloned build) | `node /abs/path/dist/index.js` | Hacking on the server, offline, or pinning a specific build. Run `npm run build` first. |

Both expose the exact same tools. Every IDE config below shows the **local** form; to use **CDN** mode,
just swap `command`/`args` for the npx form (see [Run without cloning](#run-without-cloning-npx)).

## Quick Install (Recommended)

Run the auto-install script — it handles everything: clone, install dependencies, build, and configure your IDE.

### macOS / Linux

If you already cloned the repo:
```bash
./install.sh
```

Or download and run directly:
```bash
curl -fsSL https://raw.githubusercontent.com/vuluu2k/webcake-landing-mcp/main/install.sh -o install.sh && bash install.sh
```

The installer is interactive: it asks where to install (default `~/.webcake-landing-mcp`), prompts for
the env vars (`WEBCAKE_API_BASE`, `WEBCAKE_JWT`, `WEBCAKE_ORG_ID` — all optional, Enter to skip), then
lets you pick which IDE(s) to configure: `claude-desktop`, `claude-code`, `cursor`, `windsurf`, `augment`,
`codex`, or all.

Uninstall (removes the MCP server entry from every configured IDE):
```bash
./install.sh --uninstall
```

### Windows (PowerShell)

If you already cloned the repo:
```powershell
.\install.ps1
```

Or download and run directly:
```powershell
irm https://raw.githubusercontent.com/vuluu2k/webcake-landing-mcp/main/install.ps1 -OutFile install.ps1; .\install.ps1
```

Uninstall:
```powershell
.\install.ps1 --uninstall
```

---

## Update

Update to the latest version:

```bash
cd ~/.webcake-landing-mcp   # or wherever you installed it
git pull
npm install
npm run build
```

Then restart your IDE.

---

## Run without cloning (npx)

Once published to npm, the server runs straight from the registry — no clone, no build:

```bash
npx -y webcake-landing-mcp
```

Or run the latest from GitHub (npx clones + builds via the `prepare` script on the fly):

```bash
npx -y github:vuluu2k/webcake-landing-mcp
```

### Auto-configure your IDE (`install` subcommand)

`npx` only **runs** the server — unlike `install.sh`/`install.ps1`, it does not write the MCP
config into your IDE. The bundled `install` subcommand does that step for you, no clone needed:

```bash
# Interactive — asks for env + which IDE(s) step by step
npx -y webcake-landing-mcp install

# Non-interactive — configure every supported IDE at once
npx -y webcake-landing-mcp install --ide all --jwt <your-jwt> --api-base http://localhost:5800

# Just one IDE
npx -y webcake-landing-mcp install --ide cursor --jwt <your-jwt>

# Remove the server from every IDE config
npx -y webcake-landing-mcp uninstall
```

It writes a `webcake-landing` entry (using the `npx` launch form below) into the right config file
for each target: `claude-desktop`, `claude-code`, `cursor`, `windsurf`, `augment` (VS Code), `codex`,
or `all`. Flags: `--ide`, `--api-base`, `--jwt`, `--org-id`, `--host`, `--app-base`, `--npx`/`--local`,
`-y`. Run `npx -y webcake-landing-mcp --help` for the full list.

### Manual config

The MCP config is the same as the local one, but `command`/`args` point at `npx` instead of a built file:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "npx",
      "args": ["-y", "webcake-landing-mcp"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

> npx caches the package after the first run, so subsequent launches are fast. Use a pinned version
> (`webcake-landing-mcp@1.0.0`) if you need a reproducible build.

## Manual Setup (local)

```bash
git clone https://github.com/vuluu2k/webcake-landing-mcp.git
cd webcake-landing-mcp
npm install        # postinstall `prepare` builds dist/ automatically
npm run build      # (re)build: tsc -> dist/ + copies page-schema.json
npm run smoke      # offline self-test of factory + validator (prints "ALL GOOD")
```

The reference/validation tools work with **zero config**. Env vars are only needed for the persistence
tools (`create_page`, `update_page`, `list_pages`, `get_page`, `list_organizations`).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBCAKE_API_BASE` | No* | Backend base URL, e.g. `http://localhost:5800`. Required to persist. |
| `WEBCAKE_JWT` | No* | Account JWT (dashboard auth). Required to persist — expires, refresh when needed. |
| `WEBCAKE_ORG_ID` | No | Default organization id for `create_page` (overridden by its `organization_id` arg). Omit → personal page. |
| `WEBCAKE_HOST` | No | Optional `Host` header (Phoenix routes by host, e.g. `builder.localhost`). |
| `WEBCAKE_APP_BASE` | No | Optional base used to build editor/preview URLs in the result. |

> \* `WEBCAKE_API_BASE` and `WEBCAKE_JWT` are only needed for the persistence tools. The reference and
> validation tools (`get_generation_guide`, `list_elements`, `get_element`, `validate_page`, …) work without them.

> Persisting writes a real page to whatever `WEBCAKE_API_BASE` points at, using the JWT as that account.
> Start against local/staging.

### How to get `WEBCAKE_JWT`

1. Open the WebCake builder dashboard and log in
2. Open DevTools (`F12` or `Cmd + Option + I`)
3. Go to the **Network** tab > click any page
4. Find an API request (e.g. `@me`, `organizations`…)
5. In **Request Headers**, copy the value after `Authorization: Bearer ` → this is your `WEBCAKE_JWT`
6. Use the `list_organizations` tool to list orgs and pick `WEBCAKE_ORG_ID`

---

## Configuration by IDE / AI Tool

> Replace `/absolute-path/webcake-landing-mcp/dist/index.js` below with the actual path where you
> cloned/built the repo. Example: `/Users/username/webcake-landing-mcp/dist/index.js`.
> Run `npm run build` first so `dist/` exists.

### 1. Claude Desktop

Open Settings > Developer > Edit Config, or edit the file directly:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>",
        "WEBCAKE_HOST": "builder.localhost",
        "WEBCAKE_APP_BASE": "http://builder.localhost:5800"
      }
    }
  }
}
```

Restart Claude Desktop. The MCP tools will appear in the chat input (hammer icon).

---

### 2. Claude Code (CLI)

Run in terminal — **local** build:

```bash
claude mcp add webcake-landing \
  -e WEBCAKE_API_BASE=http://localhost:5800 \
  -e WEBCAKE_JWT=<your-jwt> \
  -e WEBCAKE_HOST=builder.localhost \
  -- node /absolute-path/webcake-landing-mcp/dist/index.js
```

Or **CDN / npx** (no clone):

```bash
claude mcp add webcake-landing \
  -e WEBCAKE_API_BASE=http://localhost:5800 \
  -e WEBCAKE_JWT=<your-jwt> \
  -- npx -y webcake-landing-mcp
```

Or create `.claude.json` at project root (or `~/.claude.json` globally):

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Verify:
```bash
claude mcp list
```

---

### 3. Cursor

Create `.cursor/mcp.json` at project root (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Restart Cursor and check Settings > MCP Servers for **"Connected"** status.

---

### 4. Windsurf

Create `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Restart Windsurf. Type `@` in Cascade chat to see `webcake-landing` tools.

---

### 5. Augment (VS Code Extension)

Open Command Palette: `Cmd + Shift + P` > **"Augment: Edit MCP Settings"**, then add:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Restart VS Code.

---

### 6. Codex (OpenAI CLI)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.webcake-landing]
command = "node"
args = ["/absolute-path/webcake-landing-mcp/dist/index.js"]
env = { "WEBCAKE_API_BASE" = "http://localhost:5800", "WEBCAKE_JWT" = "<your-jwt>" }
```

Verify:
```bash
codex mcp list
```

---

## Usage Examples

### Example 1: Build a new landing page from a brief

**Prompt:**
```
Build me a WebCake landing page for "Acme Coffee" — a hero with a CTA, a 3-feature
section, and a signup form. Persist it to my default org.
```

**AI agent will automatically:**

**Step 1** — Call `get_generation_guide` to learn conventions (canvas, coordinate system, events, workflow)

**Step 2** — Call `new_page_skeleton` for an empty top-level source, then `get_element` for each type it uses:

```
get_element({ type: "section" })
get_element({ type: "text-block" })
get_element({ type: "button" })
get_element({ type: "form" })
```

**Step 3** — Assemble the full `{ page, popup, settings, options, cartConfigs }` JSON, then validate:

```
validate_page({ source })
→ { ok: false, errors: ["BUTTON-2: event target 'POPUP-9' not found"] }   # fix every error, re-validate
validate_page({ source })
→ { ok: true, errors: [] }
```

**Step 4** — Persist (dry-run first, then for real):

```
list_organizations({})                          → pick the org
create_page({ source })                         → dry-run preview (JWT masked)
create_page({ source, dry_run: false })         → { page_id, editor_url, preview_url }
```

Open the page in the editor and re-save to render `app`/`app_css`.

---

### Example 2: Edit an existing page

**Prompt:**
```
On my "Acme Coffee" landing page, change the hero headline to "Freshly Roasted Daily"
and make the CTA button green.
```

**AI agent edits surgically — never regenerates the whole tree:**

```
# Step 1: find the page
list_pages({})
→ [{ id: "page_42", name: "Acme Coffee", organization_id: "org_1", ... }]

# Step 2: fetch its decoded source tree
get_page({ page_id: "page_42" })

# Step 3: change ONLY the headline text + button color, keep every other id/coordinate,
#         then validate and write back
validate_page({ source })                       → ok
update_page({ page_id: "page_42", source })     → dry-run preview
update_page({ page_id: "page_42", source, dry_run: false })
```

---

### Example 3: Inspect an element type before using it

**Prompt:**
```
What specials does a form element need, and show me a valid example.
```

**AI agent calls:**

```
get_element({ type: "form" })
→ {
    hints: "Each input needs a unique specials.field_name…",
    specials: { ... },
    skeleton: { ... },     # structurally-valid default node
    example: { ... }       # filled, realistic example
  }
```

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
| `get_element` | One type: hints, key `specials`, default skeleton, filled example. |
| `get_page_schema` | Full JSON Schema (Draft 2020-12) of a page source. |

### Generation
| Tool | Description |
|------|-------------|
| `new_element` | A structurally-valid default node for a type (fresh id). |
| `new_page_skeleton` | An empty but complete top-level source `{ page, popup, settings, options, cartConfigs }`. |
| `validate_page` | Structural + semantic validation (ids, event targets, containers, `field_name`). |

### Persistence (needs `WEBCAKE_API_BASE` + `WEBCAKE_JWT`)
| Tool | Description |
|------|-------------|
| `list_organizations` | List the account's organizations (id, name, is_default). Default = the `is_default` org. |
| `create_page` | Persist a generated source as a new page (source-only). **Defaults to `dry_run=true`.** |
| `list_pages` | List the account's pages (id, name, organization_id, updated_at) to pick one to edit. |
| `get_page` | Fetch an existing page's decoded source tree so you can edit it. |
| `update_page` | Overwrite an existing page's source with an edited tree. **Defaults to `dry_run=true`.** |

---

## Model notes

- **Absolute-positioning canvas:** every child carries numeric `top/left/width/height` per breakpoint;
  sections stack vertically and own a `height`. Content lives in `specials` (`text`, `src`, …), never in `styles`.
- **Top-level source:** `{ page: [sections], popup: [popups], settings: {…}, options: { currency, mobileOnly, versionID }, cartConfigs: {} }`.
  Popups are a **separate** top-level array, not nested in `page`.
- Per-breakpoint animation lives in `config.animation = { name, delay, duration, repeat }`.
- Colors are `rgba()`; `top/left/width/height/fontSize` are numbers (px); form inputs need a unique `specials.field_name`.

Reference: [docs/page-element-schema.md](docs/page-element-schema.md) and
[src/page-schema.json](src/page-schema.json) (the bundled JSON Schema, Draft 2020-12). The schema mirrors
the real editor `page_source` shape.
