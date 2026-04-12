#!/usr/bin/env node
/* Audit transactions for duplicates, refund handling, and bad amounts.
 * Usage: set -a && source .env.local && set +a && node scripts/audit-data.js
 */
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const USER_ID = "115105472683255155618";

(async () => {
  const { data: txs } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", USER_ID)
    .order("date", { ascending: false });

  console.log(`\nTotal rows: ${txs.length}`);

  const zeroAmount = txs.filter((t) => !Number(t.amount) || Number(t.amount) === 0);
  console.log(`Rows with amount === 0: ${zeroAmount.length}`);
  if (zeroAmount.length) {
    console.log("  Sample:");
    zeroAmount.slice(0, 5).forEach((t) =>
      console.log(`    ${t.date}  ${t.merchant}  ${t.email_id.slice(0, 12)}  refund=${t.is_refund}`)
    );
  }

  console.log(`\nRefund count: ${txs.filter((t) => t.is_refund).length}`);
  console.log("Refund rows:");
  txs.filter((t) => t.is_refund).forEach((t) =>
    console.log(`  ${t.date} ₹${t.amount}  ${t.merchant}  refund=${t.is_refund}  cat=${t.category}`)
  );

  // Find duplicates: same merchant + amount + date (ignoring refunds)
  console.log("\n--- Duplicate candidates (same date/merchant/amount) ---");
  const keyMap = {};
  for (const t of txs) {
    const key = `${t.date}|${t.merchant}|${Number(t.amount).toFixed(2)}|${t.is_refund}`;
    (keyMap[key] ||= []).push(t);
  }
  const dupes = Object.entries(keyMap).filter(([, v]) => v.length > 1);
  console.log(`${dupes.length} duplicate groups (${dupes.reduce((s, [, v]) => s + v.length - 1, 0)} extra rows)`);
  for (const [key, rows] of dupes.slice(0, 20)) {
    console.log(`  ${key}  x${rows.length}`);
    for (const r of rows) {
      console.log(`    email_id=${r.email_id}  raw=${r.raw_email?.slice(0, 60)}`);
    }
  }

  // Category mismatches that might indicate Claude misclassification
  console.log("\n--- Amazon-like merchants categorized as non-amazon ---");
  const amazonIsh = txs.filter(
    (t) =>
      /amazon/i.test(t.merchant || "") && t.category !== "amazon" && !t.is_refund
  );
  console.log(`${amazonIsh.length} rows`);
  amazonIsh.slice(0, 5).forEach((t) =>
    console.log(`  ${t.date}  ${t.merchant}  cat=${t.category}  ₹${t.amount}`)
  );

  // Transactions with "refund" or "reversal" in notes/raw but is_refund=false
  console.log("\n--- Not marked refund but raw_email mentions refund/reversal ---");
  const missedRefunds = txs.filter(
    (t) =>
      !t.is_refund &&
      /refund|reversal|credit|reverse/i.test(
        `${t.raw_email || ""} ${t.notes || ""} ${t.merchant || ""}`
      )
  );
  console.log(`${missedRefunds.length} rows`);
  missedRefunds.slice(0, 10).forEach((t) =>
    console.log(`  ${t.date} ₹${t.amount}  ${t.merchant}  raw="${t.raw_email?.slice(0, 60)}"`)
  );

  // Month-by-month totals
  console.log("\n--- Month-by-month totals ---");
  const byMonth = {};
  for (const t of txs) {
    const m = t.date?.slice(0, 7) || "unknown";
    byMonth[m] ||= { spent: 0, refund: 0, count: 0 };
    if (t.is_refund) byMonth[m].refund += Number(t.amount);
    else byMonth[m].spent += Number(t.amount);
    byMonth[m].count += 1;
  }
  for (const m of Object.keys(byMonth).sort().reverse()) {
    const { spent, refund, count } = byMonth[m];
    console.log(
      `  ${m}  spent=₹${spent.toFixed(0)}  refund=₹${refund.toFixed(0)}  net=₹${(spent - refund).toFixed(0)}  rows=${count}`
    );
  }
})();
