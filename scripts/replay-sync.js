#!/usr/bin/env node
/* Re-parse the last N days of bank alerts through SYNC_MODEL without
 * writing, and diff against what is already in `transactions`.
 * Usage: node --env-file=.env.local scripts/replay-sync.js [days=30]
 */
const { register } = require("esbuild-register/dist/node");
register();
const { parseBatch } = require("../lib/sync.js");
const { fetchHDFCEmails } = require("../lib/gmail.js");
const { primaryMailAccount } = require("../lib/mail-account.js");
const { getSupabaseAdmin } = require("../lib/supabase.js");

const USER_ID = "115105472683255155618";
const days = Number(process.argv[2] || 30);

(async () => {
  const sb = getSupabaseAdmin();
  const since = new Date(Date.now() - days * 86400e3).toISOString();

  const primary = await primaryMailAccount(USER_ID);
  const emails = await fetchHDFCEmails(since, { refreshToken: primary.credential });
  console.log(`fetched ${emails.length} emails since ${since.slice(0, 10)}`);

  const { data: existing } = await sb
    .from("transactions").select("email_id, merchant, amount, date, category, is_refund")
    .eq("user_id", USER_ID).gte("date", since.slice(0, 10));
  const byEmail = new Map((existing || []).map((t) => [t.email_id, t]));

  const parsed = [];
  for (let i = 0; i < emails.length; i += 15) parsed.push(...(await parseBatch(emails.slice(i, i + 15))));

  let same = 0; const diffs = [];
  for (const p of parsed) {
    if (!(Number.isFinite(p.amount) && p.amount >= 10)) continue; // the cron drops these too
    const e = byEmail.get(p.email_id);
    if (!e) { diffs.push({ email_id: p.email_id, kind: "not in db", parsed: p }); continue; }
    const changed = ["merchant", "amount", "date", "category", "is_refund"].filter((f) => String(e[f]) !== String(p[f]));
    if (changed.length) diffs.push({ email_id: p.email_id, changed, was: e, now: p });
    else same++;
  }
  console.log(`parsed ${parsed.length} · identical ${same} · different ${diffs.length}`);
  for (const d of diffs) console.log(JSON.stringify(d));
  process.exit(diffs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
