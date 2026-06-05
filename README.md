# webcake-landing-mcp

An MCP (Model Context Protocol) server that teaches Claude how to build a complete
**Webcake landing-page source JSON** from a requirement — and persist it to a
Webcake backend.

It exposes the element catalog, per-element usage hints + `specials`, the full page
JSON Schema, valid element/page skeletons, a page validator, and a `create_page`
tool that saves a generated source to the backend.

Claude produces the full `{ page, popup, settings, options, cartConfigs }` JSON;
`create_page` persists it (source-only — the page opens in the editor where
re-saving renders it).

Reference: [docs/page-element-schema.md](docs/page-element-schema.md) and
[src/page-schema.json](src/page-schema.json) (the bundled JSON Schema, Draft 2020-12).
This repo was extracted from the Webcake backend repo; the schema mirrors the real
editor `page_source` shape.

## Tools

| Tool | Purpose |
|------|---------|
| `get_generation_guide` | Read FIRST. Output shape, coordinate system, event vocab, workflow. |
| `list_elements` | All element types by category (summary + when-to-use + container?). |
| `get_element` | One type: hints, key `specials`, default skeleton, filled example. |
| `new_element` | A structurally-valid default node for a type (fresh id). |
| `new_page_skeleton` | An empty but complete top-level source `{ page:[], popup:[], settings:{…}, options:{…}, cartConfigs:{} }`. |
| `get_page_schema` | Full JSON Schema (Draft 2020-12) of a page source. |
| `validate_page` | Structural + semantic validation (ids, event targets, containers, field_name). |
| `create_page` | Persist a generated source to the backend (creates a new page, source-only). **Defaults to `dry_run=true`.** |

## Build

```bash
npm install
npm run build      # tsc -> dist/ + copies page-schema.json
npm run smoke      # offline self-test of factory + validator (prints "ALL GOOD")
```

## Plug into Claude

### Claude Code (CLI)

```bash
claude mcp add webcake-landing -- node /ABSOLUTE/PATH/webcake-landing-mcp/dist/index.js
```

### Claude Desktop — `claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<account jwt>",
        "WEBCAKE_HOST": "builder.localhost",
        "WEBCAKE_APP_BASE": "http://builder.localhost:5800"
      }
    }
  }
}
```

The `env` block is only needed for `create_page` (persisting). The reference/
validation tools work without it.

## Suggested prompt

> Build me a Webcake landing page for <brand/offer>. Use the webcake-landing MCP:
> call `get_generation_guide`, `new_page_skeleton`, then `get_element` for each
> element type you use, assemble the `{ page, popup, settings, options }` JSON,
> `validate_page` until zero errors, then `create_page` (dry-run first).

## How Claude uses it (flow)

```
get_generation_guide()                 # conventions + canvas (desktop≈960, mobile≈420) + events
new_page_skeleton()                    # empty top-level { page, popup, settings, options, cartConfigs }
get_element("section" | "text-block" | "button" | "form" | ...)   # specials + examples
-> fill page[] (sections + children) and popup[]
validate_page(source)                  # fix every error
create_page({ source })                # dry-run preview -> create_page({source, dry_run:false})
```

## Persisting (`create_page`)

`create_page` calls **`POST {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source`**
on the Webcake backend (the backend must expose that endpoint —
`AiController.create_page_from_source`, which does `Pages.create_page` +
`create_source`, source-only). It **defaults to `dry_run=true`** (validates and
returns the request it *would* send, JWT masked); set `dry_run=false` to actually
create the page. The result returns `page_id` + editor/preview URLs. Open the page
in the editor and re-save to render `app`/`app_css`.

Env vars:

| Var | Purpose |
|-----|---------|
| `WEBCAKE_API_BASE` | Backend base URL, e.g. `http://localhost:5800` (required to save). |
| `WEBCAKE_JWT` | Account JWT (required to save). Expires — refresh when needed. |
| `WEBCAKE_HOST` | Optional `Host` header (Phoenix routes by host, e.g. `builder.localhost`). |
| `WEBCAKE_APP_BASE` | Optional base used to build editor/preview URLs in the result. |

> Persisting writes a real page to whatever `WEBCAKE_API_BASE` points at, using the
> JWT as that account. Start against local/staging.

## Model notes

- Absolute-positioning canvas: every child carries numeric `top/left/width/height`
  per breakpoint; sections stack vertically and own a `height`. Content lives in
  `specials` (`text`, `src`, …), never in `styles`.
- Top-level source: `{ page:[sections], popup:[popups], settings:{…}, options:{currency,mobileOnly,versionID}, cartConfigs:{} }`.
  Popups are a **separate** top-level array, not nested in `page`.
- Per-breakpoint animation lives in `config.animation = {name,delay,duration,repeat}`.
- `validate_page` errors are blocking; warnings (dangling event target, missing
  `field_name`) are advisory.
