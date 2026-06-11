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
    useWhen: "Any lead-capture / contact / registration form. Put input/textarea/select/button as DIRECT children (not nested inside groups or rectangles inside the form) — submit collection iterates form.children only (no recursion), so a field nested inside a group/rectangle is validated but NEVER SUBMITTED. Same restriction applies to group-select, country-select, address, verify-code, and submit button lookups.",
    keySpecials: {
      form_type: "'login' | undefined — 'login' runs the gated access-key flow on submit instead of the normal lead-data API.",
      submit_success: "NUMBER 1 | 2 (NOT a string — string '1' silently falls to redirect branch). 1 = open the success popup (popup_target); 2 = redirect to redirect_url.",
      popup_target: "string (popup id) — popup to open when submit_success===1. REQUIRED when submit_success===1; missing or dangling id → submit succeeds with zero user feedback (default '__popup_default__' usually absent).",
      redirect_url: "string (URL) — destination when submit_success===2. REQUIRED when submit_success===2.",
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
      fb_event_type: "Facebook pixel standard event fired on submit (e.g. Lead, Purchase, none). Use 'none' to disable pixel firing.",
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
      sync_to_crm: "'none' | 'booking_crm' — missing key treated as truthy CRM-sync for shop_type=3; always stamp 'none' when CRM sync is not intended.",
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
      el.specials.fb_event_type = "none";
      el.specials.fb_conversion_value = "10000";
      el.specials.fb_tracking_currency = "VND";
      el.specials.tiktok_conversion_value = "10000";
      el.specials.tiktok_tracking_currency = "VND";
      el.specials.sync_to_crm = "none";
    },
  },
  {
    type: "input", category: "form", container: false, field: true, defaultName: "Input",
    summary: "Single-line input. specials.field_name is the submitted data column (REQUIRED & unique).",
    useWhen: "Name/email/phone fields. Set field_type to text/email/phone/number. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique data key. Special names coerce the input type: 'phone_number'/'recheck_phone_number' → tel, 'email' → email. Phone pattern validation only applies when field_name=='phone_number' AND validate=true.",
      field_placeholder: "placeholder text.",
      field_type: "text | email | phone | number | postal_code | date. 'postal_code' enables postcode-detect helper and uses condition/pattern (country_default|limit_5|limit_6|custom). 'date' renders a date input.",
      required: "boolean.",
      validate: "boolean — enable extra pattern validation (phone regex / postal-code check).",
      validate_country: "string dial code (e.g. '84','1') used for phone validation.",
      phone_validator: "string regex — custom phone validation pattern.",
      isLimited: "boolean — enable maxlength restriction.",
      limit: "number — maxlength value (when isLimited=true).",
      isMinimumLimited: "boolean — enable minlength restriction AND forces required=true.",
      minimumLimit: "number — minlength value (when isMinimumLimited=true).",
      useInputPattern: "boolean — enable custom input validation pattern.",
      inputPattern: "string regex — custom validation pattern (when useInputPattern=true).",
      hideContent: "boolean — render as a password input (characters masked).",
      defaultVal: "string — pre-filled default value.",
      minValue: "boolean — enable minimum numeric value.",
      minValueNumber: "number — minimum numeric value (when minValue=true; number inputs default min=0, blocking negatives).",
      maxValue: "boolean — enable maximum numeric value.",
      maxValueNumber: "number — maximum numeric value (when maxValue=true).",
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
    // Examples are in the SPARSE authoring shape — the server hydrates
    // properties/runtime/events/config from factory defaults on validate/persist.
    example: {
      id: "in_phone", type: "input",
      responsive: {
        desktop: { styles: { top: 60, left: 20, width: 360, height: 40 } },
        mobile: { styles: { top: 60, left: 20, width: 360, height: 40 } },
      },
      specials: { field_name: "phone", field_placeholder: "Số điện thoại", field_type: "phone", required: true },
    },
  },
  {
    type: "textarea", category: "form", container: false, field: true, defaultName: "Textarea",
    summary: "Multi-line input.", useWhen: "Messages, notes. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique key.",
      field_placeholder: "placeholder.",
      required: "boolean.",
      isLimited: "boolean — enable maxlength restriction.",
      limit: "number — maxlength value (when isLimited=true).",
      isMinimumLimited: "boolean — enable minlength restriction AND forces required=true.",
      minimumLimit: "number — minlength value (when isMinimumLimited=true).",
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
    summary: "Dropdown select. Options live in specials.options (NOT children). Must be a DIRECT child of the form for commerce option tags to work.",
    useWhen: "Pick one from a list. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      field_placeholder: "REQUIRED — the disabled first-option label (the placeholder/prompt). The key is `field_placeholder`, NOT `placeholder`. The select renderer renders value='undefined' if this is missing.",
      default_value: "string (option id) to pre-select; 'default-none' = no pre-selection.",
      defaultVariationId: "string — default product variation id registered on the parent form regardless of selection.",
      defaultVariationQuantity: "number — quantity registered with defaultVariationId.",
      ignoreOnHidden: "boolean — when CSS-hidden, remove this element's variations from the form total.",
      isConnectSurvey: "boolean — link to a survey for conditional show/hide.",
      connectedSurvey: "string — id of the connected survey.",
      options: "array of option objects. The renderer builds each <option> from `id` and `name` ONLY — MINIMUM shape is {id, name} where name is BOTH the visible text and the submitted value. Do NOT use the HTML-style {label, value} — those keys are ignored and the option renders blank. Rich commerce options may also carry value, variations:[{id,quantity,price}], attrOnly/prodId/attrName/attrVal/attrs, quantityOnly/quantityProd/quantityValue, tags:[], toggleEvent, events_option:[] (show/hide, collapse, price/discount/shipping). See docs/element-specials-reference.md for the full option schema.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `select_${el.id}`;
      el.specials.field_placeholder = "Chọn...";
      el.specials.default_value = "default-none";
    },
    example: {
      id: "sel_attend", type: "select",
      responsive: {
        desktop: { styles: { top: 0, left: 0, width: 300, height: 44 } },
        mobile: { styles: { top: 0, left: 0, width: 280, height: 44 } },
      },
      // options use {id, name} — NOT {label, value}. field_placeholder is required.
      specials: {
        field_name: "attendance",
        field_placeholder: "Bạn có tham dự không?",
        default_value: "default-none",
        options: [
          { id: "opt_yes", name: "Tôi sẽ tham dự" },
          { id: "opt_no", name: "Rất tiếc, tôi không thể đến" },
        ],
      },
    },
  },
  {
    type: "checkbox", category: "form", container: false, field: true, defaultName: "Checkbox",
    summary: "BLANK ON LIVE — the published renderer has no case for type 'checkbox' (renders empty string, never hydrated, never submitted). Use checkbox-group with a single option instead.",
    useWhen: "DO NOT USE — renders blank on the published page and never submits. Use checkbox-group with a single option (plus required:true if needed) instead.",
    keySpecials: {
      field_name: "REQUIRED (but never submitted — see summary).",
      required: "boolean — must be checked to submit (but this type never submits; use checkbox-group).",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `checkbox_${el.id}`;
    },
  },
  {
    type: "checkbox-group", category: "form", container: true, field: true, defaultName: "Checkbox Group",
    summary: "Multiple checkboxes. Choices live in specials.options. Submitted values are the checked option NAMES (NFKC-normalized), not ids. Runtime splits DOM id '<elementId>-<optionId>' on '-' — element ids and option ids must contain NO hyphens or event/variation handling silently breaks.",
    useWhen: "Multi-select options. Also use with a single option as a replacement for type 'checkbox'. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique data key (submitted as formData.checkbox[field_name], array of checked option NAMES, NFKC-normalized).",
      required: "boolean — at least one checkbox must be checked.",
      default_values: "array of option id strings checked by default on load.",
      defaultVariationId: "string — default variation registered on the parent form.",
      defaultVariationQuantity: "number — quantity for defaultVariationId.",
      ignoreOnHidden: "boolean — when CSS-hidden, exclude this element's variations from the form total.",
      isConnectSurvey: "boolean — link to a survey for conditional show/hide.",
      connectedSurvey: "string — id of the connected survey.",
      options: "array of option objects, MINIMUM shape {id, name} where id and name must contain NO hyphens (runtime splits '<elementId>-<optionId>' on '-'). name is the submitted value (NFKC-normalized). The renderer crashes on options that lack a string `name`. Do NOT use {label, value}. Same rich shape as select. See docs/element-specials-reference.md for the full option schema.",
    },
    seed: (el) => {
      seedPosition(el);
      el.specials.field_name = `checkbox_${el.id}`;
    },
  },
  {
    type: "radio", category: "form", container: true, field: true, defaultName: "Radio",
    summary: "Single-choice radio options. Choices live in specials.options. Submitted value = selected option.name. Runtime splits DOM id '<elementId>-<optionId>' on '-' — element ids and option ids must contain NO hyphens.",
    useWhen: "Pick exactly one of a few. Common for payment-method selection. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique data key (submitted as formData.radio[field_name], the selected option.name).",
      required: "boolean — one radio must be selected.",
      default_value: "string (option id) | 'none' — option to pre-select; 'none' = nothing pre-selected (NOT 'default-none' — that is select's sentinel).",
      defaultVariationId: "string — default variation registered on the parent form.",
      defaultVariationQuantity: "number — quantity for defaultVariationId.",
      highlight: "boolean — give the selected radio item a background highlight.",
      color_highlight: "CSS color — background applied to the selected item when highlight=true.",
      ignoreOnHidden: "boolean — when hidden, exclude this element's variations from the form total.",
      isConnectSurvey: "boolean — link to a survey for conditional show/hide.",
      connectedSurvey: "string — id of the connected survey.",
      options: "array of option objects, MINIMUM shape {id, name} where id and name must contain NO hyphens (runtime splits '<elementId>-<optionId>' on '-'). Submitted value = selected option.name. The renderer crashes on options that lack a string `name`. Do NOT use {label, value}. Same rich shape as select — events_option additionally supports 9 payment-gateway event types (tcb_auto_banking, xendit_banking, onepay_banking, mercadopago_banking, vnpay_banking, paymongo_banking, stripe_banking, paypal_banking, momopay_banking). See docs/element-specials-reference.md for the full option schema.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150);
      el.specials.field_name = `radio_${el.id}`;
    },
  },
  {
    type: "address", category: "form", container: false, field: true, defaultName: "Address",
    summary: "Province/District/Ward selector (multi-country). CRITICAL: specials.field_name MUST be exactly 'province_id/district_id/commune_id' — the renderer splits on '/' to get the three select names and hardcodes province_id/district_id/commune_id internally. Any other value results in dropdowns that never populate and throw.",
    useWhen: "Shipping/contact address. Must be a DIRECT child of the form to submit. plain `required` is ignored — use required_province/required_districts/required_postal_code.",
    keySpecials: {
      field_name: "MUST be exactly 'province_id/district_id/commune_id' (canonical fixed value — do NOT change). The renderer splits on '/' to produce the three internal select names. Any other value → dropdowns never populate.",
      country: "string — numeric phone-prefix code (e.g. '84' VN, '1' US) selecting which province/district/commune data to load.",
      use_search_box: "boolean — wrap the dropdowns in a typeahead SelectSearch widget.",
      hidden_commune: "boolean — omit the commune (ward) tier entirely.",
      hidden_province_list: "array of province id strings to exclude from the province dropdown.",
      hidden_district_list: "array of district id strings to exclude from the district dropdown.",
      hidden_commune_list: "array of commune id strings to exclude from the commune dropdown.",
      required_province: "boolean — require province selection.",
      required_districts: "boolean — require district selection.",
      required_postal_code: "boolean — require postal code selection (when hide_postal_code=false).",
      hide_postal_code: "boolean (default true) — when false and the country supports it, expose a postal-code dropdown.",
      layout_column: "boolean — stack dropdowns vertically.",
      range_field_address: "number (px) — gap between the stacked dropdowns when layout_column=true.",
      placeholderProvince: "string — placeholder for the province dropdown.",
      placeholderDistrict: "string — placeholder for the district dropdown.",
      placeholderCommune: "string — placeholder for the commune dropdown.",
      placeholderPostalCode: "string — placeholder for the postal code dropdown.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = "province_id/district_id/commune_id";
    },
  },
  {
    type: "country-select", category: "form", container: false, field: true, defaultName: "Country select",
    summary: "Country picker. Auto-syncs sibling phone-number / postal-code / address direct-child fields of the same form.",
    useWhen: "International forms. Must be a DIRECT child of the form to submit and to sync with sibling fields.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      field_placeholder: "REQUIRED — the disabled first-option label. Key is `field_placeholder`, NOT `placeholder`. The country-select renderer crashes if this is missing.",
      default_country: "string (country code, default 'none') — pre-selected country code.",
      display_format: "'default' | '_'-joined combo of flag|name|phone|short — controls label rendering in the dropdown (e.g. 'flag_phone', 'flag_name_phone'). Unknown codes render a blank label.",
      countries: "array of country dial-prefix codes (e.g. ['84','1','65']) shown in the dropdown and used to preload address data.",
      autofill_phone: "boolean — listen to sibling phone_number inputs to auto-select the country by dial prefix and auto-prepend the dial code.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `country_select_${el.id}`;
      el.specials.field_placeholder = "Quốc gia";
    },
  },
  {
    type: "quantity_input", category: "form", container: false, field: true, defaultName: "Quantity",
    summary: "Quantity stepper (+/-). plain `required` does nothing on this type.",
    useWhen: "Order quantity. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      defaultVal: "number — initial value (default 0; commerce forms usually want 1).",
      minValue: "boolean — enable minimum value.",
      minValueNumber: "number — minimum value (default 0; blocks negatives).",
      maxValue: "boolean — enable maximum value.",
      maxValueNumber: "number — maximum value (default cap 200).",
      hideSpinBtn: "boolean — hide the +/- buttons.",
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
    summary: "Date/time picker.", useWhen: "Booking date, appointment. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      field_placeholder: "string — visible placeholder label.",
      required: "boolean.",
      datetime_type: "'date'(default) | 'time' | 'datetime-local' | 'time_slot_picker' — the HTML input type to render.",
      limit_option_type: "'none' | 'dynamic' | 'fixed'. 'dynamic' computes min/max from before_day/after_day offsets from today. 'fixed' uses since_day/until_day (ISO strings → min/max attr).",
      before_day: "number — days/hours before today that stay selectable (when limit_option_type='dynamic').",
      after_day: "number — days/hours after today that stay selectable (when limit_option_type='dynamic').",
      since_day: "string (ISO date) — hard min date when limit_option_type='fixed'.",
      until_day: "string (ISO date) — hard max date when limit_option_type='fixed'.",
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
    summary: "File upload (renderer: upload.js). Max 16 MB/file; images ≤5000×5000. Submitted value = uploaded CDN URLs joined by ';'.",
    useWhen: "CV/receipt/photo upload. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique data key.",
      field_placeholder: "string — visible label on the upload control (default '' = blank label).",
      required: "boolean.",
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
    summary: "Hand-drawn signature pad. `required` NOT supported (bare canvas). Submitted value = an uploaded image URL.",
    useWhen: "Consent/contracts. Must be a DIRECT child of the form to submit.",
    keySpecials: { field_name: "REQUIRED." },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 100);
      el.specials.field_name = `signature_${el.id}`;
    },
  },
  {
    type: "verify-code", category: "form", container: false, field: true, defaultName: "Verify code",
    summary: "OTP / verification code field. 'split-input' mode (the DEFAULT) renders OTP boxes ONLY for length_otp 4 or 6 — any other length renders NOTHING; other lengths need type_otp_input='one-input'. 'Get code' requires a sibling input with field_name 'phone_number' AND a button, both DIRECT children of the same form — missing phone field throws on click.",
    useWhen: "Phone/email verification. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED unique data key for the OTP value.",
      type_otp_input: "'one-input' | (omitted/other = split-input default). 'one-input' = single box accepting length_otp chars. split-input renders individual boxes but ONLY for length_otp 4 or 6.",
      length_otp: "number — number of OTP digits. For split-input mode MUST be 4 or 6 (any other value renders nothing). For one-input mode any positive length works.",
      field_placeholder: "string — placeholder shown in one-input mode (shows 'undefined' if missing).",
      partner_id: "string — backend partner/tenant id sent to GET /partners/{partner_id}/get_otp (required for 'Get Code').",
      button_get_code_text: "string — text on the 'Get Code' button (default 'Get code').",
      field_type: "'postal_code' | absent — 'postal_code' switches validation from phone OTP to a postal-code regex.",
      condition: "'limit_5' | 'limit_6' | 'custom' — postal-code regex selector (active when field_type='postal_code').",
      pattern: "string regex — custom postal-code pattern when condition='custom'.",
      message_otp_wrong: "string — custom error message shown when the entered OTP is wrong. Optional.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 150, 36);
      el.specials.field_name = `verify_${el.id}`;
      el.specials.type_otp_input = "split-input";
      el.specials.length_otp = 6;
    },
  },
  {
    type: "group-select", category: "form", container: true, defaultName: "Group Select",
    summary: "Attribute/variant selector group (e.g. size+color+quantity); children are group-select-item. MUST be a DIRECT child of the form. Submitted value = children's values joined ' - '.",
    useWhen: "Product variants with quantity. Must be a DIRECT child of the form to submit.",
    keySpecials: {
      field_name: "REQUIRED — variation slot key used when registering variations on the parent form.",
      sprod: "object {id: string} — product reference for the child items ('custom' = read product id from a runtime DOM attr).",
      alwayValue: "boolean (spelling exact, no trailing 's') — when true and the group is hidden, skip pushing its variation to the form.",
    },
    // No visual seed: the editor factory only seeds children:[] (handled generically).
  },
  {
    type: "group-select-item", category: "form", container: false, field: true, defaultName: "Group Select Item",
    summary: "One attribute (or the quantity) inside group-select. Attribute items populate options from the product catalog at runtime based on attrName + the parent's sprod; the quantity item carries a STATIC options array. quantity item's default_value matches option.value (contrast with select's id-based default).",
    useWhen: "Child of group-select only.",
    keySpecials: {
      field_name: "REQUIRED unique data key (becomes 'quantity' when field_quantity=true).",
      field_placeholder: "REQUIRED string — the disabled first-option label (the editor seeds 'AttrName' for attribute items, 'Quantity' for the quantity item). Key is `field_placeholder`, NOT `placeholder`. The renderer crashes if this is missing.",
      field_quantity: "boolean — when true this item is the quantity selector (value goes to parent._setQuantity), not a product attribute. Only one item per group.",
      attrName: "string — the product attribute name this item maps to (e.g. 'Color','Size'); numeric strings ('1','2') index product_attributes for custom products; 'sprod-name'/'sprod-sku' show the product name/SKU.",
      options: "array [{id,name,value}] — STATIC option list used by the quantity item (field_quantity=true), e.g. 1..4; attribute items leave this empty and populate from the catalog at runtime.",
      default_value: "string — pre-selected option value (matches option.value for quantity items), or 'default-none'/empty for no default.",
      required: "boolean — require selection when the item and its parent group are visible.",
    },
    seed: (el) => {
      el.specials.field_name = `gs_${el.id}`;
      el.specials.field_placeholder = "Chọn...";
    },
  },
];
