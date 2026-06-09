---
name: connector-directory
description: Get webcake-landing-mcp listed as an official connector/app in the Claude Connectors Directory and the ChatGPT App Directory. Covers the npm-vs-registry-vs-connector distinction, the remote-MCP hosting requirement, the OAuth 2.1 prerequisite, tool safety annotations, and each platform's submission process. Use when planning or doing connector/directory publishing (NOT for building landing pages — that's webcake-landing; NOT for editing the server — that's webcake-mcp-dev).
metadata:
  author: Vũ Lưu
  version: "2026.06.08"
  source: webcake-landing-mcp
---

# connector-directory — publish to Claude & ChatGPT connector stores

> How to take this MCP server from "installable" to "listed in the official
> connector/app directories of Claude and ChatGPT." The concrete, resumable
> task list lives in [docs/connector-directory-plan.md](../../../docs/connector-directory-plan.md) — read it before doing work.

## The three systems are SEPARATE (do not conflate)

| System | What it is | How this repo reaches it | Gets you into Claude/ChatGPT store? |
|--------|-----------|--------------------------|--------------------------------------|
| **npm `webcake-landing-mcp`** | stdio package | `npm publish` (CI `auto-release.yml`) | ❌ local installs only |
| **MCP Registry** `io.github.vuluu2k/webcake-landing-mcp` | neutral metadata catalog | `server.json` + `mcp-publisher publish` (see [[mcp-registry-publishing]]) | ❌ independent catalog |
| **Claude Directory / ChatGPT App Directory** | each vendor's in-product store | **host a remote MCP URL + submit a form + pass review** | ✅ this skill |

Publishing to npm or the MCP Registry does **not** propagate to the vendor stores. They are submitted and reviewed separately.

## Key mental model: nobody gives you a deploy port

Claude/ChatGPT do **not** host your code. **You** run the server (already deployed at `https://mcp.toolvn.io.vn/mcp` via `serve` mode — see [src/http.ts](../../../src/http.ts)); the platforms connect *into* your public HTTPS `/mcp` URL. "Deploy" = your infra, not theirs.

## Two levels of "being a connector"

- **Level A — self-serve add-by-URL (works TODAY, no submission):** anyone pastes
  `https://mcp.toolvn.io.vn/mcp` (or `...?jwt=<WEBCAKE_JWT>` for per-user auth) into
  **Settings → Connectors → Add custom connector**. Claude (Pro/Team/Enterprise + Desktop)
  and ChatGPT (Business/Enterprise/Edu, Developer mode). No OAuth strictly required —
  the `?jwt=` query path in [src/http.ts](../../../src/http.ts) `applyQueryAuth` exists for the
  claude.ai dialog that can't set headers. Downside: only people with the URL can add it.
- **Level B — official directory listing (form + review):** appears in the built-in
  connector/app list for everyone. **Requires OAuth 2.1** (Claude) + metadata + review.

## Hard requirements for Level B

1. **OAuth 2.1 + PKCE (S256)** — the biggest gap. MCP spec mandates it; Claude directory
   requires it. The server must become an OAuth *protected resource*:
   - Host `GET /.well-known/oauth-protected-resource` pointing at an Authorization Server.
   - Support Dynamic Client Registration (DCR) or Client ID Metadata Documents (CIMD).
   - Claude's redirect URI: `https://claude.ai/api/mcp/auth_callback`.
   - Pure machine-to-machine `client_credentials` is NOT accepted as a user-facing flow —
     each user completes a consent flow.
   - **Code seam:** today auth is a static JWT read in
     [src/persistence/config.ts](../../../src/persistence/config.ts) `configFromHeaders`
     (`Authorization: Bearer <jwt>` / `x-webcake-jwt` / `?jwt=`). OAuth means: validate a
     minted **access token** there instead, then map it to the user's Webcake identity/JWT.
2. **Tool safety annotations** — every tool needs a `title` plus `readOnlyHint` (reference/
   generation/media tools) or `destructiveHint` (create_page/update_page/add_section — they
   write to the backend). Registered in [src/tools/](../../../src/tools/) via `server.tool`/
   `registerTool` (SDK ≥1.29 supports the annotations arg).
3. **Submission assets** — icon, name (≤30 chars for ChatGPT), short+long description,
   privacy policy, terms, support contact, test account with sample data, screenshots,
   verified website, production-ready hosting.

## Where to submit

- **Claude Connectors Directory** — form (always open): https://claude.com/docs/connectors/building/submission · FAQ: https://support.claude.com/en/articles/11596036 · remote MCP uses the "MCP directory submission" form.
- **ChatGPT App Directory** — sign in to platform.openai.com → Apps submission. Guide: https://developers.openai.com/apps-sdk/deploy/submission · guidelines: https://developers.openai.com/apps-sdk/app-submission-guidelines. (Apps SDK = MCP + optional UI components; beta since Dec 2025.)

## Decision rule

- Only you / known clients use it → **stay at Level A**, no OAuth, done today.
- Want public discovery in the stores → **do Level B**, and OAuth 2.1 is the gating work.
  Follow the phased plan in [docs/connector-directory-plan.md](../../../docs/connector-directory-plan.md).
