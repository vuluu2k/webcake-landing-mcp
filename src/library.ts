/**
 * Element library: per-type AI usage hints, key specials docs, categories, and
 * the global generation guide. Derived from the renderers in
 * assets/render_v4/src/elements/*, the editor factory, and the event dispatcher.
 * See docs/ai/page-element-schema.md for the full reference.
 */

export const CANVAS = { desktopWidth: 960, mobileWidth: 420, defaultSectionHeight: 800 };

export const EVENT_TRIGGERS = ["click", "hover", "success", "unset"] as const;

export const CLICK_ACTIONS: Record<string, string> = {
  none: "Do nothing.",
  open_link: "Open a URL. target = URL (often with a `target`/`blank` flag for new tab).",
  open_popup: "Open a popup. target = popup element id.",
  close_popup: "Close a popup. target = popup element id.",
  scroll_to: "Smooth-scroll to an element. target = element/section id.",
  show_section: "Show a hidden section. target = section id.",
  hide_section: "Hide a section. target = section id.",
  show_hide_element: "Toggle element visibility. target = element id.",
  change_tab: "Switch tab. target = id.",
  lightbox: "Open image in lightbox. target = image id/url.",
  copy: "Copy text to clipboard. target = the text to copy.",
  collapse: "Collapse/expand. target = id.",
  set_field_value: "Set a form field value. target = field_name, plus set_value.",
  back_to: "Go back. target = url/none.",
  back_home: "Go to home.",
  share: "Share. target = url / social network.",
  play_audio: "Play audio. target = id.",
  stop_audio: "Stop audio. target = id.",
  open_cart: "Open cart.",
  add_to_cart: "Add product to cart. target = product id.",
  open_app: "Open chat/app. target = provider: botcake | whatsapp | mess_prefill | tiktok_prefill | line_prefill.",
  change_color: "Change color.",
  custom_js: "Run custom JS.",
};

export const HOVER_ACTIONS: Record<string, string> = {
  change_color: "Change color on hover.",
  change_background: "Change background on hover.",
  change_text_color: "Change text color on hover.",
  change_underline: "Underline on hover.",
  change_overline: "Overline on hover.",
  change_image: "Swap image on hover.",
  animation_hover: "Play a hover animation.",
  show_hide_element: "Reveal/hide a target element on hover.",
};

export type ElementDoc = {
  type: string;
  category: "layout" | "content" | "form" | "commerce" | "marketing";
  container: boolean;
  summary: string;
  useWhen: string;
  keySpecials: Record<string, string>;
  example?: unknown;
};

export const LIBRARY: Record<string, ElementDoc> = {
  // ---------------- layout / containers ----------------
  section: {
    type: "section", category: "layout", container: true,
    summary: "Top-level vertical canvas block. The page is an array of sections stacked top→bottom.",
    useWhen: "Always the outermost wrapper of any band of content (hero, features, pricing, footer…). One section per visual band.",
    keySpecials: {
      globalSection: "boolean — mark as a reusable global section (e.g. shared header/footer).",
      globalSectionName: "name of the global section when globalSection=true.",
      custom_class: "extra css class; 'fixed'/'footer' influence role detection.",
      imageCompression: "boolean — compress background images.",
      video_background_thumbnail: "thumbnail for a video background.",
    },
  },
  "dynamic_page": {
    type: "dynamic_page", category: "layout", container: true,
    summary: "Section bound to a dataset for dynamic/templated content (blog, product detail).",
    useWhen: "Building a page driven by a dataset record rather than static content.",
    keySpecials: { imageCompression: "boolean." },
  },
  group: {
    type: "group", category: "layout", container: true,
    summary: "Groups children so they move and position together (position:absolute).",
    useWhen: "Bundling an icon+text card, a badge cluster, or any reusable mini-layout you want to move as one.",
    keySpecials: {},
  },
  grid: {
    type: "grid", category: "layout", container: true,
    summary: "Grid layout; config.column / config.row; children are grid-item.",
    useWhen: "Repeating cards in a regular N-column grid (features, team, gallery of cards).",
    keySpecials: { column: "(config) number of columns.", row: "(config) number of rows." },
  },
  "grid-item": {
    type: "grid-item", category: "layout", container: true,
    summary: "A single cell inside a grid (movable:false; laid out by the grid).",
    useWhen: "Only as a direct child of grid.",
    keySpecials: {},
  },
  carousel: {
    type: "carousel", category: "layout", container: true,
    summary: "Horizontal slider; config.slideWidth; children are slide.",
    useWhen: "Testimonials, screenshots, or any swipeable set of slides.",
    keySpecials: { slideWidth: "(config) width of each slide in px." },
  },
  slide: {
    type: "slide", category: "layout", container: true,
    summary: "One slide inside a carousel (movable:false).",
    useWhen: "Only as a direct child of carousel.",
    keySpecials: {},
  },
  popup: {
    type: "popup", category: "layout", container: true,
    summary: "Overlay popup. Hidden by default; opened/closed by events targeting its id.",
    useWhen: "Thank-you dialog, lead form modal, promo. Place popups at the top level of `page` and trigger via a button's open_popup event.",
    keySpecials: {},
    example: {
      id: "popthanks", type: "popup",
      properties: { name: "Thank you", movable: false, sync: true },
      responsive: {
        desktop: { config: {}, styles: { width: 420, height: 220, background: "rgba(255,255,255,1)", borderRadius: "12px" } },
        mobile: { config: {}, styles: { width: 360, height: 220, background: "rgba(255,255,255,1)", borderRadius: "12px" } },
      },
      specials: {}, runtime: {}, events: [],
      children: [
        { id: "popclose", type: "button",
          properties: { name: "Close", movable: true, sync: true },
          responsive: {
            desktop: { config: {}, styles: { top: 150, left: 160, width: 100, height: 40, background: "rgba(76,175,80,1)", color: "rgba(255,255,255,1)", borderRadius: "8px", textAlign: "center" } },
            mobile: { config: {}, styles: { top: 150, left: 130, width: 100, height: 40, background: "rgba(76,175,80,1)", color: "rgba(255,255,255,1)", borderRadius: "8px", textAlign: "center" } },
          },
          specials: { text: "Đóng" }, runtime: {},
          events: [{ id: "ev1", type: "click", action: "close_popup", target: "popthanks" }] },
      ],
    },
  },

  // ---------------- content ----------------
  "text-block": {
    type: "text-block", category: "content", container: false,
    summary: "Text. specials.text holds the content (may contain inline HTML); specials.tag sets the semantic tag.",
    useWhen: "Any headline, paragraph, label. Use tag h1/h2 for headings, p for body. Style via responsive.styles (fontSize, color, fontWeight, textAlign).",
    keySpecials: {
      text: "string — the visible text; may include inline HTML (<b>, <br>, <span style>…).",
      tag: "p | h1 | h2 | h3 | h4 | h5 | h6 | span | div.",
    },
    example: {
      id: "headline1", type: "text-block",
      properties: { name: "Headline", movable: true, sync: true },
      responsive: {
        desktop: { config: {}, styles: { top: 80, left: 180, width: 600, fontSize: 44, fontWeight: "bold", color: "rgba(255,255,255,1)", textAlign: "center" } },
        mobile: { config: {}, styles: { top: 60, left: 20, width: 380, fontSize: 28, fontWeight: "bold", color: "rgba(255,255,255,1)", textAlign: "center" } },
      },
      specials: { text: "Bán hàng dễ hơn với Webcake", tag: "h1" },
      runtime: {}, events: [],
    },
  },
  "list-paragraph": {
    type: "list-paragraph", category: "content", container: false,
    summary: "Bulleted list. specials.text is a string of <li>…</li> items.",
    useWhen: "Feature checklists, benefit lists. One <li> per bullet.",
    keySpecials: {
      text: "string of <li>item</li><li>item</li>… (no <ul> wrapper).",
      iconSize: "(config) bullet icon size.", linePaddingLeft: "(config) text indent.",
    },
  },
  "image-block": {
    type: "image-block", category: "content", container: false,
    summary: "Image. The editor renders the image from specials.src. config.overlay tints it.",
    useWhen: "Add images where a landing page would have them: hero/product shot, feature icons, about photo, logos. There is NO image API yet — set specials.src to a PLACEHOLDER URL sized to the box: https://placehold.co/<width>x<height> (or https://picsum.photos/<w>/<h> for a photo). NEVER leave src empty (it renders blank). The user replaces placeholders later.",
    keySpecials: { src: "image URL — REQUIRED. Use https://placehold.co/WxH (matching width×height) if you don't have a real image.", resize: "resize mode.", overlay: "(config) overlay color rgba(...)." },
    example: {
      id: "hero_img", type: "image-block",
      properties: { name: "Image Block", movable: true, sync: true },
      responsive: {
        desktop: { config: {}, styles: { top: 40, left: 540, width: 360, height: 300, position: "absolute" } },
        mobile: { config: {}, styles: { top: 260, left: 60, width: 300, height: 240, position: "absolute" } },
      },
      specials: { src: "https://placehold.co/360x300?text=Product", imageCompression: true },
      runtime: {}, events: [],
    },
  },
  rectangle: {
    type: "rectangle", category: "content", container: false,
    summary: "Colored block — divider, badge background, color band, card backdrop.",
    useWhen: "Backgrounds behind text/groups, dividers, decorative shapes. Style via background/borderRadius/boxShadow.",
    keySpecials: {},
  },
  line: {
    type: "line", category: "content", container: false,
    summary: "Horizontal rule / divider line.",
    useWhen: "Separating content rows.",
    keySpecials: {},
  },
  button: {
    type: "button", category: "content", container: false,
    summary: "Clickable button. Label in specials.text; behavior in the events array.",
    useWhen: "Every CTA. Add a click event: open_link (to URL), open_popup (lead modal), scroll_to (anchor). Inside a form, a button submits the form.",
    keySpecials: {
      text: "button label.", required: "boolean — gate by form validity.",
      format: "value formatting.", connectedSurvey: "link to a survey element.",
    },
    example: {
      id: "cta_main", type: "button",
      properties: { name: "CTA", movable: true, sync: true },
      responsive: {
        desktop: { config: {}, styles: { top: 300, left: 405, width: 150, height: 44, background: "rgba(246,4,87,1)", color: "rgba(255,255,255,1)", borderRadius: "8px", textAlign: "center", fontWeight: "bold" } },
        mobile: { config: {}, styles: { top: 200, left: 135, width: 150, height: 44, background: "rgba(246,4,87,1)", color: "rgba(255,255,255,1)", borderRadius: "8px", textAlign: "center", fontWeight: "bold" } },
      },
      specials: { text: "Đăng ký ngay" }, runtime: {},
      events: [{ id: "ev_cta", type: "click", action: "scroll_to", target: "form_section" }],
    },
  },
  video: {
    type: "video", category: "content", container: false,
    summary: "Video player (YouTube/upload/etc).",
    useWhen: "Demo or promo videos. Set specials.img to a poster placeholder (https://placehold.co/640x360) when there's no real thumbnail.",
    keySpecials: { typeVideo: "youtube | upload | vimeo…", video_cdn: "video URL/id.", img: "poster/thumbnail — use a placeholder url if none.", autoReplay: "boolean — loop." },
  },
  gallery: {
    type: "gallery", category: "content", container: true,
    summary: "Multi-image gallery.",
    useWhen: "Photo grids/galleries with several images. No image API — fill specials.media with placeholder URLs (https://placehold.co/600x400).",
    keySpecials: { media: "array of image URLs (use placeholders if you have no real images)." },
  },
  "html-box": {
    type: "html-box", category: "content", container: false,
    summary: "Raw HTML embed.",
    useWhen: "Embedding third-party widgets or custom markup the standard elements can't express.",
    keySpecials: {},
  },
  "editor-blog": {
    type: "editor-blog", category: "content", container: false,
    summary: "Long-form rich text / article body.",
    useWhen: "Blog/article content blocks.",
    keySpecials: {},
  },

  // ---------------- form & inputs ----------------
  form: {
    type: "form", category: "form", container: true,
    summary: "Wraps inputs; on submit creates a lead/FormData. Pixel tracking configured here.",
    useWhen: "Any lead-capture / contact / registration form. Put input/textarea/select/button inside its children.",
    keySpecials: {
      field_type: "form field config.", form_type: "form behavior type.",
      submit_success: "post-submit action/message.", validate: "validation config.",
      fb_event_type: "Facebook pixel event (e.g. CompleteRegistration).",
      fb_conversion_value: "FB conversion value.", fb_tracking_currency: "currency (VND…).",
      tiktok_conversion_value: "TikTok conversion value.", tiktok_tracking_currency: "currency.",
    },
  },
  input: {
    type: "input", category: "form", container: false,
    summary: "Single-line input. specials.field_name is the submitted data column (REQUIRED & unique).",
    useWhen: "Name/email/phone fields. Set field_type to text/email/phone/number.",
    keySpecials: {
      field_name: "REQUIRED unique data key.", field_placeholder: "placeholder text.",
      field_type: "text | email | phone | number.", required: "boolean.", formula: "computed value.",
    },
    example: {
      id: "in_phone", type: "input",
      properties: { name: "Input", movable: true, sync: true },
      responsive: {
        desktop: { config: {}, styles: { top: 60, left: 20, width: 360, height: 40 } },
        mobile: { config: {}, styles: { top: 60, left: 20, width: 360, height: 40 } },
      },
      specials: { field_name: "phone", field_placeholder: "Số điện thoại", field_type: "phone", required: true },
      runtime: {}, events: [],
    },
  },
  textarea: { type: "textarea", category: "form", container: false, summary: "Multi-line input.", useWhen: "Messages, notes.", keySpecials: { field_name: "REQUIRED unique key.", field_placeholder: "placeholder." } },
  select: { type: "select", category: "form", container: false, summary: "Dropdown select.", useWhen: "Pick one from a list.", keySpecials: { field_name: "REQUIRED.", options: "array of options." } },
  checkbox: { type: "checkbox", category: "form", container: false, summary: "Single checkbox (consent, opt-in).", useWhen: "Agree-to-terms, single toggle.", keySpecials: { field_name: "REQUIRED." } },
  "checkbox-group": { type: "checkbox-group", category: "form", container: true, summary: "Multiple checkboxes.", useWhen: "Multi-select options.", keySpecials: { field_name: "REQUIRED.", options: "array." } },
  radio: { type: "radio", category: "form", container: true, summary: "Single-choice radio options.", useWhen: "Pick exactly one of a few.", keySpecials: { field_name: "REQUIRED.", options: "array." } },
  address: { type: "address", category: "form", container: false, summary: "Province/District/Ward selector (multi-country).", useWhen: "Shipping/contact address.", keySpecials: { field_name: "REQUIRED.", detectAddress: "auto-detect.", hidden_commune: "hide ward level." } },
  "country-select": { type: "country-select", category: "form", container: false, summary: "Country picker.", useWhen: "International forms.", keySpecials: { field_name: "REQUIRED." } },
  "quantity_input": { type: "quantity_input", category: "form", container: false, summary: "Quantity stepper (+/-).", useWhen: "Order quantity.", keySpecials: { field_name: "REQUIRED." } },
  "input-datetime": { type: "input-datetime", category: "form", container: false, summary: "Date/time picker.", useWhen: "Booking date, appointment.", keySpecials: { field_name: "REQUIRED." } },
  "input-file": { type: "input-file", category: "form", container: false, summary: "File upload.", useWhen: "CV/receipt/photo upload.", keySpecials: { field_name: "REQUIRED." } },
  signature: { type: "signature", category: "form", container: false, summary: "Hand-drawn signature pad.", useWhen: "Consent/contracts.", keySpecials: { field_name: "REQUIRED." } },
  "verify-code": { type: "verify-code", category: "form", container: false, summary: "OTP / verification code field.", useWhen: "Phone/email verification.", keySpecials: { field_name: "REQUIRED." } },
  "group-select": { type: "group-select", category: "form", container: true, summary: "Attribute/variant selector group (e.g. size+color+quantity).", useWhen: "Product variants with quantity.", keySpecials: {} },
  "group-select-item": { type: "group-select-item", category: "form", container: false, summary: "One attribute inside group-select.", useWhen: "Child of group-select only.", keySpecials: { field_placeholder: "label.", field_quantity: "boolean — is the quantity field.", options: "choices." } },

  // ---------------- commerce ----------------
  "list-product": { type: "list-product", category: "commerce", container: false, summary: "Product list bound to a dataset/store.", useWhen: "Show purchasable products.", keySpecials: { format_title: "title format (e.g. 'sku').", numerical_order: "boolean.", remain_quantity_text: "low-stock label." } },
  "search-list-product": { type: "search-list-product", category: "commerce", container: false, summary: "Search box + product list.", useWhen: "Searchable catalog.", keySpecials: {} },
  "cart-items": { type: "cart-items", category: "commerce", container: false, summary: "Items currently in the cart.", useWhen: "Cart/checkout area.", keySpecials: {} },
  "cart-quantity": { type: "cart-quantity", category: "commerce", container: false, summary: "Total cart quantity badge.", useWhen: "Cart icon counter.", keySpecials: {} },
  "product-select": { type: "product-select", category: "commerce", container: false, summary: "Product / variant selector.", useWhen: "Choose product before order.", keySpecials: {} },
  table: { type: "table", category: "commerce", container: false, summary: "Data table.", useWhen: "Pricing/comparison/spec tables.", keySpecials: {} },

  // ---------------- marketing / dynamic ----------------
  countdown: {
    type: "countdown", category: "marketing", container: false,
    summary: "Countdown timer (minute duration, fixed end time, or daily window).",
    useWhen: "Urgency: limited offer, flash sale. Renders a row of segment boxes — size width to fit the segments shown (showDay/showSecond) and CENTER the box: left = round((canvas - width)/2). Add styles.textAlign:'center' so the segments sit centered inside the box.",
    keySpecials: {
      type: "minute | endTime | daily.", duration: "minutes (when type=minute).",
      startTime: "ISO start (endTime/daily).", endTime: "ISO end.",
      showDay: "bool.", showSecond: "bool.", showText: "bool.", language: "label locale.", customTranslation: "custom labels.",
    },
  },
  timegroup: { type: "timegroup", category: "marketing", container: false, summary: "Live current date/time display.", useWhen: "Show today's date/time.", keySpecials: {} },
  "auto-number": { type: "auto-number", category: "marketing", container: false, summary: "Auto-incrementing number (e.g. fake view count).", useWhen: "Social-proof counters.", keySpecials: {} },
  "random-number": { type: "random-number", category: "marketing", container: false, summary: "Random number display.", useWhen: "Randomized social proof.", keySpecials: {} },
  notify: { type: "notify", category: "marketing", container: false, summary: "'Someone just bought…' toast notifications.", useWhen: "Social-proof popups.", keySpecials: {} },
  "spin-wheel": { type: "spin-wheel", category: "marketing", container: false, summary: "Lucky-spin wheel with prizes.", useWhen: "Gamified lead capture / promos.", keySpecials: {} },
  survey: {
    type: "survey", category: "marketing", container: false,
    summary: "Survey / image-choice question; each option submits a field.",
    useWhen: "Quizzes, preference capture, image pickers.",
    keySpecials: {
      options: "array of {id,image,title,value,field_name}.", type: "text-image | text…",
      multiOption: "boolean — allow multiple.", selectedBackground: "selected bg color.", selectedBorder: "selected border color.",
    },
  },
  "alertMessage": { type: "alertMessage", category: "marketing", container: false, summary: "Alert / announcement banner.", useWhen: "Top-of-page notices.", keySpecials: {} },
};

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

RULES
- Visible content goes in "specials" (text-block.specials.text, image-block.specials.src…), NEVER in "styles".
- Colors as rgba(r,g,b,a). fontSize/borderWidth/top/left/width/height are NUMBERS (px).
- IMAGES: a real landing page has images (hero/product shot, feature icons, about photo). There is NO image API yet, so set image-block specials.src to a PLACEHOLDER URL sized to the box: "https://placehold.co/<width>x<height>" (or "https://picsum.photos/<w>/<h>" for a photo). NEVER leave src empty — it renders blank and the page looks broken. gallery.media = array of such URLs; video.specials.img = a poster placeholder. The user replaces these later.
- CONTRAST: text must contrast with the section background (dark text on light sections, light text on dark sections). Don't put light-gray text on white or faint text on a dark background.
- movable:false for section/slide/grid-item/popup; otherwise true. runtime is always {}.
- Every form input MUST have a unique specials.field_name.
- events item: { "id", "type":"click"|"hover"|"success"|"unset", "action", "target", "appTarget":"", "hoverColor":"" }. For element-targeting actions (open_popup, close_popup, scroll_to, show_section, hide_section, show_hide_element) target = the target element's id; for open_link target = URL; for copy target = the text; target may be null (e.g. animation_hover).
- ANIMATION: each breakpoint's config has config.animation = { "name":"none", "delay":0, "duration":3, "repeat":null }. Keep "none" unless an entrance animation is wanted.
- Do NOT invent prices, phone numbers, addresses, or statistics. Output text in the requested language.

INTAKE — ask the user BEFORE generating (don't assume; ask 3–6 short, concrete questions, offer sensible defaults):
- Goal / page type: lead-gen, product/COD sale, event, invitation, app promo, portfolio…?
- Brand: name, what they sell, tone (premium/playful/minimal), language (vi/en…).
- Sections wanted (in order): e.g. hero, features, pricing, testimonials, FAQ, contact form, footer.
- Primary CTA + where it goes: open a form popup, scroll to form, call/Zalo, open link?
- Form fields to capture (if any): name, phone, email, address, quantity…? (use canonical field_names: full_name, phone_number, email, address, quantity).
- Branding details: primary color (rgba/hex), logo/image URLs, must-keep text, things to avoid.
- Target: desktop+mobile or mobile-only? Which organization to save into (list_organizations)?
Confirm a short outline (sections + CTA) with the user before building the full JSON.
NEVER invent prices, phone numbers, addresses, or statistics — ask or leave placeholders the user can fill.

WORKFLOW (recommended)
0. INTAKE: ask the questions above, confirm the section outline.
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
