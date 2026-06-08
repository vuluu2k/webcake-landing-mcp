/**
 * Tiny zero-dependency `.env` loader. We publish to npm, so every dependency
 * ships to users — instead of pulling in `dotenv`, parse a `.env` ourselves.
 *
 * Looks for a `.env` in the current working directory first, then next to the
 * running binary (dist/), so it works both for local dev and a deployed server.
 * Only sets keys that are NOT already in process.env — real env vars and the
 * per-request HTTP headers always win over the file. stdout is the MCP channel,
 * so any parse note goes to stderr.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    // Strip a single surrounding pair of quotes, if present.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Candidate `.env` locations, in priority order (cwd, then the binary's dir + parent). */
function candidatePaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url)); // dist/ at runtime
  return [join(process.cwd(), ".env"), join(here, ".env"), join(here, "..", ".env")];
}

/** Load the first readable `.env`, assigning only keys absent from process.env. */
export function loadDotenv(): void {
  const seen = new Set<string>();
  for (const path of candidatePaths()) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue; // no file here — try the next candidate
    }
    for (const [k, v] of Object.entries(parseEnv(text))) {
      if (seen.has(k)) continue;
      seen.add(k);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
