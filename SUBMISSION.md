# Anthropic Directory submission — webcake-landing-mcp

Reference answers for the Anthropic Directory submission form (`https://claude.com/docs/connectors/building/submission`). Pair with `https://claude.com/docs/connectors/building/review-criteria` when filling fields.

## Identity

| Field | Value |
|---|---|
| Server name | `webcake-landing` |
| Display title | Webcake Landing |
| Package | `webcake-landing-mcp` (npm) |
| Repo | https://github.com/vuluu2k/webcake-landing-mcp (public) |
| License | MIT |
| Contact | vuluu040320@gmail.com |
| Server domain (planned prod) | `mcp.webcake.io` |
| Service domains | `webcake.io`, `api.webcake.io`, `builder.webcake.io` |

## What the server does

An MCP server that teaches an AI agent how to build a complete Webcake landing-page source JSON from a natural-language requirement, validates it against the canonical schema + semantic rules, and persists it to the Webcake backend. The server is *knowledge + validation + persistence* — it does NOT render pages; rendering happens in the Webcake editor.

Distributed two ways:
- **stdio** via `npx -y webcake-landing-mcp` (single-user, env-configured).
- **remote streamable-HTTP** via `node dist/index.js serve --port 8787` (multi-user, per-request JWT in `x-webcake-jwt` header).

## Tools (14)

All tools carry `title`, `readOnlyHint`, `destructiveHint` (where applicable), and `openWorldHint` annotations. Names ≤ 64 chars, snake_case.

| Tool | Read-only | Destructive | Open-world | Purpose |
|---|---|---|---|---|
| `get_generation_guide` | ✓ | — | false | Returns the page-building conventions reference |
| `list_elements` | ✓ | — | false | Lists every supported element type by category |
| `get_element` | ✓ | — | false | Returns detailed usage for one element type |
| `get_page_schema` | ✓ | — | false | Returns the full JSON Schema (Draft 2020-12) |
| `new_element` | ✓ | — | false | Returns a structurally-valid default element node |
| `new_page_skeleton` | ✓ | — | false | Returns an empty top-level page source |
| `validate_page` | ✓ | — | false | Validates a page source (errors + warnings) |
| `search_images` | ✓ | — | true | Pexels stock photo search (third-party — see below) |
| `list_organizations` | ✓ | — | true | Lists the account's Webcake orgs |
| `list_pages` | ✓ | — | true | Lists the account's pages |
| `get_page` | ✓ | — | true | Fetches one page's source tree |
| `create_page` | ✗ | false | true | Creates a NEW page (dry_run=true by default) |
| `update_page` | ✗ | **true** | true | **Overwrites** an existing page's source (dry_run=true by default) |
| `add_section` | ✗ | false | true | Appends section(s) to an existing page server-side |

Read/write split: 11 read-only, 3 writes (split by action: create / update / append). No catch-all method-parameter tools. `update_page` is the only `destructiveHint: true` tool (it overwrites).

## Safety design

- **`create_page` / `update_page` / `add_section` default to `dry_run=true`**. Returns the HTTP request the server *would* send with the JWT redacted (`***JWT***`). Real writes require explicit `dry_run=false`.
- **Validation before persistence**: every write runs the full schema + semantic validator (unique ids, dangling event/option targets, container rules, missing `field_name`). Errors block; warnings are advisory.
- **JWT only from env or per-request header** (`WEBCAKE_JWT` env in stdio, `x-webcake-jwt` header in remote). Never hard-coded; repo is public.
- **Owner-scoped endpoints**: backend filters by account, so a token can only read/write its own pages.

## Prompt injection

Tool descriptions describe what the tool returns and when it's relevant — they do not instruct Claude how to behave, do not invoke other tools, do not pull behavior from external sources, and contain no hidden/encoded instructions.

Workflow guidance (the recommended order: `list_organizations` → `get_generation_guide` → `validate_page` → `create_page`, etc.) lives in `landingDomain.instructions` — the server-level `instructions` string, which MCP spec designates for this purpose.

## API ownership

**First-party APIs**: All persistence tools call `*.webcake.io/api/v1/ai/*` endpoints owned by Webcake (the `landing_page_backend` repo, `LandingPageWeb.V1.AiController`, scope `/api/v1/ai`). Endpoints used:

| Endpoint | Tool |
|---|---|
| `GET  /api/v1/org/organizations` | `list_organizations` |
| `POST /api/v1/ai/create_page_from_source` | `create_page` |
| `GET  /api/v1/ai/pages` | `list_pages` |
| `GET  /api/v1/ai/page_source` | `get_page` |
| `POST /api/v1/ai/update_page_source` | `update_page` |
| `POST /api/v1/ai/append_section` | `add_section` |

**Third-party API**: `search_images` queries the Pexels API (https://www.pexels.com/api/) for stock photos. Pexels' API terms permit this usage and require photographer attribution (returned in the tool response as `photographer` + `photographer_url`). Two paths:
- With a user-supplied `PEXELS_API_KEY` env or `x-pexels-key` header → direct Pexels call.
- Without one → a shared hosted proxy `mcp.toolvn.io.vn` (operated by us, holds our own Pexels key) so `npx` users get images zero-setup. Proxy returns the unmodified Pexels payload; used only to relay search queries, no PII forwarded.

No money/crypto transfers. No AI-generated images/video/audio (Pexels is licensed stock; output is not synthetic).

## Distribution

| Channel | Status |
|---|---|
| npm package `webcake-landing-mcp` | Published, public, MIT |
| GitHub repo | Public: https://github.com/vuluu2k/webcake-landing-mcp |
| CI release | `.github/workflows/auto-release.yml` auto-publishes on push to `main` touching `src/**` (skips `chore(release):` commits) |
| Plugin form | Plans to ship a Claude plugin wrapping this MCP + the `webcake-landing` skill (out of scope for this submission) |

## Test credentials (fill before submission)

| Field | Value |
|---|---|
| Environment | `staging` |
| `WEBCAKE_API_BASE` | `https://api-staging.webcake.io` *(confirm exact host)* |
| `WEBCAKE_JWT` | *paste JWT here — generate via `node dist/index.js login --env staging`* |
| `WEBCAKE_ORG_ID` | *optional, the test org id* |
| `PEXELS_API_KEY` | *optional — without it, the shared proxy serves images* |

Test account preconditions (review-friendly):
- 1 default org + 1 custom org.
- 2-3 sample landing pages so `list_pages` / `get_page` / `update_page` have data to operate on.
- JWT TTL ≥ 14 days so reviewer doesn't hit an expired token mid-review.

**After review**: rotate the JWT (the test account JWT becomes public-adjacent).

## Pre-submission checklist

- [x] Read/write split (11 read-only / 3 writes)
- [x] Tool annotations on every tool (`title`, `readOnlyHint`, `destructiveHint` where applicable, `openWorldHint`)
- [x] Tool names ≤ 64 chars, snake_case, unique
- [x] Descriptions describe behavior, not Claude's behavior
- [x] `dry_run=true` default on mutating tools
- [x] JWT redacted in dry-run previews
- [x] No conversation/memory/chat-history access
- [x] First-party API + disclosed third-party (Pexels)
- [x] Public docs (`README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/`)
- [x] Public GitHub repo (MIT)
- [x] `npm run smoke` ends with `ALL GOOD`
- [ ] **MCP Inspector**: every tool exercised — `npm run inspect`
- [ ] **Custom connector test**: `npm run serve` + cloudflared tunnel → add to Claude.ai → end-to-end prompt
- [ ] Test JWT generated + sample pages seeded in staging
- [ ] Submission form filled

## Verifying locally

```bash
# 1. Gate
npm run build && npm run smoke           # must end with "ALL GOOD"

# 2. MCP Inspector — exercise every tool
npm run inspect
# → opens http://localhost:6274; click each tool, send sample input

# 2b. Inspector with creds (for persistence + media tools)
WEBCAKE_ENV=staging WEBCAKE_JWT=<token> PEXELS_API_KEY=<key> npm run inspect

# 3. Custom connector test
npm run serve                              # terminal A
brew install cloudflared                   # one-time
cloudflared tunnel --url http://localhost:8787    # terminal B → public HTTPS URL
# → add the URL + /mcp path to Claude.ai → Settings → Connectors
# → custom headers: x-webcake-jwt, x-webcake-env, x-pexels-key
```

## Out-of-scope notes (for reviewer FAQ)

- The Webcake editor renders pages from the saved source on first open; the MCP only persists the source. Reviewer testing `create_page` should expect a page that opens in the editor and renders on re-save (matches the editor's UX).
- The element model + page schema live in `src/domains/landing/` and are documented in `docs/page-element-schema.md` and `docs/element-specials-reference.md`.
- The `add_section` tool exists because a single `create_page` payload for large pages (4+ sections, ~80KB+) can drop the client↔Claude connection during one-shot generation. The light append path (`POST /api/v1/ai/append_section`) keeps each call small; a legacy `get→merge→put` fallback handles older backends.
