# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-05

### Added

- Initial release of the `webcake-landing-mcp` MCP server.
- Reference tools: `get_generation_guide`, `list_elements`, `get_element`, and `get_page_schema` expose the element catalog, per-element `specials` hints, and the full page JSON Schema (Draft 2020-12).
- Generation tools: `new_element` and `new_page_skeleton` return structurally-valid default nodes, and `validate_page` performs structural + semantic validation.
- Persistence tools: `list_organizations`, `create_page`, `list_pages`, `get_page`, and `update_page` create or edit pages on a Webcake backend, defaulting to `dry_run=true`.
