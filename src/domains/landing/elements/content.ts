/**
 * Content element descriptors: the leaf elements that carry visible content —
 * text, lists, images, shapes, buttons, video, gallery, raw HTML.
 */
import type { ElementDescriptor } from "../../../core/descriptor.js";
import { seedPosition, setStyle, setBox, imgPlaceholder } from "../../../core/element.js";

export const CONTENT: ElementDescriptor[] = [
  {
    type: "text-block", category: "content", container: false, defaultName: "Text",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 200);
      el.specials.text = "hello world";
      el.specials.tag = "p";
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
  {
    type: "list-paragraph", category: "content", container: false, defaultName: "ListParagraph",
    summary: "Bulleted list. specials.text is a string of <li>…</li> items.",
    useWhen: "Feature checklists, benefit lists. One <li> per bullet.",
    keySpecials: {
      text: "string of <li>item</li><li>item</li>… (no <ul> wrapper). Bullet/icon styling lives in the per-breakpoint config, not specials: iconType ('shape'|'image'|'disc'|'circle'|'square'|'decimal'|'none'…), iconImage (SVG/URL), iconColor (rgba), iconFontSize, iconSize, iconTop, linePaddingLeft (text indent), linePaddingBottom (line spacing).",
      iconSize: "(config) bullet icon size.", linePaddingLeft: "(config) text indent.",
    },
    seed: (el) => {
      setBox(el, 400);
      el.responsive.desktop.config = { ...el.responsive.desktop.config, iconSize: 12, iconTop: 5, linePaddingLeft: 23 };
      el.responsive.mobile.config = { ...el.responsive.mobile.config, iconSize: 12, iconTop: 5, linePaddingLeft: 23 };
      el.specials.text = "<li>List Paragraph.</li><li>List Paragraph.</li><li>List Paragraph.</li>";
    },
  },
  {
    type: "image-block", category: "content", container: false, defaultName: "Image Block",
    summary: "Image. The editor renders the image from specials.src. config.overlay tints it.",
    useWhen: "Add images where a landing page would have them: hero/product shot, feature icons, about photo, logos. There is NO image API yet — set specials.src to a PLACEHOLDER URL sized to the box: https://placehold.co/<width>x<height>. NEVER leave src empty (it renders blank). The user replaces placeholders later.",
    keySpecials: {
      src: "image URL — REQUIRED. Use https://placehold.co/WxH (matching width×height) if you don't have a real image.",
      resize: "number — image crop behavior on resize; a value other than 300 triggers keep_solution (no-crop) mode.",
      enable_background_compare: "boolean — show a before/after image-comparison slider (companion config.backgroundCompare holds the second image).",
      overlay: "(config) overlay color rgba(...).",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 110, 80);
      setStyle(el, "position", "absolute");
      el.specials.imageCompression = true;
      el.specials.src = imgPlaceholder(600, 400);
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
  {
    type: "rectangle", category: "content", container: false, defaultName: "Rectangle",
    summary: "Colored block — divider, badge background, color band, card backdrop.",
    useWhen: "Backgrounds behind text/groups, dividers, decorative shapes. Style via background/borderRadius/boxShadow.",
    keySpecials: {},
    seed: (el) => {
      seedPosition(el);
      setBox(el, 100, 100);
    },
  },
  {
    type: "line", category: "content", container: false, defaultName: "Line",
    summary: "Horizontal rule / divider line.",
    useWhen: "Separating content rows.",
    keySpecials: {},
    seed: (el) => {
      setBox(el, 236);
    },
  },
  {
    type: "button", category: "content", container: false, defaultName: "Button",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.text = "Button";
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
  {
    type: "video", category: "content", container: false, defaultName: "Video",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 350, 200);
      el.specials.imageCompression = true;
      el.specials.img = imgPlaceholder(640, 360, "Video");
    },
  },
  {
    type: "gallery", category: "content", container: false, defaultName: "Gallery",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 350, 400);
      el.specials.media = [imgPlaceholder(600, 400, "1"), imgPlaceholder(600, 400, "2"), imgPlaceholder(600, 400, "3")];
      // gallery has NO children — content comes entirely from specials.media (gallery.js never reads vm.children)
    },
  },
  {
    type: "html-box", category: "content", container: false, defaultName: "HTML Box",
    summary: "Raw HTML embed. specials.html holds the markup (rendered via v-html).",
    useWhen: "Embedding third-party widgets or custom markup the standard elements can't express.",
    keySpecials: { html: "string — raw HTML content (the only content key; stored HTML-escaped, unescaped at render)." },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 280, 310);
      el.specials.html = "";
    },
  },
  {
    type: "editor-blog", category: "content", container: false, defaultName: "Editor blog",
    summary: "Long-form rich text / article body. specials.html holds the rich-text markup.",
    useWhen: "Blog/article content blocks.",
    keySpecials: { html: "string — rich-text HTML content (stored HTML-escaped, unescaped at render)." },
    seed: (el) => {
      el.responsive.mobile.styles.width = 340;
      el.responsive.mobile.styles.height = 303;
      el.responsive.desktop.styles.width = 800;
      el.responsive.desktop.styles.height = 124;
      el.responsive.mobile.styles.top = 0;
      el.responsive.mobile.styles.left = 0;
      el.responsive.desktop.styles.top = 0;
      el.responsive.desktop.styles.left = 0;
      el.specials.html = "";
    },
  },
];
