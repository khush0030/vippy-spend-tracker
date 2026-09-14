import { parseModelRef } from "./llm.js";

/**
 * The decisions receipt-vision.js makes that need no network.
 *
 * Kept apart so node --test can reach them: receipt-vision.js imports
 * through @/ and cannot be loaded without a bundler.
 */

export function readerKind(ref) {
  const { provider, model } = parseModelRef(ref);
  if (provider === "openai") return "openai";
  if (provider === "sarvam" && model === "extract") return "sarvam-extract";
  throw new Error(`${ref} cannot read a receipt: use openai:<vision model> or sarvam:extract`);
}

/**
 * Sarvam Extract wants a description of the fields, not a validator. It does
 * not honour `required` or `additionalProperties`, and OpenAI's strict-mode
 * schema carries both at every level.
 */
export function sarvamSchemaFrom(schema) {
  if (Array.isArray(schema)) return schema.map(sarvamSchemaFrom);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "required" || k === "additionalProperties") continue;
    out[k] = sarvamSchemaFrom(v);
  }
  return out;
}

/** Extract results have been seen both bare and under a single wrapper key. */
export function normaliseSarvamResult(obj) {
  if (!obj || typeof obj !== "object") return obj;
  for (const key of ["fields", "data"]) {
    if (obj[key] && typeof obj[key] === "object" && Object.keys(obj).length === 1) return obj[key];
  }
  return obj;
}
