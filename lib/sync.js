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
- notes: A brief 1-line AI-generated insight about this transaction. Examples: "Monthly Google Workspace subscription", "Fuel fill-up at highway station", "Swiggy dinner order - late night", "Amazon return processed - refund to card". Be specific and useful.
- time: Extract the time of transaction if available in the email (HH:MM format, 24hr). null if not found.

IMPORTANT rules:
- If an email is about an Amazon return, refund, or cancellation → set isRefund: true
- If an HDFC email mentions "refund", "reversal", "credit", or "cashback" → set isRefund: true
- Verification transactions (typically Rs.1 or Rs.2) should be skipped entirely.
- Clean up merchant names to be human-readable.
- If an email doesn't contain a valid transaction, skip it.

Category rules:
- Amazon orders/returns → "amazon"
- Petrol/diesel/fuel stations (HP, BPCL, Indian Oil, etc.) → "fuel"
- Restaurants, cafes, food courts → "dining"
- Swiggy, Zomato → "swiggy"
- Electricity, water, gas, phone bills → "utilities"
- Netflix, Spotify, YouTube, cloud services → "subscriptions"
- Office supplies, stationery, printing → "office"
- Airlines, hotels, trains, Uber, Ola, cabs → "travel"
- Everything else → "other"

Return ONLY a valid JSON array. Each object must have: merchant, amount, date, category, hasReceipt, itemDescription, isRefund, notes, time.`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  return (
    err?.status === 429 ||
    err?.error?.type === "rate_limit_error" ||
    err?.message?.includes("rate_limit") ||
    err?.message?.includes("Rate limit")
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
 * Sync Gmail transactions for a single user.
 * Reads last_synced_at from users, fetches only newer emails, parses with Claude,
 * upserts, and bumps last_synced_at on success.
 */
export async function syncUserTransactions({ userId }) {
  const supabase = getSupabase();

  const { data: userRow } = await supabase
    .from("users")
    .select("last_synced_at")
    .eq("id", userId)
    .maybeSingle();

  // Use last_synced_at minus 1 day of overlap to catch delayed emails
  const lastSyncedAt = userRow?.last_synced_at ? new Date(userRow.last_synced_at) : null;
  const sinceEpoch = lastSyncedAt
    ? Math.floor(lastSyncedAt.getTime() / 1000) - 86400
    : null;

  const startedAt = new Date();
  const emails = await fetchHDFCEmails({ sinceEpoch });

  if (!emails.length) {
    await supabase.from("users").update({ last_synced_at: startedAt.toISOString() }).eq("id", userId);
    return { inserted: 0, considered: 0, message: "No new transaction emails." };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("transactions")
    .select("email_id")
    .eq("user_id", userId);

  if (fetchError) throw new Error("Database error: " + fetchError.message);

  const existingIds = new Set((existing || []).map((e) => e.email_id));
  const newEmails = emails.filter((e) => !existingIds.has(e.id));

  let totalInserted = 0;

  if (newEmails.length > 0) {
    const BATCH_SIZE = 5;

    for (let i = 0; i < newEmails.length; i += BATCH_SIZE) {
      const batch = newEmails.slice(i, i + BATCH_SIZE);

      let rows = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          rows = await parseBatch(batch);
          break;
        } catch (err) {
          if (isRateLimitError(err) && attempt < 3) {
            await sleep(65000 * attempt);
          } else if (!isRateLimitError(err)) {
            console.error("parseBatch failed:", err.message);
            break;
          }
        }
      }

      rows = rows
        .filter((r) => r.amount >= 10)
        .map((r) => ({ ...r, user_id: userId }));

      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from("transactions")
          .upsert(rows, { onConflict: "email_id,user_id" });

        if (!insertError) {
          totalInserted += rows.length;
        }
      }

      // Only sleep between batches when there are more to process and the batch is full.
      // Small incremental syncs (1 batch) skip the sleep entirely.
      if (i + BATCH_SIZE < newEmails.length) {
        await sleep(65000);
      }
    }
  }

  await supabase
    .from("users")
    .update({ last_synced_at: startedAt.toISOString() })
    .eq("id", userId);

  return {
    inserted: totalInserted,
    considered: newEmails.length,
    fetched: emails.length,
    message:
      totalInserted > 0
        ? `Synced ${totalInserted} new transactions.`
        : "No new transactions.",
  };
}
