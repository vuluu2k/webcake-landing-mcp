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
    useWhen: "Any headline, paragraph, label. Use tag h1/h2 for headings, p for body. Style via responsive.styles (fontSize, color, fontWeight, textAlign). ALWAYS set color to CONTRAST the band it sits on: near-black (e.g. rgba(26,32,44,1)) on light bands, near-white ONLY on a dark/image band — white text on a light band renders invisible. styles.background on a text-block = a GRADIENT TEXT FILL (emits -webkit-text-fill-color:transparent); you must also set styles['-webkitBackgroundClip']:'text' or the glyphs go invisible. The box background key is styles.backgroundTxt — use that for a colored box behind the text. NEVER set styles.background expecting a box fill. text-block does NOT emit border-radius — for a rounded pill/badge, put a rectangle (borderRadius '13px', pill bg color) BEHIND the text-block (zIndex 2 on the text-block); the rounded shape comes from the rectangle, never from the text-block itself.",
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
      backgroundTxt: "(styles key) box background color rgba(...) — use this for a colored box behind the text. Do NOT use styles.background for a box fill; that key activates gradient text-fill mode.",
      "-webkitBackgroundClip": "(styles key) set to 'text' when styles.background is a gradient — without it the gradient text-fill makes glyphs invisible.",
      virtualHeight: "(config, per breakpoint, px) — live overrides height:auto with this value. If set it must be ≥ the rendered text height or live clips the text. Optional.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 200);
      el.specials.text = "hello world";
      el.specials.tag = "p";
    },
    // Examples are in the SPARSE authoring shape — the server hydrates
    // properties/runtime/events/config from factory defaults on validate/persist.
    example: {
      id: "headline1", type: "text-block",
      responsive: {
        desktop: { styles: { top: 80, left: 180, width: 600, fontSize: 44, fontWeight: "bold", color: "rgba(26,32,44,1)", textAlign: "center" } },
        mobile: { styles: { top: 60, left: 20, width: 380, fontSize: 28, fontWeight: "bold", color: "rgba(26,32,44,1)", textAlign: "center" } },
      },
      specials: { text: "Bán hàng dễ hơn với Webcake", tag: "h1" },
    },
  },
  {
    type: "list-paragraph", category: "content", container: false, defaultName: "ListParagraph",
    summary: "Bulleted list. specials.text is a string of <li>…</li> items. specials.text is REQUIRED — if omitted the live renderer renders the literal string 'undefined'.",
    useWhen: "Feature checklists, benefit lists. One <li> per bullet. Always set iconSize and linePaddingLeft together — the live renderer defaults are iconSize=40 (very large) and linePaddingLeft=0 (text overlaps bullet). A safe starting config: iconSize:12, iconTop:5, linePaddingLeft:23.",
    keySpecials: {
      text: "string of <li>item</li><li>item</li>… (no <ul> wrapper). REQUIRED — missing text renders the literal string 'undefined' on the live page.",
      iconType: "(config, per breakpoint) 'shape' | 'image' | 'disc' | 'circle' | 'square' | 'decimal' | 'none'… — 'shape' uses an SVG mask colored by iconColor, 'image' uses a background image URL. Live default: 'shape'.",
      iconImage: "(config, per breakpoint) SVG string (must start with '<svg', no leading whitespace — leading whitespace triggers a URL fetch) or image URL when iconType='image'.",
      iconColor: "(config, per breakpoint) rgba(...) — bullet color when iconType='shape'. Live default: black.",
      iconSize: "(config, per breakpoint) bullet icon size in px. Live default: 40 (very large) — always set this explicitly, e.g. 12.",
      iconTop: "(config, per breakpoint) vertical offset for the bullet icon in px. Live default: 0. Use ~4–6 to vertically align with text.",
      linePaddingLeft: "(config, per breakpoint) text indent in px. Live default: 0 (text overlaps bullet) — always set this explicitly to ≥ iconSize+4, e.g. 23.",
      linePaddingBottom: "(config, per breakpoint) line spacing in px.",
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
    summary: "Image. The LIVE published page paints the image from styles.background (exportCss.js) — the server automatically derives this from specials.src on every expand (create/update/validate). specials.src is the EDITOR key; always set it and let the server keep both in sync. config.overlay tints the image.",
    useWhen: "Add images where a landing page would have them: hero/product shot, feature icons, about photo, logos. Set specials.src to the image URL. Use https://placehold.co/WxH?text=Label if you don't have a real image. NEVER leave src empty — it renders blank on the live page.",
    keySpecials: {
      src: "image URL — REQUIRED. The editor reads this key; the server derives styles.background (the live renderer's key) automatically from it: 'center center/ cover no-repeat scroll content-box url(<src>) border-box'. If you hand-write styles.background it must contain url(...). Use https://placehold.co/WxH if no real image.",
      keep_solution: "boolean — true = no-crop CDN resize (preserves aspect ratio); false = crop to box. Live reads config.keep_solution ?? specials.keep_solution. The editor's 'resize' key is editor-only sugar for this — set keep_solution directly.",
      widthBgImage: "(config) CDN width for the background image crop — defaults to the element's styles.width.",
      heightBgImage: "(config) CDN height for the background image crop — defaults to the element's styles.height.",
      topBgImage: "(config) vertical crop offset in px — default 0.",
      leftBgImage: "(config) horizontal crop offset in px — default 0.",
      enable_background_compare: "boolean — show a before/after image-comparison slider (companion config.backgroundCompare holds the second image).",
      overlay: "(config) overlay tint color rgba(...). Gradient border recipe: set styles.borderColor to linear-gradient/radial-gradient AND styles.borderImage to activate a gradient-border underlay.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 110, 80);
      setStyle(el, "position", "absolute");
      el.specials.imageCompression = true;
      el.specials.src = imgPlaceholder(600, 400);
      // Stamp styles.background from the placeholder src so the live renderer
      // paints the image even before the normalization pass (seed is the baseline).
      const bg = `center center/ cover no-repeat scroll content-box url(${imgPlaceholder(600, 400)}) border-box`;
      el.responsive.desktop.styles.background = bg;
      el.responsive.mobile.styles.background = bg;
    },
    example: {
      id: "hero_img", type: "image-block",
      responsive: {
        desktop: {
          styles: {
            top: 40, left: 540, width: 360, height: 300, position: "absolute",
            background: "center center/ cover no-repeat scroll content-box url(https://placehold.co/360x300?text=Product) border-box",
          },
        },
        mobile: {
          styles: {
            top: 260, left: 60, width: 300, height: 240, position: "absolute",
            background: "center center/ cover no-repeat scroll content-box url(https://placehold.co/300x240?text=Product) border-box",
          },
        },
      },
      specials: { src: "https://placehold.co/360x300?text=Product", imageCompression: true },
    },
  },
  {
    type: "rectangle", category: "content", container: false, defaultName: "Rectangle",
    summary: "Colored block — divider, badge background, color band, card backdrop. Also doubles as an SVG icon/shape via per-breakpoint config.svgMask: set a raw <svg> string there and the renderer applies it as a mask; the shape color comes entirely from styles.background. Can also hold a CDN-resized image as a clipped background (styles.background with url(...)). Gradient border: set styles.borderColor to a linear/radial-gradient AND styles.borderImage — the renderer activates the gradient-border underlay. config.overlay adds a tint layer on top of a background image.",
    useWhen: "Backgrounds behind text/groups, dividers, decorative shapes. Style via background/borderRadius/boxShadow. LEAF — it must NEVER have children (validation blocks it): for a card, wrap a group around it and make this the group's full-size FIRST child as the backdrop. For feature/benefit icons, USE THIS with config.svgMask + a brand-colored styles.background INSTEAD of emoji characters in text — it looks far more professional and scales cleanly on all devices.",
    keySpecials: {
      svgMask: "(config, per breakpoint) — raw <svg viewBox='…'>…</svg> string. The renderer base64-encodes it and applies it as -webkit-mask-image on the element; the shape color comes from styles.background (solid rgba or gradient). The SVG's own fill/stroke colors are IGNORED — only painted pixels (alpha) matter, so the SVG must paint via fill or stroke to produce a silhouette. Aspect: the published renderer force-inserts preserveAspectRatio='none' (SVG stretches to the box) but the editor preview keeps the SVG's own aspect ratio — so ALWAYS match the box aspect to the viewBox aspect (square box for a square viewBox) or editor and live render differently. Use single quotes for SVG attributes to avoid JSON-escaping noise. Set on BOTH desktop and mobile config or mobile renders a plain rectangle.",
      overlay: "(config) tint layer rgba(...) drawn on top of the background image.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 100, 100);
    },
    example: {
      id: "icon_star", type: "rectangle",
      responsive: {
        desktop: {
          styles: { top: 40, left: 456, width: 48, height: 48, background: "rgba(34,197,94,1)" },
          config: { svgMask: "<svg viewBox='0 0 24 24'><path fill='black' d='M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 7.1-1.01z'/></svg>" },
        },
        mobile: {
          styles: { top: 40, left: 186, width: 48, height: 48, background: "rgba(34,197,94,1)" },
          config: { svgMask: "<svg viewBox='0 0 24 24'><path fill='black' d='M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 7.1-1.01z'/></svg>" },
        },
      },
      specials: {},
    },
  },
  {
    type: "line", category: "content", container: false, defaultName: "Line",
    summary: "Horizontal rule / divider line. The visible line is the TOP border only: the base CSS zeroes left/right/bottom borders. Thickness is styles.borderWidth (NOT styles.height — height is auto). The .line-css class adds padding:8px 0 so the line sits 8px below the element's top. Color via styles.borderColor; style via styles.borderStyle.",
    useWhen: "Separating content rows. Always set borderWidth, borderStyle, and borderColor — without them the line renders as an invisible element.",
    keySpecials: {},
    seed: (el) => {
      setBox(el, 236);
      el.responsive.desktop.styles.borderWidth = 1;
      el.responsive.desktop.styles.borderStyle = "solid";
      el.responsive.desktop.styles.borderColor = "rgba(208,213,221,1)";
      el.responsive.mobile.styles.borderWidth = 1;
      el.responsive.mobile.styles.borderStyle = "solid";
      el.responsive.mobile.styles.borderColor = "rgba(208,213,221,1)";
    },
  },
  {
    type: "button", category: "content", container: false, defaultName: "Button",
    summary: "Clickable button. Label in specials.text; behavior in the events array. Supports the same template variable system as text-block ({{today}}, {{cart_total_price}}, {{formId__fieldName}}, etc.).",
    useWhen: "Every CTA. Add a click event: open_link (to URL), open_popup (lead modal), scroll_to (anchor). Inside a form, a button submits the form. Hover color changes: use the modern change_color action with change_color_type:'text'|'background'|'border'|'reset' — the legacy change_background (--hover-color var) and change_text_color (--hover-text var) actions are broken on published pages because the CSS variables are never defined at publish time.",
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
      responsive: {
        desktop: { styles: { top: 300, left: 405, width: 150, height: 44, background: "rgba(246,4,87,1)", color: "rgba(255,255,255,1)", borderRadius: "8px", textAlign: "center", fontWeight: "bold" } },
        mobile: { styles: { top: 200, left: 135, width: 150, height: 44, background: "rgba(246,4,87,1)", color: "rgba(255,255,255,1)", borderRadius: "8px", textAlign: "center", fontWeight: "bold" } },
      },
      specials: { text: "Đăng ký ngay" },
      events: [{ id: "ev_cta", type: "click", action: "scroll_to", target: "form_section" }],
    },
  },
  {
    type: "video", category: "content", container: false, defaultName: "Video",
    summary: "Video player (YouTube/Vimeo/upload/CDN). Required specials by typeVideo: 'youtube' → specials.id REQUIRED (YouTube videoId); 'vimeo' → specials.video REQUIRED (full Vimeo URL); 'webcake' → specials.video REQUIRED (missing causes a video.replace TypeError that breaks the page); 'upload'/other → specials.video (src = video_cdn || video). Poster: first url() in styles.background takes precedence over specials.img — a flat background color (no url()) suppresses the img poster. specials.videoFit default 'cover'; false = 'contain'. showControl default-off hides Vimeo controls entirely.",
    useWhen: "Demo or promo videos. Set specials.img to a poster placeholder (https://placehold.co/640x360) when there's no real thumbnail. Do NOT set a flat styles.background color — it suppresses the poster image.",
    keySpecials: {
      typeVideo: "'youtube' | 'vimeo' | 'webcake' | 'upload' — video source type. REQUIRED to match the right specials keys below.",
      id: "string — YouTube video ID. REQUIRED when typeVideo='youtube'. Example: 'dQw4w9WgXcQ'.",
      video: "string — full video URL. REQUIRED when typeVideo='vimeo' (full Vimeo page URL, e.g. https://vimeo.com/123456) or typeVideo='webcake' (missing crashes the page with TypeError). For 'upload' / other CDN types this is the raw video file URL.",
      video_cdn: "string — CDN video URL or identifier (for 'upload'/'webcake' types; renderer uses video_cdn ?? video as source).",
      img: "string — poster/thumbnail image URL. Use a placeholder if none: https://placehold.co/640x360. Overridden by the first url() in styles.background — do NOT set a flat styles.background color or the poster is suppressed.",
      videoFit: "string — 'cover' (default, fills box) | false (contain, shows letterbox).",
      autoReplay: "boolean — loop the video.",
      showControl: "boolean — show player controls (default off; when off, Vimeo controls are entirely hidden).",
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
    summary: "Multi-image/video gallery with thumbnail strip. Content comes entirely from specials.media — this is NOT a container and has no children. config.showThumbnail is tri-state: when UNSET the editor hides thumbnails but the live renderer shows an 80px strip overlapping the main image — always set it explicitly.",
    useWhen: "Photo grids/galleries with several images or videos. No image API — fill specials.media with placeholder image objects (see media). NEVER use plain URL strings — the gallery reads item.link and renders blank for a string. Video items: use typeVideo 'youtube' or 'webcake' (NOT 'upload' — renders an empty item); set item.type:'video' so the play-overlay and zoom/lightbox fire correctly.",
    keySpecials: {
      media: "array of media OBJECTS (NOT plain URLs — the gallery reads item.link). Image item: {type:'image', link:'<url>', linkVideo:'', typeVideo:'youtube', imageCompression:true}. Video item: {type:'video', link:'<poster-url>', linkVideo:'<video-url>', typeVideo:'youtube'|'webcake', imageCompression:true} — item.type must be 'video' for the play-overlay and lightbox to fire; typeVideo 'upload' renders an empty item on live.",
      showThumbnail: "(config) boolean — show the thumbnail strip. ALWAYS set explicitly: when unset the live renderer shows an 80px strip overlapping the main image while the editor hides it. Default when set: true (thumbnailWidth/Height:80, distanceAmong:10, position:bottom, distanceToGallery:10).",
      allowZoom: "'off' | 'carousel' | 'lightbox' — (config) zoom/lightbox mode when clicking an image.",
      showNavigation: "boolean — (config) show prev/next navigation arrows.",
      thumbnailAutoplay: "number (ms) | 'off' — (config) auto-advance thumbnails; delay default 3000ms. Starts only when thumbnailAutoplay != 'off' AND thumbnailAutoplayRepeat is truthy.",
      thumbnailAutoplayRepeat: "boolean — (config) loop thumbnail autoplay. Required alongside thumbnailAutoplay for autoplay to start.",
      thumbnailPosition: "'top' | 'bottom' | 'left' | 'right' — (config) position of the thumbnail strip relative to the main image.",
      thumbnailWidth: "number — (config) width of each thumbnail in px. Default 80.",
      thumbnailHeight: "number — (config) height of each thumbnail in px. Default 80.",
      distanceAmong: "number — (config) gap between thumbnails in px. Default 10.",
      distanceToGallery: "number — (config) gap between thumbnail strip and main image in px. Default 10.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 350, 400);
      // gallery media items are OBJECTS, not strings — the renderer reads item.link
      // (a plain URL string renders blank). Shape mirrors the editor's seed.
      el.specials.media = [1, 2, 3].map((n) => ({
        type: "image",
        link: imgPlaceholder(600, 400, String(n)),
        linkVideo: "",
        typeVideo: "youtube",
        imageCompression: true,
      }));
      // Always set showThumbnail explicitly — unset causes the live renderer to
      // overlay an 80px strip on the main image even though the editor hides it.
      el.responsive.desktop.config = { ...el.responsive.desktop.config, showThumbnail: true };
      el.responsive.mobile.config = { ...el.responsive.mobile.config, showThumbnail: true };
      // gallery has NO children — content comes entirely from specials.media (gallery.js never reads vm.children)
    },
  },
  {
    type: "html-box", category: "content", container: false, defaultName: "HTML Box",
    summary: "Raw HTML embed. specials.html holds the markup stored HTML-escaped (unescaped at render via v-html). Contrast with editor-blog which stores html RAW. Embedded <iframe> is auto-stretched to 100%×100% of the box. Wrapper height is FIXED to styles.height — content taller than the box overflows. &nbsp; in the stored value becomes a space at render. Use unescape-safe HTML (e.g. '&lt;' → the literal character '<' after unescape).",
    useWhen: "Embedding third-party widgets or custom markup the standard elements can't express.",
    keySpecials: { html: "string — raw HTML content stored HTML-escaped (e.g. '&lt;p&gt;Hello&lt;/p&gt;'); the renderer unescapes it before injecting via v-html. The wrapper height is FIXED to styles.height — content that is taller overflows the box. An embedded <iframe> is auto-stretched to 100%×100% of the box." },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 280, 310);
      el.specials.html = "";
    },
  },
  {
    type: "editor-blog", category: "content", container: false, defaultName: "Editor blog",
    summary: "Long-form rich text / article body. specials.html holds the rich-text markup stored RAW (NOT escaped). Contrast with html-box which stores escaped HTML. The publisher injects specials.html raw with NO unescape — storing escaped HTML causes the live page to display literal '&lt;p&gt;' text instead of rendered markup. Live wrapper height is FIXED to styles.height (the editor shows auto) — a long article overflows the band; set a generous height.",
    useWhen: "Blog/article content blocks. Set styles.height to a generous value (≥ the rendered article height) — content taller than the box overflows the live page silently.",
    keySpecials: { html: "string — rich-text HTML content stored RAW (not escaped). Store exactly what you want the browser to render — e.g. '<p>Hello</p>' not '&lt;p&gt;Hello&lt;/p&gt;'. Storing escaped HTML causes the live page to display literal tag strings. The live wrapper height is FIXED to styles.height — set generously." },
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
