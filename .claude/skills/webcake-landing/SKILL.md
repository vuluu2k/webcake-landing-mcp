---
name: webcake-landing
description: Generate and edit Webcake landing pages from a requirement using the webcake-landing MCP tools. Covers the page-source model, the 16 tools, intake questions, and the create/edit workflow with organization targeting, reference-input ingest, and dry-run safety.
metadata:
  author: Vũ Lưu
  version: "2026.06.05"
  source: webcake-landing-mcp
---

# webcake-landing — generate & edit Webcake landing pages

> Workflow + rules for using the **webcake-landing** MCP to build a complete Webcake
> `page_source` from a brief, and to edit existing pages. The same rules are served at
> runtime via the server `instructions` (src/domains/landing/instructions.ts) — this skill is the long form.

## Tools (19)

Reference/validation (no backend/env needed):
`get_generation_guide`, `list_elements`, `get_element`, `new_element`,
`new_page_skeleton`, `get_page_schema`, `validate_page`.

Media (works out of the box via a shared proxy; optional own key via `PEXELS_API_KEY` env / `x-pexels-key` header — free at https://www.pexels.com/api/):
`search_images` — real stock photos for the page; returns hotlinkable URLs (`src.large` hero, `src.medium` card) to drop into an image element's `specials.src`. Only on `ok:false` → fall back to `https://placehold.co/<w>x<h>`.

Reference ingest (no env needed) — turn an EXISTING page into a layout anchor:
`ingest_html(html, intent?)` / `ingest_url(url, intent?)` — parse HTML or fetch a URL into a compact AST (title, description, sections classified by role — hero/features/form/cta/footer/… — with headings, CTAs, images, form fields, plus top colors + fonts from inline styles). Use as a LAYOUT REFERENCE, not a clone source. Default `intent='adapt'` (rewrite content for user's brand); `intent='clone'` only when the user explicitly asks. For a screenshot/image input, no tool is needed — Claude analyzes it natively.

Backend (need `WEBCAKE_API_BASE` + `WEBCAKE_JWT` env):
`list_organizations`, `create_page`, `list_pages`, `find_pages`, `get_page`, `update_page`, `add_section`, `patch_page`, `publish_page`.
`create_page` / `update_page` / `add_section` / `patch_page` / `publish_page` default to `dry_run=true`.
`find_pages` searches the account's pages by name, domain, and/or page id (AND-combined) to locate the page to edit when you don't already have a `page_id` — results include both `custom_domain` and `default_domain` to disambiguate by URL.
`add_section` appends section(s) to an existing page server-side so you send only the new section, not the whole source — use it to build a LARGE page incrementally (`create_page` small skeleton → `add_section` per section) and avoid the giant single payload that can drop the connection.
`publish_page` makes a page LIVE (saves the stored source as a version + creates/updates `page_published`, optional `custom_domain`/`custom_path`). The PREVIEW link does NOT need it — `preview_url` lives on the preview host (`preview.localhost:5800` local / `staging.webcake.me` staging / `www.webcake.me` prod — NOT the builder subdomain) and renders the stored source immediately; publish only when the user wants the page public/on their domain.
`patch_page` edits a page by element id without re-sending the whole source — send only per-element ops (`update`/`replace`/`remove`/`add`; `update` can set `type` to fix a wrong element type). Targets EITHER a live page (`page_id`) OR a cached failed-create source (`draft_id`). It's the SMALL-EDIT path AND the fix-after-error path: a failed `create_page` returns a `draft_id` (source cached ~30 min) → `patch_page({ draft_id, patches, dry_run:false })` fixes only the bad elements and creates the page; a failed `update_page`/`add_section` already has a `page_id` → `patch_page({ page_id, patches })`. Never regenerate the whole source to fix a few elements.

Reference docs in this repo: [docs/page-element-schema.md](../../../docs/page-element-schema.md),
[src/domains/landing/page-schema.json](../../../src/domains/landing/page-schema.json).

## Page-source model (cheat-sheet)

```jsonc
{ "page": [<section>...], "popup": [<popup>...], "settings": {...},
  "options": { "currency":"VND", "mobileOnly":false, "versionID":null }, "cartConfigs": {} }
```
- `page` = sections stacked vertically; `popup` is a SEPARATE top-level array (NOT inside `page`).
- Element: `{ id, type, properties:{name,movable,sync}, responsive:{desktop,mobile:{config,styles}}, specials, children, runtime, events }`.
- **SPARSE AUTHORING (default — ~half the tokens per element):** the server hydrates every
  element from its type's factory defaults, so emit ONLY `id`, `type`,
  `responsive.desktop.styles` + `responsive.mobile.styles` (BOTH breakpoints), `specials`, and
  `events` when the element really has them. OMIT `properties`/`runtime`/empty
  `events`+`children`/per-breakpoint `config`. The whole loop is sparse: `get_element`
  skeletons/examples and `new_element` come in this shape (copy as-is), `get_page` returns the
  source COMPACTED the same way (edit + send back without re-adding boilerplate), and
  `create_page`/`update_page`/`add_section`/`patch_page`/`validate_page` all hydrate before
  validating/persisting. A full node still works.
- Absolute canvas: children carry numeric `top/left/width/height` (px) per breakpoint (desktop≈960, mobile≈420); sections own a `height`, no top/left.
- Content lives in `specials` (`text`, `src`, `field_name`…), NEVER in `styles`. Colors as `rgba(...)`.
- Animation in `config.animation = {name,delay,duration,repeat}`. Event: `{id,type,action,target,appTarget,hoverColor}`.

## Workflow — new page

1. **INTAKE — every time, even a quick/test page** (ask first, offer defaults, don't assume, and do NOT jump straight to building): page purpose/goal · brand/page name · what they sell + price (sales/ads pages) · primary color + logo/branding · sections & layout in order · primary CTA + destination · form fields · desktop+mobile or mobile-only · which organization. Then RESTATE a short outline (sections + CTA + colors) and wait for the user's confirmation before generating. Don't generate + persist on the same turn as the request.
2. `get_generation_guide`, then `new_page_skeleton`.
3. `get_element` per type (specials + sparse example); `new_element` for sparse skeletons.
4. Assemble `{ page, popup, settings, options, cartConfigs }` from SPARSE nodes; fill `specials`, set coordinates (no overlaps).
5. `validate_page` → fix every error.
6. `list_organizations` → show options, ask which (default = `is_default`).
7. `create_page` `dry_run:true` (preview) → `dry_run:false` with chosen `organization_id`.
8. Give the editor/preview URLs — `preview_url` (on the preview host) renders right away for review. If the user wants the page LIVE / on a domain: `publish_page({ page_id, custom_domain?, custom_path?, dry_run:false })`.

## Workflow — edit existing page

1. `find_pages({ name?, domain?, page_id? })` to locate the page by name/domain/id (or `list_pages` to browse; or take a `page_id` straight from a URL).
2. `get_page(page_id)` → the live `{ page, popup, settings, ... }`, COMPACTED to the sparse shape (pass `compact:false` only if you need the raw stored tree).
3. **Edit surgically**: change only what was asked; keep every other element, its `id`, and coordinates; send the compacted tree back as-is (no boilerplate). To add: `new_element`, unique id, place in the right section's `children`.
4. `validate_page` → `update_page(page_id, source)` (`dry_run:true` then `dry_run:false`).

## Rules

- INTAKE every time before generating (even a "test" page) — confirm purpose, name, colors, layout + an outline first, and don't build on the same turn as the request; never invent prices/phones/addresses/stats.
- `validate_page` before any create/update; fix every error.
- `dry_run` first; send `dry_run:false` only after user confirms.
- Edit surgically; preserve ids + coordinates.
- Owner-scoped endpoints; default org = `is_default` (pass `organization_id` or set `WEBCAKE_ORG_ID`).
- Popups are top-level; form inputs need unique `specials.field_name` (canonical keys for auto-typing).
- Numbers for `top/left/width/height/fontSize`; colors `rgba()`; only containers have `children`.
- Author SPARSE (omit `properties`/`runtime`/empty `events`+`children`/`config` — the server hydrates them); when you DO send `runtime`, it is `{}`.

## Setup

`npm install && npm run build`, then register the MCP with env `WEBCAKE_API_BASE`, `WEBCAKE_JWT`
(+ optional `WEBCAKE_ENV`, `WEBCAKE_ORG_ID`, `WEBCAKE_APP_BASE`). The backend AI endpoints
(`/api/v1/ai/*`) must be running (landing_page_backend, branch `feat/ai-page-element-mcp`).
