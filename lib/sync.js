import Anthropic from "@anthropic-ai/sdk";
import { fetchHDFCEmails } from "@/lib/gmail";
import { getSupabase } from "@/lib/supabase";
import { logError, logInfo, logWarn } from "@/lib/logger";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a financial data extraction assistant for a corporate expense tracker. Parse bank transaction alert emails, Amazon order emails, and return/refund emails into structured transaction data.

For each email, extract:
- merchant: the merchant/vendor name, cleaned up (e.g. "AMAZONIN" → "Amazon", "SWIGGY" → "Swiggy", "GOOGLE WORKSPACE CYBS" → "Google Workspace"). Always use a consistent, canonical name — never mix "Amazon", "Amazon.in", "AMAZONIN" for the same merchant.
- amount: numeric amount in INR (just the number, no currency symbol)
- date: ISO date string (YYYY-MM-DD)
- category: one of: amazon, fuel, dining, swiggy, utilities, subscriptions, office, travel, other
- itemDescription: for Amazon orders/returns, extract the specific item name. For other transactions, leave null.
- isRefund: true if this is a return, refund, reversal, or cashback credit. false for normal purchases.
- notes: A brief 1-line AI-generated insight about this transaction.
- time: Extract the time of transaction if available (HH:MM 24hr). null if not found.

CRITICAL RULES — follow these strictly:

1. SKIP EMAILS (return nothing for them):
   - Amazon "Delivered" / shipment notifications that do NOT state a transaction amount
   - Amazon "Shipped" / "Out for delivery" emails with no amount
   - Verification transactions under Rs.10 (typically Rs.1, Rs.2, Rs.5 pre-auth checks)
   - Emails that are order status updates without money movement
   - Promotional emails, receipts that only confirm delivery, marketing emails

2. ALWAYS FLAG AS REFUND (isRefund: true) — scan the subject AND body for ANY of these terms:
   reversal, reversed, refund, refunded, return processed, cashback, credited back, credit for, dispute reversal, chargeback, "amount credited", "will be credited"
   If ANY of these appear in the email, isRefund MUST be true — no exceptions.

3. DEDUPLICATION — be aware that the same real-world transaction often generates MULTIPLE emails (an HDFC alert + an Amazon order confirm + an Amazon shipped email). When parsing a batch, you don't need to dedupe yourself, but you MUST:
   - Extract the amount from the HDFC bank alert when present (that's authoritative)
   - Use the EXACT amount string — don't round, don't change precision
   - Use the EXACT date of the transaction (DD/MM/YYYY from the bank alert, or order-placed date for Amazon)

4. MERCHANT NAMING — canonicalize consistently:
   - All Amazon variants ("AMAZONIN", "Amazon.in", "Amazon India") → "Amazon"
   - All Google Workspace variants ("GOOGLE WORKSPACE CYBS", "Google Workspace") → "Google Workspace"
   - All AWS variants → "Amazon Web Services"
   - Strip prefixes like "PAYTM*", "BIL*", "NACH*" if they're in the merchant string

5. Categories: amazon, fuel, dining, swiggy, utilities, subscriptions, office, travel, other.

Return ONLY a valid JSON array. Each object must have: merchant, amount, date, category, itemDescription, isRefund, notes, time.`;

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

// Normalize merchant for dedup comparisons — strip case, punctuation, spaces.
function normalizeMerchant(m) {
  return (m || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Stable fingerprint for detecting same-transaction duplicates across
// different email IDs (HDFC alert + Amazon confirm for one purchase, etc).
// Uses (date, amount, refund-flag) WITHOUT merchant — because the same
// charge arrives as "AMAZONIN" from HDFC and "Amazon.in" from Amazon.
function transactionFingerprint(t) {
  const amount = Number(t.amount || 0).toFixed(2);
  return `${t.date}|${amount}|${t.is_refund ? "R" : "P"}`;
}

// Forces is_refund = true if the raw email or notes mention any refund term
// that Claude may have overlooked. Cheap safety net for misclassifications.
const REFUND_TERMS = /\b(reversal|reversed|refund|refunded|cashback|charged[-\s]?back|credited\s+back|credit\s+for|dispute)\b/i;
// Extract transaction time from email body or header when Claude misses it.
// Matches patterns: "at 14:32", "14:32:45 IST", "Time: 14:32", "time 02:30 PM"
const TIME_PATTERNS = [
  /\bat\s+(\d{1,2}:\d{2})(?::\d{2})?\s*(?:hrs?|IST|GMT|UTC)?/i,
  /\btime[:\s]+(\d{1,2}:\d{2})(?::\d{2})?\s*(?:hrs?|IST|AM|PM)?/i,
  /(\d{1,2}:\d{2})(?::\d{2})?\s*(?:IST|hrs)/i,
  /(\d{1,2}:\d{2})\s*(AM|PM)/i,
];

function extractTimeFromEmail(emailBody, emailDateHeader) {
  // Try email body first (more specific to transaction)
  for (const pat of TIME_PATTERNS) {
    const m = emailBody?.match(pat);
    if (m) {
      let [h, min] = m[1].split(":").map(Number);
      // Handle AM/PM if captured
      if (m[2] && /PM/i.test(m[2]) && h < 12) h += 12;
      if (m[2] && /AM/i.test(m[2]) && h === 12) h = 0;
      if (h >= 0 && h < 24 && min >= 0 && min < 60) {
        return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      }
    }
  }
  // Fallback: parse the email Date header (e.g., "Mon, 14 Apr 2025 14:32:45 +0530")
  if (emailDateHeader) {
    try {
      const dt = new Date(emailDateHeader);
      if (!isNaN(dt.getTime())) {
        // Convert to IST (UTC+5:30)
        const ist = new Date(dt.getTime() + (5.5 * 60 * 60 * 1000 - dt.getTimezoneOffset() * 60 * 1000));
        const h = ist.getUTCHours(), min = ist.getUTCMinutes();
        return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      }
    } catch {}
  }
  return null;
}

function applyRefundSafetyNet(row) {
  if (row.is_refund) return row;
  const corpus = `${row.raw_email || ""} ${row.notes || ""} ${row.merchant || ""}`;
  if (REFUND_TERMS.test(corpus)) {
    return { ...row, is_refund: true };
  }
  return row;
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
  return parsed.map((t, i) => {
    const email = emailBatch[i];
    // Use Claude's extracted time, or fall back to regex extraction from email body/header
    const time = t.time || extractTimeFromEmail(email?.body, email?.date);
    return {
      email_id: email?.id || `txn-${Date.now()}-${i}`,
      merchant: t.merchant || "Unknown",
      amount: parseFloat(t.amount) || 0,
      date: t.date || new Date().toISOString().split("T")[0],
      category: t.category || "other",
      item_description: t.itemDescription || null,
      is_refund: Boolean(t.isRefund),
      notes: t.notes || null,
      txn_time: time,
      raw_email: email?.subject || "",
    };
  });
}

/**
 * Run an incremental Gmail sync for a single user.
 * Safe to call from both the manual sync endpoint and the cron handler.
 */
export async function syncUserTransactions({ userId }) {
  const supabase = getSupabase();
  const syncStartedAt = new Date();

  await logInfo({ source: "sync", event: "start", userId, message: "Sync started" });

  let lastSyncedAt = null;
  try {
    const { data: userData } = await supabase
      .from("users")
      .select("last_synced_at")
      .eq("id", userId)
      .single();
    lastSyncedAt = userData?.last_synced_at || null;
  } catch {}

  let emails;
  try {
    emails = await fetchHDFCEmails(lastSyncedAt);
  } catch (err) {
    await logError({
      source: "sync",
      event: "gmail_fetch_failed",
      userId,
      message: "Failed to fetch emails from Gmail",
      error: err,
      details: { lastSyncedAt },
    });
    throw err;
  }

  if (!emails.length) {
    await supabase
      .from("users")
      .update({ last_synced_at: syncStartedAt.toISOString() })
      .eq("id", userId);
    await logInfo({ source: "sync", event: "no_emails", userId, message: "No new emails since last sync", details: { lastSyncedAt } });
    return { inserted: 0, considered: 0, fetched: 0, message: "No new transaction emails found." };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("transactions")
    .select("email_id, date, amount, merchant, is_refund")
    .eq("user_id", userId);

  if (fetchError) {
    await logError({ source: "sync", event: "db_fetch_failed", userId, error: fetchError });
    throw new Error("Database error: " + fetchError.message);
  }

  const existingIds = new Set((existing || []).map((e) => e.email_id));
  // Transaction-level dedup: two different email ids can represent the same
  // real-world purchase, so we also compare by (date, amount, merchant) below.
  const existingFingerprints = new Set(
    (existing || []).map((row) => transactionFingerprint(row))
  );
  const newEmails = emails.filter((e) => !existingIds.has(e.id));

  // Load user's merchant aliases so newly-parsed rows respect prior renames.
  const aliasMap = new Map();
  try {
    const { data: aliasRows } = await supabase
      .from("merchant_aliases")
      .select("original_merchant, alias")
      .eq("user_id", userId);
    for (const row of aliasRows || []) {
      aliasMap.set(row.original_merchant, row.alias);
    }
  } catch {}
  const applyAlias = (r) => {
    const a = aliasMap.get(r.merchant);
    return a ? { ...r, merchant: a } : r;
  };

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
        await logError({
          source: "sync",
          event: "batch_failed",
          userId,
          message: `Batch ${i / BATCH_SIZE} failed after retries`,
          error: lastErr,
          details: { batchIndex: i / BATCH_SIZE, batchSize: batch.length },
        });
        hadBatchFailure = true;
        continue;
      }

      const toInsert = rows
        .filter((r) => Number.isFinite(r.amount) && r.amount >= 10)
        .map(applyRefundSafetyNet)
        .map(applyAlias)
        .filter((r) => {
          // Skip if same transaction already exists (by fingerprint, not email id).
          // Register in the set immediately so later rows in the same batch —
          // or a later batch in the same run — dedupe against it as well.
          const fp = transactionFingerprint(r);
          if (existingFingerprints.has(fp)) {
            console.log(`[sync] skipping duplicate ${fp}`);
            return false;
          }
          existingFingerprints.add(fp);
          return true;
        })
        .map((r) => ({ ...r, user_id: userId }));

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("transactions")
          .upsert(toInsert, { onConflict: "email_id,user_id" });

        if (insertError) {
          await logError({
            source: "sync",
            event: "upsert_failed",
            userId,
            message: "Supabase upsert failed",
            error: insertError,
            details: { attemptedRows: toInsert.length },
          });
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
  } else {
    await logWarn({
      source: "sync",
      event: "partial_sync",
      userId,
      message: "Sync completed with batch failures \u2014 last_synced_at NOT advanced",
      details: { inserted: totalInserted, fetched: emails.length, considered: newEmails.length },
    });
  }

  await logInfo({
    source: "sync",
    event: "complete",
    userId,
    message: totalInserted > 0 ? `Synced ${totalInserted} new transactions` : "Sync complete, no new transactions",
    details: { inserted: totalInserted, fetched: emails.length, considered: newEmails.length, hadBatchFailure },
  });

  // Receipts photographed before the bank alert arrived now have something to
  // bind to. This is the common case — you snap the bill at the counter, HDFC
  // emails minutes later — so it is handled here rather than asked of the user.
  let rematched = 0;
  if (totalInserted > 0) {
    try {
      const { rematchPendingReceipts } = await import("@/lib/match-service");
      const result = await rematchPendingReceipts(userId);
      rematched = result.matched;
    } catch (err) {
      // Never let receipt matching break a transaction sync.
      await logWarn({
        source: "sync",
        event: "rematch_failed",
        userId,
        message: "Post-sync receipt rematch failed",
        details: { error: err.message },
      });
    }
  }

  return {
    inserted: totalInserted,
    considered: newEmails.length,
    fetched: emails.length,
    advanced: !hadBatchFailure,
    rematched,
    message:
      totalInserted > 0
        ? `Synced ${totalInserted} new transactions.`
        : "No new transactions.",
  };
}
