#!/usr/bin/env node
/* Diagnose user + transaction state.
 * Usage: set -a && source .env.local && set +a && node scripts/diagnose.js
 */
const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY. Run:");
  console.error("  set -a && source .env.local && set +a && node scripts/diagnose.js");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const { data: users, error: uErr } = await supabase
    .from("users")
    .select("id, email, name, provider, password_hash, last_synced_at");

  if (uErr) {
    console.error("users query failed:", uErr.message);
    process.exit(1);
  }

  console.log("\n=== USERS ===");
  for (const u of users) {
    console.log(JSON.stringify({
      id: u.id,
      email: u.email,
      provider: u.provider,
      has_password: Boolean(u.password_hash),
      last_synced_at: u.last_synced_at || null,
    }));
  }

  console.log("\n=== TRANSACTION COUNTS BY user_id ===");
  const seen = {};
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select("user_id")
      .range(offset, offset + 999);
    if (error) { console.error(error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const key = row.user_id || "(null)";
      seen[key] = (seen[key] || 0) + 1;
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(seen);

  console.log("\n=== SANITY CHECK ===");
  const khush = users.find((u) => u.email === "kmutha@vippysoya.com");
  if (!khush) {
    console.log("No user with email kmutha@vippysoya.com found.");
  } else {
    console.log(`Khush user id: ${khush.id}`);
    console.log(`Transactions matching that id: ${seen[khush.id] || 0}`);
  }
})();
