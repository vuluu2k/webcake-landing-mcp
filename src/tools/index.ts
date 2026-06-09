/**
 * Tool registration: wire every tool group onto the server for a given Domain.
 * Grouped by need — reference + generation work offline; persistence needs env.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Domain } from "../core/domain.js";
import { registerReferenceTools } from "./reference.js";
import { registerGenerationTools } from "./generation.js";
import { registerMediaTools } from "./media.js";
import { registerIngestTools } from "./ingest.js";
import { registerPersistenceTools } from "./persistence.js";

export function registerTools(server: McpServer, domain: Domain) {
  registerReferenceTools(server, domain);
  registerGenerationTools(server, domain);
  registerMediaTools(server);
  registerIngestTools(server);
  registerPersistenceTools(server, domain);
}
