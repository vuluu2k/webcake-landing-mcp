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
    summary: "Countdown timer (minute duration, fixed end time, or daily window). specials.type MUST be one of 'minute'|'duration'|'daily' — any other value causes a runtime TypeError (timer dead).",
    useWhen: "Urgency: limited offer, flash sale. Renders a fixed FOUR-slot flex row (day·hour·minute·second); each visible segment is sized 1/4 of the width regardless of how many show, so HIDING a segment (showDay/showSecond:false) leaves an empty gap on the right (the row is left-aligned, no built-in re-centering). Keep all four (showDay+showSecond:true) so the row fills evenly, and CENTER the whole box on the canvas: left = round((canvas - width)/2).",
    keySpecials: {
      type: "REQUIRED enum 'minute'|'duration'|'daily' — countdown mode. Any other value causes a runtime TypeError (timer dead). 'minute' counts down from a fixed duration (persists start in a cookie, does not reset per reload; repeat only affects minute mode); 'duration' counts to a fixed end datetime; 'daily' resets in a daily window.",
      duration: "minutes to count down (when type='minute').",
      startTime: "ISO datetime string — start of the countdown window (used with type='duration' or 'daily').",
      endTime: "ISO datetime string — end/deadline datetime (used with type='duration').",
      dailyStart: "string 'HH:MM' — daily window open time (used with type='daily').",
      dailyEnd: "string 'HH:MM' — daily window close time (used with type='daily').",
      repeat: "boolean — restart the countdown when it reaches zero (only affects 'minute' mode).",
      customize: "string 'customize'|'nothing' (NOT a boolean) — 'customize' enables custom message display when countdown finishes.",
      customMessage: "string — message to display when countdown reaches zero (used when customize='customize').",
      showDay: "boolean — show the days segment (default true).",
      showHour: "boolean — show the hours segment (default true).",
      showSecond: "boolean — show the seconds segment.",
      showText: "boolean — show unit labels (days/hours/minutes/seconds).",
      animateMode: "'none'|'timer' — 'timer' enables flip-card digit animation.",
      language: "unit-label locale — MUST be one of: vietnam | english | filipino | khmer | lao | indonesian | thai | malay | custom. NOT a code like 'vi'/'en' (that crashes the renderer). For any other language use 'custom' + customTranslation.",
      customTranslation: "object {day,hour,minute,second} of label strings — used (and required) when language='custom'. e.g. {day:'Ngày',hour:'Giờ',minute:'Phút',second:'Giây'}.",
      "config.layout": "(per-breakpoint config) '1' — stacked vertical layout.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 300, 80);
      setStyle(el, "color", "rgba(255, 255, 255, 1)");
      setStyle(el, "background", "rgba(0, 0, 0, 1)");
      setStyle(el, "fontSize", 20);
      el.specials = { type: "minute", duration: "60", language: "english", showDay: true, showHour: true, showSecond: true, showText: true, repeat: false, customize: "nothing", customMessage: "", dailyStart: "", dailyEnd: "" };
    },
  },
  {
    type: "timegroup", category: "marketing", container: false, defaultName: "Time Group",
    summary: "Live current date/time display rendered as text. Supports relative labels (today/yesterday/tomorrow) or fixed datetime, with multiple format presets. specials.text is the REQUIRED static fallback (renders literally for the first second; empty = blank flash).",
    useWhen: "Show today's date, a relative date label, or a formatted timestamp on the page.",
    keySpecials: {
      text: "REQUIRED string — static fallback text rendered for the first second while the JS timer initialises. Empty string = blank flash on load.",
      currentTime: "'yesterday' | 'today' | 'nextday' | 'custom' — which date to display. customDateJump offsets from today when typeTimeGroup==1 && currentTime=='custom'.",
      formatType: "number 1–11 — selects a date/time format preset. AVOID formatType=1 — it hard-codes the America/Los_Angeles timezone.",
      language: "string — word-set for month/day names. Supported: vietnam|english|indonesian|filipino|khmer|thai|malay. Wrong key silently falls back to browser locale.",
      typeTimeGroup: "1 | 2 — 1=relative label (e.g. 'Today'), 2=fixed formatted datetime string. customTime is used ONLY when typeTimeGroup==2.",
      customTime: "string — ISO datetime string to display; used ONLY when typeTimeGroup==2.",
      customDateJump: "number — day offset from today when typeTimeGroup==1 && currentTime=='custom' (positive=future, negative=past).",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 240, 25);
    },
  },
  {
    type: "auto-number", category: "marketing", container: false, defaultName: "Auto Number",
    summary: "Auto-incrementing number that counts up from startNumber to endNumber. jumpNumber is REQUIRED — missing/0 means the counter never moves. timeDelay (legacy) is SECONDS; use timeDelayMs (ms) instead.",
    useWhen: "Social-proof counters (views, orders, customers). Counts up on page load.",
    keySpecials: {
      startNumber: "number — value to start counting from.",
      endNumber: "number — value to count up to.",
      jumpNumber: "REQUIRED number — increment per animation step. Missing or 0 → counter never moves.",
      timeDelayMs: "number (ms) — interval between steps (preferred key).",
      timeDelay: "number (SECONDS, legacy) — interval between steps. Use timeDelayMs instead.",
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
    summary: "Per-visitor persisted incrementing counter (NOT a true random picker). Each page load reads a localStorage value keyed by element id, increments by random(0..jumpNumber) from startNumber, capped at endNumber. Missing startNumber/endNumber/jumpNumber renders literal 'NaN'. All three values are REQUIRED.",
    useWhen: "Randomized social proof (e.g. 'X people viewed this'). All three numbers — startNumber, endNumber, jumpNumber — MUST be set or the element renders 'NaN'.",
    keySpecials: {
      startNumber: "REQUIRED number — initial value (first-visit floor).",
      endNumber: "REQUIRED number — maximum value (cap).",
      jumpNumber: "REQUIRED number — each load adds random(0..jumpNumber) to the stored value. Missing → renders 'NaN'.",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 60, 80);
    },
  },
  {
    type: "notify", category: "marketing", container: false, defaultName: "Notify",
    summary: "'Someone just bought…' toast notification strip. dataType 1 (Google Sheets, DEFAULT) | 2 (dataset) — there is NO dataType 0/static enum. Static data is authored by writing the dataSheet array yourself and leaving source empty. A toast appears only when its image LOADS — broken image URL = invisible notification. No data = no toasts.",
    useWhen: "Social-proof popups showing recent purchases/signups.",
    keySpecials: {
      dataType: "1 (Google Sheets, DEFAULT) | 2 (dataset). NO 0/static value.",
      source: "string — Google Sheets spreadsheet ID (when dataType=1).",
      sheetID: "string — sheet TAB NAME (default 'Sheet1', when dataType=1).",
      dataSheet: "array [{title, content, time, image}] — at publish the builder embeds rows here from the Sheets source; author this array directly for static data (leave source empty).",
      datasetId: "string — webcake dataset ID (when dataType=2).",
      dataSetData: "array — pre-fetched dataset rows.",
      delayStart: "number (ms, floor 1000) — initial delay before the FIRST notification appears.",
      delay: "number (ms, floor 4000) — gap between successive notifications.",
      duration: "number (ms, floor 3000) — how long each notification remains visible.",
      random: "boolean — shuffle display order.",
      soundMode: "'none'|'default'|'link' (NOT a boolean) — 'link' plays notifySoundLink; 'default' plays the built-in sound.",
      notifySoundLink: "string — URL to a custom notification sound file (when soundMode='link').",
      "config.notiPos": "(per-breakpoint config) 'default'|'t-l'|'t-c'|'t-r'|'b-l'|'b-c'|'b-r' — pins the toast fixed to a viewport corner. notiLeft/notiTop/notiRight/notiBottom (default 20) set the corner offset. Canvas top/left only apply with notiPos='default'.",
      "config.title_font": "(per-breakpoint config) number — title font size (default 13).",
      "config.content_font": "(per-breakpoint config) number — content font size (default 12).",
      "config.time_font": "(per-breakpoint config) number — time font size (default 11).",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 300, 62);
    },
  },
  {
    type: "spin-wheel", category: "marketing", container: false, defaultName: "Spin Wheel",
    summary: "Lucky-spin wheel with configurable prize segments and coupon codes. Can open a result popup after spinning and supports dataset-driven coupon lists. popup MUST be the literal string 'default' for the built-in result popup; message is REQUIRED with it (missing → TypeError on win). Segment percents MUST sum to 100 or the winner selection throws.",
    useWhen: "Gamified lead capture / promos. Users spin to win a coupon or prize. Always supply background (wheel face image) + backgroundBtn (spin button image) + code with percents summing to 100 + message.",
    keySpecials: {
      background: "string (URL) — wheel face image (the spinning wheel graphic). Required for visible wheel.",
      backgroundBtn: "string (URL) — spin button image overlaid at the center. Required for functional button.",
      spin: "string number — number of turns per USER, persisted in localStorage (e.g. '10'). NOT a config object.",
      rotate: "string number — initial rotation offset of the wheel in degrees (default '0').",
      rotateBackground: "number (degrees) — rotation offset of the background image (default 0).",
      code: "string (NOT an array) — the segments. ONE LINE PER SEGMENT, each line 'couponCode|Prize Name|percent', lines joined by \\n. Percents MUST sum to 100 or winner selection throws TypeError on click. e.g. 'SALE10|Giảm 10%|40\\nSALE50|Giảm 50%|10\\nMISS|Chúc may mắn|50'.",
      message: "REQUIRED string — result-popup message template shown after a spin (NOT segment labels). REQUIRED when popup='default'; missing → TypeError on win. Supports placeholders {{coupon_text}}, {{coupon_code}}, {{spin_turn_left}}, {{coupon_codes}}.",
      dataType: "0 (static codes, DEFAULT) | 2 (dataset-driven codes via codeDataset column).",
      datasetId: "string — webcake dataset ID for coupon codes (when dataType=2).",
      codeDataset: "string — dataset column key for the coupon code (same code|name|percent format, when dataType=2).",
      popup: "string — 'default' for the built-in result popup (REQUIRED with message); or an element id of a custom popup to open.",
      popupTurnOver: "string — 'default' or element id of popup to open when the user has no turns left.",
      showCoupon: "'yes'|'no' — toggles segment-label visibility on the wheel face.",
      assignCoupon: "'singular' (default, latest code) | any other value (comma-joined list) — auto-fills + disables a form input with field_name 'coupon'.",
      fontSize: "(per-breakpoint STYLE, not special) — font size of segment labels.",
      widthText: "(per-breakpoint STYLE, not special) — text wrap width in segment labels.",
      textAlign: "(per-breakpoint STYLE, not special) 'left'|'center'|'right' — alignment of segment label text.",
      "config.btnSize": "(per-breakpoint config) number — spin button size in px (default 80).",
    },
    seed: (el) => {
      seedPosition(el);
      setBox(el, 400, 400);
      setStyle(el, "color", "rgba(255, 255, 255, 1)");
      el.specials.background = "https://cdn.webcake.co/editor/main/pickers/spin-wheel-default.png";
      el.specials.backgroundBtn = "https://cdn.webcake.co/editor/main/pickers/spin-wheel-btn-default.png";
      el.specials.spin = "10";
      el.specials.rotate = "0";
      el.specials.popup = "default";
      el.specials.popupTurnOver = "default";
      el.specials.showCoupon = "yes";
      // `code` is a newline-delimited string, ONE segment per line `couponCode|Prize Name|percent`.
      // Percents MUST sum to 100.
      el.specials.code = [
        "PRIZE1|Giải 1|20",
        "PRIZE2|Giải 2|20",
        "PRIZE3|Giải 3|20",
        "MISS|Chúc may mắn|40",
      ].join("\n");
      // `message` is the result-popup template (REQUIRED when popup='default').
      el.specials.message = "Chúc mừng! Bạn nhận được {{coupon_text}} (mã: {{coupon_code}}).";
    },
  },
  {
    type: "survey", category: "marketing", container: false, defaultName: "Survey",
    summary: "Survey / image-choice question; each option submits a field. option.title is REQUIRED unless type=='image' — missing title causes a TypeError DURING PAGE BUILD (not at runtime). type enum: 'text' (titles only, no images) | 'image' (images only, no titles) | 'text-image' (both). Empty option.image under text-image renders a stock placeholder — use type:'text' unless real images are supplied.",
    useWhen: "Quizzes, preference capture, image pickers. required works only inside a form. option.value is what connectedForm joins with ', '.",
    keySpecials: {
      type: "'text'(default, titles only) | 'image'(images only, no titles required) | 'text-image'(both). option.title REQUIRED unless type=='image'.",
      multiOption: "boolean — allow selecting multiple options at once.",
      limitOption: "number — max selectable options when multiOption=true (oldest is ejected past the limit).",
      defaultOption: "array of option id strings to pre-select on load.",
      required: "boolean — require at least one selection before the form submits (only works inside a form).",
      scrollAuto: "'yes' | (other) — horizontal auto-scroll strip mode.",
      field_name: "string — form field key these selections map to in the parent form's variation data.",
      connectedForm: "string — id of another form field element to receive the survey values (cross-form wiring; that field needs isConnectSurvey=true + connectedSurvey=this id). option.value is joined with ', '.",
      showInputQuantity: "boolean — render a +/- quantity stepper inside each option. Chosen quantity applies to every variation of the selected option. min/max default 1/10.",
      sprod_id: "string — product id when the survey acts as a WCart attribute selector.",
      sprod_attr: "string — product attribute name this survey selects (e.g. 'Color').",
      sprod_vals: "array of attribute value strings, one per option (indexed by option DOM order).",
      imageHeight: "number (px) — option image height.",
      imageWidth: "number (px) — option image width.",
      alignment: "'center' | 'left' | 'right' — option alignment within the wrapper.",
      selectedColor: "CSS color — text color of selected option (read from specials by CSS).",
      selectedScale: "number (percent) — scale transform of selected option.",
      selectedBackground: "CSS color — background of selected option cards.",
      selectedBorder: "CSS color — border of selected option cards.",
      hoveredColor: "CSS color — text color on hover.",
      hoveredBackground: "CSS color — background on hover.",
      hoveredScale: "number (percent) — scale transform on hover.",
      hoveredBorder: "CSS color — border color on hover.",
      customInputSize: "boolean — enable custom input size.",
      inputWidth: "number (px) — custom option width (when customInputSize=true).",
      inputHeight: "number (px) — custom option height (when customInputSize=true).",
      options: "array of option objects {id, field_name, title (REQUIRED unless type=='image'), image, value, min_quantity, max_quantity, toggleEvent, events_option:[], variations:[], attrOnly/prodId/attrName/attrVal/attrs, quantityOnly/quantityProd/quantityValue, params_value}. Missing title when type!='image' causes a TypeError during page build. See docs/element-specials-reference.md for the full option schema.",
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
        type: "text",
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
