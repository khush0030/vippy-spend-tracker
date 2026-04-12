#!/usr/bin/env node
/* One-shot: clean up bad rows in transactions.
 *  - delete rows with amount < 10 or amount is null
 *  - delete duplicates keyed on (date, rounded amount, merchant), keeping oldest
 *  - flag known missed refunds as is_refund = true
 * Usage: set -a && source .env.local && set +a && node scripts/cleanup-data.js
 */
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const USER_ID = "115105472683255155618";

function normalizeMerchant(m) {
  return (m || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/\s+/g, "");
}

function fingerprint(t) {
  return `${t.date}|${Number(t.amount).toFixed(2)}|${normalizeMerchant(t.merchant)}|${t.is_refund ? "R" : "P"}`;
}

(async () => {
  const { data: txs } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", USER_ID);

  console.log(`Loaded ${txs.length} rows`);

  // 1. Delete rows with amount < 10
  const lowAmount = txs.filter((t) => !Number(t.amount) || Number(t.amount) < 10);
  console.log(`\n[1] Deleting ${lowAmount.length} rows with amount < 10`);
  for (const t of lowAmount) {
    console.log(`    - ${t.date} ₹${t.amount}  ${t.merchant}  ${t.email_id}`);
    await supabase.from("transactions").delete().eq("id", t.id).eq("user_id", USER_ID);
  }

  // 2. Dedupe by fingerprint — keep earliest created_at
  const remaining = txs.filter((t) => !lowAmount.some((l) => l.id === t.id));
  const groups = {};
  for (const t of remaining) {
    const key = fingerprint(t);
    (groups[key] ||= []).push(t);
  }
  const toDelete = [];
  for (const key of Object.keys(groups)) {
    const group = groups[key];
    if (group.length <= 1) continue;
    // sort by created_at ascending, keep first
    group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const keep = group[0];
    const drop = group.slice(1);
    console.log(`\n[2] Dedup group ${key}`);
    console.log(`    keep:  ${keep.date}  ${keep.merchant}  id=${keep.id}  email=${keep.email_id}`);
    drop.forEach((d) => {
      console.log(`    drop:  ${d.date}  ${d.merchant}  id=${d.id}  email=${d.email_id}`);
    });
    toDelete.push(...drop);
  }
  console.log(`\n[2] Deleting ${toDelete.length} duplicate rows`);
  for (const t of toDelete) {
    await supabase.from("transactions").delete().eq("id", t.id).eq("user_id", USER_ID);
  }

  // 3. Flag Canva reversal as refund
  console.log(`\n[3] Flagging missed refunds`);
  const { data: canva } = await supabase
    .from("transactions")
    .update({ is_refund: true })
    .eq("user_id", USER_ID)
    .eq("merchant", "CANVA")
    .ilike("raw_email", "%reversal%")
    .select("id, date, amount, merchant");
  console.log(`    Updated ${canva?.length || 0} rows`);
  canva?.forEach((r) => console.log(`    - ${r.date} ₹${r.amount}  ${r.merchant}`));

  // Final state
  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", USER_ID);
  const { count: refundCount } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", USER_ID)
    .eq("is_refund", true);
  console.log(`\n✓ Done. Remaining rows: ${count} (${refundCount} refunds)`);
})();
