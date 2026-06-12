# Tools — the full reference & workflow

**English** · [Tiếng Việt](./tools.vi.md) · back to the [README](../README.md)

The tools split into five groups: **reference** (learn the model — no config needed),
**generation** (build valid nodes), **media** (stock photos), **ingest** (recreate an existing
page), and **persistence** (save to the backend — needs env vars, see
[docs/configuration.md](./configuration.md)).

End-to-end walkthroughs (build from a brief, surgical edit, inspect a type) live in
[docs/usage-examples.md](./usage-examples.md).

---

## The workflow, step by step

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

`validate_page` **errors are blocking**; warnings (text spilling onto the element below, off-canvas bounds, empty bands, dangling event target, missing `field_name`) don't block the save but are **visible defects the agent must fix too** — every response carrying warnings includes a `warnings_notice` directive telling the model to fix and re-validate until the list is empty (only a demonstrably false positive may remain).

### Step 5: Persist — `list_organizations` / `create_page` / `update_page`

```
# List the account's organizations.
# 1 org → create_page auto-selects it. 2+ orgs → show list, ask the user, pass organization_id.
# Pass organization_id:"personal" only when the user explicitly wants no org.
list_organizations({})
→ [{ id: "org_1", name: "Acme", is_default: true }, ...]

# Create a NEW page (source-only). Defaults to dry_run=true.
create_page({ source, organization_id: "org_1" })       # explicit org — preview
create_page({ source, dry_run: false })                  # omit org → auto-resolves via list_organizations

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

# Go LIVE — publish_page builds rendered app/app_css via the build host (prod default
# https://build.webcake.io), then publishes via the editor's publish_html route (the only
# one that creates the PagePublishedV2 record public serving reads). A custom_domain gives
# the page its permanent URL; WITHOUT one the only link is /preview/<page_id>, which expires
# ~10 minutes after the publish. Without a build host it falls back to a source-only save
# (nothing goes live).
publish_page({ page_id, custom_domain: "shop.example.com", custom_path: "sale", dry_run: false })
```

`create_page` calls **`POST {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source`** on the backend.
Both `create_page` and `update_page` **default to `dry_run=true`** (validate and return the request they
*would* send, JWT masked); set `dry_run=false` to actually write. The result returns `page_id` + editor/preview URLs.

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
| `upload_images` | Convert external image URLs (from `ingest_html`/`ingest_url` results), `data:` URIs, or **local file paths from the user's machine** (`/abs/path.jpg`, `~/Pictures/logo.png`, `file:///…`, `C:\…`) into Webcake-hosted URLs (`statics.pancake.vn`) for use in `specials.src`. Pass local paths directly — never proxy the user's files through a third-party host. Uses multipart upload (200 MB backend limit). Batch mode: up to 20 entries per call, processed in parallel. No Webcake credentials required. **Defaults to `dry_run=true`** (for local paths, dry-run reports whether the file exists and its size). Local paths are only permitted in stdio (local) mode; on the remote HTTP transport they are rejected per-entry. Reference images are the user's assets — use this for BOTH intents (adapt AND clone) whenever the page is built from a reference HTML/URL, whenever the user supplies image URLs, or whenever the user provides local image files; `search_images` only fills slots with no source image. |

### Ingest (no config needed)
| Tool | Description |
|------|-------------|
| `ingest_html` | Parse raw HTML into a reference layout AST (sections classified by role, headings, CTAs, form fields, top colors/fonts, CSS custom-property palette, background_images from stylesheets, and a per-section `size_hint` — the desktop section height in px, from the source CSS when explicit (`basis:'css'`, raw value in `css`, e.g. `100vh`) else a content-volume estimate (`basis:'estimate'`); set the rebuilt section's desktop height from it). `detail:'compact'` (default) returns ~2-5 KB; `detail:'full'` returns a richer AST with per-section blocks (cards/tiles/steps with title/body/image/cta), li lists, gradients, images as `{ src, alt }` objects, and `widgets` = `{ hint, html, css? }` — the cleaned source HTML + matching CSS rules of composite visuals (phone/device mockup, chat thread, dashboard, browser frame), to rebuild verbatim as ONE `html-box` (inline the css into the html) — use for clone-faithful rebuilds. Image URLs in the result (`images`, `background_images`, `og_image`) are the user's assets — re-host them via `upload_images` and reuse them for BOTH intents (adapt rewrites text, not imagery). **Absolute-canvas builder exports** (LadiPage-family pages / Webcake-published HTML — bare positioned divs whose layout lives in per-id CSS rules) are auto-detected and additionally return `canvas`: `{ builder, width (420 mobile / 960 desktop — same as the Webcake canvas, geometry transfers 1:1), mobile_only, sections: [{ id, height, background, elements }], popups, element_count }`, each element = `{ type, box (px top/left/width/height; fixed:true = floating), text, src (full-size original, CDN size prefix stripped), crop (inner image window when offset/zoomed), style, animation (name/duration/delay/iteration-count), input, events, sticky, config (spin-wheel prizes decoded to `[{label, chance}]`, countdown minutes, popup delay…), children }` — when present, rebuild from `canvas` element-by-element instead of the role sections, and keep popups in the top-level `popup` array. On large pages the full-page call may come back `canvas.truncated:true` (styles pruned to core keys to fit the size cap) — follow `canvas.hint` and re-call with `sections:[id]` (ids from `canvas.sections[].id`; `'SECTION_POPUP'` selects the popups) to get each section in FULL untrimmed detail. Garbled Vietnamese mojibake (UTF-8 mis-read as Latin-1) is auto-repaired with a warning. |
| `ingest_url` | Fetch a public URL and run the same extraction as `ingest_html` (including absolute-canvas auto-detection → `canvas` payload). Supports the same `detail` option. Returns a warning when the page is client-rendered so the caller can fall back to a screenshot (Claude analyzes screenshots natively). |

### Persistence (needs `WEBCAKE_API_BASE` + `WEBCAKE_JWT`)
| Tool | Description |
|------|-------------|
| `list_organizations` | List the account's organizations (id, name, is_default). Default = the `is_default` org. |
| `create_page` | Persist a generated source as a new page, then **auto-publish** it (build host + `publish_html`) so the preview renders immediately — `publish:false` skips; a publish failure never fails the create (`result.publish` says how to retry); the no-domain preview link still expires ~10 min after each publish. Validates, caches the source as `draft_id`, then creates. `organization_id` accepts an org id or the string `"personal"` (explicit no-org). When omitted and no env default is set, calls `list_organizations` automatically: 1 org → auto-selected (`organization_auto_selected:true`); 2+ orgs → returns the org list and asks you to re-call with `organization_id` (never guesses); 0 orgs or lookup fails → personal. On validation failure, timeout, or network error the draft is kept — retry via `create_page({ draft_id, dry_run:false })` or fix via `patch_page({ draft_id, patches })`. **Defaults to `dry_run=true`.** |
| `list_pages` | List the account's pages (id, name, organization_id, updated_at) to pick one to edit. |
| `find_pages` | Search the account's pages by name, domain, and/or page id (AND-combined) to locate one to edit; returns id, name, org, custom/default domain, updated_at. |
| `get_page` | Fetch an existing page's decoded source tree, COMPACTED to the sparse authoring shape (factory-default boilerplate stripped — far fewer tokens; `compact:false` for the raw tree). Edit and send back as-is. |
| `update_page` | Overwrite an existing page's source with an edited tree. Validates, caches the source as `draft_id`, then saves. On timeout or failure the draft is kept — retry via `update_page({ draft_id, dry_run:false })` or `patch_page({ draft_id, dry_run:false })` (no patches). **Defaults to `dry_run=true`.** |
| `add_section` | Append section(s) to an existing page without re-sending the whole source (incremental-build path). Always caches the batch as `draft_id`; re-run with `{ page_id, draft_id, dry_run:false }` — no need to re-send sections. Validation failure, timeout, or network error also keeps the draft — fix via `patch_page({ draft_id, patches })` or retry `patch_page({ draft_id, dry_run:false })` with no patches. **Defaults to `dry_run=true`.** |
| `patch_page` | Edit a page by element id without re-sending the whole source. Targets a live page (`page_id`) OR a cached draft (`draft_id`). Draft kinds: `create_page` (creates page once valid), `add_section` (appends once valid), `update_page`/live-patch (retries updatePageSource). **Empty/omitted patches + `draft_id` = commit-as-is (the universal timeout-retry path).** Live-page path pre-caches the patched source before the network call and returns `draft_id` for recovery. **Defaults to `dry_run=true`.** |
| `publish_page` | Publish a page LIVE: builds the rendered app via the Webcake build host (`POST <buildBase>/render/build`; prod default `https://build.webcake.io`, override with `WEBCAKE_BUILD_BASE` env / `x-webcake-build-base` header), then publishes via the editor's `publish_html` route — the only one that writes the PagePublishedV2 record public serving reads. With `custom_domain` the page is permanently live at that domain; **without one the only URL is `/preview/<page_id>`, which expires ~10 minutes after the publish**. Without a build host it falls back to a legacy source-only save (nothing goes live). Result includes `live` + `rendered`. **Defaults to `dry_run=true`** (network-free, does NOT call the build host). |

---

## Model notes

- **Absolute-positioning canvas:** every child carries numeric `top/left/width/height` per breakpoint;
  sections stack vertically and own a `height`. Content lives in `specials` (`text`, `src`, …), never in `styles`.
- **Top-level source:** `{ page: [sections], popup: [popups], settings: {…}, options: { currency, mobileOnly, versionID }, cartConfigs: {} }`.
  Popups are a **separate** top-level array, not nested in `page`.
- Per-breakpoint animation lives in `config.animation = { name, delay, duration, repeat }`.
- Colors are `rgba()`; `top/left/width/height/fontSize` are numbers (px); form inputs need a unique `specials.field_name`.

Reference: [docs/page-element-schema.md](./page-element-schema.md),
[docs/element-specials-reference.md](./element-specials-reference.md) (every special/event in detail), and
[src/domains/landing/page-schema.json](../src/domains/landing/page-schema.json) (the bundled JSON Schema, Draft 2020-12). The schema mirrors
the real editor `page_source` shape.
