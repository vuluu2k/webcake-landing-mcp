/**
 * Element library: per-type AI usage hints, key specials docs, categories, and
 * the global generation guide. Derived from the renderers in
 * assets/render_v4/src/elements/*, the editor factory, and the event dispatcher.
 * See docs/ai/page-element-schema.md for the full reference.
 */

export const CANVAS = { desktopWidth: 960, mobileWidth: 420, defaultSectionHeight: 800 };

export const EVENT_TRIGGERS = ["click", "hover", "success", "error", "unset", "delay"] as const;

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
  copy: "Copy to clipboard. target = the text; OR an element id when copyType='elementValue'.",
  collapse: "Collapse/expand. target = id.",
  set_field_value: "Set a form field value. target = field_name, plus set_value.",
  back_to: "Go back in browser history (history.back()). target = none.",
  share: "Share the current page URL. target = platform name: 'Facebook'|'Twitter'|'Custom'.",
  play_audio: "Play audio. target = audio file URL (NOT an element id).",
  stop_audio: "Stop audio. target = the same audio file URL (NOT an element id).",
  open_sms: "Send SMS. target = phone number; optional smsBody for the message body.",
  send_email: "Open mail client. target = email address (mailto:).",
  download_file: "Download a file. target = file URL; optional nameFile overrides filename.",
  close_webview: "Close a Facebook/Messenger in-app webview. target = none.",
  open_cart: "Open cart.",
  add_to_cart: "Add product to cart. target = product id.",
  open_app: "Open chat/app. event.appTarget selects the provider (botcake|botcake_dynamic|whatsapp|mess_prefill|tiktok_prefill|line_prefill|others); target = destination URL/phone/ref.",
  change_color: "Change color.",
  custom_js: "Run custom JS.",
};

export const HOVER_ACTIONS: Record<string, string> = {
  change_color: "Change color on hover.",
  change_background: "Change background on hover.",
  change_text_color: "Change text color on hover.",
  change_underline: "Underline on hover.",
  change_overline: "Overline on hover.",
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
      pageLoadEvent: "string — pubsub event name the section waits for before becoming visible (conditional show on page-load event).",
      pageLoadEventDelay: "number (ms) — delay after pageLoadEvent fires before showing.",
      loadDelayMultiplier: "number — multiplier applied to pageLoadEventDelay.",
      afterPageLoadEvent: "string — pubsub event name that triggers hiding the section after it was shown.",
      afterPageLoadEventDelay: "number (ms) — delay before hiding after afterPageLoadEvent fires.",
      afterLoadDelayMultiplier: "number — multiplier applied to afterPageLoadEventDelay.",
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
    summary: "Groups children so they move and position together (position:absolute). In cart contexts can also act as a product variation selector group.",
    useWhen: "Bundling an icon+text card, a badge cluster, or any reusable mini-layout you want to move as one. Also used in cart forms to bind a group of children to a specific product variant.",
    keySpecials: {
      sprod: "object {id: string} — product reference for variation selector mode. Set to bind this group to a specific product.",
      ctype: "'field' | 'atc' — context type: 'field' means the group acts as a form field selector, 'atc' means add-to-cart trigger.",
      sprod_attr: "string — product attribute name this group targets (e.g. 'Color', 'Size').",
      sprod_val: "string — attribute value to pre-select.",
      squantity: "number — quantity to add to cart (read by the add_to_cart event handler).",
      svariant: "string — variant id override for add-to-cart.",
    },
  },
  grid: {
    type: "grid", category: "layout", container: true,
    summary: "Grid layout; config.column / config.row; children are grid-item. Can bind to an external dataset and paginate.",
    useWhen: "Repeating cards in a regular N-column grid (features, team, gallery of cards). Use datasetId to drive content from a dataset.",
    keySpecials: {
      column: "(config) number of columns.",
      row: "(config) number of rows.",
      pagination: "(config) 0 = none | 1 = 'see more' button | 2 = auto-carousel/slide mode.",
      timeSlide: "(config) auto-slide interval in ms when pagination=2.",
      datasetId: "string — bind grid to an external dataset (each row renders one grid-item clone).",
      attributeId: "(on child grid-item specials) string — bind that child element to a specific dataset column by attribute ID.",
    },
  },
  "grid-item": {
    type: "grid-item", category: "layout", container: true,
    summary: "A single cell inside a grid (movable:false; laid out by the grid).",
    useWhen: "Only as a direct child of grid.",
    keySpecials: {},
  },
  carousel: {
    type: "carousel", category: "layout", container: true,
    summary: "Horizontal slider; config.slideWidth; children are slide. Supports autoplay, center mode, dataset binding.",
    useWhen: "Testimonials, screenshots, or any swipeable set of slides. Use datasetId to drive slides from a dataset.",
    keySpecials: {
      slideWidth: "(config) width of each slide in px.",
      centerMode: "(config) boolean — center the active slide with partial neighbors visible.",
      slideToShow: "(config) number of slides visible at once.",
      infinity: "(config) boolean — infinite loop.",
      showNavigation: "(config) boolean — show prev/next arrow buttons.",
      delayTimeMs: "(config) number (ms) — global autoplay interval between slides.",
      autoplayMode: "(config) boolean | 'auto' — enable autoplay.",
      datasetId: "string — bind carousel to an external dataset (each row renders one slide clone).",
    },
  },
  slide: {
    type: "slide", category: "layout", container: true,
    summary: "One slide inside a carousel (movable:false).",
    useWhen: "Only as a direct child of carousel.",
    keySpecials: {
      src: "string (URL) — slide background image (built into a CSS background, same pattern as image-block).",
      resize: "number — background-image crop behavior on resize.",
    },
  },
  popup: {
    type: "popup", category: "layout", container: true,
    summary: "Overlay popup. Hidden by default; opened/closed by events targeting its id.",
    useWhen: "Thank-you dialog, lead form modal, promo. Place popups at the top level of `page` and trigger via a button's open_popup event.",
    keySpecials: {
      src: "string (URL) — background image (built into a CSS background, same pattern as image-block).",
      resize: "number — background-image crop behavior on resize.",
      video_background_thumbnail: "string (URL) — video thumbnail; renders a .video-background div for a video background.",
    },
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
    summary: "Text. specials.text holds the content (may contain inline HTML); specials.tag sets the semantic tag. Supports template variables ({{key}}), formula mode, URL-param injection, and date formatting.",
    useWhen: "Any headline, paragraph, label. Use tag h1/h2 for headings, p for body. Style via responsive.styles (fontSize, color, fontWeight, textAlign).",
    keySpecials: {
      text: "string — the visible text; may include inline HTML (<b>, <br>, <span style>…). Also supports template variables: {{today}}, {{yesterday}}, {{tomorrow}} (formatted dates), {{coupon_text}}, {{coupon_code}}, {{coupon_codes}}, {{spin_turn_left}}, {{cart_total_price}}, {{cart_subtotal}}, {{cart_shipping_fee}}, {{cart_discount_code}}, {{voucher_price_cart}}, {{cart_item}}, {{cart_bonus_item}}, {{form_error_log}}, {{total_cart}}. Dynamic form field binding: {{formId__fieldName}} substitutes a field value from a sibling form.",
      tag: "p | h1 | h2 | h3 | h4 | h5 | h6 | span | div.",
      isFormula: "boolean — enable formula/computed numeric mode.",
      formula: "string — formula expression evaluated to produce a numeric value (used when isFormula=true).",
      fixed: "number — decimal places to display when isFormula=true.",
      isTextParams: "boolean — populate text from a URL query parameter instead of specials.text.",
      textParams: "string — URL query parameter name to read (used when isTextParams=true).",
      isFormat: "boolean — apply a date format to template date variables.",
      format: "string — dayjs format string (e.g. 'D/MM/YYYY') used when isFormat=true.",
      formParamSeparator: "string — separator between items when rendering {{formId__form_items}} lists.",
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
      text: "string of <li>item</li><li>item</li>… (no <ul> wrapper). Bullet/icon styling lives in the per-breakpoint config, not specials: iconType ('shape'|'image'|'disc'|'circle'|'square'|'decimal'|'none'…), iconImage (SVG/URL), iconColor (rgba), iconFontSize, iconSize, iconTop, linePaddingLeft (text indent), linePaddingBottom (line spacing).",
      iconSize: "(config) bullet icon size.", linePaddingLeft: "(config) text indent.",
    },
  },
  "image-block": {
    type: "image-block", category: "content", container: false,
    summary: "Image. The editor renders the image from specials.src. config.overlay tints it.",
    useWhen: "Add images where a landing page would have them: hero/product shot, feature icons, about photo, logos. There is NO image API yet — set specials.src to a PLACEHOLDER URL sized to the box: https://placehold.co/<width>x<height> (or https://picsum.photos/<w>/<h> for a photo). NEVER leave src empty (it renders blank). The user replaces placeholders later.",
    keySpecials: {
      src: "image URL — REQUIRED. Use https://placehold.co/WxH (matching width×height) if you don't have a real image.",
      resize: "number — image crop behavior on resize; a value other than 300 triggers keep_solution (no-crop) mode.",
      enable_background_compare: "boolean — show a before/after image-comparison slider (companion config.backgroundCompare holds the second image).",
      overlay: "(config) overlay color rgba(...).",
    },
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
    summary: "Clickable button. Label in specials.text; behavior in the events array. Supports the same template variable system as text-block ({{today}}, {{cart_total_price}}, {{formId__fieldName}}, etc.).",
    useWhen: "Every CTA. Add a click event: open_link (to URL), open_popup (lead modal), scroll_to (anchor). Inside a form, a button submits the form.",
    keySpecials: {
      text: "button label — supports template variables (same set as text-block: {{today}}, {{cart_total_price}}, {{formId__fieldName}}, etc.).",
      required: "boolean — gate by form validity.",
      isTextParams: "boolean — populate label from a URL query parameter instead of specials.text.",
      textParams: "string — URL query parameter name to read (used when isTextParams=true).",
      isFormat: "boolean — apply a date format to template date variables.",
      format: "string — dayjs format string (e.g. 'D/MM/YYYY') used when isFormat=true.",
      formParamSeparator: "string — separator between items when rendering {{formId__form_items}} lists.",
      isConnectSurvey: "boolean — link this button to a survey element for required-field validation before submit.",
      connectedSurvey: "string — id of the survey element to validate when isConnectSurvey=true.",
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
    summary: "Video player (YouTube/Vimeo/upload/CDN). Use specials.typeVideo to select the source type.",
    useWhen: "Demo or promo videos. Set specials.img to a poster placeholder (https://placehold.co/640x360) when there's no real thumbnail.",
    keySpecials: {
      typeVideo: "'youtube' | 'vimeo' | 'webcake' | 'upload' — video source type.",
      video: "string — raw video URL (for upload/webcake/CDN types).",
      id: "string — YouTube video ID (for typeVideo='youtube').",
      video_cdn: "string — CDN video URL or identifier.",
      img: "string — poster/thumbnail image URL — use a placeholder if none (https://placehold.co/640x360).",
      autoReplay: "boolean — loop the video.",
      showControl: "boolean — show player controls.",
      hideRelated: "boolean — hide YouTube related videos at end.",
      muteOnPlay: "boolean — mute audio when video plays.",
      autoPlay: "boolean — autoplay on load.",
    },
  },
  gallery: {
    type: "gallery", category: "content", container: false,
    summary: "Multi-image/video gallery with thumbnail strip. Content comes entirely from specials.media — this is NOT a container and has no children.",
    useWhen: "Photo grids/galleries with several images or videos. No image API — fill specials.media with placeholder URLs (https://placehold.co/600x400).",
    keySpecials: {
      media: "array of image URLs or video objects {type:'video', linkVideo:'<url>', typeVideo:'youtube'|'upload'} — use placeholder URLs if no real images.",
      allowZoom: "'off' | 'carousel' | 'lightbox' — (config) zoom/lightbox mode when clicking an image.",
      showNavigation: "boolean — (config) show prev/next navigation arrows.",
      thumbnailAutoplay: "number (ms) | 'off' — (config) auto-advance thumbnails every N ms, or 'off' to disable.",
      thumbnailAutoplayRepeat: "boolean — (config) loop thumbnail autoplay.",
      thumbnailPosition: "'top' | 'bottom' | 'left' | 'right' — (config) position of the thumbnail strip relative to the main image.",
      thumbnailWidth: "number — (config) width of each thumbnail in px.",
      thumbnailHeight: "number — (config) height of each thumbnail in px.",
      distanceAmong: "number — (config) gap between thumbnails in px.",
    },
  },
  "html-box": {
    type: "html-box", category: "content", container: false,
    summary: "Raw HTML embed. specials.html holds the markup (rendered via v-html).",
    useWhen: "Embedding third-party widgets or custom markup the standard elements can't express.",
    keySpecials: { html: "string — raw HTML content (the only content key; stored HTML-escaped, unescaped at render)." },
  },
  "editor-blog": {
    type: "editor-blog", category: "content", container: false,
    summary: "Long-form rich text / article body. specials.html holds the rich-text markup.",
    useWhen: "Blog/article content blocks.",
    keySpecials: { html: "string — rich-text HTML content (stored HTML-escaped, unescaped at render)." },
  },

  // ---------------- form & inputs ----------------
  form: {
    type: "form", category: "form", container: true,
    summary: "Wraps inputs; on submit creates a lead/FormData. Pixel tracking configured here.",
    useWhen: "Any lead-capture / contact / registration form. Put input/textarea/select/button inside its children.",
    keySpecials: {
      form_type: "'login' | undefined — 'login' runs the gated access-key flow on submit instead of the normal lead-data API.",
      submit_success: "1 | 2 — 1 = open the success popup (popup_target); 2 = redirect to redirect_url.",
      popup_target: "string (popup id) — popup to open when submit_success=1.",
      redirect_url: "string (URL) — destination when submit_success=2.",
      target_url: "'_self' | '_blank' — window target for the redirect / payment callback.",
      open_link_with_params: "boolean — merge the current page's URL search params into redirect_url.",
      merge_sub_form_data: "boolean — pass the previous form's form_data_id as sub_form_id on redirect.",
      extra_url: "string (URL) — post-submit app/bot/WhatsApp URL used by app_target modes other than botcake.",
      app_target: "'botcake' | 'botcake_dynamic' | 'whatsapp' | 'mess_prefill' | 'tiktok_prefill' | 'line_prefill' | 'others' — which app to open after submit.",
      wa_custom_text: "string — message template for WhatsApp/Messenger/TikTok/LINE prefill (supports {{field_name}} placeholders).",
      line_OA_id: "string — LINE Official Account id (with app_target='line_prefill').",
      botcake_dynamic_ref: "string — ref appended to the m.me URL when app_target='botcake_dynamic'.",
      others_link_params: "array of {key: elementId, name: string} — field→URL-param mappings when app_target='others'.",
      partnerServiceId: "string — sent as partner_service_id (partner/affiliate tracking).",
      fb_event_type: "Facebook pixel standard event fired on submit (e.g. CompleteRegistration, Purchase, Lead, none).",
      fb_conversion_value: "string — FB pixel conversion value.",
      fb_tracking_currency: "string — currency for the FB conversion value (VND…).",
      fb_custom_tracking: "string — extra custom FB pixel event name to fire on submit.",
      tiktok_event_type: "TikTok pixel event fired on submit (e.g. CompleteRegistration, none).",
      tiktok_conversion_value: "string — TikTok conversion value.",
      tiktok_tracking_currency: "string — currency for the TikTok conversion value.",
      event_name_custom: "string | 'none' — custom name fired via fbq('trackCustom') + gtag('event') on submit.",
      ggc_id: "string — Google Ads conversion tag id (single-conversion mode).",
      ggc_label: "string — Google Ads conversion label.",
      ggc_v: "string|number — Google Ads conversion value.",
      ggc_c: "string — Google Ads conversion currency override.",
      google_conversion_mode: "'single_conversion' | 'multi_conversion' | 'none' — fire one or many Google Ads conversions per submit.",
      ggc_list: "array of {ggc_id, ggc_label, ggc_v, ggc_c} — conversions for multi_conversion mode.",
      multiForm: "boolean — mark this as a child form whose submit copies data into multiFormParent.",
      multiFormParent: "string (form id) — parent form this child form syncs into.",
      customArrangementSheet: "boolean — order the backend spreadsheet columns by sheetOrder.",
      sheetOrder: "array of {id: string} — custom child-id order for sheet column arrangement.",
      validate: "validation config (legacy).",
      field_type: "form field config (legacy).",
      "events[]": "the form's OWN events array supports type:'success' (12+ actions: phone_call, open_sms, send_email, open_link, scroll_to, open_popup, close_popup, download_file, show_hide_element, show_section, hide_section, close_webview, change_tab — fired after a successful submit) and type:'error' (open_popup, close_popup, show_hide_element — fired when validation fails).",
    },
  },
  input: {
    type: "input", category: "form", container: false,
    summary: "Single-line input. specials.field_name is the submitted data column (REQUIRED & unique).",
    useWhen: "Name/email/phone fields. Set field_type to text/email/phone/number.",
    keySpecials: {
      field_name: "REQUIRED unique data key. Special names: 'phone_number' (phone validation), 'coupon' (publishes form-info-change), 'address' (detect-address), 'postal_code' (postcode lookup), 'recheck_phone_number' (must match phone_number).",
      field_placeholder: "placeholder text.",
      field_type: "text | email | phone | number | postal_code | date — 'postal_code' enables the postcode-detect helper; 'date' renders a date input.",
      required: "boolean.",
      validate: "boolean — enable extra pattern validation (phone regex / postal-code check).",
      validate_country: "string dial code (e.g. '84','1') used for phone validation; exported as country_code in the field list.",
      phone_validator: "string regex — custom phone validation pattern (falls back to CONST.REGEX_PHONE_VALIDATOR).",
      detectAddress: "boolean — activate Vietnamese address autocomplete (only when field_name='address', country '84', no country-select sibling).",
      isFormula: "boolean — formula/computed mode (input becomes read-only, value = evaluated formula).",
      formula: "string — JS expression with {{field_name}} placeholders, e.g. '{{price}} * {{qty}}'.",
      fixed: "string|number — decimal places for the formula result ('0' = integer).",
      isTextParams: "boolean — fill the value from a URL query parameter (name from el.name / field_name).",
      isConnectSurvey: "boolean — input is hidden until a connected survey selects it (required is dropped while hidden).",
      connectedSurvey: "string — id of the survey element this input is connected to.",
      defaultVariationId: "string — default product variation id registered on the parent form (for non-quantity inputs).",
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
  textarea: { type: "textarea", category: "form", container: false, summary: "Multi-line input.", useWhen: "Messages, notes.", keySpecials: { field_name: "REQUIRED unique key.", field_placeholder: "placeholder.", isFormula: "boolean — formula/computed mode (same {{field_name}} expression system as input).", formula: "string — formula expression when isFormula=true." } },
  select: {
    type: "select", category: "form", container: false,
    summary: "Dropdown select. Options live in specials.options (NOT children).",
    useWhen: "Pick one from a list.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      field_placeholder: "placeholder/label.",
      default_value: "string (option id) to pre-select; 'default-none' = no pre-selection.",
      defaultVariationId: "string — default product variation id registered on the parent form regardless of selection.",
      defaultVariationQuantity: "number — quantity registered with defaultVariationId.",
      ignoreOnHidden: "boolean — when CSS-hidden, remove this element's variations from the form total.",
      isConnectSurvey: "boolean — link to a survey for conditional show/hide.",
      connectedSurvey: "string — id of the connected survey.",
      options: "array of rich option objects {id, name, value, variations:[{id,quantity,price}], attrOnly/prodId/attrName/attrVal/attrs (attribute mode), quantityOnly/quantityProd/quantityValue (quantity mode), tags:[], toggleEvent, events_option:[]} — events_option items drive show/hide, collapse, and price/discount/shipping adjustments. See docs/element-specials-reference.md for the full option schema.",
    },
  },
  checkbox: { type: "checkbox", category: "form", container: false, summary: "Single checkbox (consent, opt-in).", useWhen: "Agree-to-terms, single toggle.", keySpecials: { field_name: "REQUIRED.", required: "boolean — must be checked to submit." } },
  "checkbox-group": {
    type: "checkbox-group", category: "form", container: true,
    summary: "Multiple checkboxes. Choices live in specials.options (the multi-select group writes formData.checkbox[field_name]).",
    useWhen: "Multi-select options.",
    keySpecials: {
      field_name: "REQUIRED unique data key (submitted as formData.checkbox[field_name], an array of checked option ids).",
      required: "boolean — at least one checkbox must be checked.",
      default_values: "array of option id strings checked by default on load.",
      defaultVariationId: "string — default variation registered on the parent form.",
      defaultVariationQuantity: "number — quantity for defaultVariationId.",
      ignoreOnHidden: "boolean — when CSS-hidden, exclude this element's variations from the form total.",
      isConnectSurvey: "boolean — link to a survey for conditional show/hide.",
      connectedSurvey: "string — id of the connected survey.",
      options: "array of rich option objects (same shape as select) — additionally supports the tcb_auto_banking event type in events_option (sets the storecake_tcb payment gateway). See docs/element-specials-reference.md for the full option schema.",
    },
  },
  radio: {
    type: "radio", category: "form", container: true,
    summary: "Single-choice radio options. Choices live in specials.options (writes formData.radio[field_name]).",
    useWhen: "Pick exactly one of a few. Common for payment-method selection.",
    keySpecials: {
      field_name: "REQUIRED unique data key (submitted as formData.radio[field_name], the single selected value).",
      required: "boolean — one radio must be selected.",
      default_value: "string (option id) | 'none' — option to pre-select; 'none' = nothing pre-selected.",
      defaultVariationId: "string — default variation registered on the parent form.",
      defaultVariationQuantity: "number — quantity for defaultVariationId.",
      highlight: "boolean — give the selected radio item a background highlight.",
      color_highlight: "CSS color — background applied to the selected item when highlight=true.",
      ignoreOnHidden: "boolean — when hidden, exclude this element's variations from the form total.",
      isConnectSurvey: "boolean — link to a survey for conditional show/hide.",
      connectedSurvey: "string — id of the connected survey.",
      options: "array of rich option objects (same shape as select) — events_option additionally supports 9 payment-gateway event types (tcb_auto_banking, xendit_banking, onepay_banking, mercadopago_banking, vnpay_banking, paymongo_banking, stripe_banking, paypal_banking, momopay_banking) that set the form's payment provider. See docs/element-specials-reference.md for the full option schema.",
    },
  },
  address: {
    type: "address", category: "form", container: false,
    summary: "Province/District/Ward selector (multi-country).", useWhen: "Shipping/contact address.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      country: "string — numeric phone-prefix code (e.g. '84' VN, '1' US) selecting which province/district/commune data to load.",
      use_search_box: "boolean — wrap the dropdowns in a typeahead SelectSearch widget.",
      hidden_commune: "boolean — omit the commune (ward) tier entirely.",
      hidden_province_list: "array of province id strings to exclude from the province dropdown.",
      hidden_district_list: "array of district id strings to exclude from the district dropdown.",
      hidden_commune_list: "array of commune id strings to exclude from the commune dropdown.",
      required_commune: "boolean — require commune selection when communes exist for the district.",
      hide_postal_code: "boolean (default true) — when false and the country supports it, expose a postal-code dropdown.",
    },
  },
  "country-select": {
    type: "country-select", category: "form", container: false,
    summary: "Country picker. Auto-syncs sibling phone-number / postal-code / address fields.",
    useWhen: "International forms.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      countries: "array of country dial-prefix codes (e.g. ['84','1','65']) shown in the dropdown and used to preload address data.",
      autofill_phone: "boolean — listen to sibling phone_number inputs to auto-select the country by dial prefix and auto-prepend the dial code.",
    },
  },
  "quantity_input": { type: "quantity_input", category: "form", container: false, summary: "Quantity stepper (+/-).", useWhen: "Order quantity.", keySpecials: { field_name: "REQUIRED unique data key.", ignoreOnHidden: "boolean — when hidden at mount, add field_name to the parent form's ignore list and publish quantity 0." } },
  "input-datetime": {
    type: "input-datetime", category: "form", container: false,
    summary: "Date/time picker.", useWhen: "Booking date, appointment.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      datetime_type: "'date' | 'time' | 'datetime-local' | 'time_slot_picker' — the HTML input type to render.",
      limit_option_type: "'none' | 'dynamic' — 'dynamic' computes min/max from before_day/after_day offsets from today.",
      before_day: "number — days/hours before today that stay selectable (when limit_option_type='dynamic').",
      after_day: "number — days/hours after today that stay selectable (when limit_option_type='dynamic').",
      sync_to_crm: "'none' | 'booking_crm' — 'booking_crm' validates against CRM availability (active only when shop_type=3).",
    },
  },
  "input-file": { type: "input-file", category: "form", container: false, summary: "File upload (renderer: upload.js).", useWhen: "CV/receipt/photo upload.", keySpecials: { field_name: "REQUIRED unique data key.", maxFile: "number — when truthy, enable multi-file upload and track the uploaded-file count. (UI variant config.display_type 'default'|'type-1' lives in the per-breakpoint config object, NOT in specials.)" } },
  signature: { type: "signature", category: "form", container: false, summary: "Hand-drawn signature pad.", useWhen: "Consent/contracts.", keySpecials: { field_name: "REQUIRED." } },
  "verify-code": {
    type: "verify-code", category: "form", container: false,
    summary: "OTP / verification code field.", useWhen: "Phone/email verification.",
    keySpecials: {
      field_name: "REQUIRED unique data key for the OTP value.",
      type_otp_input: "'one-input' | (other) — 'one-input' = single box accepting length_otp chars; otherwise multi-box auto-advance.",
      length_otp: "number — number of OTP digits (typically 4–8); sent to the OTP endpoint.",
      partner_id: "string — backend partner/tenant id sent to GET /partners/{partner_id}/get_otp (required for 'Get Code').",
      field_type: "'postal_code' | absent — 'postal_code' switches validation from phone OTP to a postal-code regex.",
      condition: "'limit_5' | 'limit_6' | 'custom' — postal-code regex selector (active when field_type='postal_code').",
      pattern: "string regex — custom postal-code pattern when condition='custom'.",
    },
  },
  "group-select": {
    type: "group-select", category: "form", container: true,
    summary: "Attribute/variant selector group (e.g. size+color+quantity); children are group-select-item.",
    useWhen: "Product variants with quantity.",
    keySpecials: {
      field_name: "REQUIRED — variation slot key used when registering variations on the parent form.",
      sprod: "object {id: string} — product reference for the child items ('custom' = read product id from a runtime DOM attr).",
      alwayValue: "boolean (spelling exact, no trailing 's') — when true and the group is hidden, skip pushing its variation to the form.",
    },
  },
  "group-select-item": {
    type: "group-select-item", category: "form", container: false,
    summary: "One attribute (or the quantity) inside group-select. Options are NOT static — they are populated from the product catalog (window.sync.products) at runtime based on attrName + the parent's sprod.",
    useWhen: "Child of group-select only.",
    keySpecials: {
      field_name: "REQUIRED unique data key (becomes 'quantity' when field_quantity=true).",
      field_quantity: "boolean — when true this item is the quantity selector (value goes to parent._setQuantity), not a product attribute. Only one item per group.",
      attrName: "string — the product attribute name this item maps to (e.g. 'Color','Size'); numeric strings ('1','2') index product_attributes for custom products; 'sprod-name'/'sprod-sku' show the product name/SKU.",
      default_value: "string — pre-selected option value, or 'default-none'/empty for no default.",
      required: "boolean — require selection when the item and its parent group are visible.",
    },
  },

  // ---------------- commerce ----------------
  "list-product": {
    type: "list-product", category: "commerce", container: false,
    summary: "Product list bound to the page store; clicking a card opens the popup-checkout overlay.",
    useWhen: "Show purchasable products.",
    keySpecials: {
      select: "'product' | 'tag' | 'category' — which dimension to filter products by.",
      type: "'expect' | 'except' — treat the expect*/except* arrays as an allowlist (expect) or denylist (except).",
      expect: "array of product id strings to include (select='product', type='expect').",
      except: "array of product id strings to exclude (select='product', type='except').",
      expectCategory: "array of category ids to include (select='category').",
      exceptCategory: "array of category ids to exclude (select='category').",
      expectTags: "array of tag slugs to include (select='tag').",
      exceptTags: "array of tag slugs to exclude (select='tag').",
      format_title: "'default' | 'sku' | 'sku-name' | 'name-category' — product title composition.",
      format_price: "'range' | 'discount' — 'discount' shows the % off badge when original > retail.",
      direction: "'column' | (other) — 'column' = whole card is one click target; otherwise thumbnail + cart button each get handlers (and remain-quantity shows).",
      numerical_order: "boolean — show numbered labels (01, 02 …) on thumbnails.",
      remain_quantity_text: "string — low-stock label; {{value}} is replaced with the actual remaining count.",
    },
  },
  "search-list-product": { type: "search-list-product", category: "commerce", container: false, summary: "Search box + product results. Reads NO specials (all DOM-driven) and REQUIRES a co-existing list-product element on the page — openProduct() delegates to a list-product vm, so without one nothing opens.", useWhen: "Searchable catalog (pair it with a list-product element).", keySpecials: {} },
  "cart-items": { type: "cart-items", category: "commerce", container: false, summary: "Items currently in the cart. Has NO element specials — the WCart system writes its inner HTML at runtime and it needs the cart active (is_cart_active). Item name/price/quantity font sizes come from the page-level cartConfigs.checkoutElements['CART-ITEM'] (itemNameSize/itemPriceSize/inputQuantitySize), not from this node.", useWhen: "Cart/checkout area (requires WCart active).", keySpecials: {} },
  "cart-quantity": {
    type: "cart-quantity", category: "commerce", container: false,
    summary: "Quantity stepper (+/-) that controls a field in the parent variation group; publishes <id>__quantity-change on each click.",
    useWhen: "Per-variation quantity inside a cart/form group.",
    keySpecials: {
      field_name: "REQUIRED — identifies which field in the parent variation group this stepper controls.",
      ignoreOnHidden: "boolean — when hidden, suppress this element's quantity contribution (calls _addIgnoreField/_removeIgnoreField on the parent vm).",
    },
  },
  "product-select": { type: "product-select", category: "commerce", container: false, summary: "STUB — no runtime renderer exists in render_v4, so placing this type produces a non-functional element that does nothing on the page. Use list-product (catalog) or form (order capture) instead.", useWhen: "Do NOT use — it is a reserved/legacy stub. Prefer list-product or form.", keySpecials: {} },
  table: {
    type: "table", category: "commerce", container: false,
    summary: "Data table rendered from a pre-fetched Google Sheets 2D array.",
    useWhen: "Pricing/comparison/spec tables (data must be pre-loaded into specials).",
    keySpecials: {
      dataType: "0 | 1 — MUST be 1 to render anything; the renderer returns early when dataType != 1.",
      source: "string — data source label (metadata only).",
      sheetID: "string — Google Sheet document id (metadata only).",
      google_sheet_data: "string[][] — the 2D table data; row 0 = headers as 'Title|type' where type ∈ image|video|link|time (absent type = plain text); rows 1+ are data cells.",
    },
  },

  // ---------------- marketing / dynamic ----------------
  countdown: {
    type: "countdown", category: "marketing", container: false,
    summary: "Countdown timer (minute duration, fixed end time, or daily window).",
    useWhen: "Urgency: limited offer, flash sale. Renders a fixed FOUR-slot flex row (day·hour·minute·second); each visible segment is sized 1/4 of the width regardless of how many show, so HIDING a segment (showDay/showSecond:false) leaves an empty gap on the right (the row is left-aligned, no built-in re-centering). Keep all four (showDay+showSecond:true) so the row fills evenly, and CENTER the whole box on the canvas: left = round((canvas - width)/2).",
    keySpecials: {
      type: "minute | duration | daily — countdown mode. 'minute' counts down from a fixed duration; 'duration' counts to a fixed end datetime; 'daily' resets in a daily window.", duration: "minutes to count down (when type='minute').",
      startTime: "ISO datetime string — start of the countdown window (used with type='duration' or 'daily').",
      endTime: "ISO datetime string — end/deadline datetime (used with type='duration').",
      dailyStart: "string 'HH:MM' — daily window open time (used with type='daily').",
      dailyEnd: "string 'HH:MM' — daily window close time (used with type='daily').",
      repeat: "boolean — restart the countdown when it reaches zero.",
      customize: "boolean — enable custom message display when countdown finishes.",
      customMessage: "string — message to display when countdown reaches zero (used when customize=true).",
      showDay: "boolean — show the days segment.",
      showSecond: "boolean — show the seconds segment.",
      showText: "boolean — show unit labels (days/hours/minutes/seconds).",
      language: "locale string for unit labels.",
      customTranslation: "object — custom unit label overrides.",
    },
  },
  timegroup: {
    type: "timegroup", category: "marketing", container: false,
    summary: "Live current date/time display rendered as text. Supports relative labels (today/yesterday/tomorrow) or fixed datetime, with multiple format presets.",
    useWhen: "Show today's date, a relative date label, or a formatted timestamp on the page.",
    keySpecials: {
      currentTime: "'yesterday' | 'today' | 'nextday' | 'custom' — which date to display.",
      formatType: "number 1–11 — selects a date/time format preset (1=short date, 2=long date, 3=time, 4=datetime, etc.).",
      language: "string — locale for month/day names (e.g. 'vi', 'en').",
      typeTimeGroup: "1 | 2 — 1=relative label (e.g. 'Today'), 2=fixed formatted datetime string.",
      customTime: "string — ISO datetime string to display when currentTime='custom'.",
      customDateJump: "number — day offset from customTime (positive=future, negative=past).",
    },
  },
  "auto-number": {
    type: "auto-number", category: "marketing", container: false,
    summary: "Auto-incrementing number that counts up from startNumber to endNumber. Supports sync mode to mirror another element's value.",
    useWhen: "Social-proof counters (views, orders, customers). Counts up on page load.",
    keySpecials: {
      startNumber: "number — value to start counting from.",
      endNumber: "number — value to count up to.",
      jumpNumber: "number — increment per animation step.",
      timeDelayMs: "number (ms) — interval between steps (preferred key).",
      timeDelay: "number (ms) — legacy interval key (use timeDelayMs instead).",
      autoNumberMode: "'sync' | undefined — 'sync' mirrors the value of another auto-number element instead of counting independently.",
      syncTarget: "string — element id to sync with when autoNumberMode='sync'.",
    },
  },
  "random-number": {
    type: "random-number", category: "marketing", container: false,
    summary: "Displays a random number between startNumber and endNumber. Result is persisted in localStorage so it stays consistent across page reloads.",
    useWhen: "Randomized social proof (e.g. 'X people viewed this').",
    keySpecials: {
      startNumber: "number — minimum value of the random range.",
      endNumber: "number — maximum value of the random range.",
      jumpNumber: "number — step granularity for the random value.",
    },
  },
  notify: {
    type: "notify", category: "marketing", container: false,
    summary: "'Someone just bought…' toast notification strip. Cycles through a list of notifications with configurable timing. Supports static data, Google Sheets, or a webcake dataset as source.",
    useWhen: "Social-proof popups showing recent purchases/signups.",
    keySpecials: {
      delay: "number (ms) — initial delay before the first notification appears.",
      duration: "number (ms) — how long each notification is visible.",
      delayStart: "number (ms) — pause between notifications.",
      random: "boolean — randomize the order of notifications.",
      soundMode: "boolean — play a sound when a notification appears.",
      notifySoundLink: "string — URL to a custom notification sound file.",
      dataType: "0 | 1 — 0=static data embedded in page, 1=Google Sheets.",
      source: "string — data source label.",
      sheetID: "string — Google Sheet ID (when dataType=1).",
      dataSheet: "string — sheet tab name (when dataType=1).",
      datasetId: "string — webcake dataset ID to pull notification data from.",
      dataSetData: "array — pre-fetched dataset rows.",
    },
  },
  "spin-wheel": {
    type: "spin-wheel", category: "marketing", container: false,
    summary: "Lucky-spin wheel with configurable prize segments and coupon codes. Can open a result popup after spinning and supports dataset-driven coupon lists.",
    useWhen: "Gamified lead capture / promos. Users spin to win a coupon or prize.",
    keySpecials: {
      message: "array of strings — prize label for each wheel segment.",
      spin: "object — spin configuration (segment colors, angles, etc.).",
      code: "array of strings — coupon codes corresponding to each segment.",
      dataType: "0 | 1 — 0=static codes, 1=dataset-driven codes.",
      datasetId: "string — webcake dataset ID for coupon codes.",
      codeDataset: "string — dataset column key for the coupon code.",
      popup: "string — id of the popup to open after a successful spin (showing the prize).",
      popupTurnOver: "string — id of the popup to open when the user has no turns left.",
      showCoupon: "boolean — display the winning coupon code in the result popup.",
      fontSize: "number — font size of segment labels.",
      widthText: "number — text wrap width in segment labels.",
      textAlign: "'left' | 'center' | 'right' — alignment of segment label text.",
      assignCoupon: "boolean — assign a specific coupon to the user after spin.",
    },
  },
  survey: {
    type: "survey", category: "marketing", container: false,
    summary: "Survey / image-choice question; each option submits a field.",
    useWhen: "Quizzes, preference capture, image pickers.",
    keySpecials: {
      type: "'text-image' | 'text' | (other) — layout variant; controls whether option images render.",
      multiOption: "boolean — allow selecting multiple options at once.",
      limitOption: "number — max selectable options when multiOption=true (oldest is ejected past the limit).",
      defaultOption: "array of option id strings to pre-select on load.",
      required: "boolean — require at least one selection before the form submits.",
      scrollAuto: "'yes' | (other) — horizontal auto-scroll strip mode (requires a form parent); also readable via config.scrollAuto.",
      field_name: "string — form field key these selections map to in the parent form's variation data.",
      connectedForm: "string — id of another form field element to receive the survey values (cross-form wiring; that field needs isConnectSurvey=true + connectedSurvey=this id).",
      showInputQuantity: "boolean — render a +/- quantity stepper inside each option (uses each option's min_quantity/max_quantity).",
      sprod_id: "string — product id when the survey acts as a WCart attribute selector.",
      sprod_attr: "string — product attribute name this survey selects (e.g. 'Color').",
      sprod_vals: "array of attribute value strings, one per option (indexed by option DOM order).",
      imageHeight: "number (px) — option image height.",
      imageWidth: "number (px) — option image width.",
      alignment: "'center' | 'left' | 'right' — option alignment within the wrapper.",
      selectedBackground: "CSS color — background of selected option cards.",
      selectedBorder: "CSS color — border of selected option cards.",
      hoveredBorder: "CSS color — border color on hover.",
      options: "array of option objects {id, field_name, title, image, value, min_quantity, max_quantity, toggleEvent, events_option:[], variations:[], attrOnly/prodId/attrName/attrVal/attrs, quantityOnly/quantityProd/quantityValue, params_value} — events_option supports showhide/collapse/custom_form_price/custom_form_discount/custom_form_shipping_fee/tcb_auto_banking. See docs/element-specials-reference.md for the full option schema.",
    },
  },
  "alertMessage": {
    type: "alertMessage", category: "marketing", container: false,
    summary: "INTERNAL UTILITY FUNCTION — not a placeable page element. alertMessage(type, content, duration) is a JS helper called by other renderers (form, upload, verify-code, input-datetime, etc.) to show a transient toast. It has no vm.specials and cannot be placed on a page. Do NOT generate an element node of this type.",
    useWhen: "Never — this is not a user-facing element. Do not place this type in a page or popup.",
    keySpecials: {},
  },
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
