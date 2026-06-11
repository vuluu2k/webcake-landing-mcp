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
| `upload_images` | Convert external image URLs (from `ingest_html`/`ingest_url` results) or `data:` URIs into Webcake-hosted URLs (`statics.pancake.vn`) for use in `specials.src`. Batch mode: up to 20 URLs per call, processed in parallel, with an 8 MB per-image cap. No Webcake credentials required. **Defaults to `dry_run=true`.** Use when cloning a page or when the user supplies their own image URLs; use `search_images` for stock photos. |

### Ingest (no config needed)
| Tool | Description |
|------|-------------|
| `ingest_html` | Parse raw HTML into a compact layout AST (sections, roles, headings, CTAs, form fields) the AI can rebuild as a Webcake page. |
| `ingest_url` | Fetch a URL and run the same extraction — turn an existing page into a layout anchor to recreate or adapt. |

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

Reference: [docs/page-element-schema.md](./page-element-schema.md),
[docs/element-specials-reference.md](./element-specials-reference.md) (every special/event in detail), and
[src/domains/landing/page-schema.json](../src/domains/landing/page-schema.json) (the bundled JSON Schema, Draft 2020-12). The schema mirrors
the real editor `page_source` shape.
