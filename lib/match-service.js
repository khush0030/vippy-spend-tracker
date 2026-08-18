import { getSupabaseAdmin } from "@/lib/supabase";
import { scoreCandidate, decide, expectedInrBand } from "@/lib/matcher";
import { getCardAccount } from "@/lib/cycles";
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

export async function linkReceipt({ receiptId, transactionId, userId, score, matchedBy = "auto" }) {
  const sb = getSupabaseAdmin();

  await sb.from("receipt_transactions").upsert(
    { receipt_id: receiptId, transaction_id: transactionId, match_score: score, matched_by: matchedBy },
    { onConflict: "receipt_id,transaction_id" }
  );

  // The score belongs to the link, not the receipt — one bill can span two
  // charges and score differently against each.
  const { error: receiptError } = await sb
    .from("receipts")
    .update({ status: "matched" })
    .eq("id", receiptId)
    .eq("user_id", userId);

  const { error: txnError } = await sb
    .from("transactions")
    .update({ receipt_status: "attached", has_receipt: true })
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
    await linkReceipt({
      receiptId: receipt.id,
      transactionId: verdict.best.transaction_id,
      userId,
      score: verdict.best.score,
      matchedBy: "auto",
    });
  } else if (verdict.action === "defer") {
    await getSupabaseAdmin()
      .from("receipts")
      .update({ status: "unmatched" })
      .eq("id", receipt.id)
      .eq("user_id", userId);
  }

  return verdict;
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
