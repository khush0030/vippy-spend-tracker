#!/usr/bin/env node
/* One-off repair so every charge carries its bill once and the ledger matches
 * the statement. Prints the plan; writes nothing without --apply.
 *
 *   1. Bank alert emails harvested as "receipts" before 7c47246 are rejected
 *      and unlinked — an alert is not a bill.
 *   2. A charge with more bills than it needs keeps the set that covers it,
 *      best-named merchant first. Copies are marked duplicate; another
 *      merchant's bill goes back to waiting. Real splits are kept. At a
 *      restaurant the larger same-day bill (the one with the tip) is kept.
 *   3. Unfiled copies of a filed bill are marked duplicate.
 *   4. Statement lines re-paired with the whole-statement matcher; a line that
 *      took another line's charge is swapped back.
 *
 * Usage: node --env-file=.env.local scripts/dedupe-ledger.js [--apply]
 */
const { register } = require("esbuild-register/dist/node");
register();
const { getSupabaseAdmin } = require("../lib/supabase.js");
const { isSameBill, isCovered, merchantSimilarity, tippedBill } = require("../lib/matcher.js");
const { reconcile } = require("../lib/recon.js");

const APPLY = process.argv.includes("--apply");
const sb = getSupabaseAdmin();
const say = (...a) => console.log(...a);
const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

async function run(label, query) {
  if (!APPLY) return;
  const { error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
}

// Drop one receipt↔charge link; the charge goes back to missing if it was its last bill.
async function dropLink(receiptId, transactionId, receiptStatus) {
  await run("delete link", sb.from("receipt_transactions").delete().eq("receipt_id", receiptId).eq("transaction_id", transactionId));
  if (!APPLY) return;
  const { count } = await sb.from("receipt_transactions").select("*", { count: "exact", head: true }).eq("transaction_id", transactionId);
  if (!count) await run("txn missing", sb.from("transactions").update({ receipt_status: "missing", has_receipt: false }).eq("id", transactionId).eq("receipt_status", "attached"));
  const { count: left } = await sb.from("receipt_transactions").select("*", { count: "exact", head: true }).eq("receipt_id", receiptId);
  if (!left) await run("receipt status", sb.from("receipts").update({ status: receiptStatus }).eq("id", receiptId));
}

(async () => {
  say(APPLY ? "APPLYING\n" : "DRY RUN — nothing is written. Re-run with --apply.\n");

  const { data: receipts } = await sb.from("receipts").select("*");
  const { data: links } = await sb.from("receipt_transactions").select("receipt_id, transaction_id, matched_by, match_score, created_at");
  const { data: txns } = await sb.from("transactions").select("id, user_id, merchant, amount, date, receipt_status, category");
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const txnById = new Map(txns.map((t) => [t.id, t]));
  let live = links.slice();

  // --- 1. bank alerts are not bills ---
  const alerts = receipts.filter((r) => /instaalert/i.test(r.merchant || "") || /hdfcbank/i.test(r.extracted?.harvest?.from || ""));
  say(`1. Bank alert emails stored as receipts: ${alerts.length}`);
  const alertIds = new Set(alerts.map((r) => r.id));
  const orphaned = new Set();
  for (const r of alerts) {
    for (const l of live.filter((x) => x.receipt_id === r.id)) {
      const others = live.filter((x) => x.transaction_id === l.transaction_id && !alertIds.has(x.receipt_id));
      if (!others.length) orphaned.add(l.transaction_id);
      await dropLink(r.id, l.transaction_id, "rejected");
    }
    await run("reject alert", sb.from("receipts").update({ status: "rejected" }).eq("id", r.id));
  }
  live = live.filter((l) => !alertIds.has(l.receipt_id));
  say(`   charges whose only "bill" was an alert, now missing a receipt: ${orphaned.size}`);
  for (const id of orphaned) { const t = txnById.get(id); say(`     #${id} ${t.date} ${t.merchant} ${inr(t.amount)}`); }

  // --- 2. more bills than the charge needs ---
  say("\n2. Charges with extra bills:");
  const byTxn = new Map();
  for (const l of live) (byTxn.get(l.transaction_id) || byTxn.set(l.transaction_id, []).get(l.transaction_id)).push(l);
  const rank = { user: 0, auto: 1, rematch: 2, statement: 3, harvest: 4, admin: 5 };
  let extra = 0;
  for (const [txnId, ls] of byTxn) {
    if (ls.length < 2) continue;
    const t = txnById.get(txnId);
    // The bill naming the charge's merchant stays; ties go to the most trusted link, then the oldest.
    const sim = (l) => merchantSimilarity(receiptById.get(l.receipt_id).merchant, t.merchant);
    // At a restaurant the larger bill of the day carries the tip, so it comes first.
    const tipped = (a, b) => (tippedBill(t, [receiptById.get(a.receipt_id)], receiptById.get(b.receipt_id))?.keep.id === b.receipt_id ? 1 : 0)
      - (tippedBill(t, [receiptById.get(b.receipt_id)], receiptById.get(a.receipt_id))?.keep.id === a.receipt_id ? 1 : 0);
    const ordered = ls.slice().sort((a, b) => tipped(a, b) || sim(b) - sim(a) || (rank[a.matched_by] ?? 9) - (rank[b.matched_by] ?? 9) || String(a.created_at).localeCompare(String(b.created_at)));
    const kept = [];
    for (const l of ordered) {
      const r = receiptById.get(l.receipt_id);
      if (kept.some((k) => isSameBill(k, r)) || isCovered(t, kept)) {
        extra++;
        const tipCopy = kept.some((k) => tippedBill(t, [k], r)?.drop.id === r.id);
        if (l.matched_by === "user" && !tipCopy) {
          say(`   #${txnId} ${t.merchant} ${inr(t.amount)}: also carries ${r.merchant} ${r.currency} ${r.amount} (${r.id.slice(0, 8)}), which you filed yourself — left for you to decide`);
          continue;
        }
        // Another merchant's bill is misfiled, not a copy: it goes back to waiting for its own charge.
        const copy = tipCopy || kept.some((k) => isSameBill(k, r) || merchantSimilarity(k.merchant, r.merchant) >= 0.5);
        const keep = kept.map((k) => `${k.merchant} ${k.currency} ${k.amount} (${k.id.slice(0, 8)})`).join(", ");
        say(`   #${txnId} ${t.merchant} ${inr(t.amount)}: keeps ${keep}; ${copy ? "duplicate" : "misfiled, back to waiting"}: ${r.merchant} ${r.currency} ${r.amount} (${r.id.slice(0, 8)}, ${l.matched_by})`);
        await dropLink(r.id, txnId, copy ? "duplicate" : "unmatched");
      } else kept.push(r);
    }
  }
  if (!extra) say("   none");

  // --- 3. unfiled copies of filed bills ---
  say("\n3. Unfiled copies of a bill already filed:");
  const filed = receipts.filter((r) => r.status === "matched" && !alertIds.has(r.id));
  let copies = 0;
  for (const r of receipts.filter((x) => ["pending", "unmatched"].includes(x.status))) {
    const twin = filed.find((f) => f.user_id === r.user_id && isSameBill(f, r));
    if (!twin) continue;
    copies++;
    say(`   ${r.merchant} ${r.currency} ${r.amount} ${r.receipt_date} (${r.id.slice(0, 8)}) = filed ${twin.id.slice(0, 8)}`);
    await run("dup copy", sb.from("receipts").update({ status: "duplicate" }).eq("id", r.id));
  }
  if (!copies) say("   none");

  // --- 4. statement lines paired with the wrong charge ---
  say("\n4. Statement lines re-paired:");
  const { data: statements } = await sb.from("statements").select("*").eq("status", "reconciled");
  let swaps = 0;
  for (const st of statements) {
    const { data: rows } = await sb.from("statement_lines").select("*").eq("statement_id", st.id).order("line_no");
    const prefix = `stmt-${st.id}-`;
    const { data: periodTxns } = await sb.from("transactions").select("id, merchant, amount, date, is_refund, receipt_status, email_id")
      .eq("user_id", st.user_id).gte("date", "2026-01-01").lte("date", st.period_end);
    // Charges this statement created are what is in question, so they sit out the re-pair.
    const own = new Map((periodTxns || []).filter((t) => String(t.email_id || "").startsWith(prefix)).map((t) => [t.id, t]));
    const recon = reconcile({
      lines: rows.map((r) => ({ lineNo: r.line_no, txnDate: r.txn_date, postDate: r.post_date, descriptor: r.descriptor, amount: Number(r.amount), type: r.type, currency: r.currency, amountOrig: r.amount_orig })),
      transactions: (periodTxns || []).filter((t) => !own.has(t.id)),
      statement: { opening: st.opening_balance, closing: st.closing_balance, periodStart: st.period_start, periodEnd: st.period_end },
      sourceRef: st.id,
    });
    const rowByNo = new Map(rows.map((r) => [r.line_no, r]));
    for (const e of recon.tied) {
      const b = rowByNo.get(e.line.line_no);
      if (b.transaction_id === e.transaction.id) continue;
      // b should own charge T; a holds it today; b holds a charge C this statement created.
      const a = rows.find((r) => r.transaction_id === e.transaction.id && r.recon_status === "tied");
      const c = own.get(b.transaction_id);
      const aNow = recon.createdFromStatement.find((x) => x.line.line_no === a?.line_no);
      if (!a || !c || !aNow) { say(`   ${st.issued_on} line ${b.line_no} ${b.descriptor}: differs, not a clean swap — left alone`); continue; }
      swaps++;
      say(`   ${st.issued_on}: line ${b.line_no} "${b.descriptor}" ${inr(b.amount)} → #${e.transaction.id} ${e.transaction.merchant}`);
      say(`   ${st.issued_on}: line ${a.line_no} "${a.descriptor}" ${inr(a.amount)} → #${c.id}, rewritten from duplicate "${c.merchant}" to this line`);
      const { data: cLinks } = await sb.from("receipt_transactions").select("receipt_id").eq("transaction_id", c.id);
      if (cLinks?.length) say(`     note: #${c.id} has ${cLinks.length} bill(s) filed; they stay and should be checked`);
      await run("rewrite created", sb.from("transactions").update({
        merchant: a.descriptor, amount: a.amount, date: a.txn_date, email_id: `${prefix}${a.line_no}`,
        notes: "Created from the card statement — no alert email was received.",
      }).eq("id", c.id));
      await run("line a", sb.from("statement_lines").update({ transaction_id: c.id, recon_status: "created" }).eq("id", a.id));
      await run("line b", sb.from("statement_lines").update({ transaction_id: e.transaction.id, recon_status: "tied" }).eq("id", b.id));
    }
  }
  if (!swaps) say("   none");
})().catch((err) => { console.error(err); process.exit(1); });
