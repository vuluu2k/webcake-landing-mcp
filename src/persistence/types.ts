/**
 * Shared types for the Webcake persistence layer: the resolved config and the
 * response shapes the backend client returns.
 */

export type WebcakeConfig = {
  base: string;
  jwt: string;
  orgId?: string;
  /** SPA base — used for the login connect page (`<appBase>/mcp-connect`). */
  appBase?: string;
  /** Page-builder host that serves the editor/preview URL (`/editor/v2`) returned after create/update. */
  builderBase?: string;
  /**
   * Public preview host that serves `/preview/<page_id>`. The v4 renderer there serves
   * the STORED `app`/`app_css` build columns — NOT raw source. An MCP-created page's
   * preview is blank until publish_page (with buildBase configured) runs or the page
   * is re-saved in the Webcake editor. This is NOT the builder subdomain:
   * preview.localhost:5800 local / staging.webcake.me staging / www.webcake.me prod.
   */
  previewBase?: string;
  /**
   * Webcake build-host base URL for `POST <buildBase>/render/build` — the standalone
   * render service that produces `app`/`app_css` HTML from a page source. Required for
   * publish_page to produce a rendered (non-blank) page. Prod default:
   * https://build.webcake.io. Staging/local have no reliable public host — set
   * WEBCAKE_BUILD_BASE or send the x-webcake-build-base header explicitly.
   */
  buildBase?: string;
};

export type Organization = { id: number | string; name: string; type: number | null; is_default: boolean };

export type CreateOutcome = {
  ok: boolean;
  status: number;
  page_id?: string;
  editor_url?: string;
  preview_url?: string;
  organization_id?: number | string | null;
  raw?: unknown;
  error?: string;
};

export type PageSummary = {
  id: string;
  name: string;
  organization_id: number | string | null;
  engine?: number;
  custom_domain?: string | null;
  default_domain?: string | null;
  updated_at?: string;
};
