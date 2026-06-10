# Manual & advanced install

**English** · [Tiếng Việt](./manual-install.vi.md)

> The quick path is the **npx `install` subcommand** (and the remote connector) — see the
> [README](../README.md). This page keeps the **manual / advanced** options: the shell installers,
> a cloned local build, updating a clone, and hand-written per-IDE config.

All of these configure the same `webcake-landing` MCP server; pick whichever fits your setup.

## Setup methods (pick one)

| # | Method | Best for | Auth | Where |
|---|--------|----------|------|-------|
| 1 | **npx `install`** — auto-write the IDE config | Most people | `--env` + browser `login` or a JWT | [README](../README.md) |
| 2 | **Local stdio** — add to an IDE via `npx` or a built file | Daily use on your machine | env `WEBCAKE_JWT`, or `login`, or none (reference tools) | [Per-IDE config](#configuration-by-ide--ai-tool) |
| 3 | **`login`** — grab the token through the browser (no copy-paste) | Avoiding a manual token paste | browser session → saved `auth.json` | [Configuration](./configuration.md#connect-once--grab-your-token-automatically-login) |
| 4 | **Remote HTTP (`serve`)** — run as an HTTP server | The remote transport / a hosted connector | per-request `x-webcake-jwt` header, or env | [Connect guide](./connect-mcp.md) + [headers](./configuration.md#per-request-headers-hosted--remote-server) |

Two **run forms** apply to any method: **`npx -y webcake-landing-mcp …`** (no clone, auto-updates) or
**`node /abs/path/dist/index.js …`** (a cloned build — run `npm run build` first). The IDE configs below
show the local (cloned) form; swap `command`/`args` for the npx form to use CDN mode.

The **reference + generation tools** (`get_generation_guide`, `list_elements`, `validate_page`, …) work
with **zero config**; only the **persistence tools** (`create_page`, `update_page`, `list_pages`,
`get_page`, `list_organizations`) need a token. Credentials resolve in order:
**per-request header → env var → saved `auth.json`** (`login`).

## Quick install scripts (`install.sh` / `install.ps1`)

These wrapper scripts clone, install dependencies, build, and configure your IDE in one step. (The
bundled npx `install` subcommand does the configure step without a clone — prefer it if you don't need
a local checkout.)

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
`codex`, `antigravity`, `gemini` (Gemini CLI), `cline`, `kiro`, `opencode`, or all.

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

## Manual setup (local clone + build)

```bash
git clone https://github.com/vuluu2k/webcake-landing-mcp.git
cd webcake-landing-mcp
npm install        # postinstall `prepare` builds dist/ automatically
npm run build      # (re)build: tsc -> dist/ + copies src/**/*.json (page-schema.json) into dist/
npm run smoke      # offline self-test of factory + validator (prints "ALL GOOD")
```

The reference/validation tools work with **zero config**. Env vars are only needed for the persistence
tools (`create_page`, `update_page`, `list_pages`, `get_page`, `list_organizations`).

## Update a cloned install

```bash
cd ~/.webcake-landing-mcp   # or wherever you installed it
git pull
npm install
npm run build
```

Then restart your IDE. (Running via `npx` instead? It fetches the published version each time — no manual
update; pin a version with `webcake-landing-mcp@<version>` for reproducibility.)

## Configuration by IDE / AI Tool

> Replace `/absolute-path/webcake-landing-mcp/dist/index.js` below with the actual path where you
> cloned/built the repo. Example: `/Users/username/webcake-landing-mcp/dist/index.js`.
> Run `npm run build` first so `dist/` exists.
>
> The examples use explicit URLs; you can replace `WEBCAKE_API_BASE`/`WEBCAKE_APP_BASE` with a single
> `WEBCAKE_ENV` (`local` | `staging` | `prod`) — see the README's Environments table.

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
