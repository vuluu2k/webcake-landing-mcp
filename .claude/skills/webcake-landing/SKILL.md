---
name: webcake-landing
description: Generate and edit Webcake landing pages from a requirement using the webcake-landing MCP tools. Covers the page-source model, the 12 tools, intake questions, and the create/edit workflow with organization targeting and dry-run safety.
metadata:
  author: Vũ Lưu
  version: "2026.06.05"
  source: webcake-landing-mcp
---

# webcake-landing — generate & edit Webcake landing pages

> Workflow + rules for using the **webcake-landing** MCP to build a complete Webcake
> `page_source` from a brief, and to edit existing pages. The same rules are served at
> runtime via the server `instructions` (src/domains/landing/instructions.ts) — this skill is the long form.

## Tools (12)

Reference/validation (no backend/env needed):
`get_generation_guide`, `list_elements`, `get_element`, `new_element`,
`new_page_skeleton`, `get_page_schema`, `validate_page`.

Backend (need `WEBCAKE_API_BASE` + `WEBCAKE_JWT` env):
`list_organizations`, `create_page`, `list_pages`, `get_page`, `update_page`.
`create_page` / `update_page` default to `dry_run=true`.

Reference docs in this repo: [docs/page-element-schema.md](../../../docs/page-element-schema.md),
[src/domains/landing/page-schema.json](../../../src/domains/landing/page-schema.json).

## Page-source model (cheat-sheet)

```jsonc
{ "page": [<section>...], "popup": [<popup>...], "settings": {...},
  "options": { "currency":"VND", "mobileOnly":false, "versionID":null }, "cartConfigs": {} }
```
- `page` = sections stacked vertically; `popup` is a SEPARATE top-level array (NOT inside `page`).
- Element: `{ id, type, properties:{name,movable,sync}, responsive:{desktop,mobile:{config,styles}}, specials, children, runtime, events }`.
- Absolute canvas: children carry numeric `top/left/width/height` (px) per breakpoint (desktop≈960, mobile≈420); sections own a `height`, no top/left.
- Content lives in `specials` (`text`, `src`, `field_name`…), NEVER in `styles`. Colors as `rgba(...)`.
- Animation in `config.animation = {name,delay,duration,repeat}`. Event: `{id,type,action,target,appTarget,hoverColor}`.

## Workflow — new page

1. **INTAKE — every time, even a quick/test page** (ask first, offer defaults, don't assume, and do NOT jump straight to building): page purpose/goal · brand/page name · what they sell + price (sales/ads pages) · primary color + logo/branding · sections & layout in order · primary CTA + destination · form fields · desktop+mobile or mobile-only · which organization. Then RESTATE a short outline (sections + CTA + colors) and wait for the user's confirmation before generating. Don't generate + persist on the same turn as the request.
2. `get_generation_guide`, then `new_page_skeleton`.
3. `get_element` per type (specials + example); `new_element` for valid skeletons.
4. Assemble `{ page, popup, settings, options, cartConfigs }`; fill `specials`, set coordinates (no overlaps).
5. `validate_page` → fix every error.
6. `list_organizations` → show options, ask which (default = `is_default`).
7. `create_page` `dry_run:true` (preview) → `dry_run:false` with chosen `organization_id`.
8. Give the editor/preview URLs. Source-only — re-save in the editor to render.

## Workflow — edit existing page

1. `list_pages` → user picks (or take a `page_id` from a URL).
2. `get_page(page_id)` → the live `{ page, popup, settings, ... }`.
3. **Edit surgically**: change only what was asked; keep every other element, its `id`, and coordinates. To add: `new_element`, unique id, place in the right section's `children`.
4. `validate_page` → `update_page(page_id, source)` (`dry_run:true` then `dry_run:false`).

## Rules

- INTAKE every time before generating (even a "test" page) — confirm purpose, name, colors, layout + an outline first, and don't build on the same turn as the request; never invent prices/phones/addresses/stats.
- `validate_page` before any create/update; fix every error.
- `dry_run` first; send `dry_run:false` only after user confirms.
- Edit surgically; preserve ids + coordinates.
- Owner-scoped endpoints; default org = `is_default` (pass `organization_id` or set `WEBCAKE_ORG_ID`).
- Popups are top-level; form inputs need unique `specials.field_name` (canonical keys for auto-typing).
- Numbers for `top/left/width/height/fontSize`; colors `rgba()`; `runtime` always `{}`; only containers have `children`.

## Setup

`npm install && npm run build`, then register the MCP with env `WEBCAKE_API_BASE`, `WEBCAKE_JWT`
(+ optional `WEBCAKE_ORG_ID`, `WEBCAKE_HOST`, `WEBCAKE_APP_BASE`). The backend AI endpoints
(`/api/v1/ai/*`) must be running (landing_page_backend, branch `feat/ai-page-element-mcp`).
