/**
 * Statement lines — classification and the control total.
 *
 * The statement is the bank's own ledger and the final ground truth for a
 * cycle. Everything here is pure so the arithmetic that decides whether a
 * submission may leave the building is testable without a database, a model,
 * or a PDF.
 */

const LINE_TYPES = ["purchase", "refund", "fee", "payment", "chargeback"];

// A dispute, in either direction. Checked first: a provisional credit must
// never be filed as a settled merchant refund.
const CHARGEBACK = /\b(charge\s?backs?|disputed?|dispute[sd]?)\b/i;

/**
 * The bank's own charges. Deliberately anchored rather than matching a bare
 * "charge": a fee line is never chased for a receipt, so a purchase misread as
 * a fee would be silently waived. `\bcharges?\b` therefore only counts when it
 * carries one of HDFC's qualifiers — "CHARGE POINT" stays a purchase.
 */
const FEE = new RegExp(
  [
    String.raw`\bfees?\b`,
    String.raw`\b(late\s?payment|finance|service|misc\w*|other|over\s?limit|overlimit|interest)\b[\s\w%@.]*\bcharges?\b`,
    String.raw`\binterest\b`,
    String.raw`\b(mark\s?up|surcharge)\b`,
    String.raw`\b([ic]gst|sgst|utgst|gst|vat|cess)\b`,
    String.raw`\bcash\s?advance\b`,
  ].join("|"),
  "i"
);

// Money going back to the bank rather than out to a merchant.
const PAYMENT = /\b(payment|autopay|auto\s?pay|neft|imps|rtgs|thank\s?you)\b/i;

/**
 * Which of the five buckets a line belongs to.
 *
 * Order matters: a dispute outranks a fee, a fee reversal outranks a payment,
 * and only what survives all three is treated as merchant money.
 */
export function classifyLine({ descriptor = "", direction = "debit" } = {}) {
  const text = String(descriptor || "");

  if (CHARGEBACK.test(text)) return "chargeback";
  if (FEE.test(text)) return "fee";
  if (direction === "credit") return PAYMENT.test(text) ? "payment" : "refund";
  return "purchase";
}

/** "1,58,204.00 Cr" → 158204. Indian digit grouping, trailing Dr/Cr markers. */
function parseStatementAmount(input) {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (input == null) return null;

  const cleaned = String(input)
    .replace(/[₹$€£]/g, "")
    .replace(/\b(dr|cr)\b\.?/gi, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();

  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function creditMarker(input) {
  return /\bcr\b\.?/i.test(String(input ?? ""));
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * One parsed line into the shape the rest of the pipeline uses: amount always
 * positive, direction explicit. Statements express credits three different
 * ways — a `Cr` marker, a minus sign, or a separate column — so all three are
 * read, in that order of trust.
 */
export function normalizeStatementLine(raw = {}, index = 0) {
  const rawAmount = raw.amount ?? raw.amount_inr ?? raw.value;
  const parsed = parseStatementAmount(rawAmount);

  const explicit =
    raw.direction === "credit" || raw.direction === "debit" ? raw.direction : null;

  const direction =
    explicit ||
    (raw.cr === true || raw.isCredit === true || creditMarker(rawAmount)
      ? "credit"
      : parsed != null && parsed < 0
        ? "credit"
        : "debit");

  const descriptor = String(raw.description ?? raw.descriptor ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const txnDate = raw.date ?? raw.txnDate ?? raw.txn_date ?? null;
  const type = LINE_TYPES.includes(raw.type)
    ? raw.type
    : classifyLine({ descriptor, direction });

  return {
    lineNo: index + 1,
    txnDate,
    postDate: raw.postDate ?? raw.post_date ?? txnDate,
    descriptor,
    amount: parsed == null ? 0 : round2(Math.abs(parsed)),
    direction,
    type,
    currency: raw.currency ?? null,
    amountOrig:
      raw.amountOriginal ?? raw.amountOrig ?? raw.amount_orig ?? raw.originalAmount ?? null,
  };
}

/**
 * Debits, credits and payments, kept apart.
 *
 * A payment is a credit on the account but not money coming back from a
 * merchant, so it is summed separately — otherwise the control total below
 * would double-count it and never balance.
 */
export function sumByDirection(lines = []) {
  let debits = 0;
  let credits = 0;
  let payments = 0;

  for (const l of lines) {
    const amount = Math.abs(Number(l.amount) || 0);
    if (l.type === "payment") payments += amount;
    else if (l.direction === "credit") credits += amount;
    else debits += amount;
  }

  return { debits: round2(debits), credits: round2(credits), payments: round2(payments) };
}

/**
 * opening + debits − credits − payments = closing.
 *
 * This is the claim the bundle makes to accounts, so it is checked to the
 * rupee. Anything left over is the amount we cannot explain, and the cycle is
 * blocked until it is.
 */
export function controlTotal({ opening, debits, credits, payments, closing, tolerance = 0.5 } = {}) {
  const expected = round2(
    Number(opening || 0) + Number(debits || 0) - Number(credits || 0) - Number(payments || 0)
  );

  if (closing == null || !Number.isFinite(Number(closing))) {
    return { expected, diff: null, tiesOut: false, reason: "no closing balance parsed" };
  }

  const diff = round2(expected - Number(closing));
  return { expected, diff, tiesOut: Math.abs(diff) <= tolerance };
}

export { LINE_TYPES };

/** Header fields, in the order a merge prefers them: earliest page wins. */
const HEADER_FIELDS = [
  "cardLast4",
  "statementDate",
  "dueDate",
  "periodStart",
  "periodEnd",
  "openingBalance",
  "closingBalance",
  "totalDebits",
  "totalCredits",
  "minimumDue",
];

/**
 * Stitch several page-range reads back into one statement.
 *
 * The statement is transcribed a few pages at a time, so the pieces arrive
 * separately and in whatever order they finished. Order is restored by page
 * number rather than completion, because the line order on a statement is
 * information: it is the order accounts reads them in, and the order the
 * reconciliation cites.
 *
 * Header figures are printed on one page or another — the opening balance up
 * front, the closing total at the back — so each is taken from the earliest
 * page that had it. A chunk that could not be read at all is named in `unread`
 * rather than quietly reducing the statement, because a statement missing four
 * pages must never pass for a complete one.
 */
export function mergeChunkReads(chunks) {
  const ordered = [...(chunks || [])].sort((a, b) => a.from - b.from);

  const lines = [];
  const unread = [];
  const merged = {};

  for (const chunk of ordered) {
    if (!chunk?.json || !Array.isArray(chunk.json.lines)) {
      unread.push(`${chunk?.from}-${chunk?.to}`);
      continue;
    }

    for (const field of HEADER_FIELDS) {
      if (merged[field] == null && chunk.json[field] != null) merged[field] = chunk.json[field];
    }

    lines.push(...chunk.json.lines);
  }

  return { ...merged, lines, unread };
}
