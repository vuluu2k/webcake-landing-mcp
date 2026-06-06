/**
 * Page-shell builders: the empty top-level source object and its default
 * settings. `createPageSource` returns the real editor shape
 * { page, popup, settings, options, cartConfigs } ready to be filled with
 * sections (and popups). Element nodes themselves come from createElement
 * (see ./elements/index.ts).
 */
import type { ElementNode } from "../../core/element.js";

/** Default page-level settings (subset of the ~40 real keys; covers the essentials). */
export function defaultSettings(overrides: Record<string, any> = {}) {
  return {
    title: "",
    description: "",
    keywords: "",
    favicon: "",
    thumbnail: "",
    fontGeneral: "'Roboto', sans-serif",
    width_section: { desktop: 960, mobile: 420 },
    country: "84",
    fb_tracking_code: "",
    tiktok_script: "",
    global_track_ids: [],
    extra_css: "",
    extra_script: "",
    auto_save_draft: true,
    auto_save_info_user: false,
    send_info_to_thank_page: true,
    ...overrides,
  };
}

/**
 * Build a complete, empty top-level page source matching the real editor shape:
 * { page, popup, settings, options, cartConfigs }. Fill `page` with sections.
 */
export function createPageSource(opts: { settings?: Record<string, any>; mobileOnly?: boolean } = {}) {
  return {
    page: [] as ElementNode[],
    popup: [] as ElementNode[],
    settings: defaultSettings(opts.settings ?? {}),
    options: { currency: "VND", mobileOnly: opts.mobileOnly ?? false, versionID: null },
    cartConfigs: {},
  };
}
