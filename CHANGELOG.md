# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-06-06

### Added
- `get_generation_guide` now returns three dedicated per-trigger action dictionaries alongside the existing `click_actions` and `hover_actions`: `success_actions` (12 actions available on a form's `success` events after a successful submit, including `phone_call`, `download_file`, and `change_tab`), `error_actions` (3 actions available on a form's `error` events when validation fails), and `delay_actions` (`show_element` and `hide_element`, fired when an element scrolls into view).

### Changed
- Click and hover action entries in `get_generation_guide` now include an `Extra:` field listing each action's renderer-specific event-object keys (e.g. `open_link→targetURL/delayTime`, `scroll_to→scrollMore`, `change_tab→moveTo/tabIndex`, `show_hide_element→onlyMode/animation/animationOut`, `open_app→appTarget`+provider fields, `set_field_value→set_value`, `custom_js→custom_js`).
- `GENERATION_GUIDE` events-item rule expanded: now names all five trigger types (`click`, `hover`, `success`, `error`, `delay`) with their applicable scopes and cross-references the per-trigger action maps returned by `get_generation_guide`.

### Fixed
- `validate_page` now warns when the same `field_name` appears in more than one input within a single form, preventing silent data collision on submit.
- `validate_page` now warns when a `specials.options[].events_option` entry of type `showhide` or `collapse` carries a `promoId` that does not match any element id.
- `validate_page` now warns when `specials.connectedSurvey` or `specials.connectedForm` references an element id that does not exist in the page.
- `validate_page` now warns when a `set_field_value` event uses a `w-`-prefixed target that does not match any element id.
- `validate_page` now warns on dangling `collapse` action targets; `collapse` was missing from the element-id target check.

## [1.0.3] - 2026-06-06

### Added
- Two new event triggers: `error` (fires when form validation fails) and `delay` (timed trigger), expanding the vocabulary returned by `get_generation_guide` and valid in element events arrays.
- Four new click actions: `open_sms`, `send_email`, `download_file`, and `close_webview`, now included in the action vocabulary returned by `get_generation_guide`.
- `svariations` property accepted at the top level of the page schema as an open passthrough; agents should preserve it verbatim across `get_page` → edit → `update_page` on cart or commerce pages.

### Changed
- Element library (`get_element`, `list_elements`) comprehensively expanded for 29 elements that previously had sparse or empty specials hints: `form`, `input`, `select`, `checkbox-group`, `radio`, `group-select`, `group-select-item`, `survey`, `video`, `gallery`, `countdown`, `timegroup`, `auto-number`, `random-number`, `notify`, `spin-wheel`, `list-product`, `cart-quantity`, `table`, `verify-code`, `address`, `country-select`, `input-datetime`, `input-file`, `text-block`, `button`, `image-block`, `html-box`, and `editor-blog`.
- `alertMessage` corrected from a page element to an internal utility function; `get_element` now warns that nodes of this type must not be placed on a page or popup.
- `product-select` corrected to a legacy stub with no active renderer; `get_element` now warns against placing it and recommends `list-product` or `form` instead.
- `back_home` click action removed; `back_to`, `play_audio`, `stop_audio`, `share`, `copy`, and `open_app` action descriptions corrected to match actual renderer behavior.
- `change_image` hover action removed as it is not implemented in the current renderer.
- `text-block` and `button` hints expanded with the full template variable set (`{{today}}`, `{{cart_total_price}}`, `{{formId__fieldName}}`, etc.), formula mode, URL-param injection, and date formatting specials.
- `form` hints expanded with submit routing (success popup, URL redirect, app-redirect modes), pixel tracking (Facebook, TikTok, Google Ads), multi-form binding, and the `events[]` success/error action vocabulary.
- `group` element hints expanded with cart product variation selector specials (`sprod`, `ctype`, `sprod_attr`, `sprod_val`, `squantity`, `svariant`).
- `grid` and `carousel` hints expanded with dataset binding (`datasetId`), pagination, and autoplay config keys.
- Section hints expanded with conditional page-load visibility specials (`pageLoadEvent`, `pageLoadEventDelay`, `afterPageLoadEvent`, and related fields).
- `GENERATION_GUIDE` now documents cross-cutting per-breakpoint config keys (sticky positioning, animation, hide, lock) and references the full specials reference at `docs/element-specials-reference.md`.

### Fixed
- `validate_page` no longer emits false-positive dangling-reference warnings for `play_audio` and `stop_audio` events; their `target` is an audio file URL, not an element id, and they are now excluded from the id-existence check.
- `gallery` is now correctly classified as a leaf element; `new_element` no longer generates an empty `children` array on gallery nodes (gallery content comes entirely from `specials.media`).
- `new_element` for `cart-quantity` now seeds `specials.field_name` even though the type is not in `FIELD_TYPES`; the renderer requires this field.
- `new_element` for `countdown` now seeds the full specials object including `repeat`, `customize`, `customMessage`, `dailyStart`, and `dailyEnd`.
- `new_element` for `html-code` and `html-box` now seeds `specials.html` to an empty string.
- `create_page` and `update_page` error responses now include the backend's `message` or `reason` field when the server returns one, rather than a bare HTTP status code.

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
