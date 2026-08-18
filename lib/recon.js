import { merchantSimilarity, dayDiff } from "./matcher.js";
import { sumByDirection, controlTotal, round2 } from "./statement-lines.js";

/**
 * Three-way reconciliation: statement lines ↔ app transactions ↔ receipts.
 *
 * Until now the app's picture of a month came only from alert emails, which is
 * a lossy source — alerts get missed, sync windows slip, refunds arrive
 * quietly. The statement is the bank's own ledger, so it outranks everything
 * else here: where the two disagree, the statement wins and the app is
 * corrected, never the other way round.
 *
 * Every line must land in exactly one bucket. Anything that cannot be placed
 * goes to `unexplained` and blocks the cycle rather than being dropped, because
 * a silently discarded line is a wrong number sent to accounts.
 *
 * Pure: no database, no model, no clock beyond the `asOf` passed in.
 */

/** Buckets that own statement lines. Their union must equal the input lines. */
export const BUCKETS = [
  "tied",
  "createdFromStatement",
  "refundsConfirmed",
  "fees",
  "payments",
  "chargebacks",
  "unexplained",
];

// Both sides quote INR from the same source — HDFC's own alert and HDFC's own
// statement — so unlike receipt matching this can demand amount equality.
const AMOUNT_TOLERANCE = 0.5;

// An alert lands at swipe time; the statement prints the transaction date. A
// couple of days of drift is normal, a week is a different charge.
const PURCHASE_WINDOW = { min: -2, max: 5 };

// A refund is emailed when the merchant raises it and credited when the bank
// gets round to it. That gap is the whole reason this bucket exists.
const REFUND_WINDOW = { min: -3, max: 45 };

// How far back to keep chasing a refund that never arrived.
const REFUND_LOOKBACK_DAYS = 120;

function within(window, delta) {
  return delta >= window.min && delta <= window.max;
}

function amountsEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= AMOUNT_TOLERANCE;
}

function toRow(line) {
  return {
    line_no: line.lineNo,
    txn_date: line.txnDate,
    post_date: line.postDate,
    descriptor: line.descriptor,
    amount: line.amount,
    type: line.type,
    currency: line.currency,
    amount_orig: line.amountOrig,
    transaction_id: null,
    recon_status: "unmatched",
  };
}

/**
 * The best unclaimed transaction for a line, or null.
 *
 * Nearest date wins, and merchant similarity only breaks ties — a descriptor
 * like "SWIGGY BANGALORE IN" against a stored "Swiggy" is informative but the
 * amount and the date are what actually identify a charge.
 */
function bestMatch(line, candidates, claimed, window) {
  let best = null;

  for (const t of candidates) {
    if (claimed.has(t.id)) continue;
    if (!amountsEqual(t.amount, line.amount)) continue;

    const delta = dayDiff(line.txnDate, t.date);
    if (!within(window, delta)) continue;

    const score = merchantSimilarity(line.descriptor, t.merchant) - Math.abs(delta) * 0.01;
    if (!best || score > best.score) best = { txn: t, score, delta };
  }

  return best;
}

function inPeriod(date, start, end) {
  if (!date) return false;
  if (start && dayDiff(date, start) < 0) return false;
  if (end && dayDiff(date, end) > 0) return false;
  return true;
}

/**
 * @param {object}   input
 * @param {object[]} input.lines         normalised statement lines
 * @param {object[]} input.transactions  the app's own view of the period
 * @param {object}   input.statement     opening/closing balances and period
 * @param {number}   input.minReceiptAmount  below this a charge is auto-waived
 * @param {string}   input.asOf          date the report is being run for
 * @param {string}   input.sourceRef     stable id used to key created rows
 */
export function reconcile({
  lines = [],
  transactions = [],
  statement = {},
  minReceiptAmount = 500,
  asOf = null,
  sourceRef = "stmt",
} = {}) {
  const periodStart = statement.periodStart ?? statement.period_start ?? null;
  const periodEnd = statement.periodEnd ?? statement.period_end ?? null;
  const today = asOf || periodEnd || null;

  const out = {
    tied: [],
    createdFromStatement: [],
    refundsConfirmed: [],
    fees: [],
    payments: [],
    chargebacks: [],
    unexplained: [],
    rolledForward: [],
    refundsMissing: [],
    outOfPeriod: [],
  };

  const purchases = transactions.filter((t) => !t.is_refund);
  const refunds = transactions.filter((t) => t.is_refund);
  const claimed = new Set();

  for (const line of lines) {
    const row = toRow(line);

    switch (line.type) {
      case "payment": {
        // Money paid to the card, not money spent. Nothing to create, nothing
        // to chase — but recorded so the control total can see it.
        row.recon_status = "orphan";
        out.payments.push({ line: row });
        break;
      }

      case "fee": {
        row.recon_status = "created";
        out.fees.push({ line: row, transaction: feeTransaction(line, sourceRef) });
        break;
      }

      case "chargeback": {
        // A provisional credit is not a settled one. Kept in its own state so
        // it is never counted as money we have got back for good.
        row.recon_status = "orphan";
        out.chargebacks.push({ line: row });
        break;
      }

      case "refund": {
        const match = bestMatch(line, refunds, claimed, REFUND_WINDOW);
        if (match) {
          claimed.add(match.txn.id);
          row.transaction_id = match.txn.id;
          row.recon_status = "tied";
          out.refundsConfirmed.push({ line: row, transaction: match.txn, ageDays: match.delta });
        } else {
          // A credit nobody was expecting still happened. Record it rather than
          // let the control total absorb an unexplained number.
          row.recon_status = "created";
          out.createdFromStatement.push({
            line: row,
            transaction: createdTransaction(line, sourceRef, { is_refund: true }),
          });
        }
        break;
      }

      case "purchase": {
        const match = bestMatch(line, purchases, claimed, PURCHASE_WINDOW);
        if (match) {
          claimed.add(match.txn.id);
          row.transaction_id = match.txn.id;
          row.recon_status = "tied";
          out.tied.push({ line: row, transaction: match.txn });
        } else {
          // The gap the app could not previously see: the alert never arrived
          // or a sync window was missed. The statement is right, so the
          // transaction is created from it and then chased for a receipt.
          row.recon_status = "created";
          out.createdFromStatement.push({
            line: row,
            transaction: createdTransaction(line, sourceRef),
          });
        }
        break;
      }

      default: {
        row.recon_status = "unexplained";
        out.unexplained.push({ line: row });
      }
    }
  }

  // --- the other direction: what the app has that the statement does not ---

  for (const t of purchases) {
    if (claimed.has(t.id)) continue;
    if (inPeriod(t.date, periodStart, periodEnd)) {
      // Usually a pre-auth that never settled, or a charge that will land next
      // cycle. Rolled forward with a note rather than deleted.
      out.rolledForward.push(t);
    } else {
      out.outOfPeriod.push(t);
    }
  }

  for (const t of refunds) {
    if (claimed.has(t.id)) continue;
    const age = today ? dayDiff(today, t.date) : null;

    if (age != null && age <= REFUND_LOOKBACK_DAYS) {
      // The point of the whole exercise: a credit that was promised and has
      // not appeared. Escalated by name and age.
      out.refundsMissing.push({ transaction: t, ageDays: age });
    } else {
      out.outOfPeriod.push(t);
    }
  }

  // --- the control total ---

  const totals = sumByDirection(lines);
  const control = controlTotal({
    opening: statement.opening ?? statement.opening_balance ?? 0,
    closing: statement.closing ?? statement.closing_balance ?? null,
    ...totals,
  });

  // --- coverage, measured against the bank's lines rather than our guess ---

  const chargeLines = [...out.tied, ...out.createdFromStatement].filter(
    (e) => e.line.type === "purchase"
  );
  const chaseable = chargeLines.filter((e) => e.line.amount >= minReceiptAmount);
  const withReceipt = chaseable.filter((e) => hasReceipt(e.transaction)).length;

  return {
    ...out,
    totals,
    control,
    blocked: !control.tiesOut || out.unexplained.length > 0,
    coverage: {
      lines: lines.length,
      charges: chargeLines.length,
      chaseable: chaseable.length,
      withReceipt,
      missing: chaseable.length - withReceipt,
      coveragePct: chaseable.length ? Math.round((withReceipt / chaseable.length) * 100) : 100,
    },
    spend: round2(totals.debits - totals.credits),
  };
}

function hasReceipt(t) {
  return t?.receipt_status === "attached" || t?.receipt_status === "declared";
}

/**
 * Rows created from a statement line carry a synthetic `email_id` so a re-run
 * upserts over the same row instead of duplicating the charge.
 */
function createdTransaction(line, sourceRef, extra = {}) {
  return {
    email_id: `stmt-${sourceRef}-${line.lineNo}`,
    merchant: line.descriptor || "Unknown",
    amount: line.amount,
    date: line.txnDate,
    category: "other",
    is_refund: false,
    receipt_status: "missing",
    notes: "Created from the card statement — no alert email was received.",
    ...extra,
  };
}

function feeTransaction(line, sourceRef) {
  return {
    ...createdTransaction(line, sourceRef),
    category: "fee",
    // A bank fee has no invoice to photograph, so it is waived on creation
    // rather than sitting in the outstanding list forever.
    receipt_status: "waived",
    notes: "Bank fee from the card statement.",
  };
}
