import { z } from "zod";

// Typed stand-ins for z.any(): directory reviewers (and some clients) reject
// params whose JSON Schema has no `type`. Handlers still parse JSON strings.
// Fresh instance per use: a shared one makes zod-to-json-schema emit a `$ref`.
const jsonObject = () => z.record(z.any());
/** A JSON object, or a JSON string of one. */
export const objectOrJson = () => z.union([jsonObject(), z.string()]);
/** A JSON object, an array of them, or a JSON string of either. */
export const objectsOrJson = () => z.union([jsonObject(), z.array(jsonObject()), z.string()]);
