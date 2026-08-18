/**
 * One prompt and one schema, shared by every provider.
 *
 * Consensus only means something if both models are asked the same question in
 * the same words — otherwise a disagreement tells you about the prompts rather
 * than about the receipt.
 */

export const SYSTEM_PROMPT = `You extract structured data from expense receipts for a corporate card reconciliation system. Receipts come from India and from anywhere in Europe.

Return ONLY a JSON object. No prose, no markdown fence.

FIELDS
- doc_type: one of tax_invoice, pos_slip, e_invoice, boarding_pass, other
- merchant: the trading name, cleaned and canonical (e.g. "Indian Oil", "Amazon", "Cervejaria Ramiro")
- merchant_raw: the merchant line exactly as printed, verbatim
- total: the amount ACTUALLY CHARGED — the grand total after tax, service charge, tip and rounding
- subtotal: pre-tax amount if printed, else null
- tax_total: total tax if printed, else null
- currency: ISO 4217 code (INR, EUR, GBP, CHF, CZK, ...) inferred from symbol, language or country
- date: the transaction date exactly as printed, as a string; do not reformat it
- time: HH:MM 24-hour if printed, else null
- invoice_no: bill or invoice number, else null
- tax_id: GSTIN (India) or VAT number (Europe), else null
- card_last4: last 4 digits of the card if the slip prints them, else null
- country: ISO 3166-1 alpha-2 for where the receipt was issued
- city: city if identifiable, else null
- language: ISO 639-1 of the receipt's language
- dcc_amount_inr: if the terminal ALSO charged in INR (dynamic currency conversion), that INR amount; else null
- line_items: array of { desc, amount }, empty if not itemised
- tax_breakdown: array of { label, rate_pct, amount } (IVA, TVA, MwSt, BTW, DPH, VAT, CGST, SGST); empty if absent
- confidence: your own 0..1 confidence in the total and date specifically
- unreadable_fields: array of field names you could not read

RULES
1. NEVER invent a value. If a field is illegible or absent, return null and name it in unreadable_fields. A null we can ask about is cheap; a fabricated tax number in a statutory filing is not.
2. total is the amount charged to the card, not the pre-tax figure and not the subtotal. If a tip or service charge was added by hand, include it.
3. Do NOT convert currency. Report the amount in the currency printed on the receipt.
4. Do NOT reformat the date. Return the printed characters, e.g. "12/08/2026" or "12.08.2026". Downstream code resolves the format using the country.
5. Read numbers exactly as grouped. "1.234,56" is one thousand two hundred thirty four point five six. "1,234.56" is the same value written the other way. Never drop or move a separator.
6. If the slip shows two currencies (a foreign amount and an INR amount), the foreign one is total/currency and the INR one is dcc_amount_inr.
7. If the image is not a receipt at all, set doc_type to "other" and total to null.`;

export const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "doc_type",
    "merchant",
    "merchant_raw",
    "total",
    "subtotal",
    "tax_total",
    "currency",
    "date",
    "time",
    "invoice_no",
    "tax_id",
    "card_last4",
    "country",
    "city",
    "language",
    "dcc_amount_inr",
    "line_items",
    "tax_breakdown",
    "confidence",
    "unreadable_fields",
  ],
  properties: {
    doc_type: { type: "string" },
    merchant: { type: ["string", "null"] },
    merchant_raw: { type: ["string", "null"] },
    total: { type: ["number", "string", "null"] },
    subtotal: { type: ["number", "string", "null"] },
    tax_total: { type: ["number", "string", "null"] },
    currency: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    time: { type: ["string", "null"] },
    invoice_no: { type: ["string", "null"] },
    tax_id: { type: ["string", "null"] },
    card_last4: { type: ["string", "null"] },
    country: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    language: { type: ["string", "null"] },
    dcc_amount_inr: { type: ["number", "string", "null"] },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["desc", "amount"],
        properties: {
          desc: { type: ["string", "null"] },
          amount: { type: ["number", "string", "null"] },
        },
      },
    },
    tax_breakdown: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "rate_pct", "amount"],
        properties: {
          label: { type: ["string", "null"] },
          rate_pct: { type: ["number", "string", "null"] },
          amount: { type: ["number", "string", "null"] },
        },
      },
    },
    confidence: { type: ["number", "null"] },
    unreadable_fields: { type: "array", items: { type: "string" } },
  },
};

export const USER_PROMPT =
  "Extract this receipt. Return only the JSON object described in your instructions.";

/**
 * Models can still wrap JSON in prose or a fence despite instructions.
 * Recover the object rather than failing the whole read over formatting.
 */
export function parseModelJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
