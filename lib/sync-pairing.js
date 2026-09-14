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
    // The model can echo the same emailId twice; upserting both would try to
    // write two rows onto one (email_id, user_id) conflict target. Keep only
    // the first.
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const id = String(r.emailId);
      if (!byId.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push([r, byId.get(id)]);
    }
    return out;
  }

  // A model that ignored the id instruction: position is only safe when
  // nothing was skipped.
  if (rows.length === batch.length) return rows.map((r, i) => [r, batch[i]]);
  if (!rows.length) return [];
  throw new Error(`cannot pair ${rows.length} rows with ${batch.length} emails without email ids`);
}

// "co." dropped deliberately: it would also eat the "Co" in "Tiffany & Co".
const LEGAL_SUFFIX =
  /[\s,]+(private\s+limited|pvt\.?\s*ltd\.?|pvt\.?|limited|ltd\.?|llp|inc\.?|corp\.?|b\.\s*v\.?|gmbh|s\.\s*r\.\s*o\.?|ag|sa|s\.\s*a\.?|plc)$/i;

/**
 * "Zomato Limited" -> "Zomato", "RAMEN-ISM B.V." -> "RAMEN-ISM".
 *
 * Only strips legal-entity dressing — the prompt already asks the model for
 * a canonical brand name, so this must not rewrite casing it got right
 * ("IRCTC", "PVR INOX" stay as written).
 */
export function canonicalMerchant(name) {
  let s = String(name ?? "").trim();
  for (let prev = null; prev !== s; ) {
    prev = s;
    s = s.replace(LEGAL_SUFFIX, "").trim();
  }
  s = s.replace(/[\s,]+$/, "");
  if (!s) return "Unknown";
  return s;
}
