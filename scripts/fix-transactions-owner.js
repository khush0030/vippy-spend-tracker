#!/usr/bin/env node
/* One-shot: move all transactions to the correct user_id.
 * Usage: set -a && source .env.local && set +a && node scripts/fix-transactions-owner.js
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const { data: user, error: uErr } = await supabase
    .from("users")
    .select("id, email")
    .eq("email", "kmutha@vippysoya.com")
    .maybeSingle();

  if (uErr || !user) {
    console.error("Could not find user:", uErr?.message);
    process.exit(1);
  }

  console.log(`Target user id: ${user.id}`);

  const orphanId = "798112eb-3d1a-41cc-8bbf-0e24402e402c";

  const { data: updated, error: updateErr } = await supabase
    .from("transactions")
    .update({ user_id: user.id })
    .eq("user_id", orphanId)
    .select("id");

  if (updateErr) {
    console.error("Update failed (likely RLS blocking anon key):", updateErr.message);
    console.error("\nPaste this into the Supabase SQL editor instead:");
    console.error(`update transactions set user_id = '${user.id}' where user_id = '${orphanId}';`);
    process.exit(1);
  }

  console.log(`\u2713 Reassigned ${updated?.length || 0} transactions to ${user.id}`);
})();
