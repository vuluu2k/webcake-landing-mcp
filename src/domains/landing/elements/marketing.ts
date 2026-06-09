/**
 * Marketing / dynamic element descriptors: timers, live counters, social-proof
 * toasts, spin-wheel, and surveys. `alertMessage` is an internal toast helper,
 * not a placeable element — kept for catalog/schema parity with a do-not-use note.
 */
import type { ElementDescriptor } from "../../../core/descriptor.js";
import { randomId, seedPosition, setStyle, setBox } from "../../../core/element.js";

export const MARKETING: ElementDescriptor[] = [
  {
    type: "countdown", category: "marketing", container: false, defaultName: "Count Down",
    summary: "Countdown timer (minute duration, fixed end time, or daily window).",
    useWhen: "Urgency: limited offer, flash sale. Renders a fixed FOUR-slot flex row (day·hour·minute·second); each visible segment is sized 1/4 of the width regardless of how many show, so HIDING a segment (showDay/showSecond:false) leaves an empty gap on the right (the row is left-aligned, no built-in re-centering). Keep all four (showDay+showSecond:true) so the row fills evenly, and CENTER the whole box on the canvas: left = round((canvas - width)/2).",
    keySpecials: {
      type: "minute | duration | daily — countdown mode. 'minute' counts down from a fixed duration; 'duration' counts to a fixed end datetime; 'daily' resets in a daily window.", duration: "minutes to count down (when type='minute').",
      startTime: "ISO datetime string — start of the countdown window (used with type='duration' or 'daily').",
      endTime: "ISO datetime string — end/deadline datetime (used with type='duration').",
      dailyStart: "string 'HH:MM' — daily window open time (used with type='daily').",
      dailyEnd: "string 'HH:MM' — daily window close time (used with type='daily').",
      repeat: "boolean — restart the countdown when it reaches zero.",
      customize: "boolean — enable custom message display when countdown finishes.",
      customMessage: "string — message to display when countdown reaches zero (used when customize=true).",
      showDay: "boolean — show the days segment.",
      showSecond: "boolean — show the seconds segment.",
      showText: "boolean — show unit labels (days/hours/minutes/seconds).",
      language: "unit-label locale — MUST be one of: vietnam | english | filipino | khmer | lao | indonesian | thai | malay | custom. NOT a code like 'vi'/'en' (that crashes the renderer). For any other language use 'custom' + customTranslation.",
      customTranslation: "object {day,hour,minute,second} of label strings — used (and required) when language='custom'. e.g. {day:'Ngày',hour:'Giờ',minute:'Phút',second:'Giây'}.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 300, 80);
      setStyle(el, "color", "rgba(255, 255, 255, 1)");
      setStyle(el, "background", "rgba(0, 0, 0, 1)");
      setStyle(el, "fontSize", 20);
      el.specials = { type: "minute", duration: "60", language: "english", showDay: true, showSecond: true, showText: true, repeat: false, customize: false, customMessage: "", dailyStart: "", dailyEnd: "" };
    },
  },
  {
    type: "timegroup", category: "marketing", container: false, defaultName: "Time Group",
    summary: "Live current date/time display rendered as text. Supports relative labels (today/yesterday/tomorrow) or fixed datetime, with multiple format presets.",
    useWhen: "Show today's date, a relative date label, or a formatted timestamp on the page.",
    keySpecials: {
      currentTime: "'yesterday' | 'today' | 'nextday' | 'custom' — which date to display.",
      formatType: "number 1–11 — selects a date/time format preset (1=short date, 2=long date, 3=time, 4=datetime, etc.).",
      language: "string — locale for month/day names (e.g. 'vi', 'en').",
      typeTimeGroup: "1 | 2 — 1=relative label (e.g. 'Today'), 2=fixed formatted datetime string.",
      customTime: "string — ISO datetime string to display when currentTime='custom'.",
      customDateJump: "number — day offset from customTime (positive=future, negative=past).",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 240, 25);
    },
  },
  {
    type: "auto-number", category: "marketing", container: false, defaultName: "Auto Number",
    summary: "Auto-incrementing number that counts up from startNumber to endNumber. Supports sync mode to mirror another element's value.",
    useWhen: "Social-proof counters (views, orders, customers). Counts up on page load.",
    keySpecials: {
      startNumber: "number — value to start counting from.",
      endNumber: "number — value to count up to.",
      jumpNumber: "number — increment per animation step.",
      timeDelayMs: "number (ms) — interval between steps (preferred key).",
      timeDelay: "number (ms) — legacy interval key (use timeDelayMs instead).",
      autoNumberMode: "'sync' | undefined — 'sync' mirrors the value of another auto-number element instead of counting independently.",
      syncTarget: "string — element id to sync with when autoNumberMode='sync'.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 60, 80);
    },
  },
  {
    type: "random-number", category: "marketing", container: false, defaultName: "Random Number",
    summary: "Displays a random number between startNumber and endNumber. Result is persisted in localStorage so it stays consistent across page reloads.",
    useWhen: "Randomized social proof (e.g. 'X people viewed this').",
    keySpecials: {
      startNumber: "number — minimum value of the random range.",
      endNumber: "number — maximum value of the random range.",
      jumpNumber: "number — step granularity for the random value.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 60, 80);
    },
  },
  {
    type: "notify", category: "marketing", container: false, defaultName: "Notify",
    summary: "'Someone just bought…' toast notification strip. Cycles through a list of notifications with configurable timing. Supports static data, Google Sheets, or a webcake dataset as source.",
    useWhen: "Social-proof popups showing recent purchases/signups.",
    keySpecials: {
      delay: "number (ms) — initial delay before the first notification appears.",
      duration: "number (ms) — how long each notification is visible.",
      delayStart: "number (ms) — pause between notifications.",
      random: "boolean — randomize the order of notifications.",
      soundMode: "boolean — play a sound when a notification appears.",
      notifySoundLink: "string — URL to a custom notification sound file.",
      dataType: "0 | 1 — 0=static data embedded in page, 1=Google Sheets.",
      source: "string — data source label.",
      sheetID: "string — Google Sheet ID (when dataType=1).",
      dataSheet: "string — sheet tab name (when dataType=1).",
      datasetId: "string — webcake dataset ID to pull notification data from.",
      dataSetData: "array — pre-fetched dataset rows.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 300, 62);
    },
  },
  {
    type: "spin-wheel", category: "marketing", container: false, defaultName: "Spin Wheel",
    summary: "Lucky-spin wheel with configurable prize segments and coupon codes. Can open a result popup after spinning and supports dataset-driven coupon lists.",
    useWhen: "Gamified lead capture / promos. Users spin to win a coupon or prize.",
    keySpecials: {
      message: "string — result-popup message template shown after a spin (NOT segment labels). Supports placeholders {{coupon_text}}, {{coupon_code}}, {{spin_turn_left}}, {{coupon_codes}}.",
      spin: "object — spin configuration (segment colors, angles, etc.).",
      code: "string (NOT an array) — the segments. ONE LINE PER SEGMENT, each line `couponCode|Prize Name|percent`, lines joined by \\n. The visible label on each wheel slice is the middle field (Prize Name); percent is the win weight. e.g. 'SALE10|Giảm 10%|40\\nSALE50|Giảm 50%|10\\nMISS|Chúc may mắn|50'.",
      dataType: "0 | 1 — 0=static codes, 1=dataset-driven codes.",
      datasetId: "string — webcake dataset ID for coupon codes.",
      codeDataset: "string — dataset column key for the coupon code.",
      popup: "string — id of the popup to open after a successful spin (showing the prize).",
      popupTurnOver: "string — id of the popup to open when the user has no turns left.",
      showCoupon: "boolean — display the winning coupon code in the result popup.",
      fontSize: "number — font size of segment labels.",
      widthText: "number — text wrap width in segment labels.",
      textAlign: "'left' | 'center' | 'right' — alignment of segment label text.",
      assignCoupon: "boolean — assign a specific coupon to the user after spin.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 400);
      setStyle(el, "color", "rgba(255, 255, 255, 1)");
      // `code` is a newline-delimited string, ONE segment per line `couponCode|Prize Name|percent`
      // (the editor preview does code.split("\n") and crashes/renders blank if it is missing).
      el.specials.code = [
        "PRIZE1|Giải 1|20",
        "PRIZE2|Giải 2|20",
        "PRIZE3|Giải 3|20",
        "MISS|Chúc may mắn|40",
      ].join("\n");
      // `message` is the result-popup template (a string), NOT segment labels.
      el.specials.message = "Chúc mừng! Bạn nhận được {{coupon_text}} (mã: {{coupon_code}}).";
    },
  },
  {
    type: "survey", category: "marketing", container: false, defaultName: "Survey",
    summary: "Survey / image-choice question; each option submits a field.",
    useWhen: "Quizzes, preference capture, image pickers.",
    keySpecials: {
      type: "'text-image' | 'text' | (other) — layout variant; controls whether option images render.",
      multiOption: "boolean — allow selecting multiple options at once.",
      limitOption: "number — max selectable options when multiOption=true (oldest is ejected past the limit).",
      defaultOption: "array of option id strings to pre-select on load.",
      required: "boolean — require at least one selection before the form submits.",
      scrollAuto: "'yes' | (other) — horizontal auto-scroll strip mode (requires a form parent); also readable via config.scrollAuto.",
      field_name: "string — form field key these selections map to in the parent form's variation data.",
      connectedForm: "string — id of another form field element to receive the survey values (cross-form wiring; that field needs isConnectSurvey=true + connectedSurvey=this id).",
      showInputQuantity: "boolean — render a +/- quantity stepper inside each option (uses each option's min_quantity/max_quantity).",
      sprod_id: "string — product id when the survey acts as a WCart attribute selector.",
      sprod_attr: "string — product attribute name this survey selects (e.g. 'Color').",
      sprod_vals: "array of attribute value strings, one per option (indexed by option DOM order).",
      imageHeight: "number (px) — option image height.",
      imageWidth: "number (px) — option image width.",
      alignment: "'center' | 'left' | 'right' — option alignment within the wrapper.",
      selectedBackground: "CSS color — background of selected option cards.",
      selectedBorder: "CSS color — border of selected option cards.",
      hoveredBorder: "CSS color — border color on hover.",
      options: "array of option objects {id, field_name, title, image, value, min_quantity, max_quantity, toggleEvent, events_option:[], variations:[], attrOnly/prodId/attrName/attrVal/attrs, quantityOnly/quantityProd/quantityValue, params_value} — events_option supports showhide/collapse/custom_form_price/custom_form_discount/custom_form_shipping_fee/tcb_auto_banking. See docs/element-specials-reference.md for the full option schema.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 300, undefined);
      setStyle(el, "margin", 10);
      setStyle(el, "padding", 10);
      setStyle(el, "borderColor", "rgb(217, 217, 217)");
      setStyle(el, "borderStyle", "solid");
      setStyle(el, "borderWidth", 1);
      setStyle(el, "textAlign", "center");
      el.specials = {
        imageHeight: 100,
        imageWidth: 100,
        multiOption: false,
        alignment: "center",
        hoveredBorder: "rgba(28,0,194,1)",
        selectedBackground: "rgba(124,255,58,1)",
        selectedBorder: "rgba(124,255,58,1)",
        options: [
          { id: randomId(), image: "", title: "Option 1", value: "value1", field_name: `sv_${el.id}_1` },
          { id: randomId(), image: "", title: "Option 2", value: "value2", field_name: `sv_${el.id}_2` },
        ],
        type: "text-image",
      };
    },
  },
  {
    type: "alertMessage", category: "marketing", container: false, defaultName: "alertMessage",
    summary: "INTERNAL UTILITY FUNCTION — not a placeable page element. alertMessage(type, content, duration) is a JS helper called by other renderers (form, upload, verify-code, input-datetime, etc.) to show a transient toast. It has no vm.specials and cannot be placed on a page. Do NOT generate an element node of this type.",
    useWhen: "Never — this is not a user-facing element. Do not place this type in a page or popup.",
    keySpecials: {},
    seed: (el) => {
      seedPosition(el);
      setBox(el, 200, 100);
    },
  },
];
