#!/usr/bin/env node
/* Re-read every receipt on file with the new reader pair and compare
 * merchant/total/currency/date against the stored values.
 * Usage: node --env-file=.env.local scripts/replay-receipts.js [limit=40]
 */
const { register } = require("esbuild-register/dist/node");
register();
const { getSupabaseAdmin } = require("../lib/supabase.js");
const { get } = require("../lib/storage.js");
const { extractReceipt } = require("../lib/receipt-vision.js");

const limit = Number(process.argv[2] || 40);

(async () => {
  const sb = getSupabaseAdmin();
  const { data: rows } = await sb
    .from("receipts")
    .select("id, storage_path, mime, merchant, amount, currency, receipt_date, consensus")
    .eq("source", "telegram").not("amount", "is", null)
    .order("created_at", { ascending: false }).limit(limit);

  let agree = 0, conflict = 0, failed = 0, matched = 0;
  for (const r of rows || []) {
    const buffer = await get(r.storage_path);
    const out = await extractReceipt(buffer, r.mime, { userId: "replay" });
    if (!out.ok) { failed++; console.log(`${r.id} FAILED ${out.error}`); continue; }
    if (out.consensus === "agree") agree++; else if (out.consensus === "conflict") conflict++;
    const v = out.value;
    const ok = Number(v.total) === Number(r.amount) && v.currency === r.currency;
    if (ok) matched++;
    console.log(`${r.id} ${out.consensus.padEnd(8)} ${ok ? "same" : "DIFF"} stored=${r.currency} ${r.amount} now=${v.currency} ${v.total} (${v.merchant})`);
  }
  const n = (rows || []).length;
  console.log(`\n${n} receipts · agree ${agree} · conflict ${conflict} · failed ${failed} · total+currency match ${matched}/${n}`);
  const { data: baseline } = await sb.from("receipts").select("consensus").eq("source", "telegram").not("amount", "is", null);
  const base = (baseline || []).filter((b) => b.consensus === "agree").length / Math.max(1, (baseline || []).length);
  console.log(`stored agree rate (Claude+GPT): ${(base * 100).toFixed(0)}% · new agree rate: ${((agree / Math.max(1, n)) * 100).toFixed(0)}%`);
})().catch((e) => { console.error(e); process.exit(2); });
