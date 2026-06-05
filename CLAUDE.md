# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) **stdio** server that teaches an AI agent how to build a complete
Webcake landing-page **source JSON** from a requirement, validate it, and persist it to a Webcake
backend. The server is *knowledge + validation + persistence* — it does **not** render pages. The AI
agent assembles the full `{ page, popup, settings, options, cartConfigs }` object; `create_page`/`update_page`
save it source-only (the page renders when re-saved in the Webcake editor).

Published to npm as `webcake-landing-mcp`; runs via `node dist/index.js` or `npx -y webcake-landing-mcp`.

## Commands

```bash
npm run build      # tsc -> dist/ AND copies src/page-schema.json -> dist/ (both steps matter, see below)
npm run smoke      # offline self-test of factory + validator; MUST print "ALL GOOD". Run after every change.
npm run dev        # tsc --watch
npm start          # node dist/index.js (start the stdio server)
npm run release    # interactive local publish (scripts/release.js): build+smoke gate, npm version, OTP publish, gh release
npm run release:dry   # dry-run the release flow without publishing
```

There is no unit-test runner or linter — `npm run smoke` is the test gate. It exercises the pure logic
(factory skeletons, validator, and every `LIBRARY` example) without an MCP transport. `prepublishOnly`
runs `build && smoke`, so a broken smoke test blocks publishing.

## Build rules (must follow when editing `src/`)

1. **The model is in four files — change them together.** A page-source/element change touches `src/page-schema.json`, `src/factory.ts`, `src/library.ts`, and `src/validate.ts`. Editing one without the others passes `tsc` but breaks `smoke`.
2. **Gate every change:** `npm run build && npm run smoke` — must end with `ALL GOOD`. Editing the schema requires a rebuild (`dist/page-schema.json` is runtime data copied by the build).
3. **New tools** go in `src/index.ts` via `server.tool(...)`, return through the `text()` helper, and register the name in `INSTRUCTIONS` + `README.md` + the `webcake-landing` skill. **New HTTP** goes in `src/webcake.ts`.
4. **Mutating tools default to `dry_run=true`** and return a JWT-redacted request preview; only the network when `dry_run===false`.
5. **stdout is the MCP channel** — log with `console.error` only. **ESM/Node16** — relative imports end in `.js`. **Secrets** come from `WEBCAKE_JWT` env only; the repo is public.

Specialist subagents (`.claude/agents/`) enforce these: **mcp-tool-author** (add/modify a tool),
**page-model-guardian** (model/schema changes), **mcp-verifier** (run the gate + convention checks).
Delegate matching work to them.

## Architecture

The page-source model is the heart of the project. It is encoded in **four files that must stay in sync** —
changing the model in one without the others will pass `tsc` but fail `smoke` or mislead the agent:

| File | Role |
|------|------|
| [src/page-schema.json](src/page-schema.json) | Canonical JSON Schema (Draft 2020-12). Loaded at **runtime** via `readFileSync` (not `import`), so the build must copy it into `dist/`. |
| [src/factory.ts](src/factory.ts) | `createElement(type)` produces a structurally-valid default node per type; `createPageSource()`/`defaultSettings()` build the top-level shell. Owns `CONTAINER_TYPES` and `FIELD_TYPES` (the source of truth for "can hold children" / "needs field_name"). |
| [src/library.ts](src/library.ts) | The element catalog (`LIBRARY`): per-type AI hints, key `specials`, examples. Plus `GENERATION_GUIDE`, `CANVAS` (desktop 960 / mobile 420), and the event vocab (`CLICK_ACTIONS`, `HOVER_ACTIONS`, `EVENT_TRIGGERS`). |
| [src/validate.ts](src/validate.ts) | `validatePage()` — ajv structural check + semantic checks the schema can't express (unique ids, dangling event targets, children-only-on-containers, missing `field_name`, off-canvas layout bounds). |

Surrounding these:

- [src/index.ts](src/index.ts) — MCP server: defines all 12 tools, the server `instructions` string (the rules shipped to every client), and a subcommand dispatch so `webcake-landing-mcp install|uninstall` runs the bundled installer instead of starting the server.
- [src/webcake.ts](src/webcake.ts) — thin HTTP client to the Webcake backend (create/update/list pages, list orgs). Builds dry-run request previews with the JWT redacted; reads all config from env via `readConfig()`.
- [src/install.ts](src/install.ts) — bundled IDE installer; writes the MCP server block into claude-desktop / claude-code / cursor / windsurf / augment / codex config files.

The 12 tools fall into three groups: **reference** (`get_generation_guide`, `list_elements`, `get_element`,
`get_page_schema` — no env needed), **generation** (`new_element`, `new_page_skeleton`, `validate_page`),
and **persistence** (`list_organizations`, `create_page`, `list_pages`, `get_page`, `update_page` — need env).

### Page-source model invariants

When touching the model, preserve these (they live in the schema, the guide, and the validator together):

- Top-level: `{ page: [sections], popup: [popups], settings, options: {currency, mobileOnly, versionID}, cartConfigs }`. **Popups are a separate top-level array**, never nested in `page`.
- Absolute-positioning canvas (not flexbox): every child carries numeric `top/left/width/height` in px per breakpoint; sections own a `height` and have no `top/left`. Canvas width is fixed (desktop 960, mobile 420).
- Visible content lives in `specials` (`text`, `src`, `field_name`…), never in `styles`. Colors are `rgba()`. Form inputs need a unique `specials.field_name`.
- `validate_page` **errors block** persistence; **warnings** (dangling event target, missing `field_name`, off-canvas bounds) are advisory.

## Conventions that bite

- **ESM + Node16 module resolution.** Relative imports use a `.js` extension even though the source is `.ts` (e.g. `import { validatePage } from "./validate.js"`). The `bin` shebang and `"type": "module"` matter.
- **`page-schema.json` is runtime data, not a TS import.** `npm run build` is `tsc` *plus* a `copyFileSync` step — if you only run `tsc`, `dist/page-schema.json` is missing and `validate.ts` throws at startup. Editing the schema requires a rebuild before smoke/run.
- **ajv is CJS under ESM:** `validate.ts` reaches the constructor via `(Ajv2020Module as any).default ?? Ajv2020Module`.
- **stdout is the MCP channel** — all logging goes to `console.error` (stderr) only. Never `console.log` from server code.
- **`create_page`/`update_page` default to `dry_run=true`** (validate + return the redacted request they *would* send). Real writes need `dry_run=false`.
- **Secrets:** the JWT comes only from `WEBCAKE_JWT` env. The repo is public — never hard-code a token, account, or page data.

## Environment variables (persistence tools only)

`WEBCAKE_API_BASE` + `WEBCAKE_JWT` are required to hit the backend; `WEBCAKE_ORG_ID` (default org),
`WEBCAKE_HOST` (Phoenix host-routing header), `WEBCAKE_APP_BASE` (for editor/preview URLs in results)
are optional. The backend endpoints this calls live in the separate `landing_page_backend` repo
(`LandingPageWeb.V1.AiController`, scope `/api/v1/ai`).

## Release flow

Two paths, both gated by build+smoke:

- **Local:** `npm run release[:patch|:minor|:major]` runs [scripts/release.js](scripts/release.js) — npm-login check, gate, `npm version`, OTP-prompted publish (idempotent resume if a prior run bumped but failed to publish), push tags, `gh release create` from the matching `CHANGELOG.md` section.
- **CI:** [.github/workflows/auto-release.yml](.github/workflows/auto-release.yml) fires on push to `main` touching `src/**` (skips `chore(release):` commits). It auto-resolves the bump from commit messages (`feat`→minor, `BREAKING CHANGE`/`!:`→major, else patch), generates the changelog entry with the Claude CLI, then publishes to npm + GitHub Releases. So: **a `src/**` change merged to `main` ships a release automatically.**

## Skills & more detail

Two project skills (in `.claude/skills/`) — pick by what you're doing:

- [webcake-mcp-dev](.claude/skills/webcake-mcp-dev/SKILL.md) — **working ON this server**: recipes for adding a tool, adding an element type, the 4-file sync rule, and the build+smoke gate. Use this when editing `src/`.
- [webcake-landing](.claude/skills/webcake-landing/SKILL.md) — **using the MCP** to build/edit landing pages end-to-end.

[AGENTS.md](AGENTS.md) has the agent-facing runtime rules and a condensed repo-rules list.
[docs/page-element-schema.md](docs/page-element-schema.md) is the full element-model reference.
