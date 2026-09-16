// lib/reversals.js
import { merchantSimilarity, dayDiff } from "./matcher.js";

/**
 * Card holds that were released: a charge alert followed within a few days by
 * a refund alert for the same merchant and amount. Uber and Bolt do this on
 * nearly every foreign ride. The bank never bills either half, but both land
 * in the ledger and the charge sits in the missing-receipt list forever.
 * Returns [chargeId, refundId] pairs. Pure.
 */
const WINDOW_DAYS = 3;

export function findReversals(transactions) {
  const list = transactions || [];
  const refunds = list.filter((t) => t.is_refund && t.receipt_status === "missing");
  const charges = list.filter((t) => !t.is_refund && t.receipt_status === "missing");
  const used = new Set();
  const pairs = [];

  for (const r of refunds) {
    const match = charges
      .filter((c) => !used.has(c.id))
      .filter((c) => Math.abs(Number(c.amount) - Number(r.amount)) < 0.01)
      .filter((c) => {
        const d = dayDiff(r.date, c.date);
        return d >= 0 && d <= WINDOW_DAYS;
      })
      .filter((c) => merchantSimilarity(c.merchant, r.merchant) >= 0.5)
      .sort((a, b) => dayDiff(r.date, a.date) - dayDiff(r.date, b.date))[0];
    if (!match) continue;
    used.add(match.id);
    pairs.push([match.id, r.id]);
  }
  return pairs;
}
