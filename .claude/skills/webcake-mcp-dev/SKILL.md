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
- Entry: [src/index.ts](../../../src/index.ts) (thin dispatcher) → [src/server.ts](../../../src/server.ts) (`createServer`). Tools: [src/tools/](../../../src/tools/) (reference / generation / persistence groups). Backend HTTP client: [src/persistence/](../../../src/persistence/). Element model: [src/domains/landing/](../../../src/domains/landing/) — descriptors in `elements/`, plus `validate.ts`, `page.ts`, `guide.ts`, `vocab.ts`, `instructions.ts`, `page-schema.json`. Domain-agnostic primitives: [src/core/](../../../src/core/).

## THE GOLDEN RULE — each element is ONE descriptor

The element model now lives in a single place per element, so adding or editing a type is a one-file change; only the schema enum is a second touch (and `smoke` guards it):

| File | Holds |
|------|-------|
| `src/domains/landing/elements/<category>.ts` | The `ElementDescriptor` for each type: docs (`summary`/`useWhen`/`keySpecials`/`example`), `container`/`field` flags, `defaultName`, and a `seed(el)` that stamps visual defaults. Split into `layout/content/form/commerce/marketing.ts`. |
| `src/domains/landing/elements/index.ts` | Concatenates the descriptors and DERIVES `LIBRARY` (catalog), `CONTAINER_TYPES`, `FIELD_TYPES`, `ELEMENT_TYPES`, and `createElement`. You rarely touch this. |
| `src/domains/landing/page-schema.json` | The JSON Schema (structural truth). Loaded at **runtime** via `readFileSync` → copied to `dist/` by the build. Its `elementType` enum must list every descriptor type. |
| `src/domains/landing/validate.ts` | Semantic checks (unique ids, dangling event/option/connect targets, duplicate field_name per form, children-only-on-containers, field_name, layout bounds). Imports `CONTAINER_TYPES`/`FIELD_TYPES` from `elements/`. |

Domain-agnostic primitives live in `src/core/`: `element.ts` (node shape + `setStyle/setBox/seedPosition`/`base`/`randomId`/`imgPlaceholder`), `descriptor.ts` (the `ElementDescriptor` type + `createElementFrom`/`buildCatalog`/`derive*`), `domain.ts` (the `Domain` seam). After ANY model change: `npm run build && npm run smoke` — smoke must print **`ALL GOOD`**, and it asserts the `page-schema.json` `elementType` enum stays in sync with the descriptor keys, so adding a type to one but not the other fails the gate.

## Recipe: add a new MCP tool

Add it to a tool group in [src/tools/](../../../src/tools/) (`reference.ts`, `generation.ts`, or `persistence.ts`), inside that group's `register…Tools(server, domain)` function. Follow the existing `server.tool(...)` pattern:

```ts
server.tool(
  "tool_name",
  "One-line description the client/LLM sees — say what it returns and when to call it.",
  { arg: z.string().describe("...") },          // omit this arg for a no-input tool
  async ({ arg }) => text(result)               // text() wraps in { content:[{type:"text",text}] }
);
```

- Return values go through the `text()` helper (`import { text } from "../mcp/response.js"`; stringifies objects). Never return raw objects.
- Persistence tools: gate on `readConfig()` (`../persistence/config.js`) → if `!config` return `{ ok:false, reason:"missing_env", missing_env }`. Mutating tools (create/update) **default to `dry_run=true`** and return a **redacted** request preview (`buildRequestRedacted` from `../persistence/webcake-client.js` masks the JWT) — only hit the network when `dry_run===false`. Validation/coercion go through the injected `domain` (`domain.validate` / `domain.coerce`).
- A brand-new group must be registered in [src/tools/index.ts](../../../src/tools/index.ts). Mention the new tool name in three spots: the `INSTRUCTIONS` string in `src/domains/landing/instructions.ts` (bottom line lists all tools), the group file's header comment, and `docs/tools.md`(+`.vi`) + the `README.md` at-a-glance table / the `webcake-landing` skill tool list.

## Recipe: add a new element type

1. **`src/domains/landing/elements/<category>.ts`** — add an `ElementDescriptor` to that category's array: `type`, `category`, `container` (true → auto-joins `CONTAINER_TYPES`), `field` (true for a submitting form input → auto-joins `FIELD_TYPES`), `defaultName`, `summary`, `useWhen`, `keySpecials`, optionally an `example` (smoke-tested — must validate), and a `seed(el)` stamping default `responsive` styles/specials (and `el.specials.field_name` for field types). Pick the category file by the element's nature; that's the ONLY file for the model itself.
2. **`src/domains/landing/page-schema.json`** — add the type to the `elementType` enum (and any per-type structural constraint).
3. **`src/domains/landing/validate.ts`** — only if the type needs a new semantic rule (e.g. a new element-target event action → add to `ELEMENT_TARGET_ACTIONS`).
4. `npm run build && npm run smoke`. Smoke auto-covers every type (skeleton validity), every `example`, the derived `CONTAINER_TYPES`/`FIELD_TYPES` sets, and the schema-enum sync.

## Recipe: change a backend call

All HTTP lives in [src/persistence/webcake-client.ts](../../../src/persistence/webcake-client.ts) (env reading in `config.ts`, shared types in `types.ts`). Endpoints are constants at the top (`/api/v1/ai/*`, `/api/v1/org/organizations`). `authHeaders()` builds Bearer+Cookie+optional `Host`/`x-org-id`. For any mutating call add a matching `build…Redacted` preview so the tool's `dry_run` path can show it with the JWT masked. The backend lives in the separate `landing_page_backend` repo (`LandingPageWeb.V1.AiController`).

## Conventions that bite (don't trip on these)

- **ESM + Node16:** relative imports use a `.js` extension on `.ts` files (`import { x } from "./validate.js"`).
- **Build = `tsc` + copy:** `npm run build` also runs `scripts/copy-assets.mjs`, which mirrors every `src/**/*.json` into `dist/`. Bare `tsc` leaves `dist/domains/landing/page-schema.json` missing and the server throws on startup. Rebuild after editing the schema.
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
