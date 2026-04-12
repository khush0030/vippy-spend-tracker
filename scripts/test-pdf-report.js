#!/usr/bin/env node
/* Generate a monthly report PDF against real Supabase data and write to disk.
 * Uses esbuild register so we can require the ESM lib/report-pdf.js from CJS.
 * If esbuild-register isn't available, this script falls back to an inline copy.
 *
 * Usage: set -a && source .env.local && set +a && node scripts/test-pdf-report.js
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Try to load the real lib via esbuild-register so PDF stays DRY.
// Falls back to a minimal inline implementation if register isn't set up.
let buildPdf;
let aggregate;
try {
  require("esbuild-register/dist/node").register();
  const mod = require("../lib/report-pdf.js");
  buildPdf = mod.buildMonthlyReportPdf;
  aggregate = mod.aggregate;
} catch (err) {
  console.error("Could not load lib/report-pdf via esbuild-register.");
  console.error("Install it once with: npm install --save-dev esbuild-register");
  console.error("Falling back to standalone replication is no longer supported.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function main() {
  const USER_ID = "115105472683255155618";
  const { data: user } = await supabase
    .from("users")
    .select("id, email, name")
    .eq("id", USER_ID)
    .single();

  // Use last 45 days so the PDF has plenty of data even in mid-month
  const since = new Date(Date.now() - 45 * 86400 * 1000)
    .toISOString()
    .split("T")[0];
  const until = new Date().toISOString().split("T")[0];

  const { data: transactions } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", USER_ID)
    .gte("date", since)
    .lte("date", until)
    .order("date", { ascending: true });

  console.log(`Building PDF with ${transactions.length} transactions (${since} → ${until})`);
  const stats = aggregate(transactions);

  const pdf = await buildPdf({
    user,
    periodLabel: "Test Period",
    periodStart: since,
    periodEnd: until,
    transactions,
    stats,
  });

  const out = path.join(__dirname, "..", "test-report.pdf");
  fs.writeFileSync(out, pdf);
  console.log(`\u2713 Wrote ${pdf.length} bytes to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
