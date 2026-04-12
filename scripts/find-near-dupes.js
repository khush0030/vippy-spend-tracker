#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const USER_ID = "115105472683255155618";

(async () => {
  const { data: txs } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", USER_ID)
    .order("date", { ascending: false });

  // Group by (date, amount) only — ignoring merchant name
  const groups = {};
  for (const t of txs) {
    const key = `${t.date}|${Number(t.amount).toFixed(2)}`;
    (groups[key] ||= []).push(t);
  }

  const dupes = Object.entries(groups)
    .filter(([, v]) => v.length > 1)
    .sort(([a], [b]) => b.localeCompare(a));

  console.log(`=== Groups with same date+amount (${dupes.length} groups, ${dupes.reduce((s, [, v]) => s + v.length, 0)} total rows) ===\n`);

  for (const [key, rows] of dupes) {
    console.log(`--- ${key} (${rows.length} rows) ---`);
    for (const r of rows) {
      console.log(`  id=${r.id}  merchant="${r.merchant}"  refund=${r.is_refund}  cat=${r.category}  email=${r.email_id.slice(0, 16)}  raw="${(r.raw_email || "").slice(0, 70)}"`);
    }
    console.log();
  }
})();
