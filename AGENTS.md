# AGENTS.md — webcake-landing-mcp

Rules for AI agents **using** this MCP and **working on** this repo.

## Runtime rules (when an LLM uses the webcake-landing tools)

These are also served to the client via the server `instructions` (see
`src/domains/landing/instructions.ts`) and the `get_generation_guide` tool. In short:

1. **Intake first.** Before generating a new page, ask the user 3–6 concrete questions
   (goal/page type, brand + tone + language, sections in order, primary CTA + destination,
   form fields, colors/logo URLs, desktop+mobile or mobile-only, which organization) and
   confirm a short outline. Don't assume.
2. **No invented facts.** Never make up prices, phone numbers, addresses, or statistics —
   ask or leave a placeholder.
3. **Validate before persisting.** Always `validate_page` and fix every error before
   `create_page` / `update_page`.
4. **Dry-run first.** `create_page` and `update_page` default to `dry_run=true`. Show the
   dry-run; only send `dry_run=false` after the user confirms.
5. **Edit surgically.** For an existing page: `get_page` → change ONLY what was asked →
   keep every other element, its `id`, and coordinates → `validate_page` → `update_page`.
   Never regenerate the whole tree for a small change.
6. **Organizations.** Call `list_organizations`, ask which to use, default to the
   `is_default` org. Endpoints are owner-scoped (only the account's own pages).
7. **Model invariants.** Popups are a top-level `popup` array (not inside `page`); content
   lives in `specials` (not `styles`); colors are `rgba()`; `top/left/width/height/fontSize`
   are numbers (px); form inputs need a unique `specials.field_name`.

See `.claude/skills/webcake-landing/SKILL.md` for the full workflow and
`docs/page-element-schema.md` for the element model.

## Repo / dev rules (when editing this codebase)

- TypeScript, ESM, Node 18+. Source in `src/`, build to `dist/` via `npm run build`
  (`tsc` + `scripts/copy-assets.mjs`, which mirrors every `src/**/*.json` into `dist/`).
- After any change: `npm run build` then `npm run smoke` (must print `ALL GOOD`) before committing.
- Each element is ONE descriptor in `src/domains/landing/elements/<category>.ts` (docs + `container`/
  `field` flags + `defaultName` + factory `seed` + `example`); `CONTAINER_TYPES`/`FIELD_TYPES`/the catalog/
  `createElement` derive from it. When the model changes, update the descriptor AND the `elementType` enum
  in `src/domains/landing/page-schema.json` (+ `validate.ts` only for a new semantic rule), then rebuild + smoke.
- New tools go in a `src/tools/*.ts` group; backend HTTP calls in `src/persistence/webcake-client.ts`;
  element knowledge + default node shapes in `src/domains/landing/elements/`; validation in
  `src/domains/landing/validate.ts`; domain-agnostic primitives in `src/core/`.
- Two transports share `createServer()` (`src/server.ts`): stdio (default) and a remote Streamable-HTTP
  server (`node dist/index.js serve [--port N] [--env local|staging|prod]`, `src/http.ts`). In HTTP mode
  credentials are per-request via headers (`x-webcake-jwt` / `Authorization: Bearer`, `x-webcake-env`,
  `x-webcake-org-id`, …; see `src/persistence/config.ts#configFromHeaders`), falling back to env — so a
  hosted server is multi-user.
- `node dist/index.js login` (`src/auth/login.ts`) grabs the JWT via the browser (a localhost loopback
  receives a redirect from the Webcake `/mcp-connect` endpoint that reads the `jwt` cookie) and saves it to
  `~/.webcake-landing-mcp/auth.json`. `readConfig` precedence: per-request overrides → env → that file.
  `WEBCAKE_ENV` / `--env` (`local|staging|prod`, the `ENVIRONMENTS` table in `config.ts`) supplies the
  default API + app base URLs; explicit `WEBCAKE_API_BASE` / `WEBCAKE_APP_BASE` still win.
- **Never commit secrets.** The JWT is read from the `WEBCAKE_JWT` env var only — never
  hard-code a token, account, or page data in the repo. Scan before pushing (the repo is public).
- The backend endpoints this MCP calls live in `landing_page_backend`
  (`LandingPageWeb.V1.AiController`, scope `/api/v1/ai`).

When editing `src/`, follow the `webcake-mcp-dev` skill
(`.claude/skills/webcake-mcp-dev/SKILL.md`) — it has the add-a-tool / add-an-element
recipes and the one-descriptor element model. Architecture overview is in `CLAUDE.md`.
