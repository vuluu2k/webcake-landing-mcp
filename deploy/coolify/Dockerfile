# syntax=docker/dockerfile:1
#
# Production image for the webcake-landing MCP server in REMOTE (Streamable-HTTP)
# mode — i.e. `node dist/index.js serve` (see src/index.ts / src/http.ts).
#
# The build context is the REPO ROOT (see docker-compose.yml: `context: ../..`),
# so every path below is repo-relative.
#
# Multi-stage:
#   1. build      — install all deps, compile TS -> dist/, run the offline smoke gate
#   2. prod-deps  — install runtime-only deps (no typescript)
#   3. runtime    — tiny image: node_modules + dist + a non-root user
#
# NOTE: `npm ci` is run with `--ignore-scripts` because package.json defines
# `"prepare": "npm run build"`, which would otherwise fire tsc during install —
# before the sources are even copied. None of the deps need install scripts.

# ---- 1. build: compile + smoke-test -----------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
# Install ALL deps (incl. typescript) against the lockfile for a reproducible build.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
# Sources consumed by `npm run build` (tsc + scripts/copy-assets.mjs).
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
# Changelog files feed scripts/gen-changelog.mjs -> src/changelog.json (the page's
# "What's new"). gen-changelog tolerates their absence, but copying them keeps the
# deployed page's changelog populated.
COPY CHANGELOG.md CHANGELOG.vi.md ./
# Compile to dist/ (and mirror src/**/*.json into dist/), then run the offline
# smoke gate — a broken factory/validator/example fails the image build, exactly
# like `npm run smoke` locally (must print "ALL GOOD").
RUN npm run build && npm run smoke

# ---- 2. prod-deps: runtime node_modules only --------------------------------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- 3. runtime: minimal image ----------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8787
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Run as the unprivileged `node` user that ships with the official image.
USER node
EXPOSE 8787
# Default command: the remote Streamable-HTTP transport, listening on $PORT.
# (`serve` reads --port, else PORT env, else 8787 — see src/index.ts.)
CMD ["node", "dist/index.js", "serve"]
