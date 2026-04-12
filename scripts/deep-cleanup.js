#!/usr/bin/env node
/* Aggressive dedup: group by (date, amount) — same charge on the same day
 * from different email sources is the same real-world transaction.
 *
 * Within each group:
 * - Separate genuine refunds (raw_email mentions reversal/refund/return/cashback)
 *   from purchases
 * - Keep at most 1 purchase and at most 1 genuine refund
 * - Prefer the row with an HDFC "debited" alert (authoritative amount source),
 *   else the row with item_description, else the oldest
 * - Fix rows wrongly tagged is_refund (e.g. "Delivered" notifications)
 *
 * Usage: set -a && source .env.local && set +a && node scripts/deep-cleanup.js
 */
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const USER_ID = "115105472683255155618";

const REFUND_RE = /\b(reversal|reversed|refund|refunded|return\s+processed|return\s+for|cashback|credited\s+back|credit\s+for|chargeback|dispute)\b/i;
const HDFC_DEBIT_RE = /\bRs\.\d.*debited\b/i;

function isGenuineRefund(row) {
  const corpus = `${row.raw_email || ""} ${row.notes || ""}`;
  return REFUND_RE.test(corpus);
}

function scoreRow(row) {
  let s = 0;
  if (HDFC_DEBIT_RE.test(row.raw_email || "")) s += 10; // authoritative bank alert
  if (row.item_description) s += 5;                      // has item detail
  if (row.notes && row.notes.length > 5) s += 2;         // has AI insight
  return s;
}

(async () => {
  const { data: txs } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", USER_ID);

  console.log(`Loaded ${txs.length} rows\n`);

  // Group by (date, amount)
  const groups = {};
  for (const t of txs) {
    const key = `${t.date}|${Number(t.amount).toFixed(2)}`;
    (groups[key] ||= []).push(t);
  }

  const toDelete = [];
  const toFixRefund = []; // rows where is_refund should be toggled

  for (const [key, rows] of Object.entries(groups)) {
    if (rows.length <= 1) continue;

    // Classify each row
    const genuineRefunds = [];
    const purchases = [];
    for (const r of rows) {
      if (isGenuineRefund(r)) {
        genuineRefunds.push(r);
        if (!r.is_refund) toFixRefund.push({ id: r.id, set: true });
      } else {
        purchases.push(r);
        if (r.is_refund) toFixRefund.push({ id: r.id, set: false });
      }
    }

    // Keep best purchase
    if (purchases.length > 1) {
      purchases.sort((a, b) => scoreRow(b) - scoreRow(a));
      const keep = purchases[0];
      console.log(`[${key}] keep purchase: "${keep.merchant}" (score=${scoreRow(keep)}, id=${keep.id})`);
      for (const drop of purchases.slice(1)) {
        console.log(`  drop: "${drop.merchant}" (score=${scoreRow(drop)}, id=${drop.id})`);
        toDelete.push(drop.id);
      }
    }

    // Keep best refund
    if (genuineRefunds.length > 1) {
      genuineRefunds.sort((a, b) => scoreRow(b) - scoreRow(a));
      const keep = genuineRefunds[0];
      console.log(`[${key}] keep refund: "${keep.merchant}" (id=${keep.id})`);
      for (const drop of genuineRefunds.slice(1)) {
        console.log(`  drop refund: "${drop.merchant}" (id=${drop.id})`);
        toDelete.push(drop.id);
      }
    }
  }

  // Execute deletes
  console.log(`\nDeleting ${toDelete.length} duplicate rows...`);
  for (const id of toDelete) {
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", id)
      .eq("user_id", USER_ID);
    if (error) console.error(`  delete id=${id} failed: ${error.message}`);
  }

  // Fix is_refund flags
  console.log(`Fixing ${toFixRefund.length} misclassified refund flags...`);
  for (const { id, set } of toFixRefund) {
    const { error } = await supabase
      .from("transactions")
      .update({ is_refund: set })
      .eq("id", id)
      .eq("user_id", USER_ID);
    if (error) console.error(`  fix id=${id} failed: ${error.message}`);
    else console.log(`  id=${id} → is_refund=${set}`);
  }

  // Verify
  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", USER_ID);
  const { count: refundCount } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", USER_ID)
    .eq("is_refund", true);

  console.log(`\n✓ Done. ${count} rows remaining (${refundCount} refunds)`);

  // Final duplicate check
  const { data: final } = await supabase
    .from("transactions")
    .select("date, amount")
    .eq("user_id", USER_ID);
  const check = {};
  let dupeCount = 0;
  for (const r of final) {
    const k = `${r.date}|${Number(r.amount).toFixed(2)}`;
    check[k] = (check[k] || 0) + 1;
    if (check[k] === 2) dupeCount++;
  }
  console.log(`Remaining (date+amount) duplicates: ${dupeCount} ${dupeCount === 0 ? "✓" : "⚠"}`);
})();
