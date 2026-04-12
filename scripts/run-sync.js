#!/usr/bin/env node
/* Call the real lib/sync.js pipeline directly (via esbuild-register).
 * Mirrors what the Vercel cron would do but bypasses the HTTP layer.
 * Usage: set -a && source .env.local && set +a && node scripts/run-sync.js [user_id]
 */
const { register } = require("esbuild-register/dist/node");
register();
const { syncUserTransactions } = require("../lib/sync.js");

const USER_ID = process.argv[2] || "115105472683255155618";

(async () => {
  console.log(`\n=== SYNC (user ${USER_ID}) ===`);
  const result = await syncUserTransactions({ userId: USER_ID });
  console.log(JSON.stringify(result, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
