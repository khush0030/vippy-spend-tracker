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
 * What each field means, for a reader that takes a schema rather than a
 * prompt. The wording mirrors the FIELDS section of receipt-prompt.js so both
 * readers are asked the same question.
 */
const FIELD_DESCRIPTIONS = {
  doc_type: "one of tax_invoice, pos_slip, e_invoice, boarding_pass, other",
  merchant: "the trading name, cleaned and canonical (e.g. Indian Oil, Amazon, Cervejaria Ramiro)",
  merchant_raw: "the merchant line exactly as printed, verbatim",
  total: "the amount actually charged: the grand total after tax, service charge, tip and rounding, in the currency printed",
  subtotal: "pre-tax amount if printed, else null",
  tax_total: "total tax if printed, else null",
  currency: "ISO 4217 code (INR, EUR, GBP, CHF, CZK, ...) inferred from symbol, language or country",
  date: "the transaction date exactly as printed, as a string; do not reformat it",
  time: "HH:MM 24-hour if printed, else null",
  invoice_no: "bill or invoice number, else null",
  tax_id: "GSTIN (India) or VAT number (Europe), else null",
  card_last4: "last 4 digits of the card if the slip prints them, else null",
  country: "ISO 3166-1 alpha-2 for where the receipt was issued",
  city: "city if identifiable, else null",
  language: "ISO 639-1 of the receipt's language",
  dcc_amount_inr: "if the terminal also charged in INR (dynamic currency conversion), that INR amount; else null",
  line_items: "itemised lines, empty if not itemised",
  desc: "the line item description as printed",
  amount: "the amount for this line, as printed",
  tax_breakdown: "tax lines (IVA, TVA, MwSt, BTW, DPH, VAT, CGST, SGST); empty if absent",
  label: "the tax label as printed",
  rate_pct: "the tax rate in percent, else null",
  confidence: "confidence 0..1 in the total and date specifically",
  unreadable_fields: "names of fields that could not be read",
};

/**
 * Photograph geometry, not a document field: only the vision reader that sees
 * the raw photo is asked where the paper sits.
 */
const NOT_FOR_SARVAM = new Set(["corners"]);

/**
 * Sarvam Extract wants a described field list, not a validator. It rejects
 * `required`, `additionalProperties`, union types and undescribed fields.
 */
export function sarvamSchemaFrom(schema, key = null) {
  if (Array.isArray(schema)) return schema.map((v) => sarvamSchemaFrom(v));
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "required" || k === "additionalProperties") continue;
    if (k === "type" && Array.isArray(v)) {
      // The first non-null member is the one the field is really for; an
      // absent value comes back null regardless.
      out.type = v.find((t) => t !== "null") ?? "string";
      continue;
    }
    if (k === "properties") {
      out.properties = {};
      for (const [name, sub] of Object.entries(v)) {
        if (NOT_FOR_SARVAM.has(name)) continue;
        out.properties[name] = sarvamSchemaFrom(sub, name);
      }
      continue;
    }
    out[k] = sarvamSchemaFrom(v, k === "items" ? key : null);
  }
  if (key && out.type && !out.description) {
    out.description = FIELD_DESCRIPTIONS[key] || key.replace(/_/g, " ");
  }
  return out;
}

/**
 * Extract returns `{ data, field_confidence, field_sources }`; the fields are
 * under `data`. A bare object is passed through.
 */
export function normaliseSarvamResult(obj) {
  if (!obj || typeof obj !== "object") return obj;
  for (const key of ["data", "fields"]) {
    if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) return obj[key];
  }
  return obj;
}
