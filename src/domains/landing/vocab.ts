/**
 * Landing-page vocabulary: the fixed canvas, the event triggers, and the
 * per-trigger action maps. "Extra:" notes list the action-specific event-object
 * fields the render_v4 dispatcher reads beyond { id, type, action, target }.
 * Derived from assets/render_v4/event/index.js.
 */

export const CANVAS = { desktopWidth: 960, mobileWidth: 420, defaultSectionHeight: 800 };

/**
 * Element types the runtime animator handles.
 * Source: landing_page_build/render/build/animate.js — the switch statement
 * that emits the animation CSS class only covers these 9 types. Any other type
 * with config.animation.name != 'none' produces a broken CSS selector and the
 * element stays in the pre-animation (dim/hidden) state permanently.
 */
export const ANIMATABLE_TYPES = new Set([
  "group", "image-block", "text-block", "rectangle", "button",
  "countdown", "line", "list-paragraph", "notify",
]);

/**
 * Valid animation name values accepted by the editor and the renderer.
 * Source: landing_page_backend/assets/editor/main/traits/TraitAnimation.vue
 * (the animate.css-backed option list). Any name outside this set produces
 * an unknown keyframe — the animation never runs and the element may render stuck.
 */
export const ANIMATION_NAMES = new Set([
  "none",
  "bounce", "flash", "pulse", "rubberBand", "shakeX", "shakeY", "headShake",
  "swing", "swingCenter", "tada", "wobble", "jello", "heartBeat",
  "backInDown", "backInLeft", "backInRight", "backInUp",
  "backOutDown", "backOutLeft", "backOutRight", "backOutUp",
  "bounceIn", "bounceInDown", "bounceInLeft", "bounceInRight", "bounceInUp",
  "bounceOut", "bounceOutDown", "bounceOutLeft", "bounceOutRight", "bounceOutUp",
  "fadeIn", "fadeInDown", "fadeInDownBig", "fadeInLeft", "fadeInLeftBig",
  "fadeInRight", "fadeInRightBig", "fadeInUp", "fadeInUpBig",
  "fadeInTopLeft", "fadeInTopRight", "fadeInBottomLeft", "fadeInBottomRight",
  "fadeOut", "fadeOutDown", "fadeOutDownBig", "fadeOutLeft", "fadeOutLeftBig",
  "fadeOutRight", "fadeOutRightBig", "fadeOutUp", "fadeOutUpBig",
  "fadeOutTopLeft", "fadeOutTopRight", "fadeOutBottomRight", "fadeOutBottomLeft",
  "flip", "flipInX", "flipInY", "flipOutX", "flipOutY",
  "lightSpeedInRight", "lightSpeedInLeft", "lightSpeedOutRight", "lightSpeedOutLeft",
  "rotateIn", "rotateInDownLeft", "rotateInDownRight", "rotateInUpLeft", "rotateInUpRight",
  "rotateOut", "rotateOutDownLeft", "rotateOutDownRight", "rotateOutUpLeft", "rotateOutUpRight",
  "hinge", "jackInTheBox", "rollIn", "rollOut",
  "zoomIn", "zoomInDown", "zoomInLeft", "zoomInRight", "zoomInUp",
  "zoomOut", "zoomOutDown", "zoomOutLeft", "zoomOutRight", "zoomOutUp",
  "slideInDown", "slideInLeft", "slideInRight", "slideInUp",
  "slideOutDown", "slideOutLeft", "slideOutRight", "slideOutUp",
]);

export const EVENT_TRIGGERS = ["click", "hover", "success", "error", "unset", "delay"] as const;

// Click-trigger actions. "Extra:" lists the action-specific event-object fields
// the dispatcher reads beyond { id, type, action, target } (render_v4/event/index.js).
export const CLICK_ACTIONS: Record<string, string> = {
  none: "Do nothing.",
  open_link: "Open a URL. target = URL. Extra: targetURL ('_blank'|'_self'), open_link_with_params (bool), send_to_thank_page (bool), delayTime (seconds).",
  open_popup: "Open a popup. target = popup element id. Extra: animation, reverseAnimation.",
  close_popup: "Close a popup. target = popup element id. Extra: animation.",
  scroll_to: "Smooth-scroll to an element. target = element/section id. Extra: scrollMore (bonus px offset).",
  show_section: "Show a hidden section. target = section id.",
  hide_section: "Hide a section. target = section id.",
  show_hide_element: "Toggle element visibility. target = element id (comma-separated list allowed). Extra: onlyMode ('show'|'hide'), animation, animationOut.",
  change_tab: "Switch tab/slide in a gallery/carousel. target = container id. Extra: moveTo ('prev'|'next'|'index'), tabIndex.",
  lightbox: "Open in a lightbox. target = image/video/iframe URL. Extra: typeLightbox ('image'|'video'|'iframe'), alt.",
  copy: "Copy to clipboard. target = the text; OR an element id when copyType='elementValue'. Extra: copyType.",
  collapse: "Collapse/expand. target = element id.",
  set_field_value: "Set a form field value. target = field_name (or w-<element id>). Extra: set_value (the value to set).",
  back_to: "Go back in browser history (history.back()). target = none.",
  share: "Share the current page URL. target = platform name: 'Facebook'|'Twitter'|'Custom'.",
  play_audio: "Play audio. target = audio file URL (NOT an element id).",
  stop_audio: "Stop audio. target = the same audio file URL (NOT an element id).",
  open_sms: "Send SMS. target = phone number. Extra: smsBody (message body).",
  send_email: "Open mail client. target = email address (mailto:).",
  download_file: "Download a file. target = file URL. Extra: nameFile (overrides the saved filename).",
  close_webview: "Close a Facebook/Messenger in-app webview. target = none.",
  open_cart: "Open the cart drawer (WCart).",
  add_to_cart: "Add a product to the cart. Uses specials.sprod/svariant/squantity (or event.sprod_id/svariant/squantity); target unused.",
  open_app: "Open chat/app. event.appTarget selects the provider (botcake|botcake_dynamic|whatsapp|mess_prefill|tiktok_prefill|line_prefill|others); target = destination URL/phone/ref. Extra: wa_custom_text, line_custom_text, formIdLink (per provider).",
  change_color: "Change a color. Acts on the trigger element, or target_element for a cross-element change. Extra: change_color_type, change_color, target_mode, target_element.",
  custom_js: "Run custom JS. Extra: custom_js (the code string).",
};

export const HOVER_ACTIONS: Record<string, string> = {
  change_color: "Change color on hover. Extra: change_color, change_color_type, hoverText, hoverBorder, target_mode, target_element.",
  change_background: "Change background on hover. Extra: hoverColor (applied via --hover-color).",
  change_text_color: "Change text color on hover. Extra: hoverText.",
  change_underline: "Underline on hover.",
  change_overline: "Overline on hover.",
  animation_hover: "Play a hover animation. target = none.",
  show_hide_element: "Reveal/hide a target element on hover. target = element id. Extra: animation, animationOut.",
};

// Actions on a FORM's own events array, fired AFTER a successful submit (type:"success").
// target semantics match the click action of the same name.
export const SUCCESS_ACTIONS: Record<string, string> = {
  phone_call: "Call a number. target = phone number (tel:).",
  open_sms: "Send SMS. target = phone number. Extra: smsBody.",
  send_email: "Open mail client. target = email address.",
  open_link: "Open a URL. target = URL. Extra: targetURL ('_blank'|'_self').",
  scroll_to: "Scroll to an element. target = element id. Extra: scrollMore.",
  open_popup: "Open a popup. target = popup id.",
  close_popup: "Close a popup. target = popup id.",
  download_file: "Download a file. target = file URL. Extra: nameFile.",
  show_hide_element: "Toggle visibility. target = element id. Extra: onlyMode.",
  show_section: "Show a section. target = section id.",
  hide_section: "Hide a section. target = section id.",
  close_webview: "Close a Facebook/Messenger webview. target = none.",
  change_tab: "Switch tab/slide. target = container id. Extra: moveTo, tabIndex.",
};

// Actions on a FORM's events array, fired when validation FAILS (type:"error").
export const ERROR_ACTIONS: Record<string, string> = {
  open_popup: "Open a popup. target = popup id.",
  close_popup: "Close a popup. target = popup id.",
  show_hide_element: "Toggle visibility. target = element id. Extra: onlyMode.",
};

// Actions on ANY element's events array, fired when it scrolls into view (type:"delay").
export const DELAY_ACTIONS: Record<string, string> = {
  show_element: "Reveal this element after a delay. Extra: delay_multiplier (ms, default 1000).",
  hide_element: "Hide this element after a delay. Extra: delay_multiplier (ms, default 1000).",
};
