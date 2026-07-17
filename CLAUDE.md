# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) **stdio** server that teaches an AI agent how to build a complete
Webcake landing-page **source JSON** from a requirement, validate it, and persist it to a Webcake
backend. The server is *knowledge + validation + persistence* — it does **not** render pages. The AI
agent assembles the full `{ page, popup, settings, options, cartConfigs }` object; `create_page` saves it
and then AUTO-PUBLISHES (build host + `publish_html`) so the preview renders; the EDIT tools
(`update_page`/`add_section`/`patch_page`) save source-only (re-publish via `publish_page` to refresh the
rendered build).

Published to npm as `webcake-landing-mcp`; runs via `node dist/index.js` or `npx -y webcake-landing-mcp`.

## Commands

```bash
npm run build      # tsc -> dist/ AND copies src/**/*.json -> dist/ (scripts/copy-assets.mjs; both steps matter)
npm run smoke      # offline self-test of factory + validator; MUST print "ALL GOOD". Run after every change.
npm run dev        # tsc --watch
npm start          # node dist/index.js (start the stdio server)
node dist/index.js serve --port 8787   # remote Streamable-HTTP server (Claude custom connector); or PORT env
npm run release    # interactive local publish (scripts/release.js): build+smoke gate, npm version, OTP publish, gh release
npm run release:dry   # dry-run the release flow without publishing
```

There is no unit-test runner or linter — `npm run smoke` is the test gate. It exercises the pure logic
(factory skeletons, validator, and every `LIBRARY` example) without an MCP transport. `prepublishOnly`
runs `build && smoke`, so a broken smoke test blocks publishing.

## Build rules (must follow when editing `src/`)

1. **Each element is ONE descriptor.** An element's docs + `container`/`field` flags + `defaultName` + factory `seed` + `example` all live in a single object in `src/domains/landing/elements/<category>.ts`. `CONTAINER_TYPES`/`FIELD_TYPES`/the catalog/`createElement` all DERIVE from these — adding or editing a type is a one-file change. Only `src/domains/landing/page-schema.json`'s `elementType` enum must be updated alongside; `smoke` re-checks it against the descriptor keys, so schema drift fails the gate.
2. **Gate every change:** `npm run build && npm run smoke` — must end with `ALL GOOD`. Editing the schema requires a rebuild (`dist/domains/landing/page-schema.json` is runtime data copied by the build).
3. **New tools** go in a `src/tools/*.ts` group via `server.tool(...)`, return through the `text()` helper (`src/mcp/response.ts`), and register the name in `src/domains/landing/instructions.ts` + `docs/tools.md`(+`.vi`) + the README at-a-glance table + the `webcake-landing` skill. **New HTTP** goes in `src/persistence/webcake-client.ts`.
4. **Mutating tools default to `dry_run=true`** and return a JWT-redacted request preview; only the network when `dry_run===false`.
5. **stdout is the MCP channel** — log with `console.error` only. **ESM/Node16** — relative imports end in `.js`. **Secrets** come from `WEBCAKE_JWT` env only; the repo is public.

Specialist subagents (`.claude/agents/`) enforce these: **mcp-tool-author** (add/modify a tool),
**page-model-guardian** (model/schema changes), **mcp-verifier** (run the gate + convention checks).
Delegate matching work to them.

## Architecture

The code is layered so the landing knowledge can grow into other output types later without rewiring the core. `src/core/` is domain-agnostic, `src/domains/landing/` is everything landing-specific, and the tool/server layers depend only on the `Domain` seam.

- **`src/core/`** — domain-agnostic primitives:
  - `element.ts` — the `ElementNode` shape, `base()`, the `setStyle/setBox/seedPosition` helpers, `randomId`, `imgPlaceholder`, `defaultAnimation`.
  - `descriptor.ts` — the `ElementDescriptor` model + `createElementFrom`/`buildCatalog`/`deriveContainerTypes`/`deriveFieldTypes`.
  - `expand.ts` — `expandNode`/`expandSource`: hydrate a SPARSE element node by merging it onto its type's factory default (recursively for children), so the model can omit boilerplate (`properties`/`runtime`/empty `events`+`children`/per-breakpoint `config`) and emit ~half the JSON per element. Exposed as `domain.expand`; `create_page`/`update_page`/`add_section`/`patch_page`/`validate_page` run it BEFORE validate/persist. A full node still works (overlaid on the seed).
  - `compact.ts` — the INVERSE of expand, so the model also READS sources in the sparse shape it's asked to write: `compactNode`/`compactSource` strip from a full tree everything the seed re-creates (invariant, smoke-tested: `expand(compact(x))` persists the same tree as `expand(x)`); exposed as `domain.compact` and used by `get_page` (default `compact:true`). Also `sparseTemplate` — the sparse authoring template (keeps seeded styles/specials/non-default config) that `get_element` skeletons and `new_element` return, and `deepEq`. The descriptor `example`s are authored sparse too (smoke expands them before validating).
  - `domain.ts` — the `Domain` interface (the seam the tools depend on) + `ValidationResult`.

The landing element model is the heart of the project. It lives under `src/domains/landing/`:

| File | Role |
|------|------|
| [src/domains/landing/elements/](src/domains/landing/elements/) | The element catalog as **ONE descriptor per type**, split by category (`layout/content/form/commerce/marketing.ts`). Each descriptor carries the element's docs (`summary`, `useWhen`, `keySpecials`, `example`), its `container`/`field` flags, its `defaultName`, and a `seed(el)` that stamps the editor's visual defaults. `index.ts` concatenates them and DERIVES `LIBRARY` (the catalog), `CONTAINER_TYPES`, `FIELD_TYPES`, `ELEMENT_TYPES`, and `createElement`. |
| [src/domains/landing/page-schema.json](src/domains/landing/page-schema.json) | Canonical JSON Schema (Draft 2020-12). Loaded at **runtime** via `readFileSync` (not `import`), so the build must copy it into `dist/`. |
| [src/domains/landing/validate.ts](src/domains/landing/validate.ts) | `validatePage()` — ajv structural check + semantic checks the schema can't express (unique ids, dangling event/option/connect targets, duplicate `field_name` per form, children-only-on-containers, missing `field_name`, off-canvas layout bounds). Schema errors are enriched to name the enclosing **element id/type**, the offending key (`additionalProperties`) or bad value (`enum`/`type`), and the fixing op — positional ajv paths alone made models patch the wrong element. Consumes `CONTAINER_TYPES`/`FIELD_TYPES` from `elements/`. |
| [src/domains/landing/page.ts](src/domains/landing/page.ts) | `createPageSource()`/`defaultSettings()` — the top-level `{ page, popup, settings, options, cartConfigs }` shell. |
| [guide.ts](src/domains/landing/guide.ts) · [vocab.ts](src/domains/landing/vocab.ts) · [instructions.ts](src/domains/landing/instructions.ts) | `GENERATION_GUIDE`; `CANVAS` (desktop 960 / mobile 420) + the event vocab (`CLICK/HOVER/SUCCESS/ERROR/DELAY_ACTIONS`, `EVENT_TRIGGERS`); the server `instructions` string. |
| [src/domains/landing/index.ts](src/domains/landing/index.ts) | `landingDomain` — assembles all of the above into the `Domain` object the server consumes. |

To add or edit an element, change **one descriptor** in `src/domains/landing/elements/<category>.ts` (`container: true` auto-joins `CONTAINER_TYPES`; `field: true` auto-joins `FIELD_TYPES`; add a `seed` for visual defaults; any `example` is smoke-tested and must validate), then extend the `elementType` enum in `page-schema.json`. `smoke` asserts the enum stays in sync with the descriptor keys, so schema drift fails the gate rather than passing silently.

Surrounding the domain:

- [src/index.ts](src/index.ts) — thin entry: subcommand dispatch — `install|uninstall|--help` runs the bundled installer, `login` grabs the JWT via the browser and saves `~/.webcake-landing-mcp/auth.json` (see [src/auth/login.ts](src/auth/login.ts)), `serve [--port N]` (or `PORT` env) starts the remote HTTP server, no subcommand starts the stdio server.
- [src/server.ts](src/server.ts) — `createServer()`: builds the `McpServer` with the domain's `instructions` and registers the tool groups. Used by BOTH transports.
- [src/http.ts](src/http.ts) — remote **Streamable HTTP** transport (stateful sessions) so the server can be a Claude "custom connector" via a URL. Each request's headers carry the caller's own Webcake JWT (multi-user).
- [src/tools/](src/tools/) — the 22 tools as five group modules (`reference.ts`, `generation.ts`, `media.ts`, `ingest.ts`, `persistence.ts`) wired by `tools/index.ts`; each depends only on the injected `Domain` (media needs no domain). The `text()` + `image()` helpers live in [src/mcp/response.ts](src/mcp/response.ts). Persistence + media tools resolve credentials per request from `extra.requestInfo.headers` (HTTP), else env.
- [src/persistence/](src/persistence/) — the Webcake backend: `config.ts` (`readConfig` precedence: per-request overrides → env → the saved `auth.json` written by `login`; `configFromHeaders` for the HTTP `x-webcake-*` / `Authorization: Bearer` headers), `webcake-client.ts` (create/update/list pages, list orgs + JWT-redacted dry-run previews), `rehost.ts` (pure collect+rewrite of external image URLs — see auto-host below), `pexels-client.ts` (the `search_images` stock-photo client — direct Pexels with a key, else the shared `mcp.toolvn.io.vn` proxy), `types.ts`.
- [src/install.ts](src/install.ts) — bundled IDE installer; writes the MCP server block into claude-desktop / claude-code / cursor / windsurf / augment / codex / antigravity / gemini (CLI) / cline / kiro / opencode config files.

The 22 tools fall into five groups: **reference** (`get_generation_guide`, `list_elements`, `get_element`,
`get_page_schema` — no env needed), **generation** (`new_element`, `new_page_skeleton`, `validate_page`),
**media** (`search_images` — Pexels stock photos; needs a Pexels key but no Webcake env; `get_icon_svg` — resolves Material Symbols / Font Awesome icon names to inline SVG via Iconify, no creds; `upload_images` — re-hosts external images to Webcake; files into the media collection (`POST <builderBase>/api/persona/upload`, the editor's own media-picker route → Image + Asset rows, so the image is re-pickable) when a JWT AND an org both resolve — the org is REQUIRED for a collection upload and must be the SAME org the page is created in, so settle it UP FRONT during intake, before any image work. Explicit `organization_id` / `WEBCAKE_ORG_ID` / `x-webcake-org-id` win; exactly ONE org auto-selects; 2+ orgs and none chosen → the call returns `ok:false` with `reason:"organization_required"` + the org list, and the caller must re-call with `organization_id` (mirrors `create_page`; it no longer files into a personal collection). Without a JWT it still falls back to the public `external/upload_file` CDN path — URLs work, no Asset row, `collection:false` (the zero-config `npx` path). Optional `in_folder` targets a specific sub-folder and overrides the resolved org root; no creds needed; `render_preview` — screenshots a page's `/preview/<id>` (or any URL) to a PNG the model can SEE and compare to the reference [the clone-fidelity check]; zero-config via Microlink's free per-IP tier, host can point `RENDER_SCREENSHOT_BASE` at a keyed proxy, graceful skip on 429; prefer the agent's own screenshot ability when it has one), **ingest**
(`ingest_html`, `ingest_url` — no env needed), and
**persistence** (`list_organizations`, `create_page`, `list_pages`, `find_pages`, `get_page`, `update_page`, `add_section`, `patch_page`, `publish_page` — need env).
`find_pages` searches the account's pages by name / domain / id (AND-combined) via the dedicated `/api/v1/ai/search_pages` backend endpoint — the lookup step before an edit; it falls back to filtering `list_pages` client-side (name/id only) if that route is missing (older backend → 404).
`add_section` appends section(s) to an existing page server-side via the dedicated `/api/v1/ai/append_section` backend endpoint (backend reads stored source → appends → rejects duplicate ids → saves), so the model sends only the new section instead of the whole source AND the MCP skips the whole-source get+put. It validates the new section(s) client-side first; if the endpoint is missing (older backend → 404) it falls back to the legacy get→merge→validate-whole-tree→put path. This is the incremental-build path that avoids the giant single `create_page` payload that can drop the client↔Claude connection on large pages.
`patch_page` edits a page by element id without re-sending the whole source — the model sends only per-element ops (`update`/`replace`/`remove`/`add`, keyed by id; `update` can set `type`) and the MCP does the heavy lifting on the robust MCP↔backend link: it loads the source, applies the ops in-tree, validates the WHOLE merged tree (blocks on errors), and saves. It's a pure MCP-side load→merge→save (no dedicated backend endpoint, unlike `add_section`), so it works against any backend. Two source modes: **`page_id`** edits a LIVE page (get→merge→`update_page`; needs creds even on `dry_run` to read the page), and **`draft_id`** fixes a CACHED failed-create source then `create_page`s it. The draft mode closes the create-before-save gap: when `create_page` fails validation there is no page_id, so it caches the expanded source in [src/persistence/draft-cache.ts](src/persistence/draft-cache.ts) (in-memory, bounded, ~2-hour SLIDING TTL — every get/update refreshes the clock so an active fix workflow never expires; override: `WEBCAKE_DRAFT_TTL_MS` env) and returns a `draft_id` in the error; `patch_page({ draft_id, patches })` applies the fixes, re-validates, and creates the page (keeping the fixes cached across rounds until valid). So the FIX-AFTER-ERROR path never rebuilds + re-ships the whole payload — `create_page` fail → `draft_id`; `update_page`/`add_section` fail → existing `page_id`.
`create_page` AUTO-PUBLISHES after a successful create (same build+`publish_html` flow as `publish_page`, skipped when no build host or `publish:false`; a publish failure never fails the create — `result.publish` carries the retry hint).

**Auto-host external images on save.** Every REAL save — `createPage`/`updatePageSource`/`appendSection` in `webcake-client.ts` — runs `rehostSourceImages(config, source)` BEFORE the network store (it takes the whole config, not just the base, because the collection route needs the JWT + builder host + org): it collects every external image URL in the tree (via [src/persistence/rehost.ts](src/persistence/rehost.ts)'s `collectExternalImageUrls` — `specials.src`, any `url(...)` background, gallery `item.link`, video poster; skips `data:`, already-hosted `statics.pancake.vn`, and placeholder hosts), downloads + re-uploads each via the same collection path `upload_images` takes (`POST <builderBase>/api/persona/upload` when a JWT AND an org both resolve — explicit org wins, else auto-select when the account has exactly one org; with no org resolvable the images take the public `POST <apiBase>/external/upload_file` instead — the rehost NEVER blocks a save over images), and `rewriteImageUrls` swaps them in-tree. It's the chokepoint that makes the model's image step un-skippable: a clone just carries the source URLs through and they get hosted. Process-wide `rehostCache` dedupes across elements and saves; per-URL fetch/upload failure keeps the original URL and never blocks or throws; capped at `MAX_REHOST_PER_SAVE`. The outcome carries `rehost: {candidates,rehosted,failed,skipped,collection,collection_org_id}` (`collection` is true only when a JWT AND an org resolved; `collection_org_id` names that org) + `rehosted_source` (the rewritten tree — `create_page`/`patch_page` feed it to auto-publish so the rendered build matches the stored tree). Dry-run never reaches these functions, so it never uploads. `rehost.ts` is PURE (no network/no `webcake-client` import → no cycle); the network pass lives in `webcake-client.ts`. So `upload_images` is now only REQUIRED for a user's LOCAL FILE PATHS (the save can't read local files) — or to file an image into a specific collection folder (`in_folder`), which the save's org-root default can't target.

**Filing into an org's collection needs TWO things, not one** (a subtle backend contract, easy to half-implement):
1. the `x-org-id` header — stamps the Asset's `organization_id`; and
2. `in_folder` = the org's **ROOT collection folder**, resolved via `GET <builderBase>/api/organization/folders/all?type=organization-image` and picking the folder with `type === -1`.

Why both: `AssetsController.upload` defaults `folder_id` to the account's PERSONA folder, and the collection listings query by `folder_id` — so sending only the header stamps the asset to the org but strands it in the personal folder, where it shows up in NEITHER library. This mirrors the editor itself (builderx_spa `landingLibrary.js` does `folders.find(f => f.type == -1)` and passes it to `personalApi.upload` as `in_folder`). The resolution is memoized per (builder, jwt, org).
`publish_page` makes a page LIVE: it calls a standalone **build host** (`POST <buildBase>/render/build`) to produce `app`/`app_css` rendered HTML, then POSTs the editor-shaped payload `{ custom_domain, custom_path, selected_custom_domain, data_node: <source JSON string>, render_type, app, app_css, settings (+mobile_only), type, auto:false }` to the editor's own `/api/pages/:page_id/edit/publish_html` route (NOT under `/api/v1/ai`; mirrors the editor's PublishModal). That route is the ONLY one that creates/updates the **PagePublishedV2** record — the record ALL public serving paths read (`render_custom_domain` serves `page_published_v2.app`). The older `/edit/publish` route (PagePublished **v1** + app on the page_source row) is kept ONLY as the source-only fallback when no build host is available — it makes nothing live. **Serving model:** a page is only permanently live on a `custom_domain`; without one the only public URL is `/preview/<page_id>`, which the backend serves from `page_source.app` for just **~10 minutes** after the last save (then "Preview page is expired", capped at 20 guest IPs/day) — so an MCP-created page's preview is blank (app NULL) until a rendered publish, and even then the preview link is ephemeral by design. The prod build host `https://build.webcake.io` is the preset default only when the env resolves to `prod` (`WEBCAKE_ENV=prod`, `--env prod`, or `x-webcake-env: prod`). Staging/local have no reliable public build host — set `WEBCAKE_BUILD_BASE` env or send `x-webcake-build-base` per request. Without a build host `publish_page` falls back to the legacy source-only route with a `warning` (`rendered:false, live:false`). Build request body renames: `source.popup → popups`, `source.cartConfigs → $cartConfigs` (required — builder crashes without it), `source.svariations → $syncVariations`. `toPreviewUrl` re-roots `preview_url` onto the preview host. `toEditorUrl` keeps editor links on the builder host, and `toEditorLoginUrl` wraps them in the builder's public `GET /transport?token=<jwt>&redirect_uri=` route (sets the `jwt` cookie, then redirects) — the bare `/editor/v2/<id>` route 401s without that cookie, so every returned `editor_url` is a SELF-LOGGING-IN link carrying the caller's own jwt (env / auth.json / per-request header); preview links are public and stay unwrapped.

### Page-source model invariants

When touching the model, preserve these (they live in the schema, the guide, and the validator together):

- Top-level: `{ page: [sections], popup: [popups], settings, options: {currency, mobileOnly, versionID}, cartConfigs }`. **Popups are a separate top-level array**, never nested in `page`.
- Absolute-positioning canvas (not flexbox): every child carries numeric `top/left/width/height` in px per breakpoint; sections own a `height` and have no `top/left`. Canvas width is fixed (desktop 960, mobile 420).
- Visible content lives in `specials` (`text`, `src`, `field_name`…), never in `styles`. Colors are `rgba()`. Form inputs need a unique `specials.field_name`.
- `validate_page` **errors block** persistence; **warnings** (text-overlap collisions, off-canvas bounds, empty bands, dangling event target, missing `field_name`) don't block but are treated as a fix list — `warningsField()` (src/mcp/response.ts) attaches a `warnings_notice` directive to every tool response carrying warnings so the model fixes them and re-validates instead of ignoring them.

## Conventions that bite

- **ESM + Node16 module resolution.** Relative imports use a `.js` extension even though the source is `.ts` (e.g. `import { validatePage } from "./validate.js"`, `import { base } from "../../core/element.js"`). The `bin` shebang and `"type": "module"` matter.
- **`page-schema.json` is runtime data, not a TS import.** `npm run build` is `tsc` *plus* `scripts/copy-assets.mjs` (mirrors every `src/**/*.json` into `dist/`) — if you only run `tsc`, `dist/domains/landing/page-schema.json` is missing and `validate.ts` throws at startup. Editing the schema requires a rebuild before smoke/run.
- **ajv is CJS under ESM:** `validate.ts` reaches the constructor via `(Ajv2020Module as any).default ?? Ajv2020Module`.
- **stdout is the MCP channel** — all logging goes to `console.error` (stderr) only. Never `console.log` from server code.
- **`create_page`/`update_page` default to `dry_run=true`** (validate + return the redacted request they *would* send). Real writes need `dry_run=false`.
- **Secrets:** the JWT comes only from `WEBCAKE_JWT` env. The repo is public — never hard-code a token, account, or page data.

## Environment variables (persistence tools only)

`WEBCAKE_API_BASE` + `WEBCAKE_JWT` are required to hit the backend; `WEBCAKE_ENV`
(`local|staging|prod`, or the global `--env` flag) fills in `WEBCAKE_API_BASE` + `WEBCAKE_APP_BASE` +
`WEBCAKE_BUILDER_BASE` from a preset — single source of truth: `ENVIRONMENTS` in [src/persistence/config.ts](src/persistence/config.ts)
(explicit vars and the per-request `x-webcake-env` header / `?env=` query still win); `WEBCAKE_ORG_ID`
(default org), `WEBCAKE_APP_BASE` (SPA base for the `login` connect page), and `WEBCAKE_BUILDER_BASE`
(the **builder host** for the `/editor/v2` editor/preview links returned by `create_page`/`update_page` —
distinct from the API and SPA bases; defaults to the preset, else derived from the API host
`api.x`→`builder.x`) are optional. The backend endpoints this calls live in the separate `landing_page_backend` repo
(`LandingPageWeb.V1.AiController`, scope `/api/v1/ai`).

Separately, the **`search_images`** tool fetches stock photos and is independent of the Webcake backend env.
With a key — `PEXELS_API_KEY` env (loaded from `.env` at startup by [src/env.ts](src/env.ts)) or the per-request
`x-pexels-key` header — it calls Pexels directly. WITHOUT one it falls back to a **shared hosted proxy**
(`PEXELS_PROXY_BASE`, default `https://mcp.toolvn.io.vn`) so `npx` users get images with zero setup. That proxy
is just this server in `serve` mode serving `GET /api/images/search` with its own `PEXELS_API_KEY` (see
[src/http.ts](src/http.ts)). Free Pexels key: https://www.pexels.com/api/. A `.env` (gitignored; template
[.env.example](.env.example)) is the convenient place to set these locally.

The **`render_preview`** tool screenshots a page's `/preview/<id>` (or any URL) to a PNG the model can SEE
(the clone-fidelity check). Engine resolution (mirrors the Pexels pattern, with AUTO-FALLOVER) lives in
[src/persistence/screenshot-client.ts](src/persistence/screenshot-client.ts): `captureScreenshot` tries the
`RENDER_SCREENSHOT_PRIMARY` engine first (`microlink`, default, or `proxy`) and falls over to the other when
the first fails — so the free **Microlink** tier (`api.microlink.io`, no key, rate-limited ~50/day **per IP**;
optional `MICROLINK_API_KEY` / `x-microlink-key` for more) is used up first, then traffic auto-switches to the
**self-hosted Playwright** route. That route is `GET /api/render/screenshot?url=…&full_page=…&width=…` served by
this server in `serve` mode (point `RENDER_SCREENSHOT_BASE` / `x-render-screenshot-base` at the host;
[src/http.ts](src/http.ts) → [src/persistence/screenshot-playwright.ts](src/persistence/screenshot-playwright.ts)).
**Playwright is NOT a package dependency** (keeps `npx` light — no Chromium download); it's lazy-imported, so the
route replies 503 unless the VPS installs it: `npm i playwright && npx playwright install --with-deps chromium`
(or `npm i playwright-core` + `CHROME_BIN=/path/to/chrome` to reuse a system browser). The route blocks
private/loopback targets (SSRF; opt out with `RENDER_ALLOW_PRIVATE=1`). The AGENT should prefer its OWN screenshot
ability (e.g. a chrome-devtools MCP) over this tool — see the `instructions`/`GENERATION_GUIDE` "VISUAL CHECK".

## Release flow

Two paths, both gated by build+smoke:

- **Local:** `npm run release[:patch|:minor|:major]` runs [scripts/release.js](scripts/release.js) — npm-login check, gate, `npm version`, OTP-prompted publish (idempotent resume if a prior run bumped but failed to publish), push tags, `gh release create` from the matching `CHANGELOG.md` section.
- **CI:** [.github/workflows/auto-release.yml](.github/workflows/auto-release.yml) fires on push to `main` touching `src/**` (skips `chore(release):` commits). It auto-resolves the bump from commit messages (`feat`→minor, `BREAKING CHANGE`/`!:`→major, else patch), generates the changelog entry with the Claude CLI, then publishes to npm + GitHub Releases. So: **a `src/**` change merged to `main` ships a release automatically.**

## Skills & more detail

Two project skills (in `.claude/skills/`) — pick by what you're doing:

- [webcake-mcp-dev](.claude/skills/webcake-mcp-dev/SKILL.md) — **working ON this server**: recipes for adding a tool, adding an element type (one descriptor), the layered `core`/`domain`/`tools` layout, and the build+smoke gate. Use this when editing `src/`.
- [webcake-landing](.claude/skills/webcake-landing/SKILL.md) — **using the MCP** to build/edit landing pages end-to-end.

[AGENTS.md](AGENTS.md) has the agent-facing runtime rules and a condensed repo-rules list.
[docs/page-element-schema.md](docs/page-element-schema.md) is the full element-model reference.
