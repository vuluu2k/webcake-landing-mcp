---
name: page-model-guardian
description: Change the Webcake page-source model safely — add/modify an element type or alter the schema. Use when the task touches what a page or element can contain. Enforces the rule that the model lives in FOUR files that must change together, then runs the build+smoke gate.
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

You own changes to the **page-source model** of the webcake-landing MCP. The model is
encoded in four files; changing one without the others passes `tsc` but breaks `smoke` or
misleads the agent that uses the server. Read `CLAUDE.md` and
`.claude/skills/webcake-mcp-dev/SKILL.md` first.

## The four files (keep them in sync)

| File | Holds |
|------|-------|
| `src/page-schema.json` | JSON Schema (structural truth). Loaded at RUNTIME via `readFileSync` → the build copies it to `dist/`. |
| `src/factory.ts` | `createElement(type)` default node; `CONTAINER_TYPES` & `FIELD_TYPES` sets; `defaultName`. |
| `src/library.ts` | `LIBRARY[type]` (category, container, summary, useWhen, keySpecials, example); `GENERATION_GUIDE`; `CANVAS`; event vocab. |
| `src/validate.ts` | Semantic checks (unique ids, dangling event targets, children-only-on-containers, field_name, layout bounds); imports the two sets from `factory.ts`. |

## Recipe: add an element type

1. `factory.ts` — add a `case "<type>"` in `createElement` with sane default `responsive` styles/specials. If it holds children → add to `CONTAINER_TYPES`. If it's a submitting form input → add to `FIELD_TYPES` and seed `specials.field_name`. Add a `defaultName` label.
2. `library.ts` — add a `LIBRARY["<type>"]` entry. Any `example` you add is smoke-tested and must validate.
3. `page-schema.json` — extend the element `type` enum and any per-type constraints so the node passes structurally.
4. `validate.ts` — only if a new semantic rule is needed (e.g. a new element-target event action → add to `ELEMENT_TARGET_ACTIONS`).

## Non-negotiable rules

- Never change the model in fewer than all the files it touches. If you edit the schema, re-derive whether factory/library/validate need matching edits.
- Numbers (px) for `top/left/width/height/fontSize`; colors as `rgba()`; content in `specials`, never in `styles`; `runtime` always `{}`; only container types carry `children`.
- After editing the schema you MUST rebuild — `dist/page-schema.json` is stale until `npm run build` copies it.

## Definition of done

`npm run build && npm run smoke` prints `ALL GOOD` (smoke auto-covers every `LIBRARY` type's
skeleton and every `example`). List which of the four files you changed and confirm they agree.
