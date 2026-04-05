import { NextResponse } from "next/server";
import { fetchHDFCEmails } from "@/lib/gmail";
import { getSupabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

// Simple in-memory lock to prevent parallel syncs
let isSyncing = false;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a financial data extraction assistant. Parse bank transaction alert emails, Amazon order emails, and Amazon return/refund emails into structured transaction data.

For each email, extract:
- merchant: the merchant/vendor name
- amount: numeric amount in INR (just the number, no currency symbol)
- date: ISO date string (YYYY-MM-DD)
- category: one of: amazon, fuel, dining, swiggy, utilities, subscriptions, office, travel, other
- hasReceipt: true if it's an Amazon order (they include GST invoices), false otherwise
- itemDescription: for Amazon orders/returns, extract the item name/description if available. For other transactions, leave as null.
- isRefund: true if this is a return, refund, reversal, or cashback credit. false for normal purchases.

IMPORTANT rules:
- If an email is about an Amazon return, refund, or cancellation → set isRefund: true
- If an HDFC email mentions "refund", "reversal", "credit", or "cashback" → set isRefund: true
- Verification transactions (typically Rs.1 or Rs.2) should be skipped entirely.
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

Return ONLY a valid JSON array. Each object must have: merchant, amount, date, category, hasReceipt, itemDescription, isRefund.`;

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

  try {
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
      raw_email: emailBatch[i]?.subject || "",
    }));
  } catch (err) {
    console.error("Failed to parse Claude response:", err.message);
    return [];
  }
}

export async function POST() {
  if (isSyncing) {
    return NextResponse.json({
      error: "Sync already in progress. Please wait for it to finish.",
    }, { status: 409 });
  }

  isSyncing = true;

  try {
    console.log("Starting Gmail sync...");
    const emails = await fetchHDFCEmails();
    console.log(`Fetched ${emails.length} emails from Gmail`);

    if (!emails.length) {
      return NextResponse.json({
        transactions: [],
        message: "No transaction emails found.",
      });
    }

    // Get existing email IDs to skip duplicates
    const { data: existing, error: fetchError } = await getSupabase()
      .from("transactions")
      .select("email_id");

    if (fetchError) throw new Error("Supabase: " + fetchError.message);

    const existingIds = new Set((existing || []).map((e) => e.email_id));
    const newEmails = emails.filter((e) => !existingIds.has(e.id));
    console.log(`${newEmails.length} new emails to parse (${existingIds.size} already in DB)`);

    let totalInserted = 0;

    if (newEmails.length > 0) {
      // Process in small batches, save each batch immediately
      const BATCH_SIZE = 5;
      const totalBatches = Math.ceil(newEmails.length / BATCH_SIZE);

      for (let i = 0; i < newEmails.length; i += BATCH_SIZE) {
        const batch = newEmails.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        // Parse with retry
        let rows = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} emails) attempt ${attempt}`);
            rows = await parseBatch(batch);
            break;
          } catch (err) {
            if (err?.status === 429 || String(err).includes("rate_limit")) {
              const wait = 65000 * attempt;
              console.log(`Rate limited. Waiting ${wait / 1000}s...`);
              await sleep(wait);
            } else {
              console.error(`Batch ${batchNum} error:`, err.message);
              break;
            }
          }
        }

        // Filter out verification transactions (under Rs.10)
        rows = rows.filter((r) => r.amount >= 10);

        // Save this batch to Supabase immediately
        if (rows.length > 0) {
          const { error: insertError } = await getSupabase()
            .from("transactions")
            .upsert(rows, { onConflict: "email_id" });

          if (insertError) {
            console.error(`Insert error batch ${batchNum}:`, insertError.message);
          } else {
            totalInserted += rows.length;
            console.log(`Saved ${rows.length} transactions (${totalInserted} total so far)`);
          }
        }

        // Wait 65s between batches to stay within rate limits
        if (i + BATCH_SIZE < newEmails.length) {
          console.log(`Waiting 65s before next batch...`);
          await sleep(65000);
        }
      }
    }

    // Return all transactions
    const { data: allTransactions, error } = await getSupabase()
      .from("transactions")
      .select("*")
      .order("date", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      transactions: allTransactions,
      message: totalInserted > 0
        ? `Synced ${totalInserted} new transactions. ${allTransactions.length} total.`
        : `No new transactions. ${allTransactions.length} total.`,
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to sync emails" },
      { status: 500 }
    );
  } finally {
    isSyncing = false;
  }
}
