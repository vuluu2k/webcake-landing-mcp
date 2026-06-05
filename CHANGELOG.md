# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-06-05

### Added
- Bundled `install` / `uninstall` subcommand: running `npx -y webcake-landing-mcp install` interactively (or non-interactively via `--ide`, `--jwt`, `--api-base`, and related flags) writes the `webcake-landing` MCP server entry into Claude Desktop, Claude Code, Cursor, Windsurf, Augment (VS Code), and Codex config files without requiring a local clone.
- `uninstall` subcommand removes the `webcake-landing` entry from all supported IDE config files in a single step.
- The install command auto-detects whether it was run via `npx` or from a local clone and writes the appropriate launch form (`npx -y webcake-landing-mcp` vs `node <path>/dist/index.js`); override with `--npx` or `--local`.

## [1.0.1] - 2026-06-05

### Added
- The server now sends workflow instructions on MCP `initialize`, giving AI clients always-on rules for intake, validate-before-save, dry-run confirmation, surgical editing, and organization scoping.
- `new_element` now pre-fills `specials.src` (image-block), `specials.img` (video), and `specials.media` (gallery) with sized `placehold.co` placeholder URLs so generated pages render visible content immediately rather than blank image slots.
- `validate_page` now emits layout-bounds warnings when an element's `left + width` or `top + height` overflows the canvas, and suggests the corrected centering value inline.

### Changed
- Generation guide and element library hints now include explicit centering math (`left = round((canvas - width) / 2)`) and a CONTRAST rule to reduce off-center and invisible-text layout defects in generated pages.
- `image-block`, `video`, and `gallery` element hints updated to require a placeholder URL when no real image is available and warn against leaving `specials.src` or `specials.media` empty.
- `countdown` usage hint corrected to describe the actual fixed four-slot flex layout: hiding a segment via `specials.showDay` or `specials.showSecond` leaves an empty gap rather than re-flowing the row, so both should remain `true` to fill the row evenly.

## [1.0.0] - 2026-06-05

### Added

- Initial release of the `webcake-landing-mcp` MCP server.
- Reference tools: `get_generation_guide`, `list_elements`, `get_element`, and `get_page_schema` expose the element catalog, per-element `specials` hints, and the full page JSON Schema (Draft 2020-12).
- Generation tools: `new_element` and `new_page_skeleton` return structurally-valid default nodes, and `validate_page` performs structural + semantic validation.
- Persistence tools: `list_organizations`, `create_page`, `list_pages`, `get_page`, and `update_page` create or edit pages on a Webcake backend, defaulting to `dry_run=true`.
