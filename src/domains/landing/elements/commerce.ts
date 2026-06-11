/**
 * Commerce element descriptors: product lists, search, cart pieces, and data
 * tables.
 *
 * Renderer-contract notes (verified against landing_page_build/render/build/
 * index.js + exportCss.js, landing_page_backend/assets/render_v4, WCart
 * assets/cart/src, and the editor):
 *
 * - cart-items: the publish type-switch has NO cart-items case (default '').
 *   The real cart UI is WCart's floating drawer (div.cart_view) appended beside
 *   the cart icon — NOT rendered by this element. Do NOT place this element.
 * - table: SSR renders ONLY unescapeHTML(specials.sourceTable); the google_sheet
 *   branch is commented out in the publisher. Always author sourceTable.
 * - list-product: rich specials/styles surface documented below.
 * - search-list-product: crashes if product sync absent; placeholder/button text
 *   are locale-fixed.
 * - cart-quantity: ignoreOnHidden is dead code on live (dispatcher list mismatch).
 */
import type { ElementDescriptor } from "../../../core/descriptor.js";
import { seedPosition, setStyle, setBox } from "../../../core/element.js";

export const COMMERCE: ElementDescriptor[] = [
  {
    type: "list-product", category: "commerce", container: false, defaultName: "ListProduct",
    summary: "Product list bound to the page store; clicking a card opens the popup-checkout overlay configured by page-level cartConfigs.checkoutConfig.",
    useWhen: "Show purchasable products.",
    keySpecials: {
      // --- filter / layout ---
      select: "'product' | 'tag' | 'category' — which dimension to filter products by.",
      type: "'expect' | 'except' — treat the expect*/except* arrays as an allowlist (expect) or denylist (except). FOOTGUN: type='expect' + select='product' + empty expect array renders ZERO products (empty allowlist = nothing; category/tag allowlists treat empty differently). SSR caps at 200 products.",
      expect: "array of product id strings to include (select='product', type='expect'). Must be non-empty when type='expect', otherwise no products render.",
      except: "array of product id strings to exclude (select='product', type='except').",
      expectCategory: "array of category ids to include (select='category').",
      exceptCategory: "array of category ids to exclude (select='category').",
      expectTags: "array of tag slugs to include (select='tag').",
      exceptTags: "array of tag slugs to exclude (select='tag').",
      direction: "'column' | (other) — layout direction. With the SSR wrapper every card is fully clickable in BOTH directions; thumbnail+cart-only handlers are a legacy path.",
      row_layout: "'layout_1' | 'layout_2' — row-direction card variant (row only).",
      numerical_order: "boolean — show numbered labels (01, 02 …) on thumbnails.",
      // --- title / price ---
      format_title: "'default' | 'sku' | 'sku-name' | 'name-category' — product title composition.",
      format_price: "'range' | 'discount' | 'discount-revert' — 'discount' shows % off badge when original > retail; 'discount-revert' reverses the cost/price order + badge; any non-'range' value shows the first variation's original+retail pair.",
      // --- quantity / stock ---
      show_remain_quantity: "boolean — show remaining stock count (default true).",
      remain_quantity_text: "string — low-stock label; {{value}} replaced with actual count.",
      is_runout: "boolean — hide sold-out products.",
      // --- rating / social proof ---
      show_rating_star: "boolean — show fake star rating derived from product name. WARNING: if any product has a null name this throws at product.name.charCodeAt and crashes the build for that card.",
      show_total_sold: "boolean — show total sold count.",
      // --- image ---
      hide_product_image: "boolean — hide product thumbnail.",
      thumbnail_size: "number (px, default 195) — thumbnail width.",
      thumbnail_height: "number (px) — thumbnail height override.",
      background_size: "'cover' | 'contain' | … (default 'cover') — thumbnail background-size.",
      // --- button ---
      show_add_button: "'show' | 'hide' | 'hide_icon' (default 'show') — add-to-cart button visibility.",
      text_add_button: "string — custom add-to-cart button label.",
      iconCart: "url string — custom cart icon for the button.",
      btn_width: "number (px, default 182) — button width.",
      btn_height: "number (px) — button height.",
      btn_border: "string — button border shorthand.",
      border_type_btn: "string — button border type.",
      border_width_btn: "number — button border width.",
      // --- SKU / extras ---
      show_extra_sku: "boolean — show additional SKU attributes on the card.",
      // --- typography / font ---
      font_family: "string — card font family.",
      textAlign: "'left' | 'center' | 'right' — card text alignment.",
      boldName: "boolean — bold product name.",
      boldExtraTitle: "boolean — bold extra SKU title.",
      list_product_font: "object — per-element font sizes (px numbers): { pName, pPrice, pOrgPrice, pQuantity, pButton, pStarSize, pTotalSold }.",
      // --- flash sale ---
      show_flash_sale_icon: "boolean (default true) — show flash-sale badge icon.",
      // --- checkout overlay ---
      // NOTE: the checkout overlay itself is configured by page-level
      // cartConfigs.checkoutConfig (show_description / show_attrs /
      // show_quantity / popup_position …), NOT by list-product specials.
      // Only format_price passes through to the overlay from here.
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 162);
      setStyle(el, "colorBtn", "rgba(246, 4, 87, 1)");
      el.specials.format_title = "sku";
      el.specials.numerical_order = true;
    },
    // Styles consumed beyond colorBtn (all exportCss.js):
    // colorIconBtn, colorBtnBorder, colorTextBtn, colorBgIcon,
    // colorTitle, colorPrice, colorQuantity, colorBg, colorFlashSale,
    // colorTextSale, borderRadius.
  },
  {
    type: "search-list-product", category: "commerce", container: false, defaultName: "SearchListProduct",
    summary: [
      "Search box + product results overlay. Requires a co-existing list-product element on the page — openProduct() delegates to a list-product vm, so without one nothing opens.",
      "CRASH: clicking search hard-crashes when product sync is absent (window.sync.products.findIndex, search-list-product.js:51) — page must have synced products.",
      "Placeholder text and button label are NOT settable — they are locale-fixed by currency.",
      "background + color style the SEARCH BUTTON only; borderRadius splits input-left / button-right.",
      "A single search hit skips the results popup and opens the checkout overlay directly.",
    ].join(" "),
    useWhen: "Searchable catalog (pair it with a list-product element and ensure product sync is active).",
    keySpecials: {},
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 40);
      setStyle(el, "background", "rgba(246, 4, 87, 1)");
      setStyle(el, "color", "rgba(255,255,255,1)");
    },
  },
  {
    type: "cart-items", category: "commerce", container: false, defaultName: "CartItems",
    summary: [
      "DO NOT PLACE — renders an empty string on the published page.",
      "The publish renderer's type-switch has no cart-items case (index.js default ''), and render_v4 has no cart-items class.",
      "The real cart-items UI is WCart's own floating drawer (div.cart_view) appended beside the cart icon (CartView.ts:172,249; floating.ts:164) — it is positioned by cart settings, not by this element.",
      "Editor shows a placeholder product card; live page shows nothing (editor ≠ live).",
      "The page-level cartConfigs.checkoutElements['CART-ITEM'] (itemNameSize / itemPriceSize / inputQuantitySize) styles the FLOATING DRAWER — values must be CSS strings WITH units (e.g. \"14px\"); bare numbers produce invalid CSS.",
    ].join(" "),
    useWhen: "Do NOT place this element. Configure cartConfigs.checkoutElements['CART-ITEM'] for drawer font sizes instead.",
    keySpecials: {},
    seed: (el) => {
      seedPosition(el);
      setBox(el, 233, 80);
    },
  },
  {
    type: "cart-quantity", category: "commerce", container: false, defaultName: "Cart Quantity",
    summary: [
      "Quantity stepper (+/-) for a product variation group.",
      "Value always starts at 1 (hardcoded); minus clamps at 1; plus is unbounded.",
      "Publishes <id>__quantity-change on each click so WCart can read input[type=number] in the variation group DOM.",
      "ignoreOnHidden is DEAD CODE on live — the show/hide dispatcher only handles checkbox-group / select / radio / quantity_input; cart-quantity is not in that list, so hiding this element never suppresses its quantity contribution.",
      "field_name path: the SSR input has no name attribute; quantity flows via WCart reading input[type=number] in the sprod variation group (WCart path — works with any field_name value, including the seeded cart_quantity_<id>).",
      "The form quantity-LINK path (linkType / prodId|variationId) requires field_name==='quantity' AND field_type==='number' exactly — the seeded cart_quantity_<id> never satisfies that; only change field_name to 'quantity' when using the explicit form-link path, not the WCart group path.",
    ].join(" "),
    useWhen: "Per-variation quantity inside a WCart group.",
    keySpecials: {
      field_name: "REQUIRED for the renderer. WCart group path: any unique value (seed's cart_quantity_<id> is fine). Form quantity-LINK path: must be exactly 'quantity' + field_type='number' + linkType/prodId/variationId.",
      ignoreOnHidden: "boolean — DEAD CODE on live (dispatcher does not handle cart-quantity). Has no effect on quantity contribution when hidden.",
    },
    // NOT a FIELD_TYPE (field flag omitted) but the renderer still requires a
    // field_name, so the seed sets one explicitly.
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `cart_quantity_${el.id}`;
    },
  },
  {
    type: "product-select", category: "commerce", container: false, defaultName: "product-select",
    summary: "STUB — no runtime renderer exists in render_v4, so placing this type produces a non-functional element that does nothing on the page. Use list-product (catalog) or form (order capture) instead.",
    useWhen: "Do NOT use — it is a reserved/legacy stub. Prefer list-product or form.",
    keySpecials: {},
    seed: (el) => {
      seedPosition(el);
      setBox(el, 200, 100);
    },
  },
  {
    type: "table", category: "commerce", container: false, defaultName: "Table",
    summary: [
      "Data table rendered server-side from specials.sourceTable (escaped HTML string).",
      "The published SSR renders ONLY unescapeHTML(specials.sourceTable) — the Google Sheets branch is commented out in the publisher (index.js:1172-1226).",
      "EDITOR ≠ LIVE: the editor is DATASET-driven (specials.datasetId → /api/datasets/records) and snapshots its rendered DOM back into specials.sourceTable on every save — an MCP-authored google_sheet_data-only table shows BLANK in the editor, and re-saving from the editor can WIPE sourceTable.",
      "ALWAYS author specials.sourceTable (the escaped HTML string) as the primary content key.",
      "dataType=1 + google_sheet_data: renders blank on first paint / no-JS / SEO (render_v4 Table class overwrites .table-wrapper client-side at table.js:16,81). A google_sheet_data with exactly 1 row renders an empty box (table.js:20-21).",
    ].join(" "),
    useWhen: "Pricing/comparison/spec tables. Always provide specials.sourceTable (escaped HTML); google_sheet_data alone is blank on SSR/SEO.",
    keySpecials: {
      // --- content (primary) ---
      sourceTable: "PRIMARY CONTENT — escaped HTML string of the full rendered table. The SSR publisher outputs unescapeHTML(sourceTable) directly. Without this the published table is blank. Author this first; the editor will update it from its dataset on re-save.",
      dataType: "0 | 1 — set to 1 to enable the client-side Table renderer; 0 = no client-side render. Does not affect SSR (sourceTable is always used server-side).",
      source: "string — data source label (metadata only; not rendered).",
      sheetID: "string — Google Sheet document id (metadata only; not rendered on publish).",
      google_sheet_data: "string[][] — 2D table data for the client-side renderer (render_v4); row 0 = headers as 'Title|type' (type ∈ image|video|link|time; absent = plain text); rows 1+ are data cells. BLANK on SSR/no-JS — always pair with sourceTable.",
      // --- styling specials (all consumed by exportCss.js:2047-2106 / cssTable) ---
      // These are specials, NOT styles. Values are CSS strings.
      hidden_title: "truthy — hides thead on live (editor only hides when === 'none'). E.g. 'none' to hide on both.",
      head_background: "CSS color string — header row background.",
      head_color: "CSS color string — header row text color.",
      row_even_background: "CSS color string — even data-row background.",
      row_even_color: "CSS color string — even data-row text color.",
      row_odd_background: "CSS color string — odd data-row background.",
      row_odd_color: "CSS color string — odd data-row text color.",
      padding_content: "CSS padding string — cell padding (e.g. '8px 12px').",
      borderWidth: "CSS length string — table border width (e.g. '1px').",
      borderColor: "CSS color string — table border color.",
      borderStyle: "CSS border-style string — table border style (e.g. 'solid').",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 210);
    },
  },
];
