# AGENTS.md — webcake-landing-mcp

Rules for AI agents **using** this MCP and **working on** this repo.

## Runtime rules (when an LLM uses the webcake-landing tools)

These are also served to the client via the server `instructions` (see `src/index.ts`)
and the `get_generation_guide` tool. In short:

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
  (`tsc` + copies `src/page-schema.json` → `dist/`).
- After any change: `npm run build` then `npm run smoke` (must print `ALL GOOD`) before committing.
- `src/page-schema.json` is the bundled canonical JSON Schema. If the page-source model
  changes, update it AND `src/factory.ts` / `src/library.ts` / `src/validate.ts` together,
  then rebuild and re-run smoke.
- New tools go in `src/index.ts`; backend HTTP calls in `src/webcake.ts`; element knowledge
  in `src/library.ts`; default node shapes in `src/factory.ts`; validation in `src/validate.ts`.
- **Never commit secrets.** The JWT is read from the `WEBCAKE_JWT` env var only — never
  hard-code a token, account, or page data in the repo. Scan before pushing (the repo is public).
- The backend endpoints this MCP calls live in `landing_page_backend`
  (`LandingPageWeb.V1.AiController`, scope `/api/v1/ai`).
