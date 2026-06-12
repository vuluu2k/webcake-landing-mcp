# Changelog

**English** · [Tiếng Việt](./CHANGELOG.vi.md)

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.67] - 2026-06-12

### Added
- `upload_images` now accepts local file paths in the `urls` parameter — absolute POSIX paths (`/…`), home-directory paths (`~/…`), `file://` URIs, and Windows drive paths (`C:\…`) — so the AI can re-host images directly from the user's machine without routing them through a third-party service; local paths are only permitted when the server runs in stdio mode and are rejected per-entry on the remote HTTP transport.
- Per-image size limit for `upload_images` raised from 8 MB to 200 MB, matching the backend's multipart `Plug.Parsers` limit.

### Changed
- `upload_images` now sends images via multipart/form-data upload instead of base64-encoded JSON, improving transfer efficiency for large images; local file MIME type is determined by magic-byte sniffing (with extension as fallback).
- Generation guide (`get_generation_guide`) and server instructions updated to document that local file paths from the user's machine can be passed directly to `upload_images` without going through a third-party upload host.

## [1.0.66] - 2026-06-12

### Changed
- Generation guide (`get_generation_guide`) and server instructions now prescribe a four-step image sourcing priority: (1) re-host user-supplied or reference-HTML images via `upload_images`; (2) call `search_images` for empty slots; (3) if `search_images` returns `ok:false`, is unreachable, or has no fitting photo, find a real image independently using whatever web-search or fetch capability is available then re-host it via `upload_images`; (4) use a `placehold.co` placeholder only as the last resort after both (2) and (3) fail — the guide explicitly prohibits jumping straight from a failed search to a placeholder.

## [1.0.65] - 2026-06-12

### Added
- `validate_page` now warns when a single-line `text-block` label sitting on a rounded `rectangle` (the badge/pill pattern) is vertically or horizontally off-center: it uses real per-character font metrics to locate the rendered line box and the pill's geometric center, and reports the exact corrected `top` and `left` values when the offset exceeds a few pixels.
- `validate_page` also warns when the badge label text is wider than its pill rectangle and suggests the correct pill width with standard horizontal padding.
- Generation guide (`get_generation_guide`) now includes a BADGE/PILL authoring recipe: build the pattern as two elements — a rounded `rectangle` (pill) plus a `text-block` layered on top — size the pill from the estimated text width, and center the LINE BOX (not `styles.height`) because the renderer draws `text-block` height as auto from `top`; also documents that applying `styles.background` to a `text-block` enables gradient-text-fill mode (the renderer sets `-webkit-text-fill-color:transparent`), making the glyphs invisible instead of adding a backdrop.

## [1.0.64] - 2026-06-12

### Added
- `validate_page` now warns when a `rectangle` element's `svgMask` is misconfigured: placed in `specials` or `styles` instead of `responsive.<bp>.config` (where the renderer reads it), set on only one breakpoint, not starting with `<svg`, missing a `viewBox`, containing no drawable shape elements, or lacking a visible `styles.background` (the SVG is only a mask — visible color comes entirely from `styles.background`).
- Generation guide (`get_generation_guide`) and server instructions now embed the full element type catalog (all types grouped by category) so the model always sees the complete menu of available types without a `list_elements` call.

### Changed
- `validate_page` text-overflow checks (own-box and sibling-collision) now use real per-character font advance widths with greedy word-wrap, honoring `fontWeight`, `letterSpacing`, `textTransform`, and `lineHeight`; the previous flat `chars × fontSize × 0.55 / width` approximation under-counted UPPERCASE and bold headings, allowing overlaps to slip through undetected.
- Text height estimation guidance in `get_generation_guide` updated to recommend a wider character factor (0.7) for ALL-CAPS/uppercase headings and to note that `validate_page` re-checks box sizing with real font metrics.

## [1.0.63] - 2026-06-11

### Added
- `create_page` now auto-publishes after a successful create: builds the rendered app via the build host and calls the editor's `publish_html` route so the new page's preview renders immediately; a failed auto-publish never fails the create — `result.publish` carries the outcome and retry hint.
- `create_page` accepts a new `publish` parameter (default `true`); set `false` to create source-only and skip auto-publishing.
- `editor_url` returned by `create_page`, `update_page`, and `add_section` is now a self-logging-in link (routed through the builder's `/transport` endpoint with the caller's JWT), so the page owner can open it without first logging in to Webcake.
- `publish_page` result now includes a `live` boolean (`true` when the `publish_html` route ran and the `PagePublishedV2` record was written).
- Draft cache TTL extended from 30 minutes to 2 hours; now overridable via the `WEBCAKE_DRAFT_TTL_MS` environment variable.

### Changed
- `patch_page` tool description (and related error hints in `create_page`, `add_section`, and `validate_page` output) now explicitly states that `op:'update'` merges and cannot delete an existing key — schema `additionalProperties` errors require `op:'replace'` with a clean node.
- `create_page` failure hint now detects transient backend 404/5xx errors and advises against dropping `organization_id` when retrying, to prevent pages from landing in the wrong workspace.
- Server instructions updated to document the auto-publish behavior, the `editor_url` self-sign-in constraint (share with the page owner only), the ~10-minute preview link expiry, and the need to run `publish_page` after edits to rebuild the rendered app.

### Fixed
- `publish_page` now correctly calls the editor's `publish_html` route (which creates/updates the `PagePublishedV2` record that all public serving paths read) instead of the legacy `/edit/publish` route that only saved a version without making the page live; the publish payload now matches the editor's `PublishModal` format (`data_node`, `settings`, `render_type`, `auto:false`).
- Schema error messages from `validate_page` (and every tool that invokes it) now name the enclosing element's `id` and `type`, the offending property key (for `additionalProperties` errors), and the actual bad value (for `enum`/`type` errors), so the model can target the correct element on the first fix attempt.
- The expand pipeline (called by `create_page`, `update_page`, `add_section`, `validate_page`, and `patch_page`) now automatically relocates `responsive.<bp>.animation` into `responsive.<bp>.config.animation` when the two are confused, silently correcting the most common "must NOT have additional properties" schema error before validation.

## [1.0.62] - 2026-06-11

### Added
- `validate_page` now warns when a `text-block`'s estimated rendered height overflows onto a sibling element placed directly below its declared box; the warning names both the overflowing block and the victim element, and prescribes the exact new height and minimum top offset to apply.
- `validate_page` now warns when a section's declared height exceeds the bottom of its lowest child by more than 320px, flagging the empty trailing band at the section's bottom.
- `validate_page`, `create_page`, `update_page`, `add_section`, and `patch_page` now include a `warnings_notice` field alongside any non-empty `warnings` list; the notice is an explicit fix directive so the model treats every warning as a required correction rather than advisory output.

### Changed
- `validate_page`'s own-box text-overflow check now applies a tighter slack of `min(fontSize × 1.4, 24px)` instead of one full line, catching the common 2-line heading placed on a 1-line-sized box that previously slipped through at larger font sizes.
- `validate_page` tool description updated to describe warnings as "visible design defects" that must be fixed and re-validated to an empty list before persisting; only a demonstrably false positive may remain.
- Generation guide (`get_generation_guide`) and server instructions now mandate fixing every `validate_page` warning before the first `create_page` or `update_page` call, and before reporting a page as done to the user.

## [1.0.61] - 2026-06-11

### Added
- `ingest_html` and `ingest_url` now return a `size_hint` field (`{ height, basis, css? }`) on every AST section, providing the desktop section height in px derived from explicit `height`/`min-height` CSS rules on the source element when present or estimated from content volume otherwise; the generation guide (`get_generation_guide`) now directs the model to set each rebuilt section's desktop height from this hint instead of the 800 px default, so the page's vertical rhythm tracks the source.
- `ingest_html` and `ingest_url` in `detail:'full'` mode now return a `widgets` array on sections that contain composite visuals (phone or device mockups, chat threads, mini dashboards, browser frames), each entry providing the cleaned source HTML and matching stylesheet rules as `{ hint, html, css? }`; the generation guide now directs the model to build each composite widget as one `html-box` by inlining `widgets[].css` rules into `widgets[].html` verbatim rather than approximating the markup from summary fields.

## [1.0.60] - 2026-06-11

### Fixed
- The `expand` pipeline (invoked by `create_page`, `update_page`, `add_section`, `validate_page`, and `patch_page`) now auto-canonicalizes every `url()` layer in `styles.background` to the editor's exact shorthand; a non-canonical URL background (such as CSS copied from a reference page) previously survived the first save but was mangled to `undefined/ undefined/ …` the next time the page was edited in the Webcake editor, rendering the background band blank.

### Changed
- Generation guide (`get_generation_guide`), server instructions, and the `ingest_html`, `ingest_url`, `search_images`, and `upload_images` tool descriptions now enforce a strict image-source priority: images supplied by the user or found in a reference HTML/URL (ingest AST `images`, `background_images`, `og_image`) must be re-hosted via `upload_images` and reused in their original slots for both `intent:'adapt'` and `intent:'clone'`; `search_images` is reserved for image slots that have no source image.
- `ingest_html` and `ingest_url` `intent` parameter description clarified: `intent:'adapt'` rewrites the page text for the user's brand while reference images are still re-hosted via `upload_images` and preserved in place.

## [1.0.59] - 2026-06-11

### Changed
- `create_page` now resolves the organization automatically on the real run (`dry_run:false`): if the account has exactly one org it is auto-selected and the result includes `organization_auto_selected:true`; if there are multiple orgs and none is specified, the tool returns `ok:false` with the org list and a `draft_id` so the caller re-calls with the chosen `organization_id` — no up-front `list_organizations` call is needed before saving.
- `create_page` now accepts `organization_id:"personal"` as a sentinel to explicitly save a page without any organization, bypassing auto-resolution entirely.
- `create_page` dry-run response now includes an `organization_note` field that describes how the organization will be resolved on the real run given the current inputs.
- Generation guide (`get_generation_guide`) and server instructions updated to match the new org-resolution rules: call `list_organizations` only when the account has 2+ orgs; with exactly one org, `create_page` selects it automatically; pass `organization_id:"personal"` only when the user explicitly wants no org.

## [1.0.58] - 2026-06-11

### Changed
- `html-box` descriptor (`get_element`) has been rewritten to document COMPOSITE VISUALS as the primary use case: intricate non-interactive mockups such as phone/chat threads, mini dashboards, browser-window frames, inbox/notification lists, and ticket-style cards should use ONE `html-box` instead of dozens of absolute-positioned elements; the descriptor now includes a full authoring recipe (inline styles only, root `div` fills the box via `width:100%;height:100%;box-sizing:border-box;overflow:hidden`, flex/grid allowed inside, content must fit `styles.height`, `specials.html` must be HTML-escaped, both breakpoints required, font-family inline on the root), explicit when-not-to-use guidance (primary copy, CTAs, form fields, event targets), and a phone-chat mockup example.
- Generation guide (`get_generation_guide`) and server instructions now direct the model to rebuild a composite widget found in an ingested page or screenshot as a single `html-box` with all styles inlined, rather than decomposing it into element soup.

## [1.0.57] - 2026-06-11

### Added
- New `upload_images` tool re-hosts up to 20 external image URLs or `data:` URIs as Webcake-hosted URLs (statics.pancake.vn) by downloading and uploading each image to the Webcake backend; no Webcake credentials required; defaults to `dry_run=true`.
- `ingest_html` and `ingest_url` now accept a `detail` parameter (`'compact'` default / `'full'`); `detail:'full'` returns a richer AST (up to ~25 KB) that adds the CSS custom-property palette, `background_images` extracted from `<style>` blocks, per-section repeating blocks (cards/tiles/steps with title/body/image/cta), `li` lists, gradients, and images as `{ src, alt }` objects; use for clone-faithful rebuilds.

### Changed
- `publish_page` now calls the Webcake build host (`POST <buildBase>/render/build`) before publishing when one is configured (prod auto-preset `https://build.webcake.io`, override with `WEBCAKE_BUILD_BASE` env or `x-webcake-build-base` header), so the published page and `/preview/<page_id>` render immediately without re-saving in the editor; the result now includes a `rendered` boolean; the dry-run response now includes a `build_step` field showing whether the build host would be called; when no build host is available the tool falls back to source-only publish with a `warning` in the result.
- `text-block` descriptor now documents that the element does not emit `border-radius`; for a rounded pill or badge shape, place a `rectangle` (with `borderRadius`) behind the `text-block` — setting `styles.background` on a `text-block` activates gradient text-fill mode, not a box fill.
- Generation guide and server instructions now include a TAG/BADGE pill recipe, document that `borderRadius` is a CSS-unit string (e.g. `"13px"`), add a REFERENCE INPUT section with `detail:'full'/'compact'` guidance and role-to-element mapping hints for `ingest_html`/`ingest_url`, and list `upload_images` in the tool registry with guidance to re-host image URLs found in ingest results when intent is `'clone'`.

## [1.0.56] - 2026-06-11

### Added
- The `expand` pipeline now automatically derives `styles.background` from `specials.src` for every `image-block` node; the live published renderer reads only `styles.background`, so pages authored with only `specials.src` set previously rendered blank on publish.
- `validate_page` now errors when `countdown.specials.type` is missing or is not `minute`, `duration`, or `daily`; an invalid type throws a TypeError at runtime leaving the timer dead.
- `validate_page` now errors when a `video` with `typeVideo='vimeo'` or `typeVideo='webcake'` is missing `specials.video`, or when `typeVideo='youtube'` is missing `specials.id`; either omission crashes the whole page on load.
- `validate_page` now errors when an `address` element's `specials.field_name` is not exactly `province_id/district_id/commune_id`; any other value causes the province/district/commune dropdowns to never populate.
- `validate_page` now errors when a `verify-code` in split-input mode (the default) has `length_otp` other than 4 or 6; any other value renders no OTP boxes at all.
- `validate_page` now errors when a `random-number` is missing or has a non-numeric `startNumber`, `endNumber`, or `jumpNumber`; any missing value renders the literal string `NaN` on the live page.
- `validate_page` now errors when a `spin-wheel`'s segment percents do not sum to 100; unbalanced percents throw a TypeError on spin.
- `validate_page` now errors when a `survey` option lacks a `title` and `specials.type` is not `image`; a missing title causes a TypeError during page build.
- `validate_page` now warns when an `image-block` has neither `specials.src` nor a `url()` in `styles.background` for a breakpoint (renders blank on the published page at that breakpoint).
- `validate_page` now warns when a `text-block` has `styles.background` set without `styles['-webkitBackgroundClip']:'text'`; gradient text-fill mode makes all glyphs invisible on the live page without the clip key.
- `validate_page` now warns when a `text-block`'s visible text consists entirely of standalone emoji; the recommendation is to use a `rectangle` with `config.svgMask` and a brand-color `styles.background` for card icons instead.
- `validate_page` now warns when a `text-block`'s estimated wrapped height exceeds the declared box height; live text height is auto, so the overflow pushes the elements below downward.
- `validate_page` now warns when an `editor-blog` element's `specials.html` appears to contain escaped HTML (`&lt;` present); the publisher injects html raw, so escaped markup renders as literal tag strings on the live page.
- `validate_page` now warns when a `list-paragraph` has missing or empty `specials.text`; the live renderer renders the literal string `undefined` when the key is absent.
- `validate_page` now warns when a `checkbox` element is used; the published renderer has no case for this type and renders it blank — use `checkbox-group` with a single option instead.
- `validate_page` now warns when a `grid` is missing `specials.datasetId`; without a dataset the grid is permanently hidden (opacity 0, off-canvas) on the published page.
- `validate_page` now warns when a `cart-items` element is placed; the published renderer has no case for it and renders an empty string — the real cart UI is the WCart floating drawer beside the cart icon.
- `validate_page` now warns when a form's `specials.submit_success` is a string; it must be the number `1` or `2` — a string silently falls to the no-op redirect branch.
- `validate_page` now warns when a form has `submit_success=1` but `popup_target` is missing or refers to a non-existent element id; the submit then succeeds with no user feedback.
- `validate_page` now warns when a form has `submit_success=2` but `redirect_url` is missing; the redirect destination is unknown and the submit is a no-op.
- `validate_page` now warns when a form field (`FIELD_TYPES` element) is nested inside a group or other container rather than as a direct child of the form; the form's submit loop does not recurse, so nested fields validate but never submit.

### Changed
- Element descriptors for all five categories (layout, content, form, commerce, marketing) have been updated with verified renderer-contract behavior — crash conditions, dead specials, required keys, corrected types, and default values — derived from the production renderer source for 30+ element types; these updates are reflected in `get_element`, `list_elements`, and `get_generation_guide`.
- `section` descriptor now warns that `globalSection:true` renders the section empty on a normal page publish, and that `custom_class`/`custom_css` take effect only when `specials.customAdvance:true`; `video_background` and the `pageLoadEvent` enum values are now fully documented.
- `dynamic_page` descriptor now prominently warns that children are dropped by the renderer on a normal publish; use `section` for all normal content.
- `group` descriptor now documents that a group's own background and border do not render on the live page (use a full-size `rectangle` as the first child for visual styling) and adds `scrollAuto:'yes'` for horizontal-scroll mobile strips.
- `grid` descriptor now marks `specials.datasetId` as required for live rendering (without it the grid is permanently hidden), corrects `timeSlide` units to seconds, and notes that only `children[0]` is used as the clone template on the published page.
- `carousel` descriptor now documents that the renderer overrides `styles.width`, that `autoplayMode` is the string `'off'|'start'|'repeat'` (not a boolean), and adds `transition`/`transitionTime` config keys; `slide` and `popup` descriptors now mark `specials.src` as dead on the published renderer (set the background via `styles.background` instead).
- `popup` descriptor now enumerates `position` values and documents `openInPage`, `delayPopup`, `scrollTo`, and `maxHeight` keys.
- `text-block` descriptor now documents that `styles.background` activates gradient text-fill mode (requires `styles['-webkitBackgroundClip']:'text'`) and that `styles.backgroundTxt` is the correct key for a colored box behind the text; `config.virtualHeight` is also documented.
- `image-block` descriptor now explains that the live renderer reads `styles.background` (not `specials.src`) and that the server auto-derives it from `specials.src` on every expand; CDN crop keys (`widthBgImage`, `heightBgImage`, `topBgImage`, `leftBgImage`) and `keep_solution` are now documented.
- `rectangle` descriptor now fully documents `config.svgMask` for per-breakpoint scalable SVG icon shapes and recommends this pattern over keyboard emoji for feature card icons; the `line` seed now sets default `borderWidth`, `borderStyle`, and `borderColor` (previously no visual defaults were seeded, making the element invisible without explicit styling).
- `button` descriptor now warns that the `change_background` and `change_text_color` hover event actions are broken on published pages (the CSS variables they rely on are never defined at publish time); use `change_color` with `change_color_type` instead.
- `video` descriptor now documents required specials per `typeVideo`, notes that a `url()` in `styles.background` takes precedence over the `specials.img` poster (do not set a flat background color on a video element), and documents `videoFit`.
- `gallery` seed now sets `config.showThumbnail:true` on both breakpoints; previously unset, the live renderer showed an 80px thumbnail strip while the editor hid it; the descriptor now documents that video items must use `type:'video'` and that `typeVideo:'upload'` renders empty on the live page.
- `html-box` and `editor-blog` descriptors now clarify their opposite HTML-escaping behaviors (`html-box` stores escaped HTML; `editor-blog` stores raw HTML) and that both have a wrapper height fixed to `styles.height`.
- `form` descriptor now documents that all form fields must be direct children of the form (not nested inside groups or rectangles), corrects `submit_success` as a number (not a string), marks `popup_target` as required when `submit_success=1`, and adds `sync_to_crm`; the seed now sets `fb_event_type:'none'` and `sync_to_crm:'none'`.
- `checkbox` descriptor now marks the element as non-functional on the published page; use `checkbox-group` with a single option instead.
- `address` descriptor now marks `specials.field_name` as the canonical fixed value `province_id/district_id/commune_id` required by the renderer, and the seed now sets this value directly (it previously seeded a dynamic `address_<id>` value that caused the dropdowns to never populate).
- `verify-code` seed now sets `type_otp_input:'split-input'` and `length_otp:6`; the descriptor documents that split-input only renders OTP boxes for `length_otp` 4 or 6.
- `cart-items` descriptor now prominently warns not to place this element; `table` descriptor now makes `specials.sourceTable` the primary content key (the SSR publisher renders only this and the google_sheet branch is commented out in the production publisher).
- `countdown` seed now sets `customize:'nothing'` (was `false`) and adds `showHour:true`; the descriptor corrects `customize` from a boolean to the string `'customize'|'nothing'` and marks `specials.type` as required.
- `spin-wheel` seed now sets `background`, `backgroundBtn`, `spin`, `rotate`, `popup`, `popupTurnOver`, and `showCoupon`; the descriptor corrects `spin` to a string-number of turns, marks `message` as required when `popup='default'`, and corrects `showCoupon` to the string `'yes'|'no'`.
- `notify` descriptor now corrects `dataType` values (1=Google Sheets, 2=dataset; there is no static-data `0`), corrects `soundMode` to the string `'none'|'default'|'link'` (was documented as a boolean), fixes `source`/`sheetID` semantics (source is the spreadsheet ID; sheetID is the tab name), and documents `config.notiPos` for viewport-pinned toast positioning.
- `change_background` and `change_text_color` hover event actions are now documented as legacy and broken on published pages in the event vocab; `change_color` with `change_color_type` is the correct modern replacement.
- `get_generation_guide` now includes a TEXT HEIGHT MATH section explaining that live `text-block` height is auto with a wrapping-estimate formula; the HERO section warns against text columns running under an adjacent image; the FEATURES section recommends `rectangle`+`config.svgMask` over keyboard emoji for card icons; a CARD ANATOMY note documents the group-as-container pattern.
- Server instructions now note that `get_element` must be called for any element type not already fetched in the current conversation (including when building a second page in a long session where earlier skeletons may have been compacted out of context).
- `validate_page` "has children but not a container type" error message now includes the element id and a `patch_page` fix hint describing the correct group-with-rectangle-backdrop structure.

## [1.0.55] - 2026-06-10

### Fixed
- The `install` command now correctly locates `claude_desktop_config.json` on Windows when Claude Desktop was installed from the Microsoft Store: the Store build is MSIX-sandboxed and reads its config from `%LOCALAPPDATA%\Packages\Claude_<hash>\LocalCache\Roaming\Claude\` instead of `%APPDATA%\Claude`; the installer detects the package directory first and falls back to the legacy path when the Store package is absent.

## [1.0.54] - 2026-06-10

### Added
- The installer (`install` command) now supports five additional IDE/agent targets: Antigravity, Gemini CLI, Cline, Kiro, and OpenCode; pass `--ide antigravity`, `--ide gemini`, `--ide cline`, `--ide kiro`, or `--ide opencode`, pick them from the interactive menu, or use `--ide all` to configure every supported target at once; uninstall covers all five as well.

### Fixed
- The `login` command no longer hangs after a successful authentication when the browser holds a keep-alive connection open; the loopback server now closes all live connections as well as the listener on success or timeout.
- The `login` command now surfaces credential-save failures (permission errors, disk full, antivirus file lock, etc.) as a descriptive error message instead of silently crashing inside the request handler.
- The `login --port` flag now validates that the supplied value is a valid integer and exits with a clear error message when it is not.

## [1.0.53] - 2026-06-10

### Fixed
- The `login` command on Windows now opens the connect URL correctly: `cmd /c start` previously split the URL at the first `&` character (treating it as a command separator), causing the OAuth callback to arrive without the `state` parameter and be rejected; the URL is now passed with `windowsVerbatimArguments: true` and double-quoted so the full URL reaches the browser intact.

## [1.0.52] - 2026-06-10

### Added
- `validate_page` now errors when an element type that the renderer cannot animate (any type other than `group`, `image-block`, `text-block`, `rectangle`, `button`, `countdown`, `line`, `list-paragraph`, and `notify`) carries a non-`none` `config.animation.name`; the element would render stuck in its pre-animation state, and the error message includes a `patch_page` fix hint.
- `validate_page` now errors when `config.animation.name` is set to a value not in the editor's animate.css set; an unknown keyframe never runs and the element may render stuck or dim.
- `validate_page` now warns when `styles.opacity` is less than 1 at any breakpoint, because CSS opacity is permanent and renders the element and all its children faded forever; the warning recommends using rgba() alpha on the `color` or `background` property instead, or correcting the value via `patch_page`.

### Changed
- `get_generation_guide` animation rule now documents the 9 animatable element types, enumerates common animate.css entrance animation families (`fadeIn*`, `slideIn*`, `zoomIn*`, `bounceIn*`, `backIn*`, `flipIn*`, `lightSpeedIn*`, `rotateIn*`, `rollIn`, `jackInTheBox`), and explicitly prohibits setting `styles.opacity` below 1 for visual effects, directing authors to rgba() alpha instead.

## [1.0.51] - 2026-06-10

### Added
- `create_page`, `update_page`, and `add_section` dry-run responses now include a `draft_id`, and all three tools now accept `draft_id` as an input parameter: pass the returned `draft_id` with `dry_run:false` (or to a subsequent `patch_page` call) to commit, retry, or fix the cached payload without re-sending the full source JSON.
- All backend HTTP calls and `search_images` (Pexels direct and proxy) now enforce a request timeout (default 60 s, overridable via `WEBCAKE_HTTP_TIMEOUT_MS`); timed-out calls return a descriptive error noting the backend may still complete the operation.

### Changed
- `create_page`, `update_page`, and `add_section` now write the validated payload to the draft cache before making the network call, so any timeout or network failure always returns a `draft_id` that can be used to retry or fix without rebuilding the source.
- `update_page` validation failures now return a `draft_id` alongside the errors, matching the `create_page` behavior and allowing `patch_page({ draft_id, patches })` to fix only the offending elements.
- `patch_page` now handles all three draft kinds: `page` (create-failure — creates a new page), `sections` (cached `add_section` payload — appends to the stored page), and `update` (cached `update_page` or live-page patch source — overwrites the live page); an empty or omitted `patches` list with a `draft_id` commits the cached source as-is (skips apply, re-validates, honors `dry_run`) — the universal retry path after any timed-out write.
- `patch_page` in `page_id` (live-page) mode now caches the merged patched source before saving; a timeout or network failure returns a `draft_id` for retry with no patches.
- Server instructions updated with a `RETRY-AFTER-TIMEOUT` rule covering all mutating tools and a `DRY-RUN CACHE` rule: every mutating tool caches its payload before the network call and returns a `draft_id` on failure, and dry-run responses from `create_page`, `update_page`, and `add_section` include a `draft_id` for commit without re-sending.

## [1.0.50] - 2026-06-10

### Added
- New `publish_page` tool makes a page live: reads the page's current stored source, saves it as a new version, and creates or updates the `page_published` record; accepts optional `custom_domain` and `custom_path`; defaults to `dry_run=true` returning a JWT-redacted request preview; on success returns `published_url` (the custom-domain URL when attached, else the preview-host link) and `preview_url`.

### Changed
- `preview_url` returned by `create_page`, `update_page`, and `add_section` is now re-rooted onto the correct public preview host (preview.localhost:5800 / staging.webcake.me / www.webcake.me) instead of the builder subdomain; a new `WEBCAKE_PREVIEW_BASE` env var and `x-webcake-preview-base` request header override the host, and all three environment presets now carry a `previewBase` field.
- Server instructions now document the preview-vs-publish distinction: `preview_url` from `create_page`/`update_page`/`add_section` renders the stored source immediately without a publish step; call `publish_page` only when the user wants the page live on a custom domain or at the public published URL.
- `patch_page` and `add_section` parameter descriptions now explicitly note that element and section nodes may be sparse (server hydrates omitted `properties`/`runtime`/empty `events`+`children`/per-breakpoint `config` from factory defaults).

## [1.0.49] - 2026-06-10

### Changed
- `get_page` now returns a compacted source by default: factory-default boilerplate (`properties`, `runtime`, empty `events`/`children`, per-breakpoint `config`, and seed-equal style keys) is stripped from every element before returning, leaving the sparse authoring shape; the response includes `compacted:true` and an inline note; pass `compact:false` to receive the raw stored tree.
- `get_element` skeletons are now in the sparse authoring shape: the `skeleton` field contains only the keys the model should actually emit (`id`, `type`, both breakpoints' `styles`, `specials`, real `events`); a top-level `authoring` note is included in the response to reinforce the pattern.
- `new_element` now returns the element node in the sparse authoring shape (only meaningful keys — no `properties`, `runtime`, empty `events`/`config`) so the model can copy the result directly without stripping boilerplate.
- `create_page`, `update_page`, `add_section`, and `patch_page` parameter descriptions now explicitly state that sparse element nodes are accepted and that `properties`/`runtime`/empty `events`+`children`/per-breakpoint `config` should be omitted; the server hydrates them from factory defaults.
- `get_generation_guide` and server instructions now state that the entire authoring loop is sparse end-to-end: `get_element` skeletons, `new_element` output, and `get_page` sources all arrive in the sparse shape, so the model edits and sends back without re-adding boilerplate.
- Element descriptor examples for `text-block`, `image-block`, `button`, `input`, `select`, and `popup` are now written in the sparse authoring shape, removing `properties`, `runtime`, empty `events`, and per-breakpoint `config` to reinforce the expected emit format.

## [1.0.48] - 2026-06-10

### Added
- `create_page` now caches the expanded source in an in-memory draft store when validation fails and returns a `draft_id` alongside the validation errors, so the agent can fix only the listed invalid elements without rebuilding and re-shipping the whole source.
- `patch_page` now accepts `draft_id` (returned by a failed `create_page`) as an alternative to `page_id`: it applies per-element ops to the cached draft, re-validates the whole merged tree, preserves partial fixes across multiple patch rounds until the tree is valid, then creates the page; drafts expire after approximately 30 minutes (max 50 entries in memory).

### Changed
- `get_generation_guide` editing workflow and server instructions now document the `draft_id` fix-after-error path: when `create_page` fails validation, use the returned `draft_id` with `patch_page({ draft_id, patches, dry_run:false })` to repair only the offending elements and complete the page creation without rebuilding the source.

## [1.0.47] - 2026-06-10

### Added
- New `patch_page` tool edits an existing page by element id without re-sending the whole source: the agent sends per-element ops (`update`, `replace`, `remove`, `add` keyed by id), the MCP fetches the live source, applies the ops, validates the whole merged tree (blocking on errors), and saves; defaults to `dry_run=true`; credentials are required even on dry run because the live source must be fetched.

### Changed
- `get_generation_guide` workflow expands from four steps back to six: `get_element` is called per element type in step 2, images are fetched per slot in step 3b, `validate_page` is restored as a required step 5 before persisting, and `create_page` in step 6 recommends a `dry_run=true` preview before the final write.
- `get_generation_guide` editing workflow and server instructions now direct the agent to prefer `patch_page` for small edits (send only the changed element ids with their ops rather than the whole source) and add a fix-after-error path: when `create_page`, `update_page`, or `add_section` reports validation errors, correct only the offending element ids with `patch_page` instead of rebuilding the source.
- Server instructions reinstate the explicit requirement to call `validate_page` and fix every error before `create_page` or `update_page`, reversing the "VALIDATION IS BUILT IN" rule from v1.0.45 that removed this separate step.
- Server instructions update `dry_run` guidance: the pre-write dry-run round-trip may be skipped only when `validate_page` has already passed with no errors.

## [1.0.46] - 2026-06-09

### Changed
- `validate_page` now emits an advisory warning when no section, button, or text on the page carries a non-neutral color (white, black, or grey), catching pages that would render as a flat, colorless wall because section backgrounds were left unset.
- `get_generation_guide` section build hints now explicitly require setting `responsive.<bp>.styles.background` on every section at both breakpoints — the section factory default has no background, so an unset section renders transparent/white — and direct the agent to alternate light, tinted, and dark bands from the locked palette so consecutive sections read as visually distinct.

## [1.0.45] - 2026-06-09

### Changed
- `get_generation_guide` workflow condensed to four steps: element-type reads and image fetches are now batched into single calls (`get_element({types:[…]})` and `search_images({queries:[…]})`), and the separate `validate_page` pre-pass before `create_page` is removed since the persistence tool validates internally and blocks on errors.
- Server instructions replace the "always call `validate_page` before persisting" rule with a VALIDATION IS BUILT IN note: `create_page`, `update_page`, and `add_section` all validate the source and block on errors, so a standalone `validate_page` call is only needed when assembling source that will not be persisted in the same turn.
- Server instructions update the edit-page workflow to place `find_pages` as the first lookup step when a `page_id` is not already known, and direct the agent to call `update_page` with `dry_run=false` directly rather than running a separate `validate_page` round-trip first.

## [1.0.44] - 2026-06-09

### Added
- New `find_pages` tool searches the account's pages by name, domain (matches `custom_domain` or `default_domain`), and/or page id (filters are AND-combined) via the dedicated `/api/v1/ai/search_pages` backend endpoint; each result includes `id`, `name`, `organization_id`, `custom_domain`, `default_domain`, and `updated_at` so the agent can identify the correct page before editing — falls back to filtering `list_pages` client-side by name/id when the backend endpoint returns 404 (domain filter is noted as unavailable in that fallback path).

### Changed
- Server instructions now direct the agent to call `find_pages` as the lookup step when a `page_id` is not already known before the get→edit→update cycle, and `find_pages` is added to the tools list.

## [1.0.43] - 2026-06-09

### Changed
- The `GET /` web guide page has refreshed copy throughout: updated page title and meta description, simplified FAQ answers in both English and Vietnamese, and clearer UI text for the how-it-works section, flow diagram labels, and use-case cards.

## [1.0.42] - 2026-06-09

### Fixed
- `validate_page` now raises an error when a `countdown` element's `specials.language` is set to a value outside the eight supported word-values (`vietnam`, `english`, `filipino`, `khmer`, `lao`, `indonesian`, `thai`, `malay`, `custom`); locale codes such as `"vi"` or `"en"` would silently crash the renderer by passing an unrecognized key to its internal language table.
- `get_element` for `countdown` now documents that `specials.language` must be one of the eight supported word-values or `"custom"` (not a locale code like `"vi"`/`"en"`), and that `"custom"` requires `specials.customTranslation` with `day`, `hour`, `minute`, and `second` label strings.
- The `countdown` element seed now sets `specials.language` to `"english"` by default, so newly created countdown elements are valid without manual language configuration.

## [1.0.41] - 2026-06-09

### Changed
- `get_generation_guide` and server instructions now require the agent to write all page copy in the same language the user is chatting in, with full, correct diacritics and accents — for Vietnamese this means every word must carry its proper dấu (e.g. "Trân Trọng Kính Mời", "Ngày 15 Tháng 08 Năm 2025") and accent-stripped "không dấu" text is explicitly forbidden.

## [1.0.40] - 2026-06-09

### Added
- New `ingest_html` tool parses an HTML string into a compact reference AST (~2–5KB) that classifies sections by role (header, hero, features, form, cta, footer, etc.) and extracts headings, CTAs, images, form fields, and brand hints (top colors, fonts), so the agent can anchor to an existing page's layout without reading raw HTML token-by-token.
- New `ingest_url` tool fetches a public HTTP(S) page (10s timeout, 2MB cap) and runs it through the same `ingest_html` AST pipeline, with a client-rendering warning when `<body>` is essentially empty.

### Changed
- `get_element` now accepts a `types` array parameter for batch mode — fetch all element types a section needs in a single call (e.g. `types:['section','text-block','image-block','button']`) and receive `{ elements: { [type]: details } }`; the existing single-`type` call shape is unchanged for backward compatibility.
- `search_images` now accepts a `queries` array parameter for batch mode — run one query per image slot in parallel in a single call, with `pick='best'` (default) returning the top photo per query as a compact drop-in for `specials.src`, and `pick='all'` returning the full result per query; also adds `orientation`, `size`, and `color` filter parameters.
- `create_page`, `update_page`, `add_section`, and `validate_page` now expand sparse element nodes before validate/persist: the agent may omit boilerplate fields (`properties`, `runtime`, empty `events`/`children`, per-breakpoint `config`) and the server hydrates each node onto its factory seed, reducing the JSON the agent must emit per element by roughly half.
- `add_section` now ships new section(s) directly to the backend via the dedicated `/api/v1/ai/append_section` endpoint (server-side append — no whole-source get+put), falling back to the legacy get→merge→validate→put path only when that endpoint returns 404 (older backend).
- `validate_page` now emits an advisory warning when sections have inconsistent left-margin edges diverging by more than 48px on desktop, identifying the offending sections and their edges to flag the #1 page-alignment defect.
- Server instructions now direct the agent to call `get_element({types:[...]})` and `search_images({queries:[...]})` in batch when a section needs multiple element types or images, and add a REFERENCE INPUT section describing the three input modes: screenshot in chat (analyzed natively), HTML string via `ingest_html`, and URL via `ingest_url`.
- Server instructions now clarify when to skip the dry-run: call `create_page`/`update_page` with `dry_run=false` directly when the user's intent is clear and `validate_page` has already passed, instead of always previewing first.

## [1.0.39] - 2026-06-08

### Internal
- Added `server.json` MCP Registry manifest (namespace `io.github.vuluu2k/webcake-landing-mcp`) and the corresponding `mcpName` field in `package.json` so the official MCP Registry can verify npm package ownership.

## [1.0.38] - 2026-06-08

### Added
- New `add_section` tool appends one or more sections to an existing page without re-sending the full source: the server fetches the current page, appends the new section(s), validates the entire merged tree (errors block; warnings are advisory), and saves — enabling large pages to be built incrementally (`create_page` with a small skeleton, then `add_section` once per section) to avoid connection drops caused by giant single-pass `create_page` payloads.

### Changed
- `get_generation_guide` and server instructions now frame the agent as a professional landing-page designer who must lock a design system (exact palette, type scale, 8px spacing grid, and button/card component specs derived from the customer's primary color) before building any element, so the whole page is consistent and looks studio-made rather than ad hoc.
- `get_generation_guide` now includes a PREMIUM CRAFT section with explicit guidance on whitespace, type hierarchy, palette restraint, 8px spacing rhythm, component consistency, and CTA weight to raise the quality of generated pages.
- `get_generation_guide` expands the page-margin rule into a full shared horizontal axis (left edge at 80 desktop / 20 mobile, content width 800 / 380) applied to every section and the header, and updates the HEADER build hint to anchor the logo and CTA explicitly to this axis.
- `get_generation_guide` and server instructions now require the agent to communicate with customers in plain everyday words rather than design jargon, and to restate proposed designs in non-technical language before generating.
- `get_generation_guide` workflow adds step 0b directing the agent to lock the design system (palette, type scale, spacing, and component specs) immediately after customer confirmation, before assembling the page JSON.
- Server instructions add an incremental build rule for large pages (4+ sections): use `create_page` with a small skeleton then `add_section` once per section, and `add_section` is now listed in the tools list.
- `get_element` for `text-block` now explicitly warns that text color must always contrast with the section band it sits on, and the element seed's default headline color changes from white (`rgba(255,255,255,1)`) to near-black (`rgba(26,32,44,1)`) to prevent invisible text on light bands.

## [1.0.37] - 2026-06-08

### Changed
- `get_generation_guide` now includes a HEADER section build hint directing the agent to place every header child (logo, brand text, CTA button) on a shared vertical centerline by matching `top + height/2` across all children, and to keep the header's left/right margins consistent with the sections below.
- `get_generation_guide` now expands the CONTRAST rule to explicitly cover saturated and mid-tone section bands (yellow, orange, teal, pink): the agent must choose text color by the band's luminance — near-black on light or bright mid-tone bands, near-white on dark bands — and the rule now forbids low-alpha (below ~0.85), muted-grey, or near-white text on any colored band; icons and their captions are required to follow the same rule as the text beside them.

## [1.0.36] - 2026-06-08

### Changed
- The `GET /` web guide page now lists "Claude · Codex · Cursor, etc." instead of only "Claude · Cursor" in the AI assistant flow diagram, reflecting the broader set of supported AI clients.

## [1.0.35] - 2026-06-08

### Changed
- `get_generation_guide` now includes an explicit workflow step (3b) directing the agent to call `search_images` for every image a page needs (hero, product, about, feature, gallery items), placing a returned URL into `specials.src` or a gallery item's `link` using `src.large` for heroes/banners and `src.medium` for cards/thumbnails, with `avg_color` noted as a guide for matching section backgrounds; `https://placehold.co/<width>x<height>` is now documented as a fallback only when `search_images` returns `ok:false`.

## [1.0.34] - 2026-06-08

### Added
- New `search_images` tool queries Pexels stock photos by short English subject and returns ready-to-hotlink URLs at several sizes; use `src.large` for hero/banner images and `src.medium` for card/thumbnail images — works out of the box via a shared hosted proxy, or set `PEXELS_API_KEY` (env) or the `x-pexels-key` request header to use your own Pexels quota (free at pexels.com/api).
- The HTTP server now exposes `GET /api/images/search` as a shared image proxy, allowing `npx` users without a local Pexels API key to retrieve real stock photos through the hosted server.
- Startup now loads a local `.env` file (from the working directory or next to the binary) for environment variables such as `PEXELS_API_KEY`; real environment variables and per-request headers continue to take precedence.

### Changed
- Server instructions now direct the agent to call `search_images` first and place a real Pexels photo URL into `specials.src`, falling back to `https://placehold.co/<width>x<height>` only when `search_images` returns `ok: false`.

## [1.0.33] - 2026-06-08

### Fixed
- `get_element` for `country-select` now marks `specials.field_placeholder` as required (the renderer crashes without it), and the element seed now emits a default value.
- `get_element` for `group-select-item` now marks `specials.field_placeholder` as required (the renderer crashes without it), and the element seed now emits a default value.
- `validate_page` now raises an error when `specials.field_placeholder` is absent on `country-select` or `group-select-item` elements, extending the `select` coverage added in 1.0.32.

## [1.0.32] - 2026-06-08

### Fixed
- `get_element` for `select` now marks `specials.field_placeholder` as required (the published renderer crashes without it), the element seed now emits a default value, and `validate_page` now raises an error when it is absent and a warning when the wrong key (`specials.placeholder`) is used instead.
- `get_element` for `select`, `radio`, and `checkbox-group` now documents that `specials.options` items must use `{id, name}` shape — not HTML-style `{label, value}` — and `validate_page` now raises an error on any option that lacks a string `name`, with a diagnostic hint when `label`/`value` keys are detected.

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
