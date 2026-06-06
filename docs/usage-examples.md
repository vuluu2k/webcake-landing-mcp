<!-- English · Phiên bản Tiếng Việt: ./usage-examples.vi.md -->

# Usage Examples

End-to-end walkthroughs of how an AI agent drives the Webcake Landing MCP tools.
See the [README](../README.md) for setup, and the [Detailed Tool Usage Guide](../README.md#detailed-tool-usage-guide) for a tool-by-tool reference.

## Example 1: Build a new landing page from a brief

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

## Example 2: Edit an existing page

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

## Example 3: Inspect an element type before using it

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
