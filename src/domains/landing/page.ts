/**
 * Page-shell builders: the empty top-level source object and its default
 * settings. `createPageSource` returns the real editor shape
 * { page, popup, settings, options, cartConfigs } ready to be filled with
 * sections (and popups). Element nodes themselves come from createElement
 * (see ./elements/index.ts).
 */
import type { ElementNode } from "../../core/element.js";

/** Default page-level settings (subset of the ~44 real keys; covers the essentials). */
export function defaultSettings(overrides: Record<string, any> = {}) {
  return {
    title: "",
    description: "",
    keywords: "",
    robots: "",
    canonical: "",
    favicon: "",
    thumbnail: "",
    fontGeneral: "'Roboto', sans-serif",
    width_section: { desktop: 960, mobile: 420 },
    country: "84",
    // currency lives in settings (the editor's canonical home), NOT in options.
    currency: "VND",
    fb_tracking_code: "",
    tiktok_script: "",
    global_track_ids: [],
    global_tracks: {}, // the editor always re-writes this to {} on save.
    extra_css: "",
    extra_script: "",
    bhet: "", // custom code injected at the end of <head>.
    bbet: "", // custom code injected before </body>.
    global_compress_image: { enable: true, option: 300, keep_solution: false },
    auto_save_draft: true,
    auto_save_info_user: false,
    send_info_to_thank_page: true,
    ...overrides,
  };
}

/**
 * Build a complete, empty top-level page source matching the real editor shape:
 * { page, popup, dynamic_pages, settings, options, cartConfigs, svariations }.
 * Fill `page` with sections. `dynamic_pages`/`svariations` stay empty for static,
 * non-commerce pages but are emitted so edit round-trips don't drop them, and
 * `options` carries only { mobileOnly, versionID } (currency lives in settings).
 */
export function createPageSource(opts: { settings?: Record<string, any>; mobileOnly?: boolean } = {}) {
  return {
    page: [] as ElementNode[],
    popup: [] as ElementNode[],
    dynamic_pages: [] as ElementNode[],
    settings: defaultSettings(opts.settings ?? {}),
    options: { mobileOnly: opts.mobileOnly ?? false, versionID: null },
    cartConfigs: { isActive: false },
    svariations: [] as any[],
  };
}
