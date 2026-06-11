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
    useWhen: "Always the outermost wrapper of any band of content (hero, features, pricing, footer…). One section per visual band. WARNING: globalSection:true renders the section EMPTY on a normal publish — never set it unless intentionally building a shared global section.",
    keySpecials: {
      globalSection: "boolean — mark as a reusable global section (e.g. shared header/footer). CAUTION: renders EMPTY on a normal page publish; only safe for intentional global-section flows.",
      globalSectionName: "name of the global section when globalSection=true.",
      custom_class: "extra CSS class; 'fixed'/'footer' influence role detection. Only applied when specials.customAdvance is truthy.",
      custom_css: "raw CSS string injected for this section. Only applied when specials.customAdvance is truthy.",
      customAdvance: "boolean — must be truthy for custom_class / custom_css to take effect.",
      imageCompression: "boolean — compress background images.",
      video_background: "string (URL) — muted/autoplay/loop background video URL. Renders a <video> element as the section background.",
      show_control_volume: "boolean — show a mute/unmute toggle on the video background.",
      video_background_thumbnail: "string (URL) — editor-only thumbnail for the video background (deleted at build; does NOT render on the published page).",
      pageLoadEvent: "enum 'none'|'auto-hide'|'auto-show' — controls section visibility on page load. 'auto-show': section is pre-hidden on build; after pageLoadEventDelay × loadDelayMultiplier ms it becomes visible. Any other non-'none' value hides the section. 'none' = normal visible.",
      pageLoadEventDelay: "number — delay value combined with loadDelayMultiplier (delay × multiplier ms) before applying pageLoadEvent.",
      loadDelayMultiplier: "number — unit for pageLoadEventDelay: 1=ms, 1000=s, 60000=min.",
      afterPageLoadEvent: "enum 'none'|'hide'|'show' — action taken after pageLoadEvent resolves.",
      afterPageLoadEventDelay: "number — delay value for afterPageLoadEvent (combined with afterLoadDelayMultiplier).",
      afterLoadDelayMultiplier: "number — unit for afterPageLoadEventDelay: 1=ms, 1000=s, 60000=min.",
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
    summary: "RENDERS BLANK on a normal page publish — children are dropped by the renderer. Only valid inside the dataset dynamic-page flow where the backend supplies a record context. Use section instead for all normal content.",
    useWhen: "Building a page driven by a dataset record (blog post, product detail) in the dedicated dynamic-page flow ONLY. Never use for static content — it renders blank on a normal publish.",
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
    summary: "Groups children so they move and position together (position:absolute). In cart contexts can also act as a product variation selector group. NOTE: a group's own background/border does NOT render on the live page — put a full-size rectangle as the FIRST child to carry visual styling.",
    useWhen: "Bundling an icon+text card, a badge cluster, or any reusable mini-layout you want to move as one. Also used in cart forms to bind a group of children to a specific product variant. For horizontal-scroll mobile strips set specials.scrollAuto:'yes'.",
    keySpecials: {
      sprod: "object {id: string} — product reference for variation selector mode. Lives on the GROUP itself.",
      ctype: "'field' | 'atc' — context type read from DESCENDANT elements inside the group (not on the group itself): 'field' = form field selector, 'atc' = add-to-cart trigger.",
      sprod_attr: "string — product attribute name read from DESCENDANT elements inside the group (e.g. 'Color', 'Size').",
      sprod_val: "string — attribute value read from DESCENDANT elements inside the group.",
      squantity: "number — quantity to add to cart (emitted only when svariant is also set).",
      svariant: "string — variant id override for add-to-cart; squantity is only emitted when this is also set.",
      scrollAuto: "'yes' — horizontal-scroll strip mode (group-auto-scroll: width 100%, left 0, overflow-x auto). Useful mobile pattern for image rows.",
    },
    seed: (el) => {
      seedPosition(el);
      setStyle(el, "position", "absolute");
    },
  },
  {
    type: "grid", category: "layout", container: true, defaultName: "Grid",
    summary: "Dataset-driven repeating grid. HIGH IMPACT: on publish every grid is hidden (opacity 0, off-canvas) until a successful dataset fetch (GET /datasets/<datasetId>). No/invalid datasetId → grid INVISIBLE on the live page. The editor renders all column×row cells with distinct content, but the published page renders ONLY children[0] as a clone template repeated per dataset record — editor content in cells #2+ is discarded live. Static card layouts must use groups, not grid.",
    useWhen: "Repeating cards driven by a dataset (blog list, product catalog, team directory). Always supply a valid specials.datasetId — without it the grid is permanently invisible live. For static card layouts use groups instead.",
    keySpecials: {
      datasetId: "string — REQUIRED for live rendering. Binds grid to an external dataset; each row renders one grid-item clone from children[0]. Missing/invalid → grid hidden on publish.",
      column: "(config) number of columns.",
      row: "(config) number of rows.",
      pagination: "(config) 0 = none | 1 = 'see more' button | 2 = auto-carousel/slide mode.",
      timeSlide: "(config) auto-slide interval in SECONDS when pagination=2 (default 2).",
      attributeId: "(on child text-block/image-block/button specials) string — bind that descendant element to a specific dataset column by attribute ID.",
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
    summary: "A single cell inside a grid (movable:false; laid out by the grid). NOTE: only children[0] (the first grid-item) is used as the clone template on the live published page — distinct content in other cells is editor-only and discarded live.",
    useWhen: "Only as a direct child of grid.",
    keySpecials: {},
    seed: (el) => {
      setBox(el, 197, 222);
      el.properties.movable = false;
    },
  },
  {
    type: "carousel", category: "layout", container: true, defaultName: "Carousel",
    summary: "Horizontal slider; children are slide. Visible box on publish = slideToShow × slideWidth px (the carousel's own styles.width is overridden by the renderer). Keep styles.width == slideToShow × slideWidth. Supports autoplay, center mode, dataset binding.",
    useWhen: "Testimonials, screenshots, or any swipeable set of slides. Use datasetId to drive slides from a dataset.",
    keySpecials: {
      slideWidth: "(config) width of each slide in px. Visible carousel width = slideToShow × slideWidth.",
      slideToShow: "(config) number of slides visible at once. Set styles.width = slideToShow × slideWidth.",
      centerMode: "(config) boolean — center the active slide with partial neighbors visible.",
      infinity: "(config) boolean — infinite loop.",
      showNavigation: "(config) boolean — show arrow buttons. Arrows auto-hide when slideToShow > slide count. arrowPosition: 'mid'|'top'|'bottom'|'custom' (+arrowLeftToLeft/arrowLeftToTop/arrowRightToRight/arrowRightToTop px). selectIcon: 'default'|'custom'; iconArrow: raw SVG; colorArrow: CSS color; arrowWidth/arrowHeight (default 25).",
      autoplayMode: "(config) 'off'|'start'|'repeat' — DEFAULT 'repeat' (autoplay ON). Disable with 'off'. NOT a boolean.",
      delayTimeMs: "(config) number (ms) — global autoplay interval between slides (default 5000).",
      transition: "(config) 'none'|'default'|'focus' — slide transition style.",
      transitionTime: "(config) number (ms) — transition duration (default 250).",
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
    summary: "One slide inside a carousel (movable:false). IMPORTANT: specials.src is DEAD on publish — background must be set via styles.background (e.g. 'center center/cover no-repeat url(...)'). Slide height is forced to 100% of the carousel; width must equal the parent carousel's slideWidth.",
    useWhen: "Only as a direct child of carousel.",
    keySpecials: {
      src: "DEAD on publish — ignored by the published renderer. Set the background via styles.background ('center center/cover no-repeat url(...)') instead.",
      resize: "number — background-image crop behavior on resize.",
    },
    seed: (el) => {
      setBox(el, 350);
      el.properties.movable = false;
    },
  },
  {
    type: "popup", category: "layout", container: true, defaultName: "Popup",
    summary: "Overlay popup (position:fixed). Hidden by default; opened/closed by events targeting its id. IMPORTANT: specials.src is DEAD on publish — use styles.background instead. video_background + config.overlay work like section.",
    useWhen: "Thank-you dialog, lead form modal, promo. Place popups at the top level of `page` (NOT nested inside sections) and trigger via a button's open_popup event. Backdrop click always closes the popup (not configurable). Opening a popup closes others unless the triggering element has specials.closePopupOther:false.",
    keySpecials: {
      position: "enum 'center'(default)|'top-left'|'top-center'|'top-right'|'center-left'|'center-right'|'bottom-left'|'bottom-center'|'bottom-right'|'custom'. 'custom' uses customTop/customLeft px offsets from the viewport (position:fixed).",
      customTop: "number (px) — top offset from viewport when position='custom'.",
      customLeft: "number (px) — left offset from viewport when position='custom'.",
      src: "DEAD on publish — ignored by the published renderer. Set the background via styles.background instead.",
      resize: "number — background-image crop behavior on resize.",
      video_background: "string (URL) — muted/autoplay/loop background video URL.",
      show_control_volume: "boolean — show a mute/unmute toggle on the video background.",
      video_background_thumbnail: "string (URL) — editor-only thumbnail (deleted at build; does NOT render on publish).",
      openInPage: "boolean — auto-open this popup when the page loads (after delayPopup seconds).",
      delayPopup: "number (SECONDS) — delay before auto-open when openInPage=true.",
      scrollTo: "string (section id) — auto-open when that section scrolls into view (overrides timer).",
      cancelAutoIfScrollTo: "boolean — cancel the openInPage timer when scrollTo fires first.",
      closePopupOther: "boolean — when false on the TRIGGERING element, opening this popup does not close other open popups.",
      maxHeight: "string — 'full_screen' → popup height 100vh (content >90vh scrolls internally).",
    },
    seed: (el) => {
      el.properties.movable = false;
      setBox(el, 400, 250);
    },
    // Example is in the SPARSE authoring shape — the server hydrates
    // properties/runtime/events/config from factory defaults on validate/persist.
    example: {
      id: "popthanks", type: "popup",
      properties: { name: "Thank you" },
      responsive: {
        desktop: { styles: { width: 420, height: 220, background: "rgba(255,255,255,1)", borderRadius: "12px" } },
        mobile: { styles: { width: 360, height: 220, background: "rgba(255,255,255,1)", borderRadius: "12px" } },
      },
      children: [
        { id: "popclose", type: "button",
          responsive: {
            desktop: { styles: { top: 150, left: 160, width: 100, height: 40, background: "rgba(76,175,80,1)", color: "rgba(255,255,255,1)", borderRadius: "8px", textAlign: "center" } },
            mobile: { styles: { top: 150, left: 130, width: 100, height: 40, background: "rgba(76,175,80,1)", color: "rgba(255,255,255,1)", borderRadius: "8px", textAlign: "center" } },
          },
          specials: { text: "Đóng" },
          events: [{ id: "ev1", type: "click", action: "close_popup", target: "popthanks" }] },
      ],
    },
  },
];
