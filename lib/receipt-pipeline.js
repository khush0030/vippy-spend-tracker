import { getSupabaseAdmin } from "@/lib/supabase";
import { get as storageGet } from "@/lib/storage";
import { extractReceipt } from "@/lib/receipt-vision";
import { matchReceipt } from "@/lib/match-service";
import { getRate } from "@/lib/fx";
import { getCardAccount } from "@/lib/cycles";
import { shouldSyncBeforeGivingUp } from "@/lib/sync-health";
import { logError, logInfo } from "@/lib/logger";

/**
 * Read → validate → convert → match, for one stored receipt.
 *
 * Runs after the webhook has already answered Telegram, so it may take as long
 * as it needs. Every stage writes its result back to the row, so a failure
 * halfway through leaves something a retry can resume from rather than a hole.
 */
export async function processReceipt({ userId, receiptId }) {
  const sb = getSupabaseAdmin();

  const { data: receipt, error } = await sb
    .from("receipts")
    .select("*")
    .eq("id", receiptId)
    .eq("user_id", userId)
    .single();

  if (error || !receipt) throw new Error(`receipt ${receiptId} not found`);

  const buffer = await storageGet(receipt.storage_path);
  const extraction = await extractReceipt(buffer, receipt.mime, { userId });

  if (!extraction.ok) {
    // Keep a count: the retry pass gives up after a few rounds rather than
    // paying for the same unreadable photo every day.
    const attempts = Number(receipt.extracted?.attempts || 0) + 1;
    await sb
      .from("receipts")
      .update({ status: "pending", extracted: { error: extraction.error, attempts } })
      .eq("id", receiptId);

    await logError({
      source: "vision",
      event: "extraction_failed",
      userId,
      message: `Could not read receipt ${receiptId.slice(0, 8)}`,
      details: { error: extraction.error },
    });

    return { ok: false, error: extraction.error };
  }

  const v = extraction.value;

  // Foreign receipts need an INR estimate so the matcher can bound its search.
  // The rate is only ever an estimate — the statement decides the real figure.
  let fxRate = null;
  let amountInr = null;
  if (v.currency && v.currency !== "INR" && v.date) {
    fxRate = await getRate(v.currency, v.date);
    if (fxRate) amountInr = Number(v.total) * fxRate;
  }

  const update = {
    doc_type: v.doc_type || null,
    merchant: v.merchant || null,
    merchant_raw: v.merchant_raw || null,
    amount: v.total ?? null,
    tax_total: v.tax_total ?? null,
    receipt_date: v.date || null,
    receipt_time: v.time || null,
    invoice_no: v.invoice_no || null,
    card_last4: v.card_last4 || null,
    currency: v.currency || "INR",
    amount_inr: amountInr,
    dcc_amount_inr: v.dcc_amount_inr ?? null,
    fx_rate: fxRate,
    fx_date: fxRate ? v.date : null,
    country: v.country || null,
    city: v.city || null,
    language: v.language || null,
    tax_id: v.tax_id || null,
    tax_id_type: v.tax_id_type || null,
    tax_breakdown: v.tax_breakdown || null,
    extracted: extraction.raw,
    models_used: extraction.modelsUsed || [],
    consensus: extraction.consensus,
    confidence: extraction.confidence,
    status: "unmatched",
  };

  const { data: updated } = await sb
    .from("receipts")
    .update(update)
    .eq("id", receiptId)
    .select()
    .single();

  await logInfo({
    source: "receipt",
    event: "extracted",
    userId,
    message: `${v.merchant || "unknown"} · ${v.currency} ${v.total} · ${extraction.consensus}`,
    details: { receiptId, confidence: extraction.confidence },
  });

  const card = await getCardAccount(userId);

  // A conflicted read is never auto-matched, however good the score looks —
  // if two models couldn't agree what the total was, a human confirms.
  if (extraction.consensus === "conflict") {
    return {
      ok: true,
      receipt: updated,
      extraction,
      verdict: { action: "ask", candidates: [], conflicted: true },
    };
  }

  let verdict = await matchReceipt(userId, updated, { card });

  // Nothing to compare against usually means the bank alert has not been
  // imported yet — a bill photographed at the counter beats the SMS by
  // minutes. Fetching mail once, here, is the difference between "filed" and
  // "I'll get back to you tomorrow".
  if (await ledgerMightBeBehind(userId, verdict)) {
    const { syncUserTransactions } = await import("@/lib/sync");
    await syncUserTransactions({ userId });
    verdict = await matchReceipt(userId, updated, { card });

    await logInfo({
      source: "match",
      event: "synced_for_match",
      userId,
      message: `Pulled mail before answering receipt ${receiptId.slice(0, 8)}: ${verdict.action}`,
    });
  }

  return { ok: true, receipt: updated, extraction, verdict };
}

/** Cursor lookup kept out of the decision, which is pure and tested. */
async function ledgerMightBeBehind(userId, verdict) {
  const { data } = await getSupabaseAdmin()
    .from("users")
    .select("last_synced_at")
    .eq("id", userId)
    .maybeSingle();

  return shouldSyncBeforeGivingUp({
    verdict,
    lastSyncedAt: data?.last_synced_at || null,
    now: new Date().toISOString(),
  });
}

/** How many times a failed read is retried before it needs a human. */
const MAX_EXTRACTION_ATTEMPTS = 4;

/**
 * Re-read receipts whose extraction failed.
 *
 * The bot tells the sender it will retry, so something has to. Failures are
 * usually transient and external — a provider outage, a rate limit, an empty
 * credit balance — and the bytes are already stored, so a later pass costs
 * nothing but the read itself.
 */
export async function retryFailedExtractions(userId, { limit = 20 } = {}) {
  const sb = getSupabaseAdmin();

  const { data: stuck } = await sb
    .from("receipts")
    .select("id, extracted")
    .eq("user_id", userId)
    .eq("status", "pending")
    .not("extracted->>error", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  const due = (stuck || []).filter(
    (r) => Number(r.extracted?.attempts || 0) < MAX_EXTRACTION_ATTEMPTS
  );

  if (!due.length) return { retried: 0, recovered: 0 };

  let recovered = 0;
  for (const row of due) {
    try {
      const result = await processReceipt({ userId, receiptId: row.id });
      if (result.ok) recovered++;
    } catch (err) {
      await logError({
        source: "vision",
        event: "retry_failed",
        userId,
        message: `Retry of receipt ${row.id.slice(0, 8)} threw`,
        error: err,
      });
    }
  }

  await logInfo({
    source: "vision",
    event: "retry",
    userId,
    message: `Retried ${due.length} failed reads, recovered ${recovered}`,
  });

  return { retried: due.length, recovered };
}
