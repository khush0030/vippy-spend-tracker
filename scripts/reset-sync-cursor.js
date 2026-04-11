#!/usr/bin/env node
/* Reset last_synced_at for a user so the next sync re-scans older emails.
 * Usage: set -a && source .env.local && set +a && node scripts/reset-sync-cursor.js [YYYY-MM-DD]
 * If no date passed, sets to NULL (full rescan).
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const USER_ID = "115105472683255155618";
  const arg = process.argv[2];
  const value = arg ? new Date(arg).toISOString() : null;

  const { error } = await supabase
    .from("users")
    .update({ last_synced_at: value })
    .eq("id", USER_ID);

  if (error) {
    console.error("Update failed:", error.message);
    process.exit(1);
  }

  console.log(`\u2713 last_synced_at reset to: ${value ?? "NULL (full rescan)"}`);
})();
