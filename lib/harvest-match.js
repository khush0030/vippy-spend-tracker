/**
 * Decide which harvested email documents which statement line. Pure — no
 * imports, no I/O, so it can be tested against the real August statement
 * without a mailbox or a database.
 *
 * The bank's own ledger is the fixed point. A line names an amount, and the
 * question asked of the mailbox is only ever "does anything here mention that
 * amount, around that date". No merchant name is parsed, no sender recognised,
 * so a hostel in Prague and a funicular in Zermatt need no code of their own.
 */

// A charge posts after the merchant issues the receipt, essentially never
// more than a day before it. The window is asymmetric for that reason.
const DAYS_BEFORE = 1;
const DAYS_AFTER = 3;

// Amounts are compared to the hundredth. Anything finer is float noise.
const EPSILON = 0.005;

function toUtc(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(fromIso, toIso) {
  const a = toUtc(fromIso);
  const b = toUtc(toIso);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * What to look for in the mailbox for a given line, or null if the line is
 * not the sort of thing that has a receipt.
 *
 * A foreign charge is looked for in the currency the merchant billed, never
 * in rupees: HDFC's rupee figure includes a markup and GST that appear on no
 * receipt anywhere, so it would never match. The statement carries the origin
 * amount precisely so this is possible.
 */
export function targetAmount(line) {
  if (!line || line.direction !== "debit") return null;
  if (line.type === "fee" || line.type === "payment") return null;

  if (line.currency && line.currency !== "INR" && line.amount_orig != null) {
    return { value: Number(line.amount_orig), currency: line.currency };
  }
  if (line.amount == null) return null;
  return { value: Number(line.amount), currency: "INR" };
}

export function matchEmailsToLines(lines, candidates) {
  const targets = [];
  for (const line of lines || []) {
    const target = targetAmount(line);
    if (target && Number.isFinite(target.value)) targets.push({ line, target });
  }

  const links = [];
  const ambiguous = [];
  const unmatchedEmails = [];
  const linkedLineIds = new Set();

  for (const candidate of candidates || []) {
    const hits = [];

    for (const { line, target } of targets) {
      const delta = daysBetween(line.txn_date, candidate.date);
      if (delta === null || delta < -DAYS_BEFORE || delta > DAYS_AFTER) continue;

      const amount = (candidate.amounts || []).find(
        (a) => a.currency === target.currency && Math.abs(Number(a.value) - target.value) < EPSILON
      );
      if (!amount) continue;

      hits.push({
        lineId: line.id,
        lineNo: line.line_no,
        messageId: candidate.messageId,
        value: target.value,
        currency: target.currency,
        dayDelta: delta,
      });
    }

    if (hits.length === 0) {
      unmatchedEmails.push(candidate);
      continue;
    }

    if (hits.length === 1) {
      links.push(hits[0]);
      linkedLineIds.add(hits[0].lineId);
      continue;
    }

    // Several lines want the same email. The nearest date wins — but only if
    // it wins outright. Two charges equidistant from one receipt is exactly
    // the case where a confident guess files a bill against the wrong day.
    const nearest = Math.min(...hits.map((h) => Math.abs(h.dayDelta)));
    const closest = hits.filter((h) => Math.abs(h.dayDelta) === nearest);

    if (closest.length === 1) {
      links.push(closest[0]);
      linkedLineIds.add(closest[0].lineId);
    } else {
      ambiguous.push({
        messageId: candidate.messageId,
        lineIds: closest.map((h) => h.lineId),
        value: closest[0].value,
        currency: closest[0].currency,
      });
    }
  }

  const unmatchedLines = targets.map((t) => t.line).filter((l) => !linkedLineIds.has(l.id));

  return { links, ambiguous, unmatchedLines, unmatchedEmails };
}

/**
 * The arithmetic gate on anything a language model proposes.
 *
 * The model is allowed to suggest that three Amazon invoices together explain
 * one ₹1,668 charge. It is not allowed to be believed: the parts must add up
 * to the line, in the line's own currency, or the proposal is discarded. This
 * is what stops a fluent, plausible and wrong answer from reaching the
 * accounts department.
 */
export function validateProposal(line, parts) {
  const target = targetAmount(line);
  if (!target) return { ok: false, sum: 0, target: null, delta: null };

  const list = parts || [];
  if (!list.length) return { ok: false, sum: 0, target: target.value, delta: target.value };

  if (list.some((p) => p.currency !== target.currency)) {
    return { ok: false, sum: null, target: target.value, delta: null };
  }

  const sum = list.reduce((total, p) => total + Number(p.value || 0), 0);
  const delta = Math.abs(sum - target.value);
  const tolerance = Math.max(1, target.value * 0.005);

  return { ok: delta <= tolerance, sum: Number(sum.toFixed(2)), target: target.value, delta: Number(delta.toFixed(2)) };
}
