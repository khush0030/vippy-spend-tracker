import { getSupabaseAdmin } from "@/lib/supabase";
import { get as storageGet } from "@/lib/storage";
import { extractReceipt } from "@/lib/receipt-vision";
import { matchReceipt } from "@/lib/match-service";
import { getRate } from "@/lib/fx";
import { getCardAccount } from "@/lib/cycles";
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
    await sb
      .from("receipts")
      .update({ status: "pending", extracted: { error: extraction.error } })
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

  const verdict = await matchReceipt(userId, updated, { card });
  return { ok: true, receipt: updated, extraction, verdict };
}
