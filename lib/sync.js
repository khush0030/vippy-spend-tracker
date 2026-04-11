import Anthropic from "@anthropic-ai/sdk";
import { fetchHDFCEmails } from "@/lib/gmail";
import { getSupabase } from "@/lib/supabase";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a financial data extraction assistant for a corporate expense tracker. Parse bank transaction alert emails, Amazon order emails, and return/refund emails into structured transaction data.

For each email, extract:
- merchant: the merchant/vendor name (clean it up — e.g. "AMAZONIN" → "Amazon", "SWIGGY" → "Swiggy")
- amount: numeric amount in INR (just the number, no currency symbol)
- date: ISO date string (YYYY-MM-DD)
- category: one of: amazon, fuel, dining, swiggy, utilities, subscriptions, office, travel, other
- hasReceipt: true if it's an Amazon order (they include GST invoices), false otherwise
- itemDescription: for Amazon orders/returns, extract the specific item name. For other transactions, leave null.
- isRefund: true if this is a return, refund, reversal, or cashback credit. false for normal purchases.
- notes: A brief 1-line AI-generated insight about this transaction.
- time: Extract the time of transaction if available (HH:MM 24hr). null if not found.

Rules: Skip verification txns (Rs.1/2). Refunds/reversals/returns/cashback → isRefund: true. Skip emails without valid transactions.
Categories: amazon, fuel, dining, swiggy, utilities, subscriptions, office, travel, other.
Return ONLY a JSON array. Each object: merchant, amount, date, category, hasReceipt, itemDescription, isRefund, notes, time.`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  return (
    err?.status === 429 ||
    err?.error?.type === "rate_limit_error" ||
    /rate[_ ]?limit/i.test(err?.message || "")
  );
}

async function parseBatch(emailBatch) {
  const emailSummaries = emailBatch
    .map(
      (e, i) =>
        `--- Email ${i + 1} (id: ${e.id}) ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body.substring(0, 1500)}\n`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: `${SYSTEM_PROMPT}\n\nEmails:\n${emailSummaries}` }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]);
  return parsed.map((t, i) => ({
    email_id: emailBatch[i]?.id || `txn-${Date.now()}-${i}`,
    merchant: t.merchant || "Unknown",
    amount: parseFloat(t.amount) || 0,
    date: t.date || new Date().toISOString().split("T")[0],
    category: t.category || "other",
    has_receipt: Boolean(t.hasReceipt),
    item_description: t.itemDescription || null,
    is_refund: Boolean(t.isRefund),
    notes: t.notes || null,
    txn_time: t.time || null,
    raw_email: emailBatch[i]?.subject || "",
  }));
}

/**
 * Run an incremental Gmail sync for a single user.
 * Safe to call from both the manual sync endpoint and the cron handler.
 */
export async function syncUserTransactions({ userId }) {
  const supabase = getSupabase();
  const syncStartedAt = new Date();

  let lastSyncedAt = null;
  try {
    const { data: userData } = await supabase
      .from("users")
      .select("last_synced_at")
      .eq("id", userId)
      .single();
    lastSyncedAt = userData?.last_synced_at || null;
  } catch {}

  const emails = await fetchHDFCEmails(lastSyncedAt);

  if (!emails.length) {
    await supabase
      .from("users")
      .update({ last_synced_at: syncStartedAt.toISOString() })
      .eq("id", userId);
    return { inserted: 0, considered: 0, fetched: 0, message: "No new transaction emails found." };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("transactions")
    .select("email_id")
    .eq("user_id", userId);

  if (fetchError) throw new Error("Database error: " + fetchError.message);

  const existingIds = new Set((existing || []).map((e) => e.email_id));
  const newEmails = emails.filter((e) => !existingIds.has(e.id));

  let totalInserted = 0;
  let hadBatchFailure = false;

  if (newEmails.length > 0) {
    const BATCH_SIZE = 15;
    for (let i = 0; i < newEmails.length; i += BATCH_SIZE) {
      const batch = newEmails.slice(i, i + BATCH_SIZE);

      let rows = null;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          rows = await parseBatch(batch);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (isRateLimitError(err) && attempt < 3) {
            await sleep(10000 * attempt);
          } else if (!isRateLimitError(err)) {
            break;
          }
        }
      }

      if (lastErr || rows === null) {
        console.error(`[sync] batch ${i / BATCH_SIZE} failed:`, lastErr?.message);
        hadBatchFailure = true;
        continue;
      }

      const toInsert = rows
        .filter((r) => r.amount >= 10)
        .map((r) => ({ ...r, user_id: userId }));

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("transactions")
          .upsert(toInsert, { onConflict: "email_id,user_id" });

        if (insertError) {
          console.error("[sync] upsert failed:", insertError.message);
          hadBatchFailure = true;
        } else {
          totalInserted += toInsert.length;
        }
      }

      if (i + BATCH_SIZE < newEmails.length) {
        await sleep(3000);
      }
    }
  }

  if (!hadBatchFailure) {
    await supabase
      .from("users")
      .update({ last_synced_at: syncStartedAt.toISOString() })
      .eq("id", userId);
  }

  return {
    inserted: totalInserted,
    considered: newEmails.length,
    fetched: emails.length,
    advanced: !hadBatchFailure,
    message:
      totalInserted > 0
        ? `Synced ${totalInserted} new transactions.`
        : "No new transactions.",
  };
}
