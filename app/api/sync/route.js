import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { fetchHDFCEmails } from "@/lib/gmail";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

let isSyncing = {};

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

function isRateLimitError(err) {
  return (
    err?.status === 429 ||
    err?.error?.type === "rate_limit_error" ||
    err?.message?.includes("rate_limit") ||
    err?.message?.includes("Rate limit")
  );
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  if (isSyncing[userId]) {
    return NextResponse.json({
      error: "Sync already in progress. Please wait for it to finish.",
    }, { status: 409 });
  }

  isSyncing[userId] = true;

  try {
    // Get last sync time for incremental sync (gracefully handle if column doesn't exist)
    let lastSyncedAt = null;
    try {
      const { data: userData } = await getSupabase()
        .from("users")
        .select("last_synced_at")
        .eq("id", userId)
        .single();
      lastSyncedAt = userData?.last_synced_at || null;
    } catch {
      // Column may not exist yet — fall back to full sync
    }

    const emails = await fetchHDFCEmails(lastSyncedAt);

    if (!emails.length) {
      return NextResponse.json({
        transactions: [],
        message: "No new transaction emails found.",
      });
    }

    const { data: existing, error: fetchError } = await getSupabase()
      .from("transactions")
      .select("email_id")
      .eq("user_id", userId);

    if (fetchError) throw new Error("Database error: " + fetchError.message);

    const existingIds = new Set((existing || []).map((e) => e.email_id));
    const newEmails = emails.filter((e) => !existingIds.has(e.id));

    let totalInserted = 0;
    const insertedEmailIds = [];

    if (newEmails.length > 0) {
      const BATCH_SIZE = 15;

      for (let i = 0; i < newEmails.length; i += BATCH_SIZE) {
        const batch = newEmails.slice(i, i + BATCH_SIZE);

        let rows = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            rows = await parseBatch(batch);
            break;
          } catch (err) {
            if (isRateLimitError(err) && attempt < 3) {
              await sleep(10000 * attempt);
            } else if (!isRateLimitError(err)) {
              break;
            }
          }
        }

        rows = rows
          .filter((r) => r.amount >= 10)
          .map((r) => ({ ...r, user_id: userId }));

        if (rows.length > 0) {
          const { error: insertError } = await getSupabase()
            .from("transactions")
            .upsert(rows, { onConflict: "email_id,user_id" });

          if (!insertError) {
            totalInserted += rows.length;
            insertedEmailIds.push(...rows.map((r) => r.email_id));
          }
        }

        if (i + BATCH_SIZE < newEmails.length) {
          await sleep(3000);
        }
      }
    }

    // Update last_synced_at timestamp (ignore if column doesn't exist)
    try {
      await getSupabase()
        .from("users")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", userId);
    } catch {
      // Column may not exist yet
    }

    const { data: allTransactions, error } = await getSupabase()
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      transactions: allTransactions,
      message: totalInserted > 0
        ? `Synced ${totalInserted} new transactions. ${allTransactions.length} total.`
        : `No new transactions. ${allTransactions.length} total.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to sync emails" },
      { status: 500 }
    );
  } finally {
    isSyncing[userId] = false;
  }
}
