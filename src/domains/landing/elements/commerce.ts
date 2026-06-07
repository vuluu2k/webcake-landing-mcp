/**
 * Commerce element descriptors: product lists, search, cart pieces, and data
 * tables. Several of these are DOM/WCart-driven at runtime (cart-items,
 * search-list-product) and carry few or no specials. `product-select` is a
 * reserved stub with no runtime renderer — kept for parity, not for use.
 */
import type { ElementDescriptor } from "../../../core/descriptor.js";
import { seedPosition, setStyle, setBox } from "../../../core/element.js";

export const COMMERCE: ElementDescriptor[] = [
  {
    type: "list-product", category: "commerce", container: false, defaultName: "ListProduct",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 162);
      setStyle(el, "colorBtn", "rgba(246, 4, 87, 1)");
      el.specials.format_title = "sku";
      el.specials.numerical_order = true;
    },
  },
  {
    type: "search-list-product", category: "commerce", container: false, defaultName: "SearchListProduct",
    summary: "Search box + product results. Reads NO specials (all DOM-driven) and REQUIRES a co-existing list-product element on the page — openProduct() delegates to a list-product vm, so without one nothing opens.",
    useWhen: "Searchable catalog (pair it with a list-product element).",
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
    summary: "Items currently in the cart. Has NO element specials — the WCart system writes its inner HTML at runtime and it needs the cart active (is_cart_active). Item name/price/quantity font sizes come from the page-level cartConfigs.checkoutElements['CART-ITEM'] (itemNameSize/itemPriceSize/inputQuantitySize), not from this node.",
    useWhen: "Cart/checkout area (requires WCart active).",
    keySpecials: {},
    seed: (el) => {
      seedPosition(el);
      setBox(el, 233, 80);
    },
  },
  {
    type: "cart-quantity", category: "commerce", container: false, defaultName: "Cart Quantity",
    summary: "Quantity stepper (+/-) that controls a field in the parent variation group; publishes <id>__quantity-change on each click.",
    useWhen: "Per-variation quantity inside a cart/form group.",
    keySpecials: {
      field_name: "REQUIRED — identifies which field in the parent variation group this stepper controls.",
      ignoreOnHidden: "boolean — when hidden, suppress this element's quantity contribution (calls _addIgnoreField/_removeIgnoreField on the parent vm).",
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
    summary: "Data table rendered from a pre-fetched Google Sheets 2D array.",
    useWhen: "Pricing/comparison/spec tables (data must be pre-loaded into specials).",
    keySpecials: {
      dataType: "0 | 1 — MUST be 1 to render anything; the renderer returns early when dataType != 1.",
      source: "string — data source label (metadata only).",
      sheetID: "string — Google Sheet document id (metadata only).",
      google_sheet_data: "string[][] — the 2D table data; row 0 = headers as 'Title|type' where type ∈ image|video|link|time (absent type = plain text); rows 1+ are data cells.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 210);
    },
  },
];
