/**
 * Server instructions shipped to every MCP client for the landing domain (the
 * always-on rules: intake-first, validate-before-persist, dry-run safety,
 * surgical edits, the essential page-source model, and the centering rule).
 */
export const INSTRUCTIONS = `webcake-landing builds and edits Webcake landing pages (the editor "page_source" JSON).

RULES (follow for every request):
- INTAKE FIRST: before generating a new page, ask the user 3–6 concrete questions (goal/page type, brand + tone + language, sections in order, primary CTA + destination, form fields, colors/logo URLs, desktop+mobile or mobile-only, which organization) and confirm a short outline. Do not assume.
- Never invent prices, phone numbers, addresses, or statistics — ask or leave a placeholder.
- ALWAYS call validate_page and fix every error before create_page / update_page.
- create_page and update_page DEFAULT to dry_run=true. Show the dry-run, then only send dry_run=false after the user confirms.
- EDIT existing pages surgically: get_page → change ONLY what was asked → keep every other element, its id, and coordinates → validate_page → update_page. Never regenerate the whole tree for a small change.
- Organizations: call list_organizations and ask which to use; default to the is_default org. Endpoints are owner-scoped (only the account's own pages).

MODEL (essentials):
- Top-level: { page:[sections], popup:[popups], settings:{}, options:{currency,mobileOnly,versionID}, cartConfigs:{} }. Popups are a SEPARATE top-level array, NOT inside page.
- Element: { id, type, properties, responsive:{desktop,mobile:{config,styles}}, specials, children, runtime, events }. Absolute canvas: children carry numeric top/left/width/height (px) per breakpoint (canvas width desktop=960, mobile=420); sections own a height.
- CENTERING (the #1 layout defect — do the math, don't eyeball): to center a box compute left = round((canvas - width)/2) — 960 desktop, 420 mobile. textAlign:center only centers text inside the box, not the box itself. For a row of N items, center the whole row block (startLeft = round((canvas - (N*item + (N-1)*gap))/2)). Keep 0 ≤ left and left+width ≤ canvas on each breakpoint.
- Visible content lives in specials (text, src, field_name…), never in styles. Colors as rgba(). Animation in config.animation={name,delay,duration,repeat}. Form inputs need a unique specials.field_name (use canonical keys: full_name, phone_number, email, address, quantity).
- IMAGES: include them (hero/product, feature icons, about photo). No image API yet → set image-block specials.src to a PLACEHOLDER sized to the box: https://placehold.co/<width>x<height> (gallery.media = array of these; video.specials.img = poster). NEVER leave src empty (renders blank). Ensure text contrasts with its section background.

Start by calling get_generation_guide. Tools: get_generation_guide, list_elements, get_element, new_element, new_page_skeleton, get_page_schema, validate_page, list_organizations, create_page, list_pages, get_page, update_page.`;
