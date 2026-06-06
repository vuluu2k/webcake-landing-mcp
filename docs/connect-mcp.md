<!-- English · Phiên bản Tiếng Việt: ./ket-noi-mcp.md -->

# <img src="assets/webcake-icon.svg" alt="Webcake" width="22" height="22" align="absmiddle"> Turn your AI into a landing-page designer — in 60 seconds

> You type the brief. The AI builds the whole landing page. You hit publish.
> No drag-and-drop, no stale templates, no hiring a designer.

This is **Webcake Landing MCP** — the bridge that wires Claude / Cursor / any AI straight into your Webcake account. Connect **once**, then just *talk* to ship pages.

**Paste this link to a friend and they're running in seconds** 👇

```
https://mcp.toolvn.io.vn/mcp?jwt=<YOUR_TOKEN>
```

---

## ✨ Once connected, you can say things like

- *"Build me a landing page to sell an English course, blue theme, with a sign-up form + a Zalo button."*
- *"Open the `summer-sale` page, change the headline to '50% OFF' and make the button red."*
- *"Add a countdown section and 3 customer testimonials at the bottom."*

The AI handles the hard part: layout, coordinates, colors, validation, saving back to Webcake. You just review.

---

## 🚀 2 ways to connect — pick one

| | Way ① `npx` | Way ② Remote URL |
|---|---|---|
| **Install?** | Needs Node.js 18+ | Nothing to install |
| **Runs where?** | On your machine | On our server |
| **Best for** | Personal use, full control | Low-spec machines, teams, claude.ai |
| **Quick grab** | `npx -y webcake-landing-mcp install` | Open <https://webcake.io/mcp-remote> in the dashboard → copy |

> 💡 Not technical? **Pick Way ②** — just copy one link and you're done.

---

## 🔑 Get your token (one time)

The token is the "key" that lets the AI use *your* Webcake account. Two options:

1. **Easiest** — log in to Webcake → open the **<https://webcake.io/mcp-remote>** page → hit **Copy**. The link already has your token baked in.
2. **Auto, via browser:**
   ```bash
   npx -y webcake-landing-mcp login
   ```
   A browser tab opens, you confirm, done — the token is saved on your machine.

> ⚠️ A token = a password. Don't post it publicly, don't commit it to Git. Always use **HTTPS**.

---

## 🅰️ WAY ① — `npx` (runs on your machine)

### Fastest: let it configure your IDE

```bash
# Interactive: pick environment, log in, pick IDE(s)
npx -y webcake-landing-mcp install

# One shot: configure every IDE
npx -y webcake-landing-mcp install --ide all --env prod --jwt <TOKEN>

# Remove from every IDE
npx -y webcake-landing-mcp uninstall
```

### Or paste it into the config file by hand

Generic block (set the file path per IDE below):

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "npx",
      "args": ["-y", "webcake-landing-mcp"],
      "env": {
        "WEBCAKE_ENV": "prod",
        "WEBCAKE_JWT": "<YOUR_TOKEN>"
      }
    }
  }
}
```

| IDE | Paste into |
|-----|------------|
| **Claude Desktop** (Mac) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop** (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Code** | `.mcp.json` in your project (or `claude mcp add`) |
| **Cursor** | `~/.cursor/mcp.json` (or `.cursor/mcp.json` in the project) |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |

> Save → **restart the IDE** → you'll see `webcake-landing` in the MCP list. 🎉

---

## 🅱️ WAY ② — Remote URL (nothing to install)

### claude.ai (web) — the "Add custom connector" dialog

1. Go to **Settings → Connectors → Add custom connector**.
2. **Name:** `Webcake Landing`
3. **URL:** paste your personal link:
   ```
   https://mcp.toolvn.io.vn/mcp?jwt=<YOUR_TOKEN>
   ```
4. Click **Add** → wait for it to connect → done. The green <img src="assets/webcake-icon.svg" alt="Webcake" width="22" height="22" align="absmiddle"> Webcake icon shows up.

> The claude.ai dialog has **no header field**, so the token must live in the URL (`?jwt=`). One link per person = one account each, no OAuth needed.

### Claude Code / Cursor (native HTTP support)

```json
{
  "mcpServers": {
    "webcake-landing": {
      "type": "http",
      "url": "https://mcp.toolvn.io.vn/mcp",
      "headers": { "x-webcake-jwt": "<YOUR_TOKEN>" }
    }
  }
}
```

> This sends the token via a **header** (safer — it won't leak into logs) instead of in the URL.

### Claude Desktop (stdio only) → the `mcp-remote` bridge

Claude Desktop can't speak remote HTTP yet, so use `mcp-remote` as a bridge:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://mcp.toolvn.io.vn/mcp",
        "--header", "x-webcake-jwt:<YOUR_TOKEN>"
      ]
    }
  }
}
```

---

## 🎛️ Advanced params (optional)

Append to the URL (`&key=value`) or set as env / header:

| URL param | Header | Meaning |
|-----------|--------|---------|
| `?jwt=` | `x-webcake-jwt` | Account token (required for page-saving tools) |
| `&env=` | `x-webcake-env` | Environment: `prod` (default) · `staging` · `local` |
| `&org_id=` | `x-webcake-org-id` | Default organization for new pages |
| `&api_base=` | `x-webcake-api-base` | Override the API base |

> **Reference** tools (`list_elements`, `get_generation_guide`, `validate_page`…) work with **no token**. Only the **page-saving** tools (`create_page`, `update_page`…) need one.

---

## 🆘 Hit a snag? Quick rescue table

| Symptom | Common cause | Fix |
|---------|--------------|-----|
| Icon is a **white globe** | Client cached the old icon | Remove the connector → add it again |
| **"Couldn't register… sign-in service"** | Server down / unreachable | Check `https://mcp.toolvn.io.vn/health` returns `{"ok":true}` |
| Saving tools return **`missing_env`** | No token | Add `?jwt=` or `x-webcake-jwt` |
| Pages land in the **wrong account** | Wrong / expired token | Grab a fresh one (`login` or <https://webcake.io/mcp-remote>) |
| Can't add `localhost` to claude.ai | claude.ai fetches from its own servers | Use a **public HTTPS** URL |

Check the server is alive:
```bash
curl https://mcp.toolvn.io.vn/health      # → {"ok":true, ...}
```

---

## 💚 If you love it, share it

You just gave an AI the power to build real landing pages. A friend of yours needs exactly this.

> **Copy this and send it:**
> *"I just had Claude build a whole landing page by itself 😂 Drop this link into Claude and it just works: https://mcp.toolvn.io.vn — it's the Webcake Landing MCP toolkit, free."*

<img src="assets/webcake-icon.svg" alt="Webcake" width="22" height="22" align="absmiddle"> *Made with Webcake — less work, more pages.*
