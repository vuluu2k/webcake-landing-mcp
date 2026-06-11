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

## Tools (20)

Reference/validation (no backend/env needed):
`get_generation_guide`, `list_elements`, `get_element`, `new_element`,
`new_page_skeleton`, `get_page_schema`, `validate_page`.

Media (works out of the box; no Webcake credentials required for either tool):
`search_images` — real stock photos, ONLY for image slots with NO source image (nothing supplied by the user, nothing in the reference HTML/URL); returns hotlinkable URLs (`src.large` hero, `src.medium` card) to drop into an image element's `specials.src`. Works out of the box via a shared proxy; optional own key via `PEXELS_API_KEY` env / `x-pexels-key` header — free at https://www.pexels.com/api/. Only on `ok:false` → fall back to `https://placehold.co/<w>x<h>`.
`upload_images` — converts external image URLs (from `ingest_html`/`ingest_url` results) or `data:` URIs into Webcake-hosted URLs (`statics.pancake.vn`) for use in `specials.src`. Reference images are the user's assets: use this for BOTH intents (adapt AND clone) whenever the page is built from a reference HTML/URL, and whenever the user provides their own image URLs — never swap them for stock photos. Batch: up to 20 URLs/call in parallel, 8 MB cap per image. No Webcake creds needed. Defaults to `dry_run=true`.

Reference ingest (no env needed) — turn an EXISTING page into a layout anchor:
`ingest_html(html, intent?, detail?)` / `ingest_url(url, intent?, detail?)` — parse HTML or fetch a URL into a reference AST (title, description, sections classified by role — hero/features/form/cta/footer/… — with headings, CTAs, images, form fields, top colors + fonts from BOTH inline styles and `<style>` blocks, CSS custom-property palette (design tokens by name), background_images from stylesheets, and a per-section `size_hint` = `{ height, basis, css? }` — the desktop section height in px (from explicit source CSS when present, else a content-volume estimate); set each rebuilt section's desktop height from it instead of the 800px default, then redo the mobile height per the mobile text math). `detail:'compact'` (default, ~2-5 KB) gives backward-compatible layout hints. `detail:'full'` (~up to 25 KB) adds: per-section `blocks` (repeating card/tile/step structures: title, body, image, cta), `lists` (li items), `gradients`, `images` as `{ src, alt }` objects, and `widgets` = `{ hint, html, css? }` — the cleaned source HTML + matching CSS of composite visuals (phone/device mockup, chat thread, dashboard, browser frame); build the html-box FROM that html verbatim with the css inlined, never re-imagine the widget's markup — use for clone-faithful rebuilds. Default `intent='adapt'` (rewrite the TEXT for the user's brand); `intent='clone'` only when the user explicitly asks. For BOTH intents: re-host image URLs found in the AST (`images`, `background_images`, `og_image`) via `upload_images` and reuse them in the matching slots — adapt rewrites text, not imagery; `search_images` only fills slots with no source image. For a screenshot/image input, no tool is needed — Claude analyzes it natively.
Role → element mapping hints: hero → section (background image/overlay) + text-block H1 + text-block subheading + button; features → group per card (icon rectangle + title text-block + body text-block); stats bar → group with text-block per stat; pricing → group with text list + button; footer → section (dark bg) + text-block + links.

Backend (need `WEBCAKE_API_BASE` + `WEBCAKE_JWT` env):
`list_organizations`, `create_page`, `list_pages`, `find_pages`, `get_page`, `update_page`, `add_section`, `patch_page`, `publish_page`.
`create_page` / `update_page` / `add_section` / `patch_page` / `publish_page` default to `dry_run=true`.
`create_page` AUTO-PUBLISHES after a successful create (build host + `publish_html`) so the preview renders immediately — `publish:false` skips it; a publish failure never fails the create (`result.publish` carries the retry hint). The EDIT tools save source-only — after a round of edits run `publish_page({ page_id, dry_run:false })` to refresh the rendered build, else the preview shows the stale pre-edit version.
`find_pages` searches the account's pages by name, domain, and/or page id (AND-combined) to locate the page to edit when you don't already have a `page_id` — results include both `custom_domain` and `default_domain` to disambiguate by URL.
`add_section` appends section(s) to an existing page server-side so you send only the new section, not the whole source — use it to build a LARGE page incrementally (`create_page` small skeleton → `add_section` per section) and avoid the giant single payload that can drop the connection.
`publish_page` makes a page LIVE: calls the Webcake build host (`POST <buildBase>/render/build`, prod default `https://build.webcake.io`) to produce rendered `app`/`app_css` HTML, then publishes via the editor's `publish_html` route — the ONLY route that writes the **PagePublishedV2** record all public serving reads. With `custom_domain`/`custom_path` the page is permanently live at that domain. **Without a domain there is NO permanent public URL**: the `/preview/<page_id>` link serves the stored rendered app for only **~10 minutes** after the publish, then shows "Preview page is expired" — tell the user and suggest attaching a domain. An MCP-created page's preview is blank until a rendered publish (the AI save routes store source only). Without a build host `publish_page` falls back to a legacy source-only save (`rendered:false, live:false`) with a warning — nothing goes live. Set `WEBCAKE_BUILD_BASE` env or `x-webcake-build-base` header for staging/local (prod preset auto-configures).
`patch_page` edits a page by element id without re-sending the whole source — send only per-element ops (`update`/`replace`/`remove`/`add`; `update` can set `type` to fix a wrong element type). Targets EITHER a live page (`page_id`) OR a cached draft (`draft_id`). It's the SMALL-EDIT path, the fix-after-error path, AND the retry-after-timeout path:
- failed/timed-out `create_page` → returns `draft_id` (full source cached ~2 h) → `patch_page({ draft_id, patches, dry_run:false })` fixes bad elements and creates the page; or `patch_page({ draft_id, dry_run:false })` with NO patches commits as-is (timeout retry).
- `add_section` dry_run=true, validation failure, or timeout → returns `draft_id` (section batch cached ~2 h) → `patch_page({ draft_id, patches, dry_run:false })` fixes elements and appends; or `patch_page({ draft_id, dry_run:false })` with no patches to commit as-is.
- failed/timed-out `update_page` → returns `draft_id` (full source cached) → `patch_page({ draft_id, dry_run:false })` with no patches retries the update.
- live-page `patch_page` that timed out → response carries `draft_id` (patched source cached) → `patch_page({ draft_id, dry_run:false })` with no patches retries.
- `update_page` validation failure → the page already has a `page_id` → `patch_page({ page_id, patches })`.
COMMIT-AS-IS (universal timeout retry): `patch_page({ draft_id, dry_run:false })` with empty/omitted patches — skips apply, re-validates, saves. Never regenerate the whole source to fix a few elements.

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

1. **INTAKE — every time, even a quick/test page** (ask first, offer defaults, don't assume, and do NOT jump straight to building): page purpose/goal · brand/page name · what they sell + price (sales/ads pages) · primary color + logo/branding · sections & layout in order · primary CTA + destination · form fields · desktop+mobile or mobile-only · which organization (only ask when the account has 2+ orgs — call `list_organizations` to check first; if exactly 1 org, save into it automatically; pass `organization_id:"personal"` only when the user explicitly wants no org). Then RESTATE a short outline (sections + CTA + colors) and wait for the user's confirmation before generating. Don't generate + persist on the same turn as the request.
2. `get_generation_guide`, then `new_page_skeleton`.
3. `get_element` per type (specials + sparse example); `new_element` for sparse skeletons.
4. Assemble `{ page, popup, settings, options, cartConfigs }` from SPARSE nodes; fill `specials`, set coordinates (no overlaps). For intricate composite visuals (phone/chat mockup, mini dashboard, browser frame, ticket card) use ONE `html-box` with fully inline-styled HTML (root div `width:100%;height:100%;overflow:hidden`; flex/grid allowed inside; content must fit `styles.height`) instead of dozens of absolute-positioned elements — never for primary copy, CTAs, forms, or event targets.
5. `validate_page` → fix every error AND every warning (warnings are visible defects — text spilling onto the element below, off-canvas boxes, empty bands; re-validate until the list is empty, only a demonstrably false positive may remain).
6. `list_organizations` → if exactly ONE org exists, `create_page` auto-selects it (no need to ask). If MULTIPLE orgs exist, show them and ask the user which to use (highlight `is_default` as the suggested default); pass the chosen `organization_id` to `create_page`. Pass `organization_id:"personal"` only when the user explicitly wants no org. `create_page` enforces this: 2+ orgs with no `organization_id` → it returns the org list and asks you to pick.
7. `create_page` `dry_run:true` (preview) → `dry_run:false` with chosen `organization_id` (or omit if auto-selection applies).
8. Give the editor URL for review. `create_page` auto-published the page, so `preview_url` renders right away — but only for ~10 minutes after each publish (then "Preview page is expired"). After subsequent EDITS, re-run `publish_page({ page_id, dry_run:false })` to refresh the rendered build. Only `publish_page({ page_id, custom_domain, custom_path?, dry_run:false })` gives a permanent public URL — without a domain, tell the user the preview link is temporary and suggest attaching one.

## Workflow — edit existing page

1. `find_pages({ name?, domain?, page_id? })` to locate the page by name/domain/id (or `list_pages` to browse; or take a `page_id` straight from a URL).
2. `get_page(page_id)` → the live `{ page, popup, settings, ... }`, COMPACTED to the sparse shape (pass `compact:false` only if you need the raw stored tree).
3. **Edit surgically**: change only what was asked; keep every other element, its `id`, and coordinates; send the compacted tree back as-is (no boilerplate). To add: `new_element`, unique id, place in the right section's `children`.
4. `validate_page` → `update_page(page_id, source)` (`dry_run:true` then `dry_run:false`).

## Rules

- INTAKE every time before generating (even a "test" page) — confirm purpose, name, colors, layout + an outline first, and don't build on the same turn as the request; never invent prices/phones/addresses/stats.
- `validate_page` before any create/update; fix every error AND every warning — warnings are a fix list, not advisory noise (tool responses repeat this as `warnings_notice`). Never report the page done while warnings stand.
- `dry_run` first; send `dry_run:false` only after user confirms.
- Edit surgically; preserve ids + coordinates.
- Owner-scoped endpoints. Organization resolution: 1 org → auto-selected; 2+ orgs → ask user, pass `organization_id`; `"personal"` = explicit no-org. Set `WEBCAKE_ORG_ID` to skip the lookup.
- Popups are top-level; form inputs need unique `specials.field_name` (canonical keys for auto-typing).
- Numbers for `top/left/width/height/fontSize`; colors `rgba()`; only containers have `children`.
- Author SPARSE (omit `properties`/`runtime`/empty `events`+`children`/`config` — the server hydrates them); when you DO send `runtime`, it is `{}`.

## Setup

`npm install && npm run build`, then register the MCP with env `WEBCAKE_API_BASE`, `WEBCAKE_JWT`
(+ optional `WEBCAKE_ENV`, `WEBCAKE_ORG_ID`, `WEBCAKE_APP_BASE`). The backend AI endpoints
(`/api/v1/ai/*`) must be running (landing_page_backend, branch `feat/ai-page-element-mcp`).
