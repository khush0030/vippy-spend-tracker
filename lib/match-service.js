import { getSupabaseAdmin } from "@/lib/supabase";
import { scoreCandidate, decide, expectedInrBand, findSplit, isSameBill, isCovered, tippedBill, suggestCharges } from "@/lib/matcher";
import { getCardAccount, billingCycle, currentCycle, cycleScope } from "@/lib/cycles";
import { logError, logInfo } from "@/lib/logger";

/**
 * Database glue around the pure matcher.
 *
 * The scoring rules live in lib/matcher.js and are tested without a database;
 * this module only decides which rows are worth scoring and writes the result.
 */

const DOMESTIC_DATE_PAD = 7;
const FOREIGN_DATE_BEFORE = 1;
const FOREIGN_DATE_AFTER = 5;
const SPLIT_POOL = 12;

function shiftDate(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Narrow the transaction table to plausible candidates before scoring.
 *
 * Foreign receipts can't be filtered on amount equality — the charge is the
 * bill converted and marked up — so the band from the matcher is used as the
 * SQL range instead.
 */
export async function findCandidates(userId, receipt, card) {
  if (!receipt.receipt_date) return [];

  const foreign = receipt.currency && receipt.currency !== "INR";
  const from = shiftDate(receipt.receipt_date, foreign ? -FOREIGN_DATE_BEFORE : -DOMESTIC_DATE_PAD);
  const to = shiftDate(receipt.receipt_date, foreign ? FOREIGN_DATE_AFTER : DOMESTIC_DATE_PAD);

  let query = getSupabaseAdmin()
    .from("transactions")
    .select("id, merchant, amount, date, txn_time, receipt_status, is_refund")
    .eq("user_id", userId)
    .eq("is_refund", false)
    .gte("date", from)
    .lte("date", to);

  if (foreign) {
    if (receipt.dcc_amount_inr) {
      const t = Number(receipt.dcc_amount_inr);
      query = query.gte("amount", t * 0.97).lte("amount", t * 1.03);
    } else if (receipt.fx_rate) {
      const band = expectedInrBand({
        amount: receipt.amount,
        fxRate: receipt.fx_rate,
        markupPct: card?.forex_markup_pct ?? undefined,
        gstPct: card?.forex_gst_pct ?? undefined,
      });
      query = query.gte("amount", band.low * 0.98).lte("amount", band.high * 1.02);
    } else {
      // No rate means no way to bound the amount — defer rather than scan.
      return [];
    }
  } else {
    const a = Number(receipt.amount);
    if (!(a > 0)) return [];
    const pad = Math.max(a * 0.05, 20);
    query = query.gte("amount", a - pad).lte("amount", a + pad);
  }

  const { data } = await query.limit(25);
  return data || [];
}

/**
 * File a receipt against a charge.
 *
 * A charge whose bills already add up to it gets no more: the extra receipt is
 * a second copy, and a second copy in the pack is a bill counted twice against
 * the statement. It is kept as `duplicate` rather than deleted.
 * Returns { linked } or { duplicate: true }.
 */
export async function linkReceipt({ receiptId, transactionId, userId, score, matchedBy = "auto" }) {
  const sb = getSupabaseAdmin();

  // A bill with alcohol or tobacco on it is never filed, by any path.
  const { data: self } = await sb.from("receipts").select("extracted").eq("id", receiptId).maybeSingle();
  if (self?.extracted?.restricted?.length) {
    await logInfo({ source: "match", event: "restricted", userId, message: `Receipt ${receiptId.slice(0, 8)} not filed: ${self.extracted.restricted.join(", ")}` });
    return { restricted: true };
  }

  const { data: existing } = await sb
    .from("receipt_transactions")
    .select("receipt_id")
    .eq("transaction_id", transactionId)
    .neq("receipt_id", receiptId);
  if (existing?.length) {
    const [{ data: txn }, { data: bills }, { data: incoming }] = await Promise.all([
      sb.from("transactions").select("amount, category").eq("id", transactionId).eq("user_id", userId).maybeSingle(),
      sb.from("receipts").select("id, amount, currency, receipt_date").in("id", existing.map((l) => l.receipt_id)),
      sb.from("receipts").select("id, amount, currency, receipt_date").eq("id", receiptId).maybeSingle(),
    ]);
    if (txn && isCovered(txn, bills)) {
      // Two bills from one meal: the larger carries the tip and replaces the smaller.
      const tip = tippedBill(txn, bills, incoming);
      if (tip?.keep.id === receiptId) {
        await sb.from("receipt_transactions").delete().eq("receipt_id", tip.drop.id).eq("transaction_id", transactionId);
        await sb.from("receipts").update({ status: "duplicate" }).eq("id", tip.drop.id).eq("user_id", userId);
        await logInfo({
          source: "match",
          event: "duplicate",
          userId,
          message: `Receipt ${tip.drop.id.slice(0, 8)} replaced on txn ${transactionId} by the tipped bill ${receiptId.slice(0, 8)}`,
        });
      } else {
        await sb.from("receipts").update({ status: "duplicate" }).eq("id", receiptId).eq("user_id", userId);
        await logInfo({
          source: "match",
          event: "duplicate",
          userId,
          message: `Receipt ${receiptId.slice(0, 8)} not filed: txn ${transactionId} already has its bill`,
        });
        return { duplicate: true };
      }
    }
  }

  const { error: linkError } = await sb.from("receipt_transactions").upsert(
    { receipt_id: receiptId, transaction_id: transactionId, match_score: score, matched_by: matchedBy },
    { onConflict: "receipt_id,transaction_id" }
  );

  // A half-link is worse than no link: if the join row itself failed to
  // write (e.g. a matched_by value the check constraint rejects), neither
  // side should be touched.
  if (linkError) {
    await logError({
      source: "match",
      event: "link_write_failed",
      userId,
      message: `Could not link receipt ${receiptId.slice(0, 8)} to txn ${transactionId}`,
      details: { linkError: linkError.message },
    });
    return { linked: false };
  }

  // The score belongs to the link, not the receipt — one bill can span two
  // charges and score differently against each.
  const { error: receiptError } = await sb
    .from("receipts")
    .update({ status: "matched" })
    .eq("id", receiptId)
    .eq("user_id", userId);

  const { error: txnError } = await sb
    .from("transactions")
    // A bill that turns up after "no bill exists" was declared replaces the declaration.
    .update({ receipt_status: "attached", has_receipt: true, declared_reason: null })
    .eq("id", transactionId)
    .eq("user_id", userId);

  // Loudly: a link whose two sides disagree is worse than no link, and this
  // exact write once failed silently against a column that did not exist.
  if (receiptError || txnError) {
    await logError({
      source: "match",
      event: "link_write_failed",
      userId,
      message: `Linked receipt ${receiptId.slice(0, 8)} but could not update both sides`,
      details: { receiptError: receiptError?.message, txnError: txnError?.message },
    });
  }

  await logInfo({
    source: "match",
    event: "linked",
    userId,
    message: `Receipt ${receiptId.slice(0, 8)} → txn ${transactionId} (${matchedBy}, score ${score})`,
  });

  await retireCopies(userId, receiptId);
  return { linked: true };
}

/** Unfiled copies of a bill that has just been filed will never match: retire them. */
async function retireCopies(userId, receiptId) {
  const sb = getSupabaseAdmin();
  const { data: filed } = await sb.from("receipts").select("*").eq("id", receiptId).maybeSingle();
  if (!filed?.receipt_date || filed.amount == null) return;

  const { data: waiting } = await sb
    .from("receipts")
    .select("*")
    .eq("user_id", userId)
    .eq("receipt_date", filed.receipt_date)
    .eq("amount", filed.amount)
    .in("status", ["pending", "unmatched"])
    .neq("id", receiptId);
  const copies = (waiting || []).filter((r) => isSameBill(filed, r));
  if (!copies.length) return;

  await sb.from("receipts").update({ status: "duplicate" }).in("id", copies.map((r) => r.id)).eq("user_id", userId);
  await logInfo({
    source: "match",
    event: "duplicate",
    userId,
    message: `${copies.length} copy(ies) of receipt ${receiptId.slice(0, 8)} retired`,
  });
}

/**
 * Bills already sent that are still waiting to be filed, each with the charge
 * it most likely pays. Waiting on a tap, a bill reads as "missing" everywhere,
 * though it is sitting right there. `onlyCharges` narrows to those charges.
 */
export async function billsAwaitingFiling(userId, { onlyCharges = null } = {}) {
  const sb = getSupabaseAdmin();
  const { data: waiting } = await sb
    .from("receipts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "unmatched")
    .order("created_at", { ascending: false })
    .limit(60);
  const card = await getCardAccount(userId);
  const out = [];
  for (const r of waiting || []) {
    const best = (await findCandidates(userId, r, card))
      .filter((t) => t.receipt_status === "missing")
      .map((txn) => ({ txn, ...scoreCandidate(r, txn, { cardLast4: card?.last4 }) }))
      .filter((c) => !c.disqualified && c.score >= 45)
      .sort((a, b) => b.score - a.score)[0];
    if (!best || (onlyCharges && !onlyCharges.has(best.txn.id))) continue;
    out.push({ receipt: r, txn: best.txn, score: best.score, foreign: best.foreign });
  }
  return out;
}

/**
 * Charges still missing a bill in the cycle being paid and the open one.
 * Older cycles are paid and closed, so nothing there is offered.
 */
export async function openMissingCharges(userId) {
  const sb = getSupabaseAdmin();
  const cycles = [await billingCycle(userId), await currentCycle(userId)].filter(Boolean);
  const seen = new Map();
  for (const cycle of cycles) {
    const scope = await cycleScope(cycle);
    const { data } = await scope(
      sb.from("transactions").select("id, merchant, amount, date").eq("user_id", userId).eq("is_refund", false).eq("receipt_status", "missing")
    ).limit(500);
    for (const t of data || []) seen.set(t.id, t);
  }
  return [...seen.values()];
}

/** The charges a waiting bill could be for, best first, for the user to pick from. */
export async function suggestForReceipt(userId, receipt, { charges = null, limit = 4 } = {}) {
  return suggestCharges(receipt, charges ?? (await openMissingCharges(userId)), { limit });
}

export const NOT_A_WORK_BILL = "not a work bill";

/** The user says this bill is not for the card: it never matches and never goes to accounts. */
export async function discardReceipt({ userId, receiptId }) {
  const { data, error } = await getSupabaseAdmin()
    .from("receipts")
    .update({ status: "rejected", user_note: NOT_A_WORK_BILL })
    .eq("id", receiptId)
    .eq("user_id", userId)
    .in("status", ["pending", "unmatched"])
    .select("id");
  if (error) throw new Error(error.message);
  if (data?.length) await logInfo({ source: "match", event: "discarded", userId, message: `Receipt ${receiptId.slice(0, 8)} discarded by user` });
  return Boolean(data?.length);
}

/** Undo discardReceipt. Only a bill the user discarded comes back — never one set aside for alcohol or tobacco. */
export async function restoreReceipt({ userId, receiptId }) {
  const { data, error } = await getSupabaseAdmin()
    .from("receipts")
    .update({ status: "unmatched", user_note: null })
    .eq("id", receiptId)
    .eq("user_id", userId)
    .eq("status", "rejected")
    .eq("user_note", NOT_A_WORK_BILL)
    .select("id");
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

/** Every item line both readers saw on a bill. */
export function billItems(extracted) {
  return [...(extracted?.a?.line_items || []), ...(extracted?.b?.line_items || [])];
}

/**
 * Set aside a bill with alcohol or tobacco on it: never attached, never sent.
 * The charge it pays for needs no bill, so it is marked "no bill exists" —
 * the charge named here, and any it was already filed against.
 */
export async function setAsideRestricted({ userId, receiptId, hits, transactionId = null }) {
  const sb = getSupabaseAdmin();
  const { data: r } = await sb.from("receipts").select("extracted").eq("id", receiptId).maybeSingle();
  await sb
    .from("receipts")
    .update({ status: "rejected", extracted: { ...(r?.extracted || {}), restricted: hits } })
    .eq("id", receiptId)
    .eq("user_id", userId);

  const { data: links } = await sb.from("receipt_transactions").select("transaction_id").eq("receipt_id", receiptId);
  await sb.from("receipt_transactions").delete().eq("receipt_id", receiptId);

  const charges = [...new Set([...(links || []).map((l) => l.transaction_id), transactionId].filter(Boolean))];
  for (const id of charges) {
    const { count } = await sb.from("receipt_transactions").select("*", { count: "exact", head: true }).eq("transaction_id", id);
    if (count) continue; // another bill still covers it
    await sb
      .from("transactions")
      .update({ receipt_status: "declared", declared_reason: "no bill exists", has_receipt: false })
      .eq("id", id)
      .eq("user_id", userId)
      .in("receipt_status", ["missing", "attached"]);
  }

  await logInfo({
    source: "match",
    event: "restricted",
    userId,
    message: `Receipt ${receiptId.slice(0, 8)} set aside (${hits.join(", ")}); ${charges.length ? `charge ${charges.join(", ")} marked no bill` : "no charge identified"}`,
  });
  return { charges };
}

/** Undo. Used by the "Wrong match" button and the dashboard. */
export async function unlinkReceipt({ receiptId, userId }) {
  const sb = getSupabaseAdmin();

  const { data: links } = await sb
    .from("receipt_transactions")
    .select("transaction_id")
    .eq("receipt_id", receiptId);

  await sb.from("receipt_transactions").delete().eq("receipt_id", receiptId);

  for (const link of links || []) {
    // Only clear the transaction if nothing else is still attached to it.
    const { count } = await sb
      .from("receipt_transactions")
      .select("*", { count: "exact", head: true })
      .eq("transaction_id", link.transaction_id);

    if (!count) {
      await sb
        .from("transactions")
        .update({ receipt_status: "missing", has_receipt: false })
        .eq("id", link.transaction_id)
        .eq("user_id", userId);
    }
  }

  await sb
    .from("receipts")
    .update({ status: "unmatched", match_score: null })
    .eq("id", receiptId)
    .eq("user_id", userId);

  await logInfo({
    source: "match",
    event: "unlinked",
    userId,
    message: `Receipt ${receiptId.slice(0, 8)} unlinked`,
  });
}

/**
 * Score a receipt against its candidates and act on the verdict.
 * Returns { action, best, candidates } — the caller renders the chat reply.
 */
export async function matchReceipt(userId, receipt, { card } = {}) {
  const cardAccount = card ?? (await getCardAccount(userId));
  const candidates = await findCandidates(userId, receipt, cardAccount);

  const scored = candidates.map((txn) => {
    const result = scoreCandidate(receipt, txn, { cardLast4: cardAccount?.last4 });
    return { ...result, transaction_id: txn.id, txn };
  });

  const foreign = Boolean(receipt.currency && receipt.currency !== "INR");
  const verdict = decide(scored, { foreign });

  if (verdict.action === "auto") {
    const result = await linkReceipt({
      receiptId: receipt.id,
      transactionId: verdict.best.transaction_id,
      userId,
      score: verdict.best.score,
      matchedBy: "auto",
    });
    return result?.duplicate ? { ...verdict, action: "duplicate" } : verdict;
  }

  // Only when no single charge is plausible — a split never overrides a choice the user is shown.
  if (!foreign && verdict.action === "defer") {
    const split = await matchSplit(userId, receipt);
    if (split) return split;
  }

  if (verdict.action === "defer") {
    // A receipt a split just filed must not be put back.
    await getSupabaseAdmin()
      .from("receipts")
      .update({ status: "unmatched" })
      .eq("id", receipt.id)
      .eq("user_id", userId)
      .in("status", ["pending", "unmatched"]);
  }

  return verdict;
}

/**
 * One charge paid for several bills: link every part, or nothing.
 * Returns an auto verdict naming the charge, or null.
 */
async function matchSplit(userId, receipt) {
  if (!receipt.receipt_date || !(Number(receipt.amount) > 0)) return null;
  const sb = getSupabaseAdmin();

  const { data: siblings } = await sb
    .from("receipts")
    .select("id, amount, currency, receipt_date")
    .eq("user_id", userId)
    .eq("receipt_date", receipt.receipt_date)
    .in("status", ["pending", "unmatched"])
    .limit(SPLIT_POOL);
  const pool = [...(siblings || []).filter((r) => r.id !== receipt.id), receipt];
  if (pool.length < 2) return null;

  const total = pool.reduce((s, r) => s + Number(r.amount || 0), 0);
  const { data: txns } = await sb
    .from("transactions")
    .select("id, merchant, amount, date")
    .eq("user_id", userId)
    .eq("is_refund", false)
    .eq("receipt_status", "missing")
    .gt("amount", Number(receipt.amount))
    .lte("amount", total + 1)
    .gte("date", shiftDate(receipt.receipt_date, -DOMESTIC_DATE_PAD))
    .lte("date", shiftDate(receipt.receipt_date, DOMESTIC_DATE_PAD))
    .limit(25);

  // Only the receipt being matched may complete a split, and only one charge may fit.
  const fits = (txns || [])
    .map((txn) => ({ txn, parts: findSplit(pool, txn) }))
    .filter((f) => f.parts?.some((r) => r.id === receipt.id));
  if (fits.length !== 1) return null;

  const { txn, parts } = fits[0];
  for (const part of parts) {
    await linkReceipt({ receiptId: part.id, transactionId: txn.id, userId, score: null, matchedBy: "rematch" });
  }
  await logInfo({
    source: "match",
    event: "split",
    userId,
    message: `${parts.length} receipts → txn ${txn.id} (₹${txn.amount})`,
  });
  return { action: "auto", best: { transaction_id: txn.id, txn, score: `split of ${parts.length}` }, candidates: [], split: parts.length };
}

/**
 * Re-run matching for receipts still waiting on a transaction.
 *
 * Called after every Gmail sync, because the common case is photographing the
 * bill at the counter minutes before HDFC sends the alert. Solved without the
 * user ever knowing there was a problem.
 */
export async function rematchPendingReceipts(userId, { maxAgeDays = 30 } = {}) {
  const cutoff = shiftDate(new Date().toISOString().slice(0, 10), -maxAgeDays);

  const { data: pending } = await getSupabaseAdmin()
    .from("receipts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "unmatched")
    .gte("receipt_date", cutoff)
    .limit(100);

  if (!pending?.length) return { checked: 0, matched: 0 };

  const card = await getCardAccount(userId);
  let matched = 0;

  for (const receipt of pending) {
    // A split or a retired copy earlier in this loop may already have settled this one.
    const { data: now } = await getSupabaseAdmin().from("receipts").select("status").eq("id", receipt.id).maybeSingle();
    if (now?.status !== "unmatched") continue;
    const verdict = await matchReceipt(userId, receipt, { card });
    if (verdict.action === "auto") matched++;
  }

  if (matched) {
    await logInfo({
      source: "match",
      event: "rematch",
      userId,
      message: `Rematch bound ${matched} of ${pending.length} pending receipts`,
    });
  }

  return { checked: pending.length, matched };
}
