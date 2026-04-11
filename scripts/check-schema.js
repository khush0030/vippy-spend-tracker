#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
(async () => {
  const { data, error } = await supabase.from("transactions").select("*").limit(1);
  if (error) { console.error(error.message); process.exit(1); }
  console.log("Existing columns:", data[0] ? Object.keys(data[0]).sort() : "(empty table)");
  console.log("\nExpected by code:", [
    "id","user_id","email_id","merchant","amount","date","category",
    "has_receipt","item_description","is_refund","notes","txn_time",
    "user_notes","raw_email","created_at"
  ].sort());
})();
