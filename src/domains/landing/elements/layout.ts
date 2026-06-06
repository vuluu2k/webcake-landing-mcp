/**
 * Layout / container element descriptors: the structural wrappers that hold
 * children (sections, groups, grids, carousels, popups). Each descriptor is the
 * single source for this element's docs, container flag, default name, and the
 * factory `seed` that stamps its editor defaults.
 */
import type { ElementDescriptor } from "../../../core/descriptor.js";
import { seedPosition, setStyle, setBox } from "../../../core/element.js";

export const LAYOUT: ElementDescriptor[] = [
  {
    type: "section", category: "layout", container: true, defaultName: "Section",
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
    seed: (el) => {
      el.properties.movable = false;
      setStyle(el, "position", "relative");
      setBox(el, undefined, 800);
      el.specials.imageCompression = true;
    },
  },
  {
    type: "dynamic_page", category: "layout", container: true, defaultName: "Dynamic page",
    summary: "Section bound to a dataset for dynamic/templated content (blog, product detail).",
    useWhen: "Building a page driven by a dataset record rather than static content.",
    keySpecials: { imageCompression: "boolean." },
    seed: (el) => {
      el.properties.movable = false;
      setStyle(el, "position", "relative");
      setStyle(el, "height", 800);
      el.responsive.desktop.styles.width = 960;
      el.responsive.mobile.styles.width = 420;
      el.specials.imageCompression = true;
    },
  },
  {
    type: "group", category: "layout", container: true, defaultName: "Group",
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
    seed: (el) => {
      seedPosition(el);
      setStyle(el, "position", "absolute");
    },
  },
  {
    type: "grid", category: "layout", container: true, defaultName: "Grid",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 450);
      el.responsive.desktop.config.column = 2;
      el.responsive.desktop.config.row = 2;
      el.responsive.mobile.config.column = 2;
      el.responsive.mobile.config.row = 2;
    },
  },
  {
    type: "grid-item", category: "layout", container: true, defaultName: "GridItem",
    summary: "A single cell inside a grid (movable:false; laid out by the grid).",
    useWhen: "Only as a direct child of grid.",
    keySpecials: {},
    seed: (el) => {
      setBox(el, 197, 222);
      el.properties.movable = false;
    },
  },
  {
    type: "carousel", category: "layout", container: true, defaultName: "Carousel",
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
    seed: (el) => {
      seedPosition(el);
      el.responsive.desktop.config.slideWidth = 350;
      el.responsive.mobile.config.slideWidth = 350;
      setBox(el, 350, 400);
    },
  },
  {
    type: "slide", category: "layout", container: true, defaultName: "Slide",
    summary: "One slide inside a carousel (movable:false).",
    useWhen: "Only as a direct child of carousel.",
    keySpecials: {
      src: "string (URL) — slide background image (built into a CSS background, same pattern as image-block).",
      resize: "number — background-image crop behavior on resize.",
    },
    seed: (el) => {
      setBox(el, 350);
      el.properties.movable = false;
    },
  },
  {
    type: "popup", category: "layout", container: true, defaultName: "Popup",
    summary: "Overlay popup. Hidden by default; opened/closed by events targeting its id.",
    useWhen: "Thank-you dialog, lead form modal, promo. Place popups at the top level of `page` and trigger via a button's open_popup event.",
    keySpecials: {
      src: "string (URL) — background image (built into a CSS background, same pattern as image-block).",
      resize: "number — background-image crop behavior on resize.",
      video_background_thumbnail: "string (URL) — video thumbnail; renders a .video-background div for a video background.",
    },
    seed: (el) => {
      el.properties.movable = false;
      setBox(el, 400, 250);
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
];
