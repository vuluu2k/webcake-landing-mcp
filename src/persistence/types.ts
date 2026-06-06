/**
 * Shared types for the Webcake persistence layer: the resolved config and the
 * response shapes the backend client returns.
 */

export type WebcakeConfig = {
  base: string;
  jwt: string;
  orgId?: string;
  appBase?: string;
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
  updated_at?: string;
};
