# Webcake Element Specials Reference

This document is the authoritative, comprehensive catalog of every Webcake element type: the exact `specials`, `config`, and notable `style` keys each element reads at runtime.

**Derivation:** All key names and allowed values are drawn directly from the `render_v4` renderer source files (`.js` / `.vue`). File:line citations are preserved throughout. The MCP's concise live version lives in the element descriptors under `src/domains/landing/elements/` (the per-type `keySpecials`, derived into the `LIBRARY` catalog); `get_element` exposes it at tool-call time. This document is richer — it covers every key the renderer actually reads, including those absent from the descriptors.

**How to use:** When creating or editing a page element, consult the element's section below for the full list of valid specials. Cross-cutting keys (sticky, animation, hide/lock, notification, custom tracking) apply to every element and are documented once in §1.

---

## Table of Contents

1. [Cross-Cutting Keys](#1-cross-cutting-keys)
   - 1.1 [Universal Config Keys (all elements)](#11-universal-config-keys-all-elements)
   - 1.2 [Universal Specials (select element types)](#12-universal-specials-select-element-types)
2. [Shared Option-Object Schema](#2-shared-option-object-schema)
3. [Layout / Container Elements](#3-layout--container-elements)
   - 3.1 [section](#31-section)
   - 3.2 [group](#32-group)
   - 3.3 [popup](#33-popup)
   - 3.4 [slide](#34-slide)
   - 3.5 [grid-item](#35-grid-item)
   - 3.6 [dynamic_page](#36-dynamic_page)
4. [Content / Media Elements](#4-content--media-elements)
   - 4.1 [image-block](#41-image-block)
   - 4.2 [editor-blog](#42-editor-blog)
   - 4.3 [html-box](#43-html-box)
   - 4.4 [list-paragraph](#44-list-paragraph)
   - 4.5 [rectangle](#45-rectangle)
   - 4.6 [line](#46-line)
5. [Form & Input Elements](#5-form--input-elements)
   - 5.1 [form](#51-form)
   - 5.2 [input](#52-input)
   - 5.3 [textarea](#53-textarea)
   - 5.4 [select](#54-select)
   - 5.5 [checkbox-group](#55-checkbox-group)
   - 5.6 [radio](#56-radio)
   - 5.7 [address](#57-address)
   - 5.8 [country-select](#58-country-select)
   - 5.9 [quantity_input](#59-quantity_input)
   - 5.10 [input-datetime](#510-input-datetime)
   - 5.11 [input-file](#511-input-file)
   - 5.12 [signature](#512-signature)
   - 5.13 [verify-code](#513-verify-code)
   - 5.14 [group-select](#514-group-select)
   - 5.15 [group-select-item](#515-group-select-item)
6. [Commerce Elements](#6-commerce-elements)
   - 6.1 [list-product](#61-list-product)
   - 6.2 [search-list-product](#62-search-list-product)
   - 6.3 [cart-items](#63-cart-items)
   - 6.4 [cart-quantity](#64-cart-quantity)
   - 6.5 [table](#65-table)
   - 6.6 [product-select — STUB](#66-product-select--stub)
7. [Marketing Elements](#7-marketing-elements)
   - 7.1 [survey](#71-survey)
8. [Stub / Non-Functional Types](#8-stub--non-functional-types)
9. [Phantom Keys](#9-phantom-keys)
10. [Persistence Model](#10-persistence-model)

---

## 1. Cross-Cutting Keys

### 1.1 Universal Config Keys (all elements)

These keys live in `responsive[display].config` and apply to **every** element type. Source: `ElementWrapper.vue:256–327`, `sticky/index.js:14–25,193–194`.

**Sticky family:**

| Config key | Type / Values | Meaning |
|---|---|---|
| `sticky` | boolean | Enable sticky/fixed-scroll behavior |
| `stickyPosition` | `'t-l'` \| `'t-c'` \| `'t-r'` \| `'b-l'` \| `'b-c'` \| `'b-r'` \| `'l-c'` \| `'r-c'` \| `'flex'` \| `'a-t'` \| `'a-b'` | Anchor position when sticky |
| `stickyTop` | number (px) | Distance from top edge when sticking |
| `stickyBottom` | number (px) | Distance from bottom edge when sticking |
| `stickyLeft` | number (px) | Left offset (for `l-*` / `r-*` positions) |
| `stickyRight` | number (px) | Right offset |
| `stickyHeight` | number (px) | Override element height when sticky |
| `stickyWidth` | number (px) | Override element width when sticky |
| `stickyFlex` | `'left'` \| `'right'` | Flex positioning side |
| `stickyLR` | number (px) | Offset for the `stickyFlex` side |
| `stickyUnpinAtSection` | string (element id) | Single section id where sticky disengages |
| `stickyUnpinAtSections` | string[] | Multiple section ids to unpin at |

**Visibility / editor state:**

| Config key | Type | Meaning |
|---|---|---|
| `hide` | boolean | 10% opacity in editor; hidden at runtime |
| `lock` | boolean | Lock element from editing in the editor |
| `notloaded` | boolean | Suppresses initial render until triggered |

**Animation:**

| Config key | Type | Meaning |
|---|---|---|
| `animation` | object | Entrance animation. Shape: `{ name: string, delay: number, duration: number, repeat: null \| number }`. Default: `{ name: "none", delay: 0, duration: 3, repeat: null }`. |

**Animation renderer contract (enforced by `validate_page`):**

- Animations only run on these 9 element types: `group`, `image-block`, `text-block`, `rectangle`, `button`, `countdown`, `line`, `list-paragraph`, `notify`. Source: `landing_page_build/render/build/animate.js`. Any other type with `name != "none"` produces a broken CSS selector — the element renders stuck in its pre-animation (dim/hidden) state permanently.
- `name` must be a value from the editor's animate.css set (see `landing_page_backend/assets/editor/main/traits/TraitAnimation.vue`). Common entrance families: `fadeIn*`, `slideIn*`, `zoomIn*`, `bounceIn*`, `backIn*`, `flipIn*`, `lightSpeedIn*`, `rotateIn*`, `rollIn`, `jackInTheBox`; attention seekers: `bounce`, `pulse`, `tada`, `wobble`, `jello`, `heartBeat`. An unknown name means the keyframe never runs; `validate_page` reports an error.
- **`styles.opacity`** — do NOT use `opacity < 1` for a "muted" or "subtle" look. `exportCss.js` emits `opacity:<v>` as a permanent CSS rule; the element AND all its content render faded forever. Use `rgba()` alpha on the `color` or `background` property instead. `validate_page` warns when `opacity < 1`.

**Notification / floating badge:**

| Config key | Type / Values | Meaning |
|---|---|---|
| `notiPos` | `'default'` \| `'t-l'` \| `'t-c'` \| `'t-r'` \| `'b-l'` \| `'b-c'` \| `'b-r'` | Notify element position anchor |
| `notiTop` | number | Offset from top for noti badge |
| `notiBottom` | number | Offset from bottom for noti badge |
| `notiLeft` | number | Offset from left for noti badge |
| `notiRight` | number | Offset from right for noti badge |

### 1.2 Universal Specials (select element types)

These specials keys are read by `event/index.js` (`measureClick`) and `lazyload/index.js:208,210,215` on: `button`, `text-block`, `image-block`, `rectangle`, `group`.

| Specials key | Type | Meaning |
|---|---|---|
| `isCustomTracking` | boolean | Enable custom Facebook Pixel tracking on click / viewport entry |
| `customTracking` | string | Tracking function body (compiled and called by `compileTrackingFn`). The element must also have CSS class `has-custom-tracking` for lazyload to register viewport-entry FB tracking. |

---

## 2. Shared Option-Object Schema

The `select`, `checkbox-group`, `radio`, and `survey` elements all use the same rich option object shape. The MCP `LIBRARY` currently describes options only as "array" — this is the complete schema. Sources: `select.js:27–166`, `checkbox-group.js:164–281`, `radio.js:51–368`, `survey.js:51–513`.

```jsonc
{
  "id": "string",          // unique option id; must match DOM <option id="…">
  "name": "string",        // display label (select / checkbox-group / radio)
  "title": "string",       // display label (survey)
  "image": "string",       // image URL (survey image-choice mode)
  "value": "string",       // submitted value (survey)
  "field_name": "string",  // per-option field name (survey only)

  // Product variation binding
  "variations": [{ "id": "string", "quantity": number, "price": number }],

  // Attribute-only mode (sets a product attribute, not a variation)
  "attrOnly": false,
  "prodId": "string",       // product id for attrOnly
  "attrName": "string",     // attribute name for attrOnly
  "attrVal": "string",      // attribute value for attrOnly
  "attrs": [{ "prodId": "string", "name": "string", "value": "string" }], // multi-attr override

  // Quantity-only mode (adjusts product quantity, not variation)
  "quantityOnly": false,
  "quantityProd": "string", // product id for quantityOnly
  "quantityValue": number,  // quantity to set

  // Order tags
  "tags": ["string"],

  // Event control
  "toggleEvent": true,      // false = skip this option's event handling
  "events_option": [        // side-effects on select / deselect
    {
      "id": "string",
      "type": "showhide | collapse | custom_form_price | custom_form_discount | custom_form_shipping_fee | tcb_auto_banking | xendit_banking | onepay_banking | mercadopago_banking | vnpay_banking | paymongo_banking | stripe_banking | paypal_banking | momopay_banking",

      // For showhide / collapse:
      "promoId": "string",         // target element id (showhide / collapse) OR payment account id (banking events)

      // For custom price events (custom_form_price / custom_form_discount / custom_form_shipping_fee):
      "custom_price": number,
      "custom_price_name": "string",

      // For tcb_auto_banking:
      "transfer_content": "string",
      "failed_payment_callback": "string",
      "supplier": "string",
      "discountCode": "string",
      "productName": "string",
      "timeRedirect": number,

      // For other banking events (xendit / onepay / mercadopago):
      "paymentType": "string",

      "toggleEvent": true
    }
  ],

  // Survey quantity-per-option (showInputQuantity mode)
  "min_quantity": 1,
  "max_quantity": 10,

  // Survey product-attribute extras
  "params_value": number
}
```

**Payment gateway event type → sets payment method to:**

| `type` | Sets payment to | Evidence |
|---|---|---|
| `tcb_auto_banking` | `storecake_tcb` | checkbox-group.js:216–221; radio.js:287–298 |
| `xendit_banking` | `xendit` | radio.js:299–307 |
| `onepay_banking` | `onepay` | radio.js:308–316 |
| `mercadopago_banking` | `mercado_pago` | radio.js:317–325 |
| `vnpay_banking` | `vnpay` | radio.js:326–333 |
| `paymongo_banking` | `paymongo` | radio.js:334–341 |
| `stripe_banking` | `stripe` | radio.js:342–349 |
| `paypal_banking` | `paypal` | radio.js:350–357 |
| `momopay_banking` | `momopay` | radio.js:358–365 |

Note: `tcb_auto_banking` is supported in `checkbox-group`, `radio`, and `survey`. The other banking types are supported in `radio` only.

---

## 3. Layout / Container Elements

### 3.1 `section`

**Identity:** type `"section"` · container: Yes · field_name: No

Sections are the page's top-level layout roots. All other elements live as children inside sections.

**Specials:**

| Key | Type / Values | Meaning | Evidence |
|---|---|---|---|
| `pageLoadEvent` | `'show'` \| `'hide'` | Show or hide this section on page load after a delay | section.js |
| `pageLoadEventDelay` | number (ms) | Delay before applying `pageLoadEvent` | section.js |
| `loadDelayMultiplier` | number | Multiplier applied to `pageLoadEventDelay` (delay × multiplier) | section.js |
| `afterPageLoadEvent` | `'show'` \| `'hide'` | Action to take after `pageLoadEvent` completes | section.js |
| `afterPageLoadEventDelay` | number (ms) | Delay for `afterPageLoadEvent` | section.js |
| `afterLoadDelayMultiplier` | number | Multiplier for `afterPageLoadEventDelay` | section.js |
| `globalSection` | boolean | Mark as a global/shared section synced across pages | Section.vue |
| `globalSectionName` | string | Name identifier for the global section | Section.vue |
| `imageCompression` | boolean | Enable CDN image compression for background image | factory.ts |
| `resize` | number | Controls image crop behavior when section has a background image (same semantics as `image-block`) | Section.vue |
| `video_background_thumbnail` | string (URL) | URL of video thumbnail; renders a `.video-background` div with this as background | Section.vue |
| `boxShadow` | string (CSS) | Section box-shadow (also consumed by `sticky/index.js:33` for sticky shadow) | sticky/index.js:33 |

**Notable config keys:**

| Config key | Meaning |
|---|---|
| `overlay` | Overlay color/gradient div rendered over background |
| `position` | `'relative'` — sections are flow-positioned, not absolute |
| `height` | Section height in px (default 800) |

**Realistic example:**

```json
{
  "id": "sec_hero",
  "type": "section",
  "properties": { "name": "Hero Section" },
  "responsive": {
    "desktop": {
      "config": { "position": "relative", "height": 700, "overlay": null },
      "styles": { "background": "center center/ cover no-repeat url(https://cdn.example.com/bg.jpg)" }
    },
    "mobile": {
      "config": { "position": "relative", "height": 400 },
      "styles": { "background": "#ffffff" }
    }
  },
  "specials": {
    "imageCompression": true,
    "pageLoadEvent": "show",
    "pageLoadEventDelay": 500,
    "loadDelayMultiplier": 1
  },
  "children": []
}
```

---

### 3.2 `group`

**Identity:** type `"group"` · container: Yes · field_name: No

A general-purpose container. When `specials.sprod` is set and `window.isActiveCart` is true, activates WCart product binding.

**Specials:**

| Key | Type / Values | Meaning | Evidence |
|---|---|---|---|
| `sprod` | `{ id: string, ... }` | Connected product. When set with `window.isActiveCart`, activates cart binding. DOM attribute `product-connect` is set when this key is present. | group.js; Group.vue |
| `ctype` | `'field'` \| `'atc'` | Cart role of this group or a child group: `'field'` = attribute selector, `'atc'` = add-to-cart trigger | group.js |
| `sprod_attr` | string | Product attribute key this group controls (e.g. `'color'`, `'size'`) | group.js |
| `sprod_val` | string | Selected value for `sprod_attr` | group.js |
| `squantity` | number | Quantity to add to cart (read by the `add_to_cart` event handler) | event/index.js |
| `svariant` | string | Variant id override for add-to-cart | event/index.js |
| `isCustomTracking` | boolean | Custom FB Pixel tracking on click | event/index.js |
| `customTracking` | string | FB tracking function body | event/index.js |

The `add_to_cart` event action reads `event.sprod_id OR vm.specials.sprod.id`, `event.svariant OR vm.specials.svariant`, `event.squantity OR vm.specials.squantity`.

**Realistic example:**

```json
{
  "id": "grp_product_card",
  "type": "group",
  "properties": { "name": "Product Card" },
  "responsive": {
    "desktop": { "config": { "position": "absolute", "top": 200, "left": 100, "width": 300, "height": 400 }, "styles": {} },
    "mobile":  { "config": { "position": "absolute", "top": 120, "left": 10,  "width": 390, "height": 350 }, "styles": {} }
  },
  "specials": {
    "sprod": { "id": "prod_123" },
    "ctype": "atc",
    "squantity": 1
  },
  "children": []
}
```

---

### 3.3 `popup`

**Identity:** type `"popup"` · container: Yes · field_name: No

Popups are overlay containers shown/hidden by `open_popup` / `close_popup` event actions from other elements.

**Specials:**

| Key | Type / Values | Meaning | Evidence |
|---|---|---|---|
| `src` | string (URL) | Background image URL (same auto-built CSS background pattern as image-block) | Popup.vue |
| `resize` | number | Controls background image crop behavior | Popup.vue |
| `video_background_thumbnail` | string (URL) | Video thumbnail URL; renders `.video-background` div | Popup.vue |
| `imageCompression` | boolean | CDN image compression for background | pattern from image-block |

**Notable config keys:**

| Config key | Type | Meaning |
|---|---|---|
| `overlay` | object \| string | Overlay color/gradient rendered over background |
| `movable` | boolean | Whether popup can be dragged; default `false` |
| `width` | number (px) | Popup width |
| `height` | number (px) | Popup height |

**Realistic example:**

```json
{
  "id": "popup_thanks",
  "type": "popup",
  "properties": { "name": "Thank You Popup" },
  "responsive": {
    "desktop": {
      "config": { "position": "absolute", "width": 600, "height": 400, "movable": false, "overlay": null },
      "styles": { "background": "#ffffff", "borderRadius": "12px", "boxShadow": "0 8px 40px rgba(0,0,0,0.3)" }
    },
    "mobile": {
      "config": { "position": "absolute", "width": 360, "height": 320 },
      "styles": { "borderRadius": "8px" }
    }
  },
  "specials": { "src": null, "resize": 300 },
  "children": []
}
```

---

### 3.4 `slide`

**Identity:** type `"slide"` · container: Yes · field_name: No · parent: must be child of `carousel`

**Specials:**

| Key | Type | Meaning | Evidence |
|---|---|---|---|
| `src` | string (URL) | Slide background image URL | CarouselSlide.vue |
| `resize` | number | Background image crop behavior | CarouselSlide.vue |

**Notable config keys:** `movable: false` (slides are not user-repositionable), `width` (inherited from carousel), `height` (slide height in px).

**Realistic example:**

```json
{
  "id": "slide_001",
  "type": "slide",
  "properties": { "name": "Slide 1" },
  "responsive": {
    "desktop": {
      "config": { "position": "absolute", "movable": false, "width": 960, "height": 500 },
      "styles": { "background": "center center/ cover no-repeat url(https://cdn.example.com/slide1.jpg)" }
    },
    "mobile": {
      "config": { "position": "absolute", "movable": false, "width": 420, "height": 300 },
      "styles": {}
    }
  },
  "specials": { "src": "https://cdn.example.com/slide1.jpg", "resize": 300 },
  "children": []
}
```

---

### 3.5 `grid-item`

**Identity:** type `"grid-item"` · container: Yes · field_name: No · parent: child of `grid`

`GridItem.vue` reads zero specials. This element is entirely position/style-driven. No specials to document.

**Realistic example:**

```json
{
  "id": "grid_item_001",
  "type": "grid-item",
  "properties": { "name": "Grid Cell 1" },
  "responsive": {
    "desktop": { "config": { "position": "absolute", "top": 0, "left": 0, "width": 300, "height": 200 }, "styles": {} },
    "mobile":  { "config": { "position": "absolute", "top": 0, "left": 0, "width": 420, "height": 160 }, "styles": {} }
  },
  "specials": {},
  "children": []
}
```

---

### 3.6 `dynamic_page`

**Identity:** type `"dynamic_page"` · container: Yes · field_name: No

**Specials:**

| Key | Type | Meaning | Evidence |
|---|---|---|---|
| `imageCompression` | boolean | CDN image compression for any background images | library.ts |

`properties.thumbnail` is auto-managed by the editor on change; it is a `properties` field, not a `specials` key.

**Realistic example:**

```json
{
  "id": "dynpage_001",
  "type": "dynamic_page",
  "properties": { "name": "Product Template", "thumbnail": "https://cdn.example.com/thumb.png" },
  "responsive": {
    "desktop": { "config": { "position": "absolute", "top": 0, "left": 0, "width": 960, "height": 600 }, "styles": {} },
    "mobile":  { "config": { "position": "absolute", "top": 0, "left": 0, "width": 420, "height": 400 }, "styles": {} }
  },
  "specials": { "imageCompression": true },
  "children": []
}
```

---

## 4. Content / Media Elements

### 4.1 `image-block`

**Identity:** type `"image-block"` · container: No · field_name: No

**Specials:**

| Key | Type / Values | Meaning | Evidence |
|---|---|---|---|
| `src` | string (URL) | Image URL; auto-built into CSS background shorthand: `center center/ cover no-repeat scroll content-box url(${src}) border-box` | ImageBlock.vue |
| `imageCompression` | boolean | Enable CDN image compression/optimization | factory.ts; library.ts |
| `enable_background_compare` | boolean | Show image-comparison slider (reveals `.image-background-compare` div + `.image-compare-line` divider) | ImageBlock.vue; image-block.js |
| `resize` | number | When `!= 300`, triggers `keep_solution` config key; controls whether image crops on resize | ImageBlock.vue |
| `isCustomTracking` | boolean | Enable custom FB Pixel tracking on click | event/index.js |
| `customTracking` | string | FB tracking function body | event/index.js; lazyload/index.js |

**Notable config keys:**

| Config key | Type | Meaning |
|---|---|---|
| `overlay` | object \| string | Overlay color/gradient rendered as `.overlay` div atop the image |
| `backgroundCompare` | string (CSS background) | Second image CSS background string for the comparison overlay; required companion to `enable_background_compare` |
| `svgMask` | string (SVG or URL) | Apply `-webkit-mask-image` polygon clip |
| `topBgImage` | number (%) | Background-position-y for image |
| `leftBgImage` | number (%) | Background-position-x for image |
| `widthBgImage` | number (%) | Background-size width |
| `heightBgImage` | number (%) | Background-size height |
| `constrainProportions` | boolean | Lock aspect ratio on resize |
| `keep_solution` | boolean | Auto-set when `resize != 300` |

**Events (element `events` array):**

| Event type / action | Key fields | Meaning |
|---|---|---|
| click → `open_link` | `targetURL`, `open_link_with_params` (boolean), `send_to_thank_page` (boolean), `delayTime` (ms) | Opens a URL on click |
| click → `lightbox` | `id` (target element id), `typeLightbox` (`'image'`\|`'video'`\|etc.), `target` (URL), `alt` (caption string — event field, not specials) | Opens lightbox overlay |
| viewport → `delay` | `action` (`'show_element'`\|`'hide_element'`), `target` (element id), `timeout` (ms), `delay_multiplier` (default 1000) | Triggers show/hide on viewport entry | 

Source: `event/index.js`, `lazyload/index.js:171–188`.

**Realistic example:**

```json
{
  "id": "img_hero",
  "type": "image-block",
  "properties": { "name": "Hero Image" },
  "responsive": {
    "desktop": {
      "config": {
        "position": "absolute", "top": 120, "left": 200, "width": 560, "height": 380,
        "overlay": { "background": "rgba(0,0,0,0.3)" },
        "svgMask": null, "backgroundCompare": null, "constrainProportions": true
      },
      "styles": {
        "background": "center center/ cover no-repeat scroll content-box url(https://cdn.example.com/hero.jpg) border-box",
        "borderRadius": "8px", "boxShadow": "0 4px 20px rgba(0,0,0,0.2)"
      }
    },
    "mobile": {
      "config": { "position": "absolute", "top": 60, "left": 10, "width": 400, "height": 220 },
      "styles": { "background": "center center/ cover no-repeat scroll content-box url(https://cdn.example.com/hero-mobile.jpg) border-box" }
    }
  },
  "specials": {
    "src": "https://cdn.example.com/hero.jpg",
    "imageCompression": true,
    "enable_background_compare": false,
    "resize": 300
  },
  "events": [
    { "id": "ev1", "type": "click", "action": "open_link", "targetURL": "https://example.com/products", "open_link_with_params": false }
  ]
}
```

---

### 4.2 `editor-blog`

**Identity:** type `"editor-blog"` · container: No · field_name: No · height: Auto

`EditorBlog.vue` renders `specials.html` with `v-html`. Height is content-driven (auto).

**Specials:**

| Key | Type | Meaning | Evidence |
|---|---|---|---|
| `html` | string (HTML) | Rich text HTML content stored HTML-escaped, unescaped at render time | EditorBlog.vue |

**Realistic example:**

```json
{
  "id": "blog_content",
  "type": "editor-blog",
  "properties": { "name": "Blog Article" },
  "responsive": {
    "desktop": {
      "config": { "position": "absolute", "top": 120, "left": 80, "width": 800 },
      "styles": { "fontSize": "16px", "fontFamily": "Georgia, serif", "color": "#222222", "lineHeight": "1.8" }
    },
    "mobile": {
      "config": { "position": "absolute", "top": 80, "left": 10, "width": 400 },
      "styles": { "fontSize": "14px" }
    }
  },
  "specials": {
    "html": "<h1>Article Title</h1><p>Lorem ipsum dolor sit amet, <strong>consectetur adipiscing</strong> elit.</p><ul><li>Point one</li><li>Point two</li></ul>"
  }
}
```

---

### 4.3 `html-box`

**Identity:** type `"html-box"` · container: No · field_name: No

`HTMLBox.vue` renders `specials.html` via `v-html`. No lazyload entry.

**Specials:**

| Key | Type | Meaning | Evidence |
|---|---|---|---|
| `html` | string (HTML) | Raw HTML content stored HTML-escaped, unescaped at render time | HTMLBox.vue |

**Realistic example:**

```json
{
  "id": "html_embed",
  "type": "html-box",
  "properties": { "name": "Custom HTML Embed" },
  "responsive": {
    "desktop": {
      "config": { "position": "absolute", "top": 200, "left": 200, "width": 560, "height": 400 },
      "styles": { "borderRadius": "8px", "overflow": "hidden" }
    },
    "mobile": {
      "config": { "position": "absolute", "top": 120, "left": 10, "width": 400, "height": 300 },
      "styles": {}
    }
  },
  "specials": {
    "html": "<div class='custom-embed'><script src='https://example.com/widget.js'><\/script></div>"
  }
}
```

---

### 4.4 `list-paragraph`

**Identity:** type `"list-paragraph"` · container: No · field_name: No · height: Auto

**Specials:**

| Key | Type | Meaning | Evidence |
|---|---|---|---|
| `text` | string (HTML) | HTML string containing `<li>` items, stored HTML-escaped and unescaped at render | ListParagraph.vue; source_tools.ex |

**Notable config keys** (all in `responsive[display].config`):

| Config key | Type / Values | Meaning | Evidence |
|---|---|---|---|
| `iconType` | `'shape'` \| `'image'` \| `'disc'` \| `'circle'` \| `'square'` \| `'decimal'` \| `'upper-roman'` \| `'lower-roman'` \| `'upper-alpha'` \| `'lower-alpha'` \| `'none'` | List marker style; `'shape'` = SVG from `iconImage`, `'image'` = raster from `iconImage` | ListParagraph.vue |
| `iconImage` | string (SVG or URL) | SVG markup or image URL for the list icon | ListParagraph.vue |
| `iconColor` | string (rgba) | Color of icon when `iconType == 'shape'` | ListParagraph.vue |
| `iconTop` | number (px) | Vertical offset for the icon marker | ListParagraph.vue; factory.ts |
| `iconSize` | number (px) | Size of the icon marker bounding box | factory.ts |
| `iconFontSize` | number (px) | Font size of CSS counter characters (disc, decimal, etc.) | ListParagraph.vue |
| `linePaddingLeft` | number (px) | Left padding of each list item (indent from icon); default 23 | factory.ts |
| `linePaddingBottom` | number (px) | Bottom padding of each list item (line spacing) | ListParagraph.vue |
| `virtualHeight` | number | Auto-computed for parent height calculations | ListParagraph.vue |

**Realistic example:**

```json
{
  "id": "lst_features",
  "type": "list-paragraph",
  "properties": { "name": "Feature List" },
  "responsive": {
    "desktop": {
      "config": {
        "position": "absolute", "top": 200, "left": 100, "width": 400,
        "iconType": "shape",
        "iconSize": 16, "iconTop": 4, "iconFontSize": 14,
        "iconImage": "<svg viewBox='0 0 16 16'><circle cx='8' cy='8' r='6' fill='currentColor'/></svg>",
        "iconColor": "rgba(0,120,212,1)",
        "linePaddingLeft": 28, "linePaddingBottom": 8
      },
      "styles": { "fontSize": "16px", "color": "#333333", "lineHeight": "1.6" }
    },
    "mobile": {
      "config": { "position": "absolute", "top": 120, "left": 10, "width": 390, "iconSize": 14, "linePaddingLeft": 22 },
      "styles": { "fontSize": "14px" }
    }
  },
  "specials": {
    "text": "<li>Free shipping on orders over $50</li><li>30-day money-back guarantee</li><li>24/7 customer support</li>"
  }
}
```

---

### 4.5 `rectangle`

**Identity:** type `"rectangle"` · container: No · field_name: No

No dedicated renderer in `render_v4/src/elements/`; on viewport entry `lazyload` calls `fbEventTracking(vm)`. Rectangle is purely style-driven.

**Specials:**

| Key | Type | Meaning | Evidence |
|---|---|---|---|
| `isCustomTracking` | boolean | Enable custom FB Pixel tracking on viewport entry | lazyload/index.js; event/index.js |
| `customTracking` | string | FB tracking function body | same |

**Notable config keys:**

| Config key | Meaning |
|---|---|
| `overlay` | Overlay color rendered as `.overlay` div atop the background |
| `svgMask` | SVG or URL → sets `-webkit-mask-image` for polygon clipping |

Source: `Rectangle.vue`.

**Realistic example:**

```json
{
  "id": "rect_divider",
  "type": "rectangle",
  "properties": { "name": "Colored Box" },
  "responsive": {
    "desktop": {
      "config": { "position": "absolute", "top": 400, "left": 0, "width": 960, "height": 4, "overlay": null, "svgMask": null },
      "styles": { "background": "linear-gradient(90deg, #ff6b6b, #4ecdc4)", "borderRadius": "2px" }
    },
    "mobile": {
      "config": { "position": "absolute", "top": 280, "left": 0, "width": 420, "height": 3 },
      "styles": { "background": "#ff6b6b" }
    }
  },
  "specials": {}
}
```

---

### 4.6 `line`

**Identity:** type `"line"` · container: No · field_name: No · height: Auto

`WLine.vue` renders all `responsive[display].styles`. No specials. Entirely style-driven.

**Notable config key:**

| Config key | Meaning |
|---|---|
| `virtualHeight` | Auto-computed for layout/height calculation |

**Notable style keys:**

| Style key | Typical use |
|---|---|
| `borderTopWidth` | Line thickness |
| `borderTopStyle` | `'solid'` \| `'dashed'` \| `'dotted'` \| `'double'` \| etc. |
| `borderTopColor` | Line color |
| `width` | Line width (often 100%) |
| `transform` | Rotate for diagonal lines |

**Realistic example:**

```json
{
  "id": "line_divider",
  "type": "line",
  "properties": { "name": "Section Divider" },
  "responsive": {
    "desktop": {
      "config": { "position": "absolute", "top": 300, "left": 80, "width": 800 },
      "styles": { "borderTopWidth": "2px", "borderTopStyle": "solid", "borderTopColor": "#e0e0e0" }
    },
    "mobile": {
      "config": { "position": "absolute", "top": 200, "left": 20, "width": 380 },
      "styles": { "borderTopWidth": "1px", "borderTopStyle": "dashed", "borderTopColor": "#cccccc" }
    }
  },
  "specials": {}
}
```

---

## 5. Form & Input Elements

### 5.1 `form`

**Identity:** type `"form"` · container: **Yes** (reads `vm.children`) · field_name: No (children have field_name)

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `form_type` | `"login"` \| undefined | When `"login"`: submit calls access-key flow instead of the form-data API | — | form.js:63,733 |
| `submit_success` | `1` \| `2` | `1` = open success popup; `2` = redirect to thank-page URL | `1` | form.js:1005,1184,1548,1617 |
| `popup_target` | string (element id) | Id of popup to open when `submit_success=1` | `"__popup_default__"` | form.js:1548 |
| `redirect_url` | string (URL) | URL to redirect to after success when `submit_success=2` | — | form.js:1187,1563 |
| `target_url` | `"_self"` \| `"_blank"` | Window target for the redirect / payment callback | `"_self"` | form.js:1187,1563,1605 |
| `open_link_with_params` | boolean | Merge current page URL query params into `redirect_url` | `false` | form.js:1187,1563,1589 |
| `merge_sub_form_data` | boolean | Merge previous form's `form_data_id` as `sub_form_id` on redirect | `true` | form.js:912,1563,1617,1717 |
| `extra_url` | string (URL) | Post-submit app / bot / WhatsApp URL (for `app_target` modes other than `botcake`) | — | form.js:1328,1617,1638,1654,1700,1737 |
| `app_target` | `"botcake"` \| `"whatsapp"` \| `"mess_prefill"` \| `"tiktok_prefill"` \| `"line_prefill"` \| `"botcake_dynamic"` \| `"others"` | Which app to open after submit | `"botcake"` | form.js:1617,1623 |
| `wa_custom_text` | string | Custom message template for WhatsApp / Messenger / TikTok / LINE prefill. Supports `{{field_name}}` placeholders | `"Confirm order {{phone_number}}"` | form.js:1639,1655,1671 |
| `line_OA_id` | string | LINE Official Account ID (used with `app_target="line_prefill"`) | — | form.js:1671 |
| `botcake_dynamic_ref` | string | Ref parameter appended to `m.me/…` URL when `app_target="botcake_dynamic"` | — | form.js:1680,1688 |
| `others_link_params` | array of `{key: elementId, name: string}` | Field-to-URL-param mappings when `app_target="others"` | — | form.js:1617,1748 |
| `partnerServiceId` | string | Sent as `partner_service_id` in API call (partner/affiliate tracking) | — | form.js:834,2740 |
| `fb_event_type` | string (`"CompleteRegistration"` \| `"Purchase"` \| `"Lead"` \| `"none"` \| …) | Facebook Pixel standard event to fire on submit | `"CompleteRegistration"` | form.js:475,526,749,853,936 |
| `fb_conversion_value` | string (numeric) | Conversion value for FB Pixel event | `"10000"` | form.js:501,760 |
| `fb_tracking_currency` | string (`"VND"`, `"USD"`, …) | Currency for FB Pixel conversion value | `"VND"` | form.js:496,751,771 |
| `fb_custom_tracking` | string | Custom FB Pixel event name fired additionally (calls `fbq('trackCustom', …)`) | — | form.js:475,534,752,958 |
| `tiktok_event_type` | string (`"CompleteRegistration"` \| `"none"` \| …) | TikTok Pixel event to fire on submit | — | form.js:479,530,750,861,947 |
| `tiktok_conversion_value` | string (numeric) | Conversion value for TikTok Pixel | `"10000"` | form.js:507,761 |
| `tiktok_tracking_currency` | string | Currency for TikTok conversion value | `"VND"` | form.js:490,754,772 |
| `event_name_custom` | string \| `"none"` | Custom FB + gtag event name fired on submit (calls `fbq('trackCustom', …)` + `gtag('event', …)`) | — | form.js:475,517,748,935 |
| `ggc_id` | string | Google Ads conversion tag ID (single-conversion mode) | — | form.js:101,105,480,554,979 |
| `ggc_label` | string | Google Ads conversion label | — | form.js:481,555,755,980 |
| `ggc_v` | string / number | Google Ads conversion value | — | form.js:482,512,756,795 |
| `ggc_c` | string | Google Ads conversion currency override | — | form.js:483,497,757,773 |
| `google_conversion_mode` | `"single_conversion"` \| `"multi_conversion"` \| `"none"` | Whether to fire one or multiple Google Ads conversions per submit | `"single_conversion"` | form.js:102,106,484,553,759,977 |
| `ggc_list` | array of `{ggc_id, ggc_label, ggc_v, ggc_c}` | List of Google Ads conversions for `multi_conversion` mode | `[]` | form.js:102,106,481,559,756,983 |
| `multiForm` | boolean | Marks this form as a child form (submit copies data into `multiFormParent`) | — | form.js:134,145 |
| `multiFormParent` | string (form element id) | Id of the parent form this child form syncs into | — | form.js:130,133,145,354 |
| `customArrangementSheet` | boolean | If true, the field list order in the backend spreadsheet is determined by `sheetOrder` | — | form.js:2787 |
| `sheetOrder` | array of `{id: string}` | Custom order of child element ids for sheet column arrangement | — | form.js:2787,2788 |

**Form events array — `type: "error"` actions** (fired when form validation fails, form.js:1422–1443):

| `action` | Effect | Extra fields |
|---|---|---|
| `"open_popup"` | Opens popup | `target` = popup id |
| `"close_popup"` | Closes popup | `target` = popup id |
| `"show_hide_element"` | Toggles element visibility | `target` = element id; `onlyMode` |

**Form events array — `type: "success"` actions** (fired after successful submit, form.js:1445–1539):

| `action` | Effect | Extra fields |
|---|---|---|
| `"phone_call"` | `window.location = 'tel:' + target` | `target` = phone number |
| `"open_sms"` | Opens SMS compose | `target` = phone; `smsBody` = message body |
| `"send_email"` | Opens mailto | `target` = email address |
| `"open_link"` | Opens URL | `target` = URL; `targetURL` = `"_blank"` \| `"_self"` |
| `"scroll_to"` | Scrolls to element | `target` = element id; `scrollMore` = extra px offset |
| `"open_popup"` | Opens popup | `target` = popup id |
| `"close_popup"` | Closes popup | `target` = popup id |
| `"download_file"` | Downloads file | `target` = file URL; `nameFile` = filename |
| `"show_hide_element"` | Toggles visibility | `target` = element id; `onlyMode` = `"show"` \| `"hide"` |
| `"show_section"` | Shows section | `target` = section id |
| `"hide_section"` | Hides section | `target` = section id |
| `"close_webview"` | Closes FB/MS webview | — |
| `"change_tab"` | Switches tab | `target` = container id; `moveTo` = direction; `tabIndex` = index |

Note: redirect-triggering success actions (`phone_call`, `open_sms`, `send_email`, `open_link`, `close_webview`) cause an extra `sleep(1000)` before the handler runs (form.js:1002–1006).

**Realistic example:**

```json
{
  "id": "form_lead",
  "type": "form",
  "properties": { "name": "Lead Form", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": { "animation": { "name": "none", "delay": 0, "duration": 3, "repeat": null } }, "styles": { "top": 200, "left": 280, "width": 400, "height": 300 } },
    "mobile":  { "config": { "animation": { "name": "none", "delay": 0, "duration": 3, "repeat": null } }, "styles": { "top": 200, "left": 10,  "width": 400, "height": 300 } }
  },
  "specials": {
    "submit_success": 1,
    "popup_target": "popup_thanks",
    "fb_event_type": "CompleteRegistration",
    "fb_conversion_value": "0",
    "fb_tracking_currency": "VND",
    "tiktok_event_type": "none",
    "tiktok_conversion_value": "0",
    "tiktok_tracking_currency": "VND",
    "google_conversion_mode": "none",
    "app_target": "botcake",
    "merge_sub_form_data": true
  },
  "events": [
    { "id": "ev_success", "type": "success", "action": "open_popup", "target": "popup_thanks" }
  ],
  "children": []
}
```

---

### 5.2 `input`

**Identity:** type `"input"` · container: No · field_name: **Required**

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted data key. Special-cased values: `"phone_number"` → phone validation; `"coupon"` → publishes `form_info_change` on change; `"address"` → activates detect-address; `"postal_code"` → activates postcode lookup; `"recheck_phone_number"` → must match the phone_number field | `"input_<id>"` | input.js:48,54,207,225,227,245 |
| `field_placeholder` | string | HTML placeholder text | — | form.js:2798 |
| `field_type` | `"text"` \| `"email"` \| `"phone"` \| `"number"` \| `"postal_code"` \| `"date"` | Determines input type and validation behavior. `"postal_code"` activates postcode-detect helper and sends `postal_country_code` to API | — | form.js:1788,2610,2612,2135 |
| `required` | boolean | Adds `required` attribute to the input | `false` | input.js:30,216 |
| `validate` | boolean | Enable extra pattern validation (phone regex, postal code check) | `false` | input.js:216,695; form.js:2612,2695 |
| `validate_country` | string (dial code, e.g. `"84"`, `"1"`) | Country dial code for phone validation; exported as `country_code` in `field_list` | `"84"` | form.js:2611,2801 |
| `phone_validator` | string (regex) | Custom phone validation regex; falls back to `WebcakeScript.CONST.REGEX_PHONE_VALIDATOR` | — | form.js:2696 |
| `country_code` | string | Country code for postal code validation (sent as `postal_country_code` in form data) | — | form.js:1789 |
| `isFormula` | boolean | Enable formula / computed mode — disables direct editing, evaluates `formula` expression | `false` | input.js:35 |
| `formula` | string | JS expression using `{{field_name}}` placeholders evaluated live; e.g. `"{{price}} * {{qty}}"` | — | input.js:35,72,128 |
| `fixed` | string / number | Decimal places for formula result (`"0"` = integer) | `"0"` | input.js:72,137 |
| `isTextParams` | boolean | Fill input value from a URL query parameter (name from `field_name`) | `false` | form.js:214 |
| `defaultVariationId` | string (variation id) | Default product variation id to register on the parent form when `field_name != "quantity"` | — | input.js:245,247 |
| `detectAddress` | boolean | Activate Vietnamese address auto-complete dropdown (only when `field_name="address"`, country `"84"`, no `country-select` sibling, no `address` element with `hidden_commune`) | `false` | input.js:48 |
| `isConnectSurvey` | boolean | Input is hidden unless a connected survey selects it | `false` | input.js:29; form.js:1925 |
| `connectedSurvey` | string (element id) | Id of the survey element this input is connected to | — | form.js:1925,1930 |
| `prodId` / `variationId` / `linkType` | strings | When the input is a quantity field, link the quantity to a `product` or `variation` | — | form.js:2143,2146,2148,2159 |

**Realistic example:**

```json
{
  "id": "in_phone",
  "type": "input",
  "properties": { "name": "Phone", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": { "animation": { "name": "none", "delay": 0, "duration": 3, "repeat": null } }, "styles": { "top": 100, "left": 20, "width": 360, "height": 44 } },
    "mobile":  { "config": { "animation": { "name": "none", "delay": 0, "duration": 3, "repeat": null } }, "styles": { "top": 100, "left": 20, "width": 360, "height": 44 } }
  },
  "specials": {
    "field_name": "phone_number",
    "field_placeholder": "Số điện thoại",
    "field_type": "phone",
    "required": true,
    "validate": true,
    "validate_country": "84"
  },
  "events": []
}
```

---

### 5.3 `textarea`

**Identity:** type `"textarea"` · container: No · field_name: **Required**

`textarea.js` is minimal — the renderer locates the `<textarea>` DOM node, registers `vm.$instance`, and removes `required` when hidden.

**Specials:**

| Key | Type | Meaning | Evidence |
|---|---|---|---|
| `field_name` | string | **Required.** Submitted data key (form collects `vm.$el.querySelector('textarea').value`) | form.js:1802–1805 |
| `field_placeholder` | string | Placeholder text (referenced in `getFieldList` and `getErrorLog`) | form.js:1408,2798 |
| `isFormula` | boolean | Formula mode — `input.js handleInputFormula` handles textarea type | input.js:92–95,175 |

**Realistic example:**

```json
{
  "id": "ta_note",
  "type": "textarea",
  "properties": { "name": "Note", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 180, "left": 20, "width": 360, "height": 100 } },
    "mobile":  { "config": {}, "styles": { "top": 180, "left": 20, "width": 360, "height": 100 } }
  },
  "specials": { "field_name": "note", "field_placeholder": "Ghi chú" },
  "events": []
}
```

---

### 5.4 `select`

**Identity:** type `"select"` · container: No · field_name: **Required**

Options are stored in `specials.options` (static). See §2 for the full option-object schema.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted data key | `"select_<id>"` | select.js:108,198,248 |
| `field_placeholder` | string | Label for `getFieldList` / `getErrorLog` | — | form.js:2798 |
| `options` | option[] | All selectable choices (see §2 for full schema) | `[]` | select.js:27,53,130,198 |
| `default_value` | string (option `id`) | Option `id` to pre-select; `"default-none"` = no pre-selection | — | select.js:109,115,128,132 |
| `defaultVariationId` | string (variation id) | Default variation registered regardless of selected option | — | select.js:108,115,120 |
| `defaultVariationQuantity` | number | Quantity to register alongside `defaultVariationId` | `1` | select.js:110,123 |
| `ignoreOnHidden` | boolean | If true and element is CSS-hidden, its variations are removed from the form | `false` | select.js:112,118,245,256 |
| `promotion` | boolean | Enables option-level event handling | — | select.js:25,51 |
| `isConnectSurvey` | boolean | Links to a survey for conditional hide/show | — | form.js:1925 |
| `connectedSurvey` | string (element id) | Id of the connected survey | — | form.js:1925 |

**Realistic example:**

```json
{
  "id": "sel_size",
  "type": "select",
  "properties": { "name": "Size", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 140, "left": 20, "width": 360, "height": 44 } },
    "mobile":  { "config": {}, "styles": { "top": 140, "left": 20, "width": 360, "height": 44 } }
  },
  "specials": {
    "field_name": "size",
    "field_placeholder": "Chọn size",
    "default_value": "default-none",
    "ignoreOnHidden": false,
    "options": [
      { "id": "opt_s", "name": "S", "variations": [{ "id": "var_s", "quantity": 1, "price": 150000 }], "tags": [], "toggleEvent": true, "events_option": [] },
      { "id": "opt_m", "name": "M", "variations": [{ "id": "var_m", "quantity": 1, "price": 160000 }], "tags": [], "toggleEvent": true, "events_option": [] }
    ]
  },
  "events": []
}
```

---

### 5.5 `checkbox-group`

**Identity:** type `"checkbox-group"` · container: Yes (in CONTAINER_TYPES; but data collection is via DOM querySelectorAll, not children vm) · field_name: **Required**

Form data is collected via `vm.$el.querySelectorAll('input[type="checkbox"]:checked')` and written to `formData.checkbox[field_name]` as an array of checked option ids (form.js:1825–1834). Options use the shared schema (§2). Supported `events_option` types additionally include `"tcb_auto_banking"` (checkbox-group.js:216–221).

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted as `formData.checkbox[field_name]` | `"checkbox_<id>"` | checkbox-group.js:61,132,143,231 |
| `field_placeholder` | string | Label for `getFieldList` / `getErrorLog` | — | form.js:2798 |
| `required` | boolean | At least one checkbox must be checked | `false` | checkbox-group.js:75,88 |
| `options` | option[] | All checkbox choices (see §2 for full schema) | `[]` | checkbox-group.js:37,113,132,165,231 |
| `default_values` | string[] | Option `id`s to pre-check on load | `[]` | checkbox-group.js:37,42 |
| `defaultVariationId` | string (variation id) | Default variation registered with the parent form | — | checkbox-group.js:61,62,64 |
| `defaultVariationQuantity` | number | Quantity for `defaultVariationId` | `1` | checkbox-group.js:61,66 |
| `ignoreOnHidden` | boolean | When true and element is CSS-hidden, its variations are excluded from the form | `false` | checkbox-group.js:11,128,139 |
| `isConnectSurvey` | boolean | Links to a survey for conditional hide/show | — | form.js:1925 |
| `connectedSurvey` | string (element id) | Id of the connected survey | — | form.js:1925 |

**Realistic example:**

```json
{
  "id": "cbg_extras",
  "type": "checkbox-group",
  "properties": { "name": "Extras", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 180, "left": 20, "width": 360 } },
    "mobile":  { "config": {}, "styles": { "top": 180, "left": 20, "width": 360 } }
  },
  "specials": {
    "field_name": "extras",
    "required": false,
    "default_values": [],
    "ignoreOnHidden": false,
    "options": [
      {
        "id": "cb_gift", "name": "Gift wrap",
        "variations": [], "tags": [], "toggleEvent": true,
        "events_option": [{ "id": "ev_gift", "type": "custom_form_price", "custom_price": 10000, "custom_price_name": "Gift wrap fee" }]
      },
      { "id": "cb_express", "name": "Express delivery", "variations": [], "tags": [], "toggleEvent": true, "events_option": [] }
    ]
  },
  "events": [],
  "children": []
}
```

---

### 5.6 `radio`

**Identity:** type `"radio"` · container: Yes (in CONTAINER_TYPES; data collection is via DOM querySelector, not children vm) · field_name: **Required**

Form data is collected via `vm.$el.querySelector('input[type="radio"]:checked')?.value` as a single string (form.js:1838). Options use the shared schema (§2). Supports all 9 payment gateway event types (see §2).

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted as `formData.radio[field_name]` | `"radio_<id>"` | radio.js:54,142,384,395 |
| `field_placeholder` | string | Label for `getFieldList` / `getErrorLog` | — | form.js:2798 |
| `required` | boolean | At least one radio must be selected | `false` | radio.js:36 |
| `options` | option[] | All radio choices (see §2 for full schema) | `[]` | radio.js:57,79,139,200,224,242,384 |
| `default_value` | string (option `id`) \| `"none"` | Option `id` to pre-select; `"none"` = nothing pre-selected | `"none"` | radio.js:55,74,79 |
| `defaultVariationId` | string (variation id) | Default variation registered with the parent form | — | radio.js:54,66 |
| `defaultVariationQuantity` | number | Quantity for `defaultVariationId` | `1` | radio.js:58,69 |
| `highlight` | boolean | When true, the selected radio item gets a background highlight color | `false` | radio.js:57,87,141,148 |
| `color_highlight` | string (CSS color) | Background color applied to the selected radio item when `highlight=true` | — | radio.js:56,89,140,149 |
| `ignoreOnHidden` | boolean | If true and element is offset-hidden, its variations are excluded | `false` | radio.js:53,64,380,391 |
| `isConnectSurvey` | boolean | Links to a survey for conditional hide/show | — | form.js:1925 |
| `connectedSurvey` | string (element id) | Id of the connected survey | — | form.js:1925 |

**Notable config keys:**

| Config key | Meaning |
|---|---|
| `responsive.config.direction` | `"row"` \| `"column"` — layout direction of radio items |
| `responsive.styles.gap` | Gap between radio items |

`reset()` is called by `form.#submissionReset()` after successful submit (radio.js:374; form.js:2548) — clears `selectedOption` and removes highlight styles.

**Realistic example:**

```json
{
  "id": "rdo_payment",
  "type": "radio",
  "properties": { "name": "Payment method", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 220, "left": 20, "width": 360 } },
    "mobile":  { "config": {}, "styles": { "top": 220, "left": 20, "width": 360 } }
  },
  "specials": {
    "field_name": "payment_method",
    "required": false,
    "default_value": "none",
    "highlight": true,
    "color_highlight": "rgba(246,4,87,0.1)",
    "ignoreOnHidden": false,
    "options": [
      { "id": "opt_cod", "name": "COD", "variations": [], "tags": [], "toggleEvent": true, "events_option": [] },
      {
        "id": "opt_bank", "name": "Bank transfer",
        "variations": [], "tags": [], "toggleEvent": true,
        "events_option": [{ "id": "ev_tcb", "type": "tcb_auto_banking", "transfer_content": "Order {{order_id}}", "failed_payment_callback": "https://example.com/failed" }]
      }
    ]
  },
  "events": [],
  "children": []
}
```

---

### 5.7 `address`

**Identity:** type `"address"` · container: No · field_name: **Required**

Renders province/district/commune (and optionally postal code) select dropdowns for Vietnamese or multi-country address entry. The renderer scans sibling `country-select` elements in the parent form to coordinate country changes, but is itself a leaf.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted data key | — | FIELD_TYPES |
| `country` | string (numeric phone-prefix code, e.g. `"84"`, `"1"`) | Which country's address data to load. Falls back to `WebcakeScript.CONST.COUNTRY` then `"84"` | `"84"` | address.js:37 |
| `use_search_box` | boolean | Wraps province/district/commune selects in a `SelectSearch` typeahead widget | `false` | address.js:10 |
| `hidden_province_list` | string[] | Province IDs to exclude from the province select | `[]` | address.js:86 |
| `hidden_district_list` | string[] | District IDs to exclude from the district select | `[]` | address.js:118 |
| `hidden_commune` | boolean | Hides and skips the commune (ward) tier entirely | `false` | address.js:161 |
| `hidden_commune_list` | string[] | Commune IDs to exclude from the commune select | `[]` | address.js:171–184 |
| `required_commune` | boolean | Makes the commune select required when communes are available | `false` | address.js:171–184 |
| `hide_postal_code` | boolean | When `false` AND the country is in `COUNTRY_WITH_POSTAL_CODES`, a postal code select is populated. Default is `true` (hidden) | `true` | address.js:161,213 |

**Realistic example:**

```json
{
  "id": "addr_main",
  "type": "address",
  "properties": { "name": "Address", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 200, "left": 20, "width": 360, "height": 120 } },
    "mobile":  { "config": {}, "styles": { "top": 200, "left": 20, "width": 360, "height": 120 } }
  },
  "specials": {
    "field_name": "address",
    "country": "84",
    "use_search_box": true,
    "hidden_province_list": [],
    "hidden_district_list": [],
    "hidden_commune": false,
    "required_commune": false,
    "hide_postal_code": true
  },
  "events": []
}
```

---

### 5.8 `country-select`

**Identity:** type `"country-select"` · container: No · field_name: **Required**

When `handleChangeCountry` fires, this renderer walks the parent form's children and updates sibling `input[field_name="phone_number"]` validation patterns, sibling `input[field_name="postal_code"]` patterns, and any sibling `address` element's country/data.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted data key | — | FIELD_TYPES |
| `countries` | string[] | Country dial-prefix codes to show in the select AND preload address data for (e.g. `["84","1","65"]`) | `[]` | country-select.js:14 |
| `autofill_phone` | boolean | When true, listens for changes to sibling `phone_number` inputs and auto-selects country based on dialing prefix typed; also auto-prepends dial code on country change | `false` | country-select.js:100,123 |

**Realistic example:**

```json
{
  "id": "csel_1",
  "type": "country-select",
  "properties": { "name": "Country select", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 60, "left": 20, "width": 360, "height": 40 } },
    "mobile":  { "config": {}, "styles": { "top": 60, "left": 20, "width": 360, "height": 40 } }
  },
  "specials": {
    "field_name": "country",
    "countries": ["84", "1", "65", "66"],
    "autofill_phone": true
  },
  "events": []
}
```

---

### 5.9 `quantity_input`

**Identity:** type `"quantity_input"` (underscore, not hyphen) · container: No · field_name: **Required**

A +/− stepper. Publishes `"${vm.id}__quantity-change"` on every click.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** The submitted data column key | — | quantity_input.js:46,58 |
| `ignoreOnHidden` | boolean | When true: if element is not visible at mount time (`.offsetParent === null`), calls `_addIgnoreField(field_name)` on the parent form and publishes `0` as quantity; `enableVariation()` later removes it from the ignore list | `false` | quantity_input.js:16,42,53 |

**Realistic example:**

```json
{
  "id": "qty_main",
  "type": "quantity_input",
  "properties": { "name": "Quantity", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 160, "left": 20, "width": 150, "height": 36 } },
    "mobile":  { "config": {}, "styles": { "top": 160, "left": 20, "width": 150, "height": 36 } }
  },
  "specials": { "field_name": "quantity", "ignoreOnHidden": false },
  "events": []
}
```

---

### 5.10 `input-datetime`

**Identity:** type `"input-datetime"` · container: No · field_name: **Required**

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted data key | — | FIELD_TYPES |
| `datetime_type` | `"date"` \| `"time"` \| `"datetime-local"` \| `"time_slot_picker"` | The HTML input type to render. `"time_slot_picker"` requires `sync_to_crm=="booking_crm"` and `window.sync.shop_type==3`; otherwise falls back to `"datetime-local"` | `"date"` | input-datetime.js:30 |
| `limit_option_type` | `"none"` \| `"dynamic"` | When `"dynamic"`, computes `min`/`max` on the input using `before_day` / `after_day` offsets from today | `"none"` | input-datetime.js:31 |
| `before_day` | number | Days/hours before today that are still selectable (date/datetime-local = days; time = hours) | `0` | input-datetime.js:33 |
| `after_day` | number | Days/hours after today that are still selectable | `0` | input-datetime.js:34 |
| `sync_to_crm` | `"none"` \| `"booking_crm"` | Enables CRM booking integration; syncs valid date ranges from `crm_setting.setting.range_appointment` | `"none"` | input-datetime.js:32,137,151 |
| `field_type` | string | Legacy/alias fallback for `datetime_type` in `addValidateTimeFieldByCrmOnChange` and date-find filter | — | input-datetime.js:152,187 |

**Realistic example:**

```json
{
  "id": "dt_booking",
  "type": "input-datetime",
  "properties": { "name": "Input datetime", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 100, "left": 20, "width": 300, "height": 40 } },
    "mobile":  { "config": {}, "styles": { "top": 100, "left": 20, "width": 300, "height": 40 } }
  },
  "specials": {
    "field_name": "appointment_date",
    "datetime_type": "date",
    "limit_option_type": "dynamic",
    "before_day": 0,
    "after_day": 30,
    "sync_to_crm": "none"
  },
  "events": []
}
```

---

### 5.11 `input-file`

**Identity:** type `"input-file"` (renderer class: `Upload` in `upload.js`) · container: No · field_name: **Required**

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted data key | — | FIELD_TYPES |
| `maxFile` | number \| falsy | When truthy, enables multi-file upload and tracks the count of successfully uploaded files via `input#file-length` | absent = single-file mode | upload.js:22 |

**Non-specials config key (important):**

`display_type` lives in the **per-breakpoint object** (`vm[window.DISPLAY].display_type`, equivalent to `vm.responsive.<bp>.display_type`), NOT inside `specials`. In the page source schema this is most naturally `responsive.<bp>.config.display_type` (or directly on the breakpoint object).

| `display_type` | Meaning | Evidence |
|---|---|---|
| `"type-1"` | Click on the `.img-preview` re-triggers the file picker | upload.js:37–40 |
| `"default"` (or absent) | Default upload behavior | upload.js:20 |

Upload validates file size ≤ 16 MB and image dimensions ≤ 5000×5000 before POSTing to `${host}/upload`.

**Realistic example:**

```json
{
  "id": "upload_cv",
  "type": "input-file",
  "properties": { "name": "Upload", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": { "display_type": "default" }, "styles": { "top": 140, "left": 20, "width": 300, "height": 50 } },
    "mobile":  { "config": { "display_type": "default" }, "styles": { "top": 140, "left": 20, "width": 300, "height": 50 } }
  },
  "specials": { "field_name": "cv_file", "maxFile": 3 },
  "events": []
}
```

---

### 5.12 `signature`

**Identity:** type `"signature"` · container: No · field_name: **Required**

The `signature` renderer reads **no `vm.specials.*` keys beyond `field_name`**. All behavior is hardcoded: canvas drawing (color `#000`, lineWidth 2), PNG export (maxSizeMB 5, maxDimension 5000, quality 0.92), upload to `${host}/upload`. The parent form collects the uploaded image URL via `field_name`.

**Specials:**

| Key | Type | Meaning |
|---|---|---|
| `field_name` | string | **Required.** Submitted data key |

**Realistic example:**

```json
{
  "id": "sig_consent",
  "type": "signature",
  "properties": { "name": "Signature", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 180, "left": 20, "width": 360, "height": 120 } },
    "mobile":  { "config": {}, "styles": { "top": 180, "left": 20, "width": 360, "height": 120 } }
  },
  "specials": { "field_name": "signature" },
  "events": []
}
```

Note: the factory seeds `width=150, height=100` — quite small for a usable signature pad. Recommend at least `360×120`.

---

### 5.13 `verify-code`

**Identity:** type `"verify-code"` · container: No · field_name: **Required**

OTP verification element. Reads sibling `phone_number` input's `phone_validator` and `validate_country` specials for validation.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted data key for the OTP value | — | verify-code.js:84,94 |
| `type_otp_input` | `"one-input"` \| any other string | `"one-input"` = single input accepts up to `length_otp` chars; otherwise = multi-box (one char per box, auto-advance) | multi-box | verify-code.js:16 |
| `length_otp` | number | Number of OTP digits. Controls paste-truncation in `one-input` mode; passed to backend OTP endpoint as `length_otp` | `4` | verify-code.js:17,105 |
| `partner_id` | string | Backend partner/tenant ID sent to `GET /partners/{partner_id}/get_otp`. Required for the "Get Code" button to work | — | verify-code.js:104 |
| `field_type` | `"postal_code"` \| absent | When `"postal_code"`, replaces phone validation regex with a postal-code regex | absent (phone mode) | verify-code.js:116 |
| `condition` | `"limit_5"` \| `"limit_6"` \| `"custom"` | Active when `field_type=="postal_code"`. Selects validation regex: `limit_5` → `[0-9]{5}`, `limit_6` → `[0-9]{6}`, `custom` → uses `pattern` | — | verify-code.js:117 |
| `pattern` | string (regex) | Custom regex used when `field_type=="postal_code"` and `condition=="custom"` | `""` | verify-code.js:125 |

**Realistic example:**

```json
{
  "id": "otp_phone",
  "type": "verify-code",
  "properties": { "name": "Verify code", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 120, "left": 20, "width": 300, "height": 50 } },
    "mobile":  { "config": {}, "styles": { "top": 120, "left": 20, "width": 300, "height": 50 } }
  },
  "specials": {
    "field_name": "otp_code",
    "type_otp_input": "one-input",
    "length_otp": 6,
    "partner_id": "your-partner-id"
  },
  "events": []
}
```

---

### 5.14 `group-select`

**Identity:** type `"group-select"` · container: **Yes** · field_name: **Required** (read by renderer directly, though not in FIELD_TYPES in factory.ts)

A container that holds `group-select-item` children representing product attribute selectors and quantity fields. Options for each item are populated dynamically from `window.sync.products` at runtime — do not seed a static `specials.options`.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Used when calling `_removeVariations(field_name)` / `_setVariations(field_name, v)` on the parent form | — | group-select.js:58,81,96 |
| `sprod` | `{ id: string }` | Product reference. Read by child `group-select-item` renderers. When `sprod.id == 'custom'`, product id is read from DOM attribute set by `bindProduct()`; otherwise `sprod.id` is matched against `window.sync.products[].product_id` | — | group-select-item.js:156,239 |
| `alwayValue` | boolean | When true: if the group container is not visible (`!display && alwayValue`), the renderer returns early and does NOT push the variation to the form. Note: the exact spelling is `alwayValue` (no trailing 's') | `false` | group-select.js:96 |

**Realistic example:** see §5.15 for the combined parent+children example.

---

### 5.15 `group-select-item`

**Identity:** type `"group-select-item"` · container: No · field_name: **Required** · parent: must be direct child of `group-select`

Options are NOT stored in `specials.options`. They are populated dynamically at runtime from `window.sync.products` based on `attrName` and the parent's `sprod`. Do not seed a static `specials.options` array for this type.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Submitted data column key. When `field_quantity` is true the effective submit name becomes `'quantity'` (group-select.js:59) | — | group-select-item.js:17 |
| `field_quantity` | boolean | When true, this item is the quantity selector — its value is passed to `parent._setQuantity()` rather than used as a product attribute. Only one item per group should have this | `false` | group-select-item.js:17 |
| `attrName` | string | The product attribute name this item maps to, e.g. `"Color"`, `"Size"`. Numeric strings (`"1"`, `"2"`) are used as 1-based indices into `product.product_attributes`. Special values `"sprod-name"` / `"sprod-sku"` show the product name / SKU as a single read-only option | — | group-select-item.js:164,176,91 |
| `default_value` | string | Pre-selected value for the select. For attribute items: an option value or `"default-none"` (no pre-selection). For quantity items: a numeric string. | `""` | group-select-item.js:19 |
| `required` | boolean | Makes the select required when the item AND its parent group are visible | `false` | group-select-item.js:28 |

**Parent ↔ child relationship:**

```
group-select  (vm.children = [id1, id2, ...]; in CONTAINER_TYPES)
  ├── group-select-item  (attribute selector: specials.attrName = "Color")
  ├── group-select-item  (attribute selector: specials.attrName = "Size")
  └── group-select-item  (quantity:           specials.field_quantity = true)
```

When one attribute item changes selection, `checkVariation()` builds an `attrs` list from ALL sibling items, finds the matching `product.variations[]` entry, and `setAllStatus()` rebuilds every other item's available options so only valid combinations remain selectable.

**Realistic example (group-select + two items):**

```json
{
  "id": "gs_color_grp",
  "type": "group-select",
  "properties": { "name": "Group Select", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": {}, "styles": { "top": 100, "left": 20, "width": 360, "height": 100 } },
    "mobile":  { "config": {}, "styles": { "top": 100, "left": 20, "width": 360, "height": 100 } }
  },
  "specials": {
    "field_name": "variation_color_size",
    "sprod": { "id": "prod_abc123" },
    "alwayValue": false
  },
  "events": [],
  "children": [
    {
      "id": "gsi_color",
      "type": "group-select-item",
      "properties": { "name": "Color", "movable": true, "sync": true },
      "responsive": {
        "desktop": { "config": {}, "styles": { "top": 0, "left": 0, "width": 160, "height": 36 } },
        "mobile":  { "config": {}, "styles": { "top": 0, "left": 0, "width": 160, "height": 36 } }
      },
      "specials": { "field_name": "attr_color", "attrName": "Color", "field_quantity": false, "default_value": "default-none", "required": true },
      "events": []
    },
    {
      "id": "gsi_qty",
      "type": "group-select-item",
      "properties": { "name": "Quantity", "movable": true, "sync": true },
      "responsive": {
        "desktop": { "config": {}, "styles": { "top": 0, "left": 180, "width": 160, "height": 36 } },
        "mobile":  { "config": {}, "styles": { "top": 0, "left": 180, "width": 160, "height": 36 } }
      },
      "specials": { "field_name": "attr_qty", "field_quantity": true, "default_value": "1", "required": false },
      "events": []
    }
  ]
}
```

---

## 6. Commerce Elements

### 6.1 `list-product`

**Identity:** type `"list-product"` · container: No · field_name: No

Fetches and renders a paginated product grid. Opens a `popup-checkout` overlay on card click. On construction calls `loadMore(0, 50, false)` from `GET ${host}/products/${PAGE_ID}?offset=&limit=&expect=&except=&type=&select=`.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `select` | `"product"` \| `"tag"` \| `"category"` | Which dimension to filter products by | `"product"` | LP:308 |
| `type` | `"expect"` \| `"except"` | Include-list (`expect`) or exclude-list (`except`) mode | `"except"` | LP:309 |
| `expect` | string[] | Product IDs to include (when `type=="expect"` and `select=="product"`) | `[]` | LP:310 |
| `except` | string[] | Product IDs to exclude (when `type=="except"` and `select=="product"`) | `[]` | LP:311 |
| `expectCategory` | string[] | Category IDs to include (when `select=="category"` and `type=="expect"`) | `[]` | LP:313 |
| `exceptCategory` | string[] | Category IDs to exclude (when `select=="category"` and `type=="except"`) | `[]` | LP:314 |
| `expectTags` | string[] | Tag slugs to include (when `select=="tag"` and `type=="expect"`) | `[]` | LP:315 |
| `exceptTags` | string[] | Tag slugs to exclude (when `select=="tag"` and `type=="except"`) | `[]` | LP:316 |
| `format_title` | `"default"` \| `"sku"` \| `"sku-name"` \| `"name-category"` | How product titles are rendered in lazy-loaded cards | `"default"` | LP:363 |
| `format_price` | `"range"` \| `"discount"` | Price display mode. `"discount"` shows the % off badge when original > retail. Also forwarded to the popup-checkout vm | `"range"` | LP:364,426; LP:103 |
| `direction` | `"column"` \| _(any other string)_ | `"column"` = single click on whole card; otherwise thumbnail + cart button get separate click handlers | undefined = row mode | LP:438 |
| `numerical_order` | boolean | Show numbered labels (01, 02, …) on thumbnails | `false` | LP:432 |
| `remain_quantity_text` | string (may contain `{{value}}`) | Custom "N items remaining" label; `{{value}}` is replaced with the actual count | falls back to i18n | LP:87–88 |

**Realistic example:**

```json
{
  "id": "listprod1",
  "type": "list-product",
  "properties": { "name": "ListProduct", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": { "notloaded": false, "animation": { "name": "none", "delay": 0, "duration": 3, "repeat": null } }, "styles": { "top": 0, "left": 0, "width": 960, "height": 400 } },
    "mobile":  { "config": { "notloaded": false, "animation": { "name": "none", "delay": 0, "duration": 3, "repeat": null } }, "styles": { "top": 0, "left": 0, "width": 420, "height": 400 } }
  },
  "specials": {
    "select": "product",
    "type": "except",
    "expect": [], "except": [],
    "expectCategory": [], "exceptCategory": [],
    "expectTags": [], "exceptTags": [],
    "format_title": "default",
    "format_price": "range",
    "direction": "row",
    "numerical_order": false,
    "remain_quantity_text": "Còn lại {{value}} sản phẩm"
  },
  "events": []
}
```

---

### 6.2 `search-list-product`

**Identity:** type `"search-list-product"` · container: No · field_name: No

**No `vm.specials.*` keys are read at all.** The renderer sets `this.vm.specials = {}` (SLP:15) and reads nothing from it. All behavior is DOM-driven.

The button HTML must call `searchProduct(event)` (the renderer exposes `window.searchProduct`). `openProduct()` at SLP:190 iterates all vms looking for `type == 'list-product'`; without one, nothing opens.

**Specials:** `{}` — no specials.

**Realistic example:**

```json
{
  "id": "srchprod1",
  "type": "search-list-product",
  "properties": { "name": "SearchListProduct", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": { "notloaded": false }, "styles": { "top": 0, "left": 0, "width": 400, "height": 40 } },
    "mobile":  { "config": { "notloaded": false }, "styles": { "top": 0, "left": 0, "width": 400, "height": 40 } }
  },
  "specials": {},
  "events": []
}
```

---

### 6.3 `cart-items`

**Identity:** type `"cart-items"` · container: No · **no renderer in `render_v4/src/elements/`**

This is a **WCart-owned element**. At runtime the DOM node is populated by `CartView.ts:renderCartItems()` which queries the `.cart-items` CSS class (CartView.ts:188–191). The element node itself carries no meaningful specials. There is no instantiated JS class for this type at page runtime; `render_v4/src/index.js` does not dispatch it.

**Specials:** `{}` — no specials read by any renderer.

**Font size customization** for cart items is controlled via the **page-level `cartConfigs`** object (`window.$cartConfigs.checkoutElements['CART-ITEM']`), not element specials:

| `cartConfigs.checkoutElements['CART-ITEM']` key | Meaning | Source |
|---|---|---|
| `itemNameSize` | Font size for cart item name | CartView.ts:29 |
| `itemPriceSize` | Font size for cart item price | CartView.ts:30 |
| `inputQuantitySize` | Font size for quantity input | CartView.ts:34 |

Note: `cart-items` requires WCart active (`is_cart_active` in cart/index.js:5); without it, WCart never loads and the element stays empty.

**Realistic example:**

```json
{
  "id": "cartitems1",
  "type": "cart-items",
  "properties": { "name": "CartItems", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": { "notloaded": false }, "styles": { "top": 0, "left": 0, "width": 233, "height": 80 } },
    "mobile":  { "config": { "notloaded": false }, "styles": { "top": 0, "left": 0, "width": 233, "height": 80 } }
  },
  "specials": {},
  "events": []
}
```

---

### 6.4 `cart-quantity`

**Identity:** type `"cart-quantity"` · container: No · field_name: Yes (read by renderer)

A +/− stepper for WCart. Publishes `"${vm.id}__quantity-change"` on every click. `disableVariation()` / `enableVariation()` are called externally from section/group show-hide events.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `field_name` | string | **Required.** Identifies which field in the parent variation group this quantity stepper controls | — | CQ:41,52 |
| `ignoreOnHidden` | boolean | When true and the element is hidden, suppresses its quantity contribution to the parent variation group (calls `_addIgnoreField` / `_removeIgnoreField` on parent vm) | `false` | CQ:37,48 |

**Realistic example:**

```json
{
  "id": "cq_size1",
  "type": "cart-quantity",
  "properties": { "name": "Cart Quantity", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": { "notloaded": false }, "styles": { "top": 0, "left": 0, "width": 150, "height": 36 } },
    "mobile":  { "config": { "notloaded": false }, "styles": { "top": 0, "left": 0, "width": 150, "height": 36 } }
  },
  "specials": { "field_name": "qty_field", "ignoreOnHidden": false },
  "events": []
}
```

---

### 6.5 `table`

**Identity:** type `"table"` · container: No · field_name: No

Renders a Google Sheets-backed data table. `dataType` must be `1` and `google_sheet_data` must be pre-populated for anything to render.

**Specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `dataType` | `0` \| `1` | `0` = static / no-op; `1` = Google Sheets render mode. Renderer returns early at TB:16 if `!= 1` | `0` | TB:9,16 |
| `sheetID` | string | Google Sheet document ID (metadata; not used directly in render logic) | — | TB:14 |
| `source` | string | Data source label (metadata only) | — | TB:14 |
| `google_sheet_data` | string[][] | Pre-fetched 2D array of sheet data. **Row 0 = headers** in `"Column Title|type"` format; rows 1+ = data rows | — | TB:14,16 |

**Column type encoding** — each header cell uses `"Column Title|type"`:

| Type suffix | Cell rendering |
|---|---|
| `\|image` | `<img src="cell">` inside `.table-record-elm--images` |
| `\|video` | `<video src="cell" muted playsinline …>` inside `.table-record-elm--images` |
| `\|link` | `<a href="cell" target="_blank">cell</a>` inside `.table-record-elm--text` |
| `\|time` | `new Date(cell).toLocaleString('en-GB')` inside `.table-record-elm--text` |
| _(absent/default)_ | Plain text `<p class="primary-input">cell</p>` inside `.table-record-elm--text` |

Source: TB:55–69.

**Realistic example:**

```json
{
  "id": "table001",
  "type": "table",
  "properties": { "name": "Table", "movable": true, "sync": true },
  "responsive": {
    "desktop": { "config": { "notloaded": false }, "styles": { "top": 0, "left": 0, "width": 400, "height": 210 } },
    "mobile":  { "config": { "notloaded": false }, "styles": { "top": 0, "left": 0, "width": 400, "height": 210 } }
  },
  "specials": {
    "dataType": 1,
    "sheetID": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
    "source": "Google Sheet",
    "google_sheet_data": [
      ["Product|text", "Price|text", "Image|image", "Link|link"],
      ["Widget A", "99000", "https://example.com/img.jpg", "https://example.com"],
      ["Widget B", "149000", "https://example.com/img2.jpg", "https://example.com/b"]
    ]
  },
  "events": []
}
```

---

### 6.6 `product-select` — STUB

**This type has no renderer anywhere in the codebase.** Zero hits across all `.js`/`.vue`/`.ts` files under the backend `assets/` directory. The type string appears only in `webcake-landing-mcp/src/domains/landing/page-schema.json` (the `elementType` enum) and its descriptor in `src/domains/landing/elements/commerce.ts`. It is not in `editor/factory.js`, `render_v4/src/index.js`, or any Vue component.

An AI or user generating this type will produce a page element that **does nothing at runtime**.

---

## 7. Marketing Elements

### 7.1 `survey`

**Identity:** type `"survey"` · container: No · field_name: Yes (read by renderer)

A visual choice-picker element. Submits selections to the parent form via variation / attribute / quantity methods. Supports single and multi-select modes, option-level side-effects (show/hide, pricing, payment gateways), and WCart attribute selection.

**Top-level specials:**

| Key | Type / Values | Meaning | Default | Evidence |
|---|---|---|---|---|
| `options` | option[] (see §7.1.1) | Array of selectable choices | `[]` | SV:12 |
| `type` | `"text-image"` \| `"text"` \| other | Layout variant; controls whether option images render | `"text-image"` | editor/factory.js:562 |
| `multiOption` | boolean | Allow selecting multiple options simultaneously | `false` | SV:325 |
| `limitOption` | number \| undefined | When `multiOption=true`, max options selectable at once; oldest is ejected when exceeded | undefined = no limit | SV:324,334 |
| `defaultOption` | string[] (option `id`s) | Option IDs to pre-select on load | `[]` | SV:179,189 |
| `required` | boolean | A hidden `#required-box` checkbox gates HTML5 form validation; checked only when ≥1 option is selected | `false` | SV:396 |
| `scrollAuto` | `"yes"` \| other | Horizontal scroll-auto mode (full-viewport-width overflow strip inside a form). Also readable via `responsive.*.config.scrollAuto` | — | SV:161–162 |
| `field_name` | string | Form field key this survey's selections map to in the parent form's variation data | — | SV:256,406,453 |
| `connectedForm` | string (element id) | ID of another form field element to receive survey values instead of the survey's own parent form | — | SV:254,318 |
| `showInputQuantity` | boolean | Render a quantity stepper (+/−/input) inside each option card | `false` | SV:24,433,513 |
| `imageHeight` | number | Height of option images in px | `100` | editor/factory.js:539 |
| `imageWidth` | number | Width of option images in px | `100` | editor/factory.js:540 |
| `alignment` | `"center"` \| `"left"` \| `"right"` | Option alignment within the survey wrapper | `"center"` | editor/factory.js:541 |
| `selectedBackground` | CSS color string | Background applied to selected option cards | `"rgba(124,255,58,1)"` | editor/factory.js:544 |
| `selectedBorder` | CSS color string | Border color on selected option cards | `"rgba(124,255,58,1)"` | editor/factory.js:545 |
| `hoveredBorder` | CSS color string | Border color on hover | `"rgba(28,0,194,1)"` | editor/factory.js:543 |
| `sprod_id` | string | Product ID when this survey acts as a WCart attribute selector | — | SV:385,390 |
| `sprod_attr` | string | Product attribute name this survey selects (e.g. `"Color"`) | — | SV:386 |
| `sprod_vals` | string[] | Ordered attribute values matching option DOM index; `sprod_vals[data-index]` gives the value per option | `[]` | SV:387,369 |

#### 7.1.1 Per-option object shape (`options[]`)

| Key | Type | Meaning | Evidence |
|---|---|---|---|
| `id` | string | Unique option ID; DOM id = `sv__${vm.id}__${option.id}` | SV:23 |
| `field_name` | string | Per-option field name for `optionsName` list / `selectOptionByFieldNames` | SV:16,308–309 |
| `title` | string | Display label | HTML template |
| `image` | string URL | Image URL for image-choice mode | HTML template |
| `value` | string | Value submitted when this option is selected | SV:475,484 |
| `min_quantity` | number | Minimum quantity when `showInputQuantity=true` | SV:200 (default 1) |
| `max_quantity` | number | Maximum quantity when `showInputQuantity=true` | SV:201 (default 10) |
| `toggleEvent` | boolean | If false, this option's `events_option` are NOT fired on re-init | SV:76 |
| `events_option` | object[] | Side-effects on select/deselect — see §2 for full schema | SV:78 |
| `attrOnly` | boolean | Option only sets a product attribute, not a variation | SV:260,410,489 |
| `quantityOnly` | boolean | Option only adjusts a product quantity | SV:429,451,509 |
| `params_value` | number | Numeric price/weight param multiplied by option quantity | SV:282 |
| `variations` | object[] | Variation objects submitted to form `_setVariations` | SV:267,283 |
| `prodId` | string | Product ID for `attrOnly` mode | SV:262,412,491 |
| `attrName` | string | Attribute name for `attrOnly` mode | SV:413,492 |
| `attrVal` | string | Attribute value for `attrOnly` mode | SV:414,493 |
| `attrs` | `{prodId,name,value}[]` | Multiple attribute bindings for `attrOnly` (overrides single prodId/attrName/attrVal) | SV:261,295,415,495 |
| `quantityProd` | string | Product ID for `quantityOnly` mode | SV:430,510 |
| `quantityValue` | number | Quantity value to set for `quantityOnly` mode | SV:430,510 |

Survey `events_option` supports: `showhide`, `collapse`, `custom_form_price`, `custom_form_discount`, `custom_form_shipping_fee`, `tcb_auto_banking` (SV:83–119). See §2 for the full event schema.

**Connected field wiring (`connectedForm`):** The target field element's specials must have `isConnectSurvey: true` and `connectedSurvey: "<this survey's id>"`. The target's `field_name` is used as the variation key in the parent form (SV:463).

**Realistic example:**

```json
{
  "id": "survey01",
  "type": "survey",
  "properties": { "name": "Survey", "movable": true, "sync": true },
  "responsive": {
    "desktop": {
      "config": { "notloaded": false, "scrollAuto": "no", "animation": { "name": "none", "delay": 0, "duration": 3, "repeat": null } },
      "styles": { "top": 0, "left": 0, "width": 300, "margin": 10, "padding": 10, "borderColor": "rgb(217,217,217)", "borderStyle": "solid", "borderWidth": 1, "textAlign": "center" }
    },
    "mobile": {
      "config": { "notloaded": false, "scrollAuto": "no", "animation": { "name": "none", "delay": 0, "duration": 3, "repeat": null } },
      "styles": { "top": 0, "left": 0, "width": 300, "margin": 10, "padding": 10 }
    }
  },
  "specials": {
    "type": "text-image",
    "multiOption": false,
    "limitOption": null,
    "defaultOption": [],
    "required": false,
    "scrollAuto": "no",
    "field_name": "survey_size",
    "showInputQuantity": false,
    "imageHeight": 100,
    "imageWidth": 100,
    "alignment": "center",
    "selectedBackground": "rgba(124,255,58,1)",
    "selectedBorder": "rgba(124,255,58,1)",
    "hoveredBorder": "rgba(28,0,194,1)",
    "options": [
      {
        "id": "optabc123", "field_name": "sv_survey01_1",
        "title": "Small", "image": "https://placehold.co/100x100?text=S",
        "value": "small", "min_quantity": 1, "max_quantity": 10,
        "toggleEvent": true, "events_option": [], "variations": []
      },
      {
        "id": "optdef456", "field_name": "sv_survey01_2",
        "title": "Large", "image": "https://placehold.co/100x100?text=L",
        "value": "large", "min_quantity": 1, "max_quantity": 10,
        "toggleEvent": true, "events_option": [], "variations": []
      }
    ]
  },
  "events": []
}
```

---

## 8. Stub / Non-Functional Types

| Type | Status | Notes |
|---|---|---|
| `product-select` | **STUB — no renderer exists** | Type appears only in `page-schema.json:80` and `library.ts:351`. Not in `editor/factory.js`, `render_v4/src/index.js`, or any Vue component. Produces a page element that does nothing at runtime. Do not use. |
| `cart-items` | **WCart-owned — no `render_v4` renderer** | DOM is populated by `CartView.ts:renderCartItems()`. No specials. Requires WCart active (`is_cart_active`). Styling via page-level `cartConfigs.checkoutElements['CART-ITEM']`, not element specials. |
| `search-list-product` | Functional but **no specials** | All behavior DOM-driven; requires a co-existing `list-product` vm on the same page to open product popups. |

---

## 9. Phantom Keys

These keys appear in the MCP `LIBRARY` or MCP docs but are **not read by any renderer**. Do not include them in generated elements.

| Element | Phantom key | Notes |
|---|---|---|
| `address` | `detectAddress` | Appears in LIBRARY `keySpecials` but is never read by `address.js`. The `detectAddress` key is actually read by the `input` renderer (input.js:48) when `field_name="address"` — it belongs on the `input` element, not on `address`. |
| `group-select-item` | `field_placeholder` | Listed in LIBRARY `keySpecials` for `group-select-item` but not read by `group-select-item.js`. Likely a copy/paste artifact. |
| `group-select-item` | `options` | Listed in LIBRARY as if options are stored statically in specials. `group-select-item` does NOT use a static `specials.options` array — options are populated dynamically from `window.sync.products` at runtime based on `attrName` and the parent's `sprod`. |

---

## 10. Persistence Model

This is a short summary of how the backend stores and returns page source, derived from `§2` and `§3` of `backend-ai-endpoints.md`.

**Backend stores `source` verbatim — no validation or transform on write.**

`create_page_from_source` and `update_page_source` both call `encode_source/1` (ai_controller.ex:95–97):
- If `source` is a binary string: stored as-is.
- If `source` is a map: stored as `Jason.encode!(source)`.
- Anything else: stored as `"{}"`.

The backend never inspects keys, never requires a `page` top-level key, never rejects malformed element trees. All structural validation is the MCP's responsibility.

**Source-only persistence; not rendered immediately.**

After `create_page_from_source`, the page `app`/`app_css` are untouched (`null`). The page must be opened and re-saved in the editor for the source to be compiled into a renderable page.

**Read path decodes the stored string.**

`get_page_source` calls `Jason.decode` on the stored string (ai_controller.ex:116–120), returning a map. Fallback is `%{}` on decode failure. Round-tripping a map through create → get yields a map.

**Full documented top-level key set:**

The backend's `page_schema.ex:20–24` documents the canonical editor-saved page source as having these top-level keys:

```
page, popup, dynamic_pages, options, svariations, cartConfigs, settings
```

The MCP's `page-schema.json` currently lists all of these except `svariations`. Because `additionalProperties: true` is set on the schema, `svariations` is not rejected — but surgical edits via `update_page_source` should preserve it if present. The `settings` object typically includes `auto_save_draft: true` (seeded by `new_page_skeleton`, consistent with `ai_services.ex:120–127`).

**Success envelope contract.**

Backend responses use a dynamic key: `{ "success": true, "fallback": "with_data", "<key>": <data> }` where `<key>` is `"data"` for create/update/get/list-pages endpoints and `"organizations"` for the org list endpoint. Failure responses are HTTP 422 with `{ "success": false, "message": "…", "fallback": "with_reason" }`. Auth failures are plain-text 401/403.

---

## Event Model

Derived from the runtime dispatcher `render_v4/event/index.js`, the form handlers in `render_v4/src/elements/form.js`, and the scroll-in handler in `render_v4/lazyload/index.js`. Every element carries an `events` array; each item is:

```jsonc
{ "id": "ev1", "type": "click", "action": "open_popup", "target": "<popup id>", /* + action-specific extra fields */ }
```

### Triggers (`type`)

| type | Fires when | Lives on |
|------|-----------|----------|
| `click` | element is clicked | any element |
| `hover` | mouseenter/mouseleave | any element |
| `success` | a form submit succeeds | a **form** element |
| `error` | form validation fails | a **form** element |
| `delay` | element scrolls into view (timed) | any element |
| `unset` | page init (e.g. initial `collapse`) | any element |

### Click actions (target + extra event-object fields)

| action | target | extra fields |
|--------|--------|--------------|
| `none` | — | — |
| `open_link` | URL | `targetURL` ('_blank'\|'_self'), `open_link_with_params`, `send_to_thank_page`, `delayTime` (s) |
| `open_popup` | popup id | `animation`, `reverseAnimation` |
| `close_popup` | popup id | `animation` |
| `scroll_to` | element/section id | `scrollMore` (bonus px) |
| `show_section` / `hide_section` | section id | — |
| `show_hide_element` | element id (comma-list ok) | `onlyMode` ('show'\|'hide'), `animation`, `animationOut` |
| `change_tab` | gallery/carousel id | `moveTo` ('prev'\|'next'\|'index'), `tabIndex` |
| `lightbox` | image/video/iframe URL | `typeLightbox` ('image'\|'video'\|'iframe'), `alt` |
| `copy` | text — or element id when `copyType='elementValue'` | `copyType` |
| `collapse` | element id | — |
| `set_field_value` | field_name (or `w-<id>`) | `set_value` |
| `back_to` | none (history.back) | — |
| `share` | platform: 'Facebook'\|'Twitter'\|'Custom' | — |
| `play_audio` / `stop_audio` | audio file URL (NOT an id) | — |
| `open_sms` | phone number | `smsBody` |
| `send_email` | email address | — |
| `download_file` | file URL | `nameFile` |
| `close_webview` | none | — |
| `open_cart` | none | — |
| `add_to_cart` | (unused) | uses `specials.sprod/svariant/squantity` or `event.sprod_id/svariant/squantity` |
| `open_app` | destination URL/phone/ref | `appTarget` (botcake\|botcake_dynamic\|whatsapp\|mess_prefill\|tiktok_prefill\|line_prefill\|others), `wa_custom_text`, `line_custom_text`, `formIdLink` |
| `change_color` | (self / `target_element`) | `change_color_type`, `change_color`, `target_mode`, `target_element` |
| `custom_js` | none | `custom_js` (code string) |

### Hover actions

`change_color` (extra: `change_color`, `change_color_type`, `hoverText`, `hoverBorder`, `target_mode`, `target_element`), `change_background` (`hoverColor`), `change_text_color` (`hoverText`), `change_underline`, `change_overline`, `animation_hover`, `show_hide_element` (target = element id; `animation`, `animationOut`).

### Success actions (form, after submit)

`phone_call` (phone), `open_sms` (phone, `smsBody`), `send_email` (email), `open_link` (URL, `targetURL`), `scroll_to` (id, `scrollMore`), `open_popup` (id), `close_popup` (id), `download_file` (URL, `nameFile`), `show_hide_element` (id, `onlyMode`), `show_section` (id), `hide_section` (id), `close_webview`, `change_tab` (id, `moveTo`, `tabIndex`).

### Error actions (form, on validation failure)

`open_popup` (id), `close_popup` (id), `show_hide_element` (id, `onlyMode`).

### Delay actions (any element, on scroll-into-view)

`show_element`, `hide_element` — both read `delay_multiplier` (ms, default 1000).

> The MCP exposes these vocabularies live via `get_generation_guide` (`click_actions`, `hover_actions`, `success_actions`, `error_actions`, `delay_actions`) and `validate_page` checks element-id targets — including option-level `events_option` `promoId`, `connectedSurvey`/`connectedForm`, and `set_field_value` element refs.
