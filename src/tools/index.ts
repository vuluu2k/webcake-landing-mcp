/**
 * Tool registration: wire every tool group onto the server for a given Domain.
 * Grouped by need — reference + generation work offline; persistence needs env.
 *
 * `allowLocalFiles` (default true) is passed to registerMediaTools. It must be
 * set to false when the server runs in remote HTTP (serve) mode so that the
 * upload_images tool cannot read arbitrary files from the host filesystem.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { registerReferenceTools } from "./reference.js";
import { registerGenerationTools } from "./generation.js";
import { registerMediaTools } from "./media.js";
import { registerIngestTools } from "./ingest.js";
import { registerPersistenceTools } from "./persistence.js";

export function registerTools(server: McpServer, domain: Domain, { allowLocalFiles = true }: { allowLocalFiles?: boolean } = {}) {
  registerReferenceTools(server, domain);
  registerGenerationTools(server, domain);
  registerMediaTools(server, allowLocalFiles);
  registerIngestTools(server, domain);
  registerPersistenceTools(server, domain);
}
