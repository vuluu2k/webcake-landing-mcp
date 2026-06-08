# Changelog

**English** · [Tiếng Việt](./CHANGELOG.vi.md)

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.31] - 2026-06-08

### Fixed
- `get_element` for `spin_wheel` now correctly documents `specials.code` as a newline-delimited string (one line per segment in `couponCode|Prize Name|percent` format), not an array, and `specials.message` as the result-popup template string (not an array of segment labels); the element seed now emits both fields in the correct format so generated pages render properly.
- `get_element` for `gallery` now correctly documents `specials.media` as an array of media objects (`{type, link, linkVideo, typeVideo, imageCompression}`), not plain URL strings; the element seed, `get_generation_guide`, and server instructions all now document the correct object shape so that generated gallery elements display images instead of rendering blank.

## [1.0.30] - 2026-06-08

### Changed
- The server instructions now direct the agent to gather all `get_element` and `get_generation_guide` results before assembling the page source, build the full element tree in one pass, and avoid interleaving reference calls between `create_page` or `update_page` previews.
- The server instructions now enforce a single dry-run: call `create_page` or `update_page` with `dry_run=true` exactly once, show the result to the user, and only send `dry_run=false` after confirmation; if the dry-run exposes validation errors, fix them via `validate_page` and re-run once rather than looping dry-runs.

## [1.0.29] - 2026-06-08

### Fixed
- The `GET /` guide page now takes full control of scroll restoration across reloads: native browser scroll restoration is disabled in the `<head>` script and the exact `window.scrollY` offset is saved to `sessionStorage` on `beforeunload`/`pagehide` and restored at body-end so the position no longer drifts as reveal and hero animations settle.
- The social-card OG image now displays the correct install command (`npx -y webcake-landing-mcp install`) instead of the shorter form that omitted the `-y` flag and the `install` subcommand.

## [1.0.28] - 2026-06-08

### Fixed
- The `GET /` guide page no longer animates the browser's scroll-position restoration on reload; smooth scrolling is now enabled one animation frame after load so that anchor-link navigation remains smooth without causing a jerky scroll on page refresh.

## [1.0.27] - 2026-06-08

### Fixed
- The HTTP server's `GET /` route now serves the full HTML guide page to social and search crawlers (Facebook, Zalo, Twitter/X, LinkedIn, Slack, Telegram, WhatsApp, Discord, Google, Bing, and others) that send `Accept: */*` rather than `text/html`, so link previews and Open Graph tags are correctly seen by these bots.

## [1.0.26] - 2026-06-07

### Added
- The HTTP server now serves a pre-rendered 1200×630 PNG social card at `GET /og.png`; the guide page's `og:image` and `twitter:image` meta tags now point to the PNG so link previews unfurl correctly on Facebook, X, LinkedIn, and Zalo, which do not render SVG `og:image` assets.
- The guide page `<head>` now includes `og:image:type`, `og:image:alt`, and `twitter:image:alt` meta tags for more complete Open Graph and Twitter Card coverage.

## [1.0.25] - 2026-06-07

### Changed
- `currency` has moved from `options.currency` to `settings.currency` in the page source model; `new_page_skeleton` now emits it in the correct location, `get_generation_guide` documents the corrected placement, and `validate_page` enforces the updated schema.
- `new_page_skeleton` now emits `dynamic_pages: []` and `svariations: []` at the top level so that edit round-trips preserve commerce data; `cartConfigs` is now initialized to `{isActive: false}` instead of `{}`.
- `new_page_skeleton` `settings` skeleton now includes `robots`, `canonical`, `bhet` (custom code injected at the end of `<head>`), and `bbet` (custom code injected before `</body>`).
- `get_generation_guide` now documents `settings.robots`, `settings.canonical`, `settings.bhet`, and `settings.bbet`, and describes the corrected full top-level page source shape including `dynamic_pages` and `svariations`.
- `get_element` for `group-select-item` now documents the `field_placeholder` and `options` specials keys, and clarifies that the quantity item uses a static `options` array while attribute items populate their options from the product catalog at runtime.
- `get_element` for `otp-phone` now documents the `message_otp_wrong` specials key for customizing the error message shown when the user submits a wrong OTP.

## [1.0.24] - 2026-06-07

### Changed
- The numbered installation steps on the `GET /` guide page now display a faint vertical connector line between step numbers, giving the list a clear stepper appearance.
- Buttons inside installation steps on the `GET /` guide page now render on their own left-aligned line instead of sitting inline beside the step text.
- The installation note and "configure every IDE at once" command on the `GET /` guide page are now grouped together inside a styled tip box, making the relationship between the note and the command visually clear.

## [1.0.23] - 2026-06-07

### Added
- The `GET /` guide page now includes a dark/light theme toggle button in the header; the preference is saved in `localStorage` and applied before the page renders to prevent a flash of unstyled content.
- Every `<pre>` code block on the `GET /` guide page now has a one-click copy-to-clipboard button.

### Changed
- The `GET /` guide page is now responsive on narrow screens (≤640 px): the pipeline flow diagram stacks vertically, the header wraps correctly, and inline `<code>` elements no longer overflow their containers.
- The "configure every IDE at once" install command on the `GET /` guide page is now rendered as a separate `<pre>` block instead of an inline code snippet, making it easy to copy with the new copy button.

## [1.0.22] - 2026-06-07

### Added
- New `WEBCAKE_BUILDER_BASE` environment variable, `x-webcake-builder-base` HTTP header, and `?builder_base=` query parameter set the page-builder host used for the editor and preview links returned by `create_page` and `update_page`; each named environment preset (`local`, `staging`, `prod`) now carries a default builder base, and when none is given the host is derived automatically from the API base (`api.<domain>` → `builder.<domain>`).
- The `GET /` guide page served by the HTTP server now includes an animated bilingual flow diagram (vi/en) illustrating the idea-to-page pipeline: You → AI assistant → MCP → WebCake.

### Fixed
- `create_page` and `update_page` now return editor and preview links correctly rooted on the page-builder host instead of the SPA base (`WEBCAKE_APP_BASE`), so the links open in the page editor rather than the SPA.

## [1.0.21] - 2026-06-07

### Added
- The HTTP server's `GET /` guide page is now bilingual (vi/en): append `?lang=en` to the URL to switch to English (default is Vietnamese), a language toggle is rendered in the page header, and `<link rel="alternate" hreflang>` tags are emitted so search engines index both language variants.
- The HTTP server now serves a social-card image at `GET /og.svg`, referenced by `og:image` and `twitter:image` meta tags on the guide page, so links shared on social networks and chat platforms unfurl with a branded preview image.
- The `GET /` guide page now includes a complete SEO `<head>` (Open Graph, Twitter Card, and JSON-LD structured data for SoftwareApplication, WebSite, and FAQPage schemas) so the server URL is indexable and link previews render correctly when shared.

## [1.0.20] - 2026-06-07

### Changed
- `get_generation_guide` now includes a Layout Archetypes block that maps seven page types (sales/COD, lead-gen/service, event/invitation, app/SaaS promo, portfolio, local business, course/webinar) to concrete ordered section flows, so the agent picks the right structure for the page goal instead of defaulting to the sales template every time.
- `get_generation_guide` now includes a Visual Variety block that prescribes four named hero treatments (text-beside-image, full-bleed overlay, bold centered type, product/mockup centered), a palette-derivation rule (one accent + neutrals + alternating band backgrounds), and tone-to-typography guidance, so pages of the same type still look different from one another.
- `get_generation_guide` now includes a Section Build Hints block with per-band composition rules for hero, features/benefits, product/offer, social proof, form/CTA, and footer sections.
- The intake process described in `get_generation_guide` and the server instructions is now framed as a design-consultant interaction: the agent must propose a section flow (matched to the detected archetype) and a hero treatment alongside each batch of questions, offer two to three concrete directions when the user is vague, and suggest relevant sections (social proof, FAQ, countdown) before confirming the outline, rather than asking open-ended questions and waiting.

## [1.0.19] - 2026-06-07

### Changed
- `get_generation_guide` now includes a Section Playbook block that lists a common section menu for lead-gen and COD sales pages (header, hero, features/benefits, product/offer, social proof, lead form, footer), explains when to include or drop each band, and gives per-section composition guidance (hero treatments, feature-row centering, form field naming, footer content rules) while emphasising that coordinates must still be derived from the centering math and adapted to each product and brand.

## [1.0.18] - 2026-06-07

### Changed
- `new_element` for `list-product` now seeds a default `styles.colorBtn` (`rgba(246,4,87,1)`) so generated product-list button labels have a visible accent color without manual style edits.
- `new_element` for `survey` now seeds default border styles (`borderColor`, `borderStyle`, `borderWidth`, `margin`, `padding`) and pre-fills `specials.selectedBackground` and `specials.selectedBorder` so option cards render with visible spacing and selection state out of the box.

## [1.0.17] - 2026-06-07

### Fixed
- `get_element` and `get_generation_guide` no longer suggest `https://picsum.photos` as an alternative image placeholder; agents are now directed to use only `https://placehold.co/<width>x<height>` for `image-block` `specials.src`, consistent with the `keySpecials` description already in the catalog.

## [1.0.16] - 2026-06-06

### Changed
- The server icon (served at `/favicon.svg` and embedded in `serverInfo.icons`) has been refined to the official Webcake brand mark: a green-gradient (#3FBB57 → #108B67) rounded tile with the correct white "W" lettermark path and a peach (#FFD591) accent dot.
- The browser-facing `GET /` page served by the HTTP server is now a rich, self-contained guide that explains what the MCP does, lists two connection methods (npx local install and remote URL), and shows a live endpoint URL; the displayed URL adapts to the actual public hostname via `x-forwarded-host` and `x-forwarded-proto` headers so it is correct behind a reverse proxy (Coolify, Traefik, Cloudflare).

## [1.0.15] - 2026-06-06

### Changed
- The server icon (served at `/favicon.svg` and embedded in `serverInfo.icons`) has been updated from a lightning-bolt placeholder to the official Webcake "W" lettermark (green rounded tile with white "W"), matching the logo used in the Webcake SPA.

## [1.0.14] - 2026-06-06

### Added
- The HTTP server now serves the Webcake green bolt SVG at `/favicon.svg`, `/favicon.ico`, and `/icon.svg` so MCP clients that fetch a favicon from the server origin display a branded icon instead of a generic globe.
- The MCP `initialize` handshake now includes a `serverInfo.icons` entry carrying a self-contained data URI of the Webcake icon, so clients that render server icons (e.g. the claude.ai custom-connector UI) show the branded icon without requiring a public URL.
- `GET /` on the HTTP server now returns a minimal HTML page with a favicon link when the request includes `Accept: text/html`; programmatic health-check clients continue to receive the JSON `{ ok: true }` response.

## [1.0.13] - 2026-06-06

### Changed
- The `login` subcommand now re-focuses the terminal automatically on macOS once the browser delivers the OAuth token, so the user does not need to manually switch back after connecting.
- The browser success page shown after `login` completes has been redesigned with a modern animated card layout, an SVG check-mark badge, and full dark-mode support.

## [1.0.12] - 2026-06-06

### Added
- New `help` subcommand (`webcake-landing-mcp help`) prints a top-level usage summary covering all subcommands (`install`, `uninstall`, `login`, `serve`), the `--env` global option, and a link to the GitHub repository.

### Changed
- `--help` and `-h` flags now print the new top-level help instead of delegating to the installer's own `--help` output; install-specific flags are still accessible via `webcake-landing-mcp install --help`.

## [1.0.11] - 2026-06-06

### Removed
- The `WEBCAKE_HOST` environment variable, `--host` installer flag, `x-webcake-host` request header, and `?host=` HTTP query parameter have been removed; Phoenix host-routing via a custom `Host` header is no longer supported.
- The `WEBCAKE_CONNECT_URL` environment variable is no longer accepted by the `login` subcommand; the connect URL is now always derived from the active environment preset as `<appBase>/mcp-connect`, with only an explicit `--connect-url` CLI option still accepted as an override.

## [1.0.10] - 2026-06-06

### Added
- New `WEBCAKE_ENV=local|staging|prod` environment variable selects a named deployment preset that automatically fills in both `WEBCAKE_API_BASE` and `WEBCAKE_APP_BASE`, so persistence tools (`create_page`, `update_page`, `list_pages`, etc.) connect to the right backend without setting the two URL variables separately.
- New global `--env <name>` CLI flag (also `--env=<name>`) applies a named environment before any config is read; an unrecognized value passed via the flag exits immediately with a list of valid names, while an unrecognized `WEBCAKE_ENV` value is silently ignored so explicit base-URL overrides still resolve.
- The HTTP server now accepts `x-webcake-env` as a per-request header and `?env=<name>` as a URL query parameter, letting individual callers select a named environment without changing the server's own environment.

### Changed
- The interactive `install` wizard now presents an environment selector (local / staging / prod) in place of the raw `WEBCAKE_API_BASE` URL prompt, and offers browser-based login (via `login`) as the default first authentication step; `WEBCAKE_ENV` is written into the IDE config env block instead of `WEBCAKE_API_BASE`.
- The `login` subcommand now derives both its connect URL and API base from the active environment preset and saves `appBase` (SPA URL) to `auth.json` alongside `base` (API URL), so no separate `WEBCAKE_APP_BASE` is needed after a browser login.

## [1.0.9] - 2026-06-06

### Changed
- The HTTP server now accepts Webcake credentials (`jwt`, `api_base`, `org_id`, `host`, `app_base`) as URL query parameters (e.g. `.../mcp?jwt=<token>`) in addition to the existing `x-webcake-*` / `Authorization: Bearer` headers, enabling clients such as the claude.ai custom connector dialog that cannot set custom headers to authenticate without environment variables.

## [1.0.8] - 2026-06-06

### Added
- New `webcake-landing-mcp login` subcommand authenticates via the browser automatically: it opens a loopback callback server, launches the Webcake connect page, and saves the received JWT to `~/.webcake-landing-mcp/auth.json`, eliminating manual token copy-paste.
- New `webcake-landing-mcp serve [--port N]` subcommand (also accepts the `PORT` env var) starts a Streamable-HTTP server at `/mcp`, enabling the server to run as a Claude custom connector accessible via a public URL with multi-user support.
- A `/health` endpoint (`GET /` or `GET /health`) is available on the HTTP server for hosting-platform health checks.

### Changed
- Credential resolution in `readConfig` now follows a three-tier priority: per-request HTTP header overrides first, then environment variables, then the saved `~/.webcake-landing-mcp/auth.json` written by `login` — so a one-time browser connect replaces pasting `WEBCAKE_JWT` into the environment.
- All five persistence tools (`list_organizations`, `create_page`, `list_pages`, `get_page`, `update_page`) now read the caller's Webcake JWT from the `x-webcake-jwt` or `Authorization: Bearer` request headers in remote/HTTP mode, so a hosted server is multi-user without baking a shared token into the environment.
- Missing-credential error messages and dry-run hints from persistence tools now mention the `x-webcake-jwt` header as an alternative to the `WEBCAKE_JWT` env var.

## [1.0.7] - 2026-06-06

### Changed
- `get_generation_guide` and server instructions now document the sticky/fixed header overlay behavior: a section with `config.sticky` overlays the page and does not push content below it down, so agents are instructed to offset the first section's topmost elements by the header height (~60–72 px) on both breakpoints and to avoid duplicating the shop name in both the header and the hero.
- Intake instructions in `get_generation_guide` and server instructions are strengthened to require gathering answers before generating even for "quick" or "test" pages; agents must restate a short outline (sections + CTA + colors) and wait for explicit user confirmation before calling `new_page_skeleton` or `create_page`.
- The rule against inventing data is expanded into a dedicated instruction covering phone/hotline/Zalo, price (and original price), address, shop/brand name, links/URLs, email, opening hours, and social-proof numbers; agents are directed to ask for any missing value and may use a clearly-labelled placeholder only when the user explicitly declines to provide it.
- Intake question list in `get_generation_guide` adds a required "Product + price" question for sales and ads pages, and rephrases the sections question to invite proposing a sensible default layout for the user to confirm.

## [1.0.6] - 2026-06-06

### Internal

- The monolithic `src/index.ts`, `src/library.ts`, and `src/factory.ts` are replaced by a layered module structure: `src/core/` (domain-agnostic primitives — `element.ts`, `descriptor.ts`, `domain.ts`), `src/domains/landing/` (all landing-specific logic), `src/tools/` (the 12 MCP tools split into `reference.ts`, `generation.ts`, and `persistence.ts`), `src/mcp/response.ts` (the `text()` helper), and `src/persistence/` (`config.ts`, `types.ts`, `webcake-client.ts`).
- The element catalog is split from a single `library.ts` into five per-category descriptor files (`layout.ts`, `content.ts`, `form.ts`, `commerce.ts`, `marketing.ts`) under `src/domains/landing/elements/`, with `index.ts` deriving `LIBRARY`, `CONTAINER_TYPES`, `FIELD_TYPES`, `ELEMENT_TYPES`, and `createElement` from them.
- `src/server.ts` extracts `McpServer` construction from the entry point, leaving `src/index.ts` as a thin subcommand dispatcher.
- `page-schema.json` moves from `src/` to `src/domains/landing/` alongside `validate.ts`.
- `src/webcake.ts` is renamed to `src/persistence/webcake-client.ts` with Webcake HTTP config and API types extracted into `config.ts` and `types.ts`.
- No tool names, parameters, output shapes, or runtime behavior changed.

## [1.0.5] - 2026-06-06

### Internal

- `CONTAINER_TYPES` is now derived from the `container` flag on each `LIBRARY` entry in `library.ts` rather than a separate hardcoded list in `factory.ts`, eliminating a silent-drift risk when new element types are added; `factory.ts` re-exports both `CONTAINER_TYPES` and `FIELD_TYPES` for backward compatibility.
- `FIELD_TYPES` moved to `library.ts`, co-located with `LIBRARY` as the single source of truth for element structural flags.
- Smoke gate now asserts the `page-schema.json` `elementType` enum exactly matches `LIBRARY` keys, so adding a type to one file without the other fails `npm run smoke` immediately rather than silently diverging.

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
