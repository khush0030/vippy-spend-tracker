#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const USER_ID = "115105472683255155618";

(async () => {
  const { data: txs } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", USER_ID);

  const refundRegex = /\b(refund|reversal|reversed|return(?!s\s*@)|cashback|credited\s+to)\b/i;
  const hits = txs.filter((t) => {
    if (t.is_refund) return false;
    const corpus = `${t.raw_email || ""} ${t.notes || ""} ${t.merchant || ""}`;
    return refundRegex.test(corpus);
  });

  console.log(`Potentially missed refunds: ${hits.length}`);
  hits.forEach((t) =>
    console.log(
      `  ${t.date} ₹${t.amount}  ${t.merchant}  raw="${(t.raw_email || "").slice(0, 80)}"  notes="${(t.notes || "").slice(0, 60)}"`
    )
  );

  console.log(`\nCurrently flagged refunds: ${txs.filter((t) => t.is_refund).length}`);
  txs
    .filter((t) => t.is_refund)
    .forEach((t) => console.log(`  ${t.date} ₹${t.amount}  ${t.merchant}`));
})();
