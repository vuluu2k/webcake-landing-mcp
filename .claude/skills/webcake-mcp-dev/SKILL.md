---
name: webcake-mcp-dev
description: Build and extend the webcake-landing MCP server itself — add tools, add element types, keep the page-source model in sync across the four source files, and pass the build+smoke gate. Use when editing src/ in this repo (NOT when using the MCP to make landing pages — that's the webcake-landing skill).
metadata:
  author: Vũ Lưu
  version: "2026.06.06"
  source: webcake-landing-mcp
---

# webcake-mcp-dev — develop the webcake-landing MCP server

> Rules + recipes for **working on this codebase** (the MCP server). For *using* the
> tools to build landing pages, see the `webcake-landing` skill. Big-picture architecture
> lives in [CLAUDE.md](../../../CLAUDE.md); this skill is the how-to for changes.

## Stack & entry points

- TypeScript, **ESM**, Node ≥18. Built with `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`), `ajv` (Draft 2020-12), `zod`.
- Server + all tool definitions: [src/index.ts](../../../src/index.ts). Backend HTTP client: [src/webcake.ts](../../../src/webcake.ts). Element knowledge: [src/library.ts](../../../src/library.ts). Default nodes: [src/factory.ts](../../../src/factory.ts). Validation: [src/validate.ts](../../../src/validate.ts). Canonical schema: [src/page-schema.json](../../../src/page-schema.json).

## THE GOLDEN RULE — the model lives in 4 files, keep them in sync

The page-source model is encoded in four places. Change one for a model change and you MUST update the others, or `tsc` passes but `smoke` fails / the agent gets misled:

| File | Holds |
|------|-------|
| `src/page-schema.json` | The JSON Schema (structural truth). Loaded at **runtime** via `readFileSync` → must be copied to `dist/` by the build. |
| `src/factory.ts` | `createElement(type)` default node (per-type visual defaults: sizes/specials) + `defaultName`. Re-exports `CONTAINER_TYPES`/`FIELD_TYPES` from library.ts for back-compat. |
| `src/library.ts` | `LIBRARY[type]` (hints, key specials, example) — and the **single source of truth** for `CONTAINER_TYPES` (DERIVED from each entry's `container` flag) and `FIELD_TYPES` (the list right below `LIBRARY`). Plus `GENERATION_GUIDE`; `CANVAS`; event vocab. |
| `src/validate.ts` | Semantic checks (unique ids, dangling event/option/connect targets, duplicate field_name per form, children-only-on-containers, field_name, layout bounds). Imports `CONTAINER_TYPES`/`FIELD_TYPES` (defined in library.ts, re-exported by factory.ts). |

After ANY model change: `npm run build && npm run smoke` — smoke must print **`ALL GOOD`**. `smoke` also asserts the `page-schema.json` `elementType` enum stays in sync with `LIBRARY` keys, so adding a type to one but not the other fails the gate.

## Recipe: add a new MCP tool

Edit only [src/index.ts](../../../src/index.ts). Follow the existing `server.tool(...)` pattern:

```ts
server.tool(
  "tool_name",
  "One-line description the client/LLM sees — say what it returns and when to call it.",
  { arg: z.string().describe("...") },          // omit this arg for a no-input tool
  async ({ arg }) => text(result)               // text() wraps in { content:[{type:"text",text}] }
);
```

- Return values go through the local `text()` helper (stringifies objects). Never return raw objects.
- Persistence tools: gate on `readConfig()` → if `!config` return `{ ok:false, reason:"missing_env", missing_env }`. Mutating tools (create/update) **default to `dry_run=true`** and return a **redacted** request preview (`buildRequestRedacted` masks the JWT) — only hit the network when `dry_run===false`.
- Mention the new tool name in three spots: the `INSTRUCTIONS` string (bottom line lists all tools), the file header comment, and `README.md` / the `webcake-landing` skill tool list.

## Recipe: add a new element type

1. **library.ts** — add a `LIBRARY["<type>"]` entry: `category`, `container` (true → it auto-joins `CONTAINER_TYPES`), `summary`, `useWhen`, `keySpecials`, optionally an `example` (examples are smoke-tested — they must validate). If it's a form input that submits a value, add its type to the `FIELD_TYPES` set right below `LIBRARY`.
2. **factory.ts** — add a `case "<type>"` in `createElement` seeding sane default `responsive` styles/specials (and `specials.field_name` for field types); add a label to `defaultName`.
3. **page-schema.json** — extend the element `type` enum / any per-type constraints so the new node passes the structural check.
4. **validate.ts** — only if the type needs a new semantic rule (e.g. a new element-target event action → add to `ELEMENT_TARGET_ACTIONS`).
5. `npm run build && npm run smoke`. Smoke auto-covers every `LIBRARY` type (skeleton validity) and every `example`.

## Recipe: change a backend call

All HTTP lives in [src/webcake.ts](../../../src/webcake.ts). Endpoints are constants at the top (`/api/v1/ai/*`, `/api/v1/org/organizations`). `authHeaders()` builds Bearer+Cookie+optional `Host`/`x-org-id`. For any mutating call add a matching `build…Redacted` preview so the tool's `dry_run` path can show it with the JWT masked. The backend lives in the separate `landing_page_backend` repo (`LandingPageWeb.V1.AiController`).

## Conventions that bite (don't trip on these)

- **ESM + Node16:** relative imports use a `.js` extension on `.ts` files (`import { x } from "./validate.js"`).
- **Build = `tsc` + copy:** `npm run build` also copies `page-schema.json` into `dist/`. Bare `tsc` leaves `dist/page-schema.json` missing and the server throws on startup. Rebuild after editing the schema.
- **ajv under ESM:** the constructor is `(Ajv2020Module as any).default ?? Ajv2020Module`.
- **stdout is the MCP channel** — log only with `console.error` (stderr). Never `console.log` in server code.
- **Secrets:** JWT comes only from `WEBCAKE_JWT` env; repo is public — never hard-code tokens, accounts, or page data. Scan before pushing.
- **Subcommand dispatch:** `index.ts main()` routes `install`/`uninstall`/`--help` to `src/install.ts` before starting the server — don't break that branch when editing startup.

## Verify & ship

```bash
npm run build && npm run smoke   # gate — must end with "ALL GOOD"
npm run dev                      # tsc --watch while iterating
```

Releasing: `npm run release[:patch|:minor|:major]` (local, OTP-prompted) OR just merge a `src/**` change
to `main` — [.github/workflows/auto-release.yml](../../../.github/workflows/auto-release.yml) auto-bumps,
generates the changelog, and publishes to npm + GitHub Releases (skips `chore(release):` commits).
