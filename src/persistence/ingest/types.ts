/**
 * Shared runtime-free types for the HTML-ingest modules.
 */

export type IngestedCta = { text: string; href?: string };
export type IngestedFormField = { label?: string; type: string; name?: string; required?: boolean };

/**
 * Desktop section-height hint (px on the 960px canvas) so the rebuilt page's
 * vertical rhythm tracks the source instead of defaulting every band to 800.
 * basis:'css' — an explicit height/min-height was found for the section
 * (inline style or a stylesheet rule matching its id/class); `css` keeps the
 * raw value (e.g. "100vh"). basis:'estimate' — content-volume math.
 */
export type IngestedSizeHint = { height: number; basis: "css" | "estimate"; css?: string };

/**
 * full mode only: a composite-widget candidate (phone/device mockup, chat
 * thread, mini dashboard, browser frame…) — its raw HTML plus the stylesheet
 * rules that style it, so the model can rebuild it FAITHFULLY as ONE html-box
 * (inline the css into the html) instead of re-imagining it from a summary.
 */
export type IngestedWidget = { hint: string; html: string; css?: string };

/** A repeating card-like block detected in full mode. */
export type IngestedBlock = {
  icon?: string;   // an emoji/short badge text, OR an icon-font ref "ms:<name>" (Material Symbols, e.g. "ms:verified") / "fa:<name>" (Font Awesome). For ms:/fa: call get_icon_svg to resolve the real <svg>, then render it as a rectangle (svg in both breakpoints' config.svgMask + styles.background = icon color, square box) — the native Webcake icon.
  title?: string;
  body?: string;
  image?: string;
  cta?: { text: string; href?: string };
};

export type IngestedSection = {
  role:
    | "header"
    | "hero"
    | "features"
    | "about"
    | "form"
    | "cta"
    | "gallery"
    | "testimonials"
    | "pricing"
    | "faq"
    | "footer"
    | "unknown";
  heading?: string;
  subheading?: string;
  paragraphs?: string[];
  /** compact: string[]; full: { src: string; alt?: string }[] */
  images?: string[] | { src: string; alt?: string }[];
  ctas?: IngestedCta[];
  links?: { text: string; href: string }[];
  form_fields?: IngestedFormField[];
  /** full mode only */
  blocks?: IngestedBlock[];
  /** full mode only */
  lists?: string[];
  /** full mode only: composite widgets to rebuild as ONE html-box each */
  widgets?: IngestedWidget[];
  /** both modes: desktop height hint for the rebuilt Webcake section */
  size_hint?: IngestedSizeHint;
  /**
   * both modes: interaction effects detected in this section's hover/transition
   * utility classes (Tailwind `hover:`/`group-hover:`/`active:`), normalized to
   * the kinds Webcake can reproduce — "scale" (button grow), "image-zoom"
   * (group-hover image scale), "lift" (hover translate-y), "slide", "fade",
   * "underline", "shadow", "bg-color-change", "text-color-change",
   * "border-color-change". REPRODUCE these on the rebuilt elements: a hover
   * `change_color` event (change_color_type text/background/border) for the
   * color changes + underline, the button's hovered* specials or `animation_hover`
   * for scale/lift/zoom. Without this the cloned page is static (no hover).
   */
  hover_effects?: string[];
};

export type IngestedAst = {
  title?: string;
  description?: string;
  og_image?: string;
  language?: string;
  sections: IngestedSection[];
  colors?: string[];
  fonts?: string[];
  /** full & compact: named design-palette colors by token name — from CSS custom-properties AND, when the page is built on the Tailwind CDN with a `tailwind.config` (Google Stitch / Pancake-style output), the config's resolved `colors` map (e.g. primary→#a43b38, surface-container-low→#f3f3f3). Map utility classes (text-primary, bg-surface-container-low) back to these. */
  palette?: Record<string, string>;
  /**
   * full & compact: the design system lifted from a `tailwind.config` block when
   * present (Google Stitch / Tailwind-CDN pages put the WHOLE design system here,
   * not in CSS). Reproduce the page from these tokens — they're the spacing grid,
   * corner radii, and TYPE SCALE the original was laid out on. `font_size`/`spacing`
   * values are concrete px/rem (e.g. display-lg→48px, xl→80px), so a class like
   * `text-display-lg`/`py-xl` resolves to a real size.
   */
  design_tokens?: {
    spacing?: Record<string, string>;
    radius?: Record<string, string>;
    font_size?: Record<string, string>;
    font_family?: Record<string, string>;
  };
  /** full & compact: background-image URLs found in stylesheets + inline styles */
  background_images?: string[];
  /** full mode only */
  gradients?: string[];
  /**
   * Absolute-canvas builder exports only (LadiPage-family / Webcake-published
   * HTML, auto-detected): the machine-readable geometry payload — when present,
   * rebuild from THIS, element by element, instead of the role `sections`.
   */
  canvas?: IngestedCanvas;
  truncated?: boolean;
  warnings?: string[];
};

export type ParseHtmlOptions = {
  /**
   * Absolute-canvas mode only: return ONLY these canvas section ids (from a
   * previous call's canvas.sections[].id; "SECTION_POPUP" selects the popups).
   * Lets the caller re-fetch a truncated page section-by-section in full detail.
   */
  sections?: string[];
};

export type CanvasElement = {
  id: string;
  /** decoded from the id prefix: HEADLINE123 → headline, SPINLUCKY1 → spin_wheel… */
  type: string;
  /** px on the source canvas. fixed:true = position:fixed (floating/sticky element). */
  box?: { top?: number; left?: number; width?: number; height?: number; bottom?: number; right?: number; fixed?: boolean };
  text?: string;
  /** image URL from the element's background rule — CDN size prefix stripped (full-size original); re-host via upload_images. */
  src?: string;
  /**
   * image: the inner image-layer geometry when it differs from the element box —
   * the visible window into the full image (offset/zoom crop). Emulate with
   * background-position/size when the target element can't crop natively.
   */
  crop?: { top?: number; left?: number; width?: number; height?: number };
  /** entrance/attention animation from the builder's `.ladi-animation` rules: { name, duration?, delay?, "iteration-count"? }. */
  animation?: Record<string, string>;
  /** shape: the inline SVG markup (capped; the fill may also appear in style). */
  svg?: string;
  /** html_code / notify: raw embed HTML (capped). */
  html?: string;
  /** the element is an <a> in the source. */
  href?: string;
  /** whitelisted declarations from the element's stylesheet rules (typography, colors, borders, background…). */
  style?: Record<string, string>;
  /** form_item: the real <input>/<select>/<textarea> facts. */
  input?: { name?: string; placeholder?: string; input_type?: string; required?: boolean; pattern?: string };
  /** simplified builder events: { type: 'popup'|'section'|'link'|'phone', action: target }. */
  events?: { type: string; action: string }[];
  /** builder sticky-position keyword (bottom_left…) when the element is pinned. */
  sticky?: string;
  /** widget config from the event-data JSON (countdown_minute, thankyou_value, delay_popup_welcome_page, autoplay…). */
  config?: Record<string, unknown>;
  children?: CanvasElement[];
};

export type CanvasSection = {
  id: string;
  /** band height in px on the source canvas. */
  height?: number;
  /** background-* declarations of the band (background-image already a bare full-size URL). */
  background?: Record<string, string>;
  elements: CanvasElement[];
};

export type IngestedCanvas = {
  builder: "ladi";
  /** source canvas width: 420 (mobile) or 960 (desktop) — same as the Webcake canvas. */
  width: number;
  mobile_only?: boolean;
  sections: CanvasSection[];
  /** popup overlays — top-level in the Webcake model too (never nest them in page sections). */
  popups?: CanvasElement[];
  element_count: number;
  truncated?: boolean;
  /** present when truncated: how to re-fetch sections in full detail. */
  hint?: string;
};

export type FetchHtmlResult = { ok: boolean; html?: string; status?: number; error?: string };
