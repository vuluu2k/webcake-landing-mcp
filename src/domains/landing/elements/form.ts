/**
 * Form & input element descriptors. `field: true` marks the inputs that submit a
 * value and therefore need a unique specials.field_name (drives FIELD_TYPES and
 * the validator's field_name checks). The container forms (form/radio/
 * checkbox-group/group-select) hold their inputs as children.
 */
import type { ElementDescriptor } from "../../../core/descriptor.js";
import { seedPosition, setBox } from "../../../core/element.js";

export const FORM: ElementDescriptor[] = [
  {
    type: "form", category: "form", container: true, defaultName: "Form",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 250);
      el.specials.fb_event_type = "CompleteRegistration";
      el.specials.fb_conversion_value = "10000";
      el.specials.fb_tracking_currency = "VND";
      el.specials.tiktok_conversion_value = "10000";
      el.specials.tiktok_tracking_currency = "VND";
    },
  },
  {
    type: "input", category: "form", container: false, field: true, defaultName: "Input",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `input_${el.id}`;
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
  {
    type: "textarea", category: "form", container: false, field: true, defaultName: "Textarea",
    summary: "Multi-line input.", useWhen: "Messages, notes.",
    keySpecials: {
      field_name: "REQUIRED unique key.",
      field_placeholder: "placeholder.",
      isFormula: "boolean — formula/computed mode (same {{field_name}} expression system as input).",
      formula: "string — formula expression when isFormula=true.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 50);
      el.specials.field_name = `textarea_${el.id}`;
    },
  },
  {
    type: "select", category: "form", container: false, field: true, defaultName: "Select",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `select_${el.id}`;
    },
  },
  {
    type: "checkbox", category: "form", container: false, field: true, defaultName: "Checkbox",
    summary: "Single checkbox (consent, opt-in).", useWhen: "Agree-to-terms, single toggle.",
    keySpecials: { field_name: "REQUIRED.", required: "boolean — must be checked to submit." },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `checkbox_${el.id}`;
    },
  },
  {
    type: "checkbox-group", category: "form", container: true, field: true, defaultName: "Checkbox Group",
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
    seed: (el) => {
      seedPosition(el);
      el.specials.field_name = `checkbox_${el.id}`;
    },
  },
  {
    type: "radio", category: "form", container: true, field: true, defaultName: "Radio",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150);
      el.specials.field_name = `radio_${el.id}`;
    },
  },
  {
    type: "address", category: "form", container: false, field: true, defaultName: "Address",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `address_${el.id}`;
    },
  },
  {
    type: "country-select", category: "form", container: false, field: true, defaultName: "Country select",
    summary: "Country picker. Auto-syncs sibling phone-number / postal-code / address fields.",
    useWhen: "International forms.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      countries: "array of country dial-prefix codes (e.g. ['84','1','65']) shown in the dropdown and used to preload address data.",
      autofill_phone: "boolean — listen to sibling phone_number inputs to auto-select the country by dial prefix and auto-prepend the dial code.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `country_select_${el.id}`;
    },
  },
  {
    type: "quantity_input", category: "form", container: false, field: true, defaultName: "Quantity",
    summary: "Quantity stepper (+/-).", useWhen: "Order quantity.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      ignoreOnHidden: "boolean — when hidden at mount, add field_name to the parent form's ignore list and publish quantity 0.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `quantity_input_${el.id}`;
    },
  },
  {
    type: "input-datetime", category: "form", container: false, field: true, defaultName: "Input datetime",
    summary: "Date/time picker.", useWhen: "Booking date, appointment.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      datetime_type: "'date' | 'time' | 'datetime-local' | 'time_slot_picker' — the HTML input type to render.",
      limit_option_type: "'none' | 'dynamic' — 'dynamic' computes min/max from before_day/after_day offsets from today.",
      before_day: "number — days/hours before today that stay selectable (when limit_option_type='dynamic').",
      after_day: "number — days/hours after today that stay selectable (when limit_option_type='dynamic').",
      sync_to_crm: "'none' | 'booking_crm' — 'booking_crm' validates against CRM availability (active only when shop_type=3).",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `input_datetime_${el.id}`;
    },
  },
  {
    type: "input-file", category: "form", container: false, field: true, defaultName: "Upload",
    summary: "File upload (renderer: upload.js).", useWhen: "CV/receipt/photo upload.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      maxFile: "number — when truthy, enable multi-file upload and track the uploaded-file count. (UI variant config.display_type 'default'|'type-1' lives in the per-breakpoint config object, NOT in specials.)",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `input_file_${el.id}`;
    },
  },
  {
    type: "signature", category: "form", container: false, field: true, defaultName: "Signature",
    summary: "Hand-drawn signature pad.", useWhen: "Consent/contracts.",
    keySpecials: { field_name: "REQUIRED." },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 100);
      el.specials.field_name = `signature_${el.id}`;
    },
  },
  {
    type: "verify-code", category: "form", container: false, field: true, defaultName: "Verify code",
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
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `verify_${el.id}`;
    },
  },
  {
    type: "group-select", category: "form", container: true, defaultName: "Group Select",
    summary: "Attribute/variant selector group (e.g. size+color+quantity); children are group-select-item.",
    useWhen: "Product variants with quantity.",
    keySpecials: {
      field_name: "REQUIRED — variation slot key used when registering variations on the parent form.",
      sprod: "object {id: string} — product reference for the child items ('custom' = read product id from a runtime DOM attr).",
      alwayValue: "boolean (spelling exact, no trailing 's') — when true and the group is hidden, skip pushing its variation to the form.",
    },
    // No visual seed: the editor factory only seeds children:[] (handled generically).
  },
  {
    type: "group-select-item", category: "form", container: false, field: true, defaultName: "Group Select Item",
    summary: "One attribute (or the quantity) inside group-select. Options are NOT static — they are populated from the product catalog (window.sync.products) at runtime based on attrName + the parent's sprod.",
    useWhen: "Child of group-select only.",
    keySpecials: {
      field_name: "REQUIRED unique data key (becomes 'quantity' when field_quantity=true).",
      field_quantity: "boolean — when true this item is the quantity selector (value goes to parent._setQuantity), not a product attribute. Only one item per group.",
      attrName: "string — the product attribute name this item maps to (e.g. 'Color','Size'); numeric strings ('1','2') index product_attributes for custom products; 'sprod-name'/'sprod-sku' show the product name/SKU.",
      default_value: "string — pre-selected option value, or 'default-none'/empty for no default.",
      required: "boolean — require selection when the item and its parent group are visible.",
    },
    seed: (el) => {
      el.specials.field_name = `gs_${el.id}`;
    },
  },
];
