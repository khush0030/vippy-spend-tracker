/**
 * Putting a parsed batch back together with the emails it came from.
 *
 * The prompt tells the model to skip emails that carry no money movement, so
 * the array it returns is often shorter than the batch. Pairing by position
 * then files every row after a skipped email under the wrong email id. The
 * model echoes each email's id instead, and rows are paired by that.
 *
 * No @/ imports: node --test runs this file directly.
 */

export function pairRowsWithEmails(parsed, batch) {
  const rows = Array.isArray(parsed) ? parsed : [];
  const byId = new Map(batch.map((e) => [e.id, e]));

  if (rows.length && rows.every((r) => r && r.emailId != null)) {
    return rows.filter((r) => byId.has(String(r.emailId))).map((r) => [r, byId.get(String(r.emailId))]);
  }

  // A model that ignored the id instruction: position is only safe when
  // nothing was skipped.
  if (rows.length === batch.length) return rows.map((r, i) => [r, batch[i]]);
  if (!rows.length) return [];
  throw new Error(`cannot pair ${rows.length} rows with ${batch.length} emails without email ids`);
}

const LEGAL_SUFFIX =
  /[\s,]+(private\s+limited|pvt\.?\s*ltd\.?|pvt\.?|limited|ltd\.?|llp|inc\.?|corp\.?|b\.\s*v\.?|gmbh|s\.\s*r\.\s*o\.?|ag|sa|s\.\s*a\.?|plc|co\.?)$/i;

/** "Zomato Limited" -> "Zomato", "RAMEN-ISM B.V." -> "Ramen-Ism". */
export function canonicalMerchant(name) {
  let s = String(name ?? "").trim();
  for (let prev = null; prev !== s; ) {
    prev = s;
    s = s.replace(LEGAL_SUFFIX, "").trim();
  }
  s = s.replace(/[\s,]+$/, "");
  if (!s) return "Unknown";

  // Shouting names from card descriptors read better title-cased; short
  // acronyms (KFC, GMR) are left alone.
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length > 4 && letters === letters.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
  }
  return s;
}
