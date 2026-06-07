/**
 * The page-generation guide returned by get_generation_guide: output shape, the
 * absolute-positioning coordinate system, centering math, the element-node
 * contract, the event model, and the intake/workflow checklist.
 */
import { CANVAS } from "./vocab.js";

export const GENERATION_GUIDE = `You are generating the JSON source of a Webcake landing page that the editor renders directly.

OUTPUT (top-level page source — matches the real editor shape)
- Return ONE JSON object:
  { "page": [<section>...], "popup": [<popup>...], "settings": {...},
    "options": { "currency":"VND", "mobileOnly":false, "versionID":null }, "cartConfigs": {} }
- "page" is an array of SECTIONS stacked vertically (index 0 = top). Each item MUST be type "section" (or "dynamic_page").
- "popup" is a SEPARATE top-level array of popup elements — do NOT nest popups inside "page". A button opens one via a click event { action:"open_popup", target:"<popup id>" }.
- All other elements (text, image, button, form…) live inside a section's "children".
- "settings" carries SEO + page config: title, description, keywords, favicon, fontGeneral, width_section {desktop:960,mobile:420}, country, fb_tracking_code, tiktok_script, extra_css, extra_script (call new_page_skeleton for a ready default).

ELEMENT NODE (every element)
{ "id": "<unique ~8-char [A-Za-z0-9_]>", "type": "<type>",
  "properties": { "name": "<label>", "movable": <bool>, "sync": true },
  "responsive": { "desktop": { "config": {}, "styles": {} }, "mobile": { "config": {}, "styles": {} } },
  "specials": { ...type-specific CONTENT... }, "runtime": {}, "events": [],
  "children": [ ... ] }  // children ONLY on container types
- Cross-cutting config keys apply to EVERY element via the per-breakpoint config (responsive.<bp>.config): sticky/stickyPosition/stickyTop/stickyBottom/stickyLeft/stickyRight/stickyWidth/stickyHeight/stickyUnpinAtSections…, animation, hide, lock. The full per-element specials reference (every renderer-read key, including the rich select/checkbox-group/radio/survey option-object schema) lives in docs/element-specials-reference.md.

COORDINATE SYSTEM (critical)
- Absolute-positioning canvas (NOT flexbox). Children carry top/left/width/height in px (numbers).
- section has NO top/left; it has height (canvas height, default ${CANVAS.defaultSectionHeight}) and position:"relative".
- Canvas width is FIXED: desktop = ${CANVAS.desktopWidth}px, mobile = ${CANVAS.mobileWidth}px (settings.width_section). Provide BOTH breakpoints; do not overlap elements within a section.
- Every child must stay on-canvas: 0 ≤ left and left + width ≤ canvas width (${CANVAS.desktopWidth} desktop / ${CANVAS.mobileWidth} mobile). Same for top + height ≤ section height.

CENTERING & ALIGNMENT (do the math — do NOT eyeball \`left\`; off-center layouts are the #1 defect)
- \`textAlign:"center"\` only centers text INSIDE the element box. It does NOT move the box. To center the box on the canvas you MUST compute \`left\`.
- Center ONE element of width w:  left = round((CANVAS - w) / 2).
    desktop: left = round((${CANVAS.desktopWidth} - w) / 2)   ·   mobile: left = round((${CANVAS.mobileWidth} - w) / 2).
    e.g. a 300px box → desktop left = ${(CANVAS.desktopWidth - 300) / 2}, mobile left = ${Math.round((CANVAS.mobileWidth - 300) / 2)}.
- Full-width text/headline: pick a content width and center it. A safe content column is desktop width 800 (left 80) / mobile width 380 (left 20), with textAlign:"center".
- A ROW of N equal items (feature cards, countdown, logos, stats) — center the whole row as a block:
    rowWidth = N*itemWidth + (N-1)*gap
    startLeft = round((CANVAS - rowWidth) / 2)
    item i (0-based) left = startLeft + i*(itemWidth + gap)   ← gives equal outer margins and equal gaps.
    Pick itemWidth+gap so rowWidth ≤ CANVAS. On mobile, either shrink items to fit ${CANVAS.mobileWidth}px or stack them vertically (same left, increasing top).
- Keep a consistent left edge for stacked content in a section (e.g. all centered on the same axis) so the section reads as aligned, not ragged.
- Mirror the centering on BOTH breakpoints with each breakpoint's own canvas width — never reuse a desktop \`left\` on mobile.

STICKY / FIXED HEADER (and any overlay element) — reserve space so nothing hides behind it
- A sticky/fixed header (set via the per-breakpoint config.sticky on the section) OVERLAYS the page; it does NOT push the sections below it down. So the next section's top content sits UNDER the header and gets hidden — this is the #1 header defect.
- When you add a sticky header of height H (typically 60–72px): push the first section's top content DOWN by ≥ H — increase the \`top\` of the hero's topmost elements by H (and add H to that section's height so the band stays clear), OR keep an empty H-px band at the very top of the hero. Do it on BOTH breakpoints (the header height can differ per breakpoint).
- Do NOT duplicate the brand/shop name: if the header shows the shop name, remove or reposition any shop-name line that sat at the very top of the hero — otherwise the two overlap (a classic symptom: a half-hidden shop-name behind the header).
- A NON-sticky header is simpler — it's just the first section in \`page\`, stacks normally, and pushes the hero down on its own (no offset needed). Only add the offset when the header is sticky/fixed.

RULES
- Visible content goes in "specials" (text-block.specials.text, image-block.specials.src…), NEVER in "styles".
- Colors as rgba(r,g,b,a). fontSize/borderWidth/top/left/width/height are NUMBERS (px).
- IMAGES: a real landing page has images (hero/product shot, feature icons, about photo). There is NO image API yet, so set image-block specials.src to a PLACEHOLDER URL sized to the box: "https://placehold.co/<width>x<height>". NEVER leave src empty — it renders blank and the page looks broken. gallery.media = array of such URLs; video.specials.img = a poster placeholder. The user replaces these later.
- CONTRAST: text must contrast with the section background (dark text on light sections, light text on dark sections). Don't put light-gray text on white or faint text on a dark background.
- movable:false for section/slide/grid-item/popup; otherwise true. runtime is always {}.
- Every form input MUST have a unique specials.field_name.
- events item: { "id", "type", "action", "target", ...action-specific extra fields }. TRIGGER (type): click & hover on any element; success & error on a FORM (success = after a successful submit, error = on validation failure); delay on any element (when it scrolls into view); unset on init. Action vocab per trigger: click→CLICK_ACTIONS, hover→HOVER_ACTIONS, success→SUCCESS_ACTIONS, error→ERROR_ACTIONS, delay→DELAY_ACTIONS (all returned by get_generation_guide). For element-targeting actions (open_popup, close_popup, scroll_to, show_section, hide_section, show_hide_element, change_tab, collapse) target = the target element's id; open_link/download_file target = URL; open_sms/send_email/phone_call target = phone/email; copy target = text (or element id when copyType='elementValue'); set_field_value target = field_name; target may be null (e.g. animation_hover). Each action also reads extra fields (e.g. open_link→targetURL/delayTime, scroll_to→scrollMore, change_tab→moveTo/tabIndex, lightbox→typeLightbox/alt, show_hide_element→onlyMode, open_app→appTarget+provider fields, set_field_value→set_value) — see the action maps for the full list.
- ANIMATION: each breakpoint's config has config.animation = { "name":"none", "delay":0, "duration":3, "repeat":null }. Keep "none" unless an entrance animation is wanted.
- Real data the page DISPLAYS must come from the user — never invent it: phone/hotline/Zalo, price (+ original price), address, shop/brand name, links/URLs, email, opening hours, exact stats/social-proof numbers. If a value the page needs is missing, ASK for it (in intake, or pause before generating); use a clearly-labelled placeholder ONLY when the user explicitly declines, and tell them exactly what to fill. Output text in the requested language.

INTAKE — ask the user BEFORE generating, EVERY time (even a "quick"/"test" page). The #1 mistake is building a full page on the first message without asking — do NOT do that. Ask ONE short batch of 3–6 concrete questions (offer sensible defaults so the user answers fast), enough to understand the page's purpose, name, look and layout:
- Goal / page type: what is the page FOR? lead-gen, product/COD sale, event, invitation, app promo, portfolio, a test/demo…?
- Brand: page/shop name, what they sell, tone (premium/playful/minimal), language (vi/en…).
- Product + price (sales/ads pages): the exact product, price (+ original price if discounted), and the offer/promo.
- Sections wanted (in order): e.g. hero, features, pricing, testimonials, FAQ, contact form, footer — or propose a sensible default set and ask the user to confirm.
- Primary CTA + where it goes: open a form popup, scroll to form, call/Zalo, open link?
- Form fields to capture (if any): name, phone, email, address, quantity…? (use canonical field_names: full_name, phone_number, email, address, quantity).
- Branding / look: primary color (rgba/hex), logo/image URLs, must-keep text, things to avoid.
- Target: desktop+mobile or mobile-only? Which organization to save into (list_organizations)?
Then RESTATE a short outline (sections + CTA + colors) and WAIT for the user's confirmation before assembling the JSON. Do NOT generate + persist on the same turn as the request.
NEVER invent prices, phone numbers, addresses, or statistics — ask, or leave a clear placeholder ONLY when the user declines to provide it.

WORKFLOW (recommended)
0. INTAKE (never skip — even for a quick/test page): ask the essentials above, WAIT for the answers, restate a short outline (sections + CTA + colors), and get the user's "yes" BEFORE any new_page_skeleton / create_page. Do not generate on the same turn as the request.
1. Call get_generation_guide (this) once, then new_page_skeleton for the top-level shape.
2. For each element type you'll use, call get_element to learn its specials & see an example.
3. Optionally call new_element to get a correct skeleton, then fill specials + coordinates.
4. Assemble { page, popup, settings, options, cartConfigs }.
5. Call validate_page and fix every error.
6. To save: call list_organizations, show the orgs to the user and ask which to use (default to is_default). Then create_page (dry_run first, then dry_run:false with the chosen organization_id).

EDITING an existing page
- list_pages → let the user pick (or take a page_id from a URL).
- get_page(page_id) → you get the live { page, popup, settings, ... }. Edit it surgically: change only the elements the user asked for (text/styles/specials/events); keep every other element, its id, and coordinates intact. Never regenerate the whole tree for a small change.
- To add an element: build it with new_element, give it a unique id, set top/left/width/height inside the right section's children.
- validate_page → update_page(page_id, source) (dry_run first, then dry_run:false).`;
