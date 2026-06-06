/**
 * Shared MCP response helpers. `text()` wraps any value as a single text content
 * block (objects are pretty-printed JSON) — the shape every tool returns.
 */
export function text(value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: body }] };
}
