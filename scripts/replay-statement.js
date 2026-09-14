#!/usr/bin/env node
/* Read each reconciled statement PDF on file with STATEMENT_MODEL and report
 * whether it ties out. Both must.
 * Usage: node --env-file=.env.local scripts/replay-statement.js
 */
const { register } = require("esbuild-register/dist/node");
register();
const { getSupabaseAdmin } = require("../lib/supabase.js");
const { get } = require("../lib/storage.js");
const { parseStatement } = require("../lib/statement-vision.js");

(async () => {
  const sb = getSupabaseAdmin();
  const { data: statements } = await sb
    .from("statements").select("id, user_id, storage_path, issued_on, status")
    .eq("status", "reconciled").order("issued_on", { ascending: false });

  let bad = 0;
  for (const s of statements || []) {
    if (!s.storage_path) { console.log(`${s.issued_on}: skipped, no storage_path`); continue; }
    const pdf = await get(s.storage_path);
    const t0 = Date.now();
    const read = await parseStatement(pdf, { userId: s.user_id });
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`${s.issued_on}: ${read.lines.length} lines · tiesOut=${read.control.tiesOut} · ${secs}s`);
    if (!read.control.tiesOut) { bad++; console.log(JSON.stringify(read.control)); }
  }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
