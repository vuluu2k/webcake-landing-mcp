/**
 * Port of assets/editor/factory.js `createElement`.
 * Produces a valid default element node (skeleton) for a given `type`, matching
 * the sizes / specials the real editor seeds. Used by the `new_element` tool so
 * Claude always starts from a structurally-correct node.
 */

export type Breakpoint = { config: Record<string, any>; styles: Record<string, any> };
export type ElementNode = {
  id: string;
  type: string;
  properties: Record<string, any>;
  responsive: { desktop: Breakpoint; mobile: Breakpoint };
  specials: Record<string, any>;
  runtime: Record<string, any>;
  events: any[];
  children?: ElementNode[];
};

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALNUM[Math.floor(Math.random() * ALNUM.length)];
  return s;
}

/** Types that carry a `children` array. */
export const CONTAINER_TYPES = new Set([
  "section",
  "dynamic_page",
  "group",
  "grid",
  "grid-item",
  "carousel",
  "slide",
  "popup",
  "form",
  "gallery",
  "checkbox-group",
  "radio",
  "group-select",
]);

/** Form input types that require a unique specials.field_name. */
export const FIELD_TYPES = new Set([
  "input",
  "textarea",
  "select",
  "checkbox",
  "checkbox-group",
  "radio",
  "address",
  "country-select",
  "quantity_input",
  "input-datetime",
  "input-file",
  "signature",
  "verify-code",
  "group-select-item",
]);

/** Default per-breakpoint animation block (matches real page_source). */
export function defaultAnimation() {
  return { name: "none", delay: 0, duration: 3, repeat: null };
}

function base(): ElementNode {
  return {
    id: randomId(),
    type: "",
    properties: { movable: true, sync: true },
    responsive: {
      desktop: { config: { notloaded: false, animation: defaultAnimation() }, styles: {} },
      mobile: { config: { notloaded: false, animation: defaultAnimation() }, styles: {} },
    },
    specials: {},
    runtime: {},
    events: [],
  };
}

/** Set the same style key on both breakpoints. */
function setStyle(el: ElementNode, key: string, value: any) {
  el.responsive.desktop.styles[key] = value;
  el.responsive.mobile.styles[key] = value;
}
/** Set width+height on both breakpoints. */
function setBox(el: ElementNode, w?: number, h?: number) {
  if (w != null) setStyle(el, "width", w);
  if (h != null) setStyle(el, "height", h);
}
/** Seed top/left = 0 on both breakpoints (absolute-positioned leaf inside a section). */
function seedPosition(el: ElementNode) {
  setStyle(el, "top", 0);
  setStyle(el, "left", 0);
}

/**
 * Create a default element node for `type`. Mirrors editor factory defaults.
 * `overrides.name` sets properties.name; unknown types still produce a valid node.
 */
export function createElement(type: string, overrides: { name?: string } = {}): ElementNode {
  const el = base();
  el.type = type;
  el.properties.name = overrides.name ?? defaultName(type);

  switch (type) {
    case "section":
      el.properties.movable = false;
      setStyle(el, "position", "relative");
      setBox(el, undefined, 800);
      el.children = [];
      el.specials.imageCompression = true;
      break;
    case "dynamic_page":
      el.properties.movable = false;
      setStyle(el, "position", "relative");
      setStyle(el, "height", 800);
      el.responsive.desktop.styles.width = 960;
      el.responsive.mobile.styles.width = 420;
      el.children = [];
      el.specials.imageCompression = true;
      break;
    case "text-block":
      seedPosition(el);
      setBox(el, 200);
      el.specials.text = "hello world";
      el.specials.tag = "p";
      break;
    case "list-paragraph":
      setBox(el, 400);
      el.responsive.desktop.config = { ...el.responsive.desktop.config, iconSize: 12, iconTop: 5, linePaddingLeft: 23 };
      el.responsive.mobile.config = { ...el.responsive.mobile.config, iconSize: 12, iconTop: 5, linePaddingLeft: 23 };
      el.specials.text = "<li>List Paragraph.</li><li>List Paragraph.</li><li>List Paragraph.</li>";
      break;
    case "group":
      seedPosition(el);
      setStyle(el, "position", "absolute");
      el.children = [];
      break;
    case "rectangle":
      seedPosition(el);
      setBox(el, 100, 100);
      break;
    case "line":
      setBox(el, 236);
      break;
    case "image-block":
      seedPosition(el);
      setBox(el, 110, 80);
      setStyle(el, "position", "absolute");
      el.specials.imageCompression = true;
      el.specials.src = "";
      break;
    case "button":
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.text = "Button";
      break;
    case "video":
      seedPosition(el);
      setBox(el, 350, 200);
      el.specials.imageCompression = true;
      break;
    case "gallery":
      seedPosition(el);
      setBox(el, 350, 400);
      el.specials.media = [];
      el.children = [];
      break;
    case "popup":
      el.properties.movable = false;
      setBox(el, 400, 250);
      el.children = [];
      break;
    case "form":
      seedPosition(el);
      setBox(el, 400, 250);
      el.children = [];
      el.specials.fb_event_type = "CompleteRegistration";
      el.specials.fb_conversion_value = "10000";
      el.specials.fb_tracking_currency = "VND";
      el.specials.tiktok_conversion_value = "10000";
      el.specials.tiktok_tracking_currency = "VND";
      break;
    case "input":
    case "input-datetime":
    case "input-file":
    case "country-select":
    case "checkbox":
    case "address":
    case "quantity_input":
    case "select":
    case "cart-quantity":
      seedPosition(el);
      setBox(el, 150, 36);
      if (FIELD_TYPES.has(type)) el.specials.field_name = `${type.replace(/-/g, "_")}_${el.id}`;
      break;
    case "signature":
      seedPosition(el);
      setBox(el, 150, 100);
      el.specials.field_name = `signature_${el.id}`;
      break;
    case "verify-code":
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `verify_${el.id}`;
      break;
    case "radio":
      seedPosition(el);
      setBox(el, 150);
      el.children = [];
      el.specials.field_name = `radio_${el.id}`;
      break;
    case "checkbox-group":
      seedPosition(el);
      el.children = [];
      el.specials.field_name = `checkbox_${el.id}`;
      break;
    case "textarea":
      seedPosition(el);
      setBox(el, 150, 50);
      el.specials.field_name = `textarea_${el.id}`;
      break;
    case "notify":
      seedPosition(el);
      setBox(el, 300, 62);
      break;
    case "countdown":
      seedPosition(el);
      setBox(el, 300, 80);
      setStyle(el, "color", "rgba(255, 255, 255, 1)");
      setStyle(el, "background", "rgba(0, 0, 0, 1)");
      setStyle(el, "fontSize", 20);
      el.specials = { type: "minute", duration: "60", showDay: true, showSecond: true, showText: true };
      break;
    case "timegroup":
      seedPosition(el);
      setBox(el, 240, 25);
      break;
    case "auto-number":
    case "random-number":
      seedPosition(el);
      setBox(el, 60, 80);
      break;
    case "editor-blog":
      el.responsive.mobile.styles.width = 340;
      el.responsive.mobile.styles.height = 303;
      el.responsive.desktop.styles.width = 800;
      el.responsive.desktop.styles.height = 124;
      el.responsive.mobile.styles.top = 0;
      el.responsive.mobile.styles.left = 0;
      el.responsive.desktop.styles.top = 0;
      el.responsive.desktop.styles.left = 0;
      break;
    case "html-box":
      seedPosition(el);
      setBox(el, 280, 310);
      break;
    case "spin-wheel":
      seedPosition(el);
      setBox(el, 400, 400);
      setStyle(el, "color", "rgba(255, 255, 255, 1)");
      break;
    case "carousel":
      seedPosition(el);
      el.responsive.desktop.config.slideWidth = 350;
      el.responsive.mobile.config.slideWidth = 350;
      setBox(el, 350, 400);
      el.children = [];
      break;
    case "slide":
      setBox(el, 350);
      el.properties.movable = false;
      el.children = [];
      break;
    case "grid":
      seedPosition(el);
      setBox(el, 400, 450);
      el.responsive.desktop.config.column = 2;
      el.responsive.desktop.config.row = 2;
      el.responsive.mobile.config.column = 2;
      el.responsive.mobile.config.row = 2;
      el.children = [];
      break;
    case "grid-item":
      setBox(el, 197, 222);
      el.properties.movable = false;
      el.children = [];
      break;
    case "table":
      seedPosition(el);
      setBox(el, 400, 210);
      break;
    case "cart-items":
      seedPosition(el);
      setBox(el, 233, 80);
      break;
    case "list-product":
      seedPosition(el);
      setBox(el, 400, 162);
      el.specials.format_title = "sku";
      el.specials.numerical_order = true;
      break;
    case "search-list-product":
      seedPosition(el);
      setBox(el, 400, 40);
      setStyle(el, "background", "rgba(246, 4, 87, 1)");
      setStyle(el, "color", "rgba(255,255,255,1)");
      break;
    case "group-select":
      el.children = [];
      break;
    case "group-select-item":
      el.specials.field_name = `gs_${el.id}`;
      break;
    case "survey":
      seedPosition(el);
      setBox(el, 300, undefined);
      setStyle(el, "textAlign", "center");
      el.specials = {
        imageHeight: 100,
        imageWidth: 100,
        multiOption: false,
        alignment: "center",
        options: [
          { id: randomId(), image: "", title: "Option 1", value: "value1", field_name: `sv_${el.id}_1` },
          { id: randomId(), image: "", title: "Option 2", value: "value2", field_name: `sv_${el.id}_2` },
        ],
        type: "text-image",
      };
      break;
    default:
      // Unknown / niche type: keep a generic, still-valid skeleton.
      seedPosition(el);
      setBox(el, 200, 100);
      if (CONTAINER_TYPES.has(type)) el.children = [];
      break;
  }

  return el;
}

function defaultName(type: string): string {
  const names: Record<string, string> = {
    section: "Section",
    "dynamic_page": "Dynamic page",
    "text-block": "Text",
    "list-paragraph": "ListParagraph",
    group: "Group",
    rectangle: "Rectangle",
    line: "Line",
    "image-block": "Image Block",
    button: "Button",
    video: "Video",
    gallery: "Gallery",
    popup: "Popup",
    form: "Form",
    input: "Input",
    "input-datetime": "Input datetime",
    "input-file": "Upload",
    "country-select": "Country select",
    checkbox: "Checkbox",
    "checkbox-group": "Checkbox Group",
    radio: "Radio",
    textarea: "Textarea",
    address: "Address",
    "quantity_input": "Quantity",
    select: "Select",
    signature: "Signature",
    "verify-code": "Verify code",
    notify: "Notify",
    countdown: "Count Down",
    timegroup: "Time Group",
    "auto-number": "Auto Number",
    "random-number": "Random Number",
    "editor-blog": "Editor blog",
    "html-box": "HTML Box",
    "spin-wheel": "Spin Wheel",
    carousel: "Carousel",
    slide: "Slide",
    grid: "Grid",
    "grid-item": "GridItem",
    table: "Table",
    "cart-items": "CartItems",
    "cart-quantity": "Cart Quantity",
    "list-product": "ListProduct",
    "search-list-product": "SearchListProduct",
    "group-select": "Group Select",
    "group-select-item": "Group Select Item",
    survey: "Survey",
  };
  return names[type] ?? type;
}

/** Default page-level settings (subset of the ~40 real keys; covers the essentials). */
export function defaultSettings(overrides: Record<string, any> = {}) {
  return {
    title: "",
    description: "",
    keywords: "",
    favicon: "",
    thumbnail: "",
    fontGeneral: "'Roboto', sans-serif",
    width_section: { desktop: 960, mobile: 420 },
    country: "84",
    fb_tracking_code: "",
    tiktok_script: "",
    global_track_ids: [],
    extra_css: "",
    extra_script: "",
    auto_save_draft: true,
    auto_save_info_user: false,
    send_info_to_thank_page: true,
    ...overrides,
  };
}

/**
 * Build a complete, empty top-level page source matching the real editor shape:
 * { page, popup, settings, options, cartConfigs }. Fill `page` with sections.
 */
export function createPageSource(opts: { settings?: Record<string, any>; mobileOnly?: boolean } = {}) {
  return {
    page: [] as ElementNode[],
    popup: [] as ElementNode[],
    settings: defaultSettings(opts.settings ?? {}),
    options: { currency: "VND", mobileOnly: opts.mobileOnly ?? false, versionID: null },
    cartConfigs: {},
  };
}
