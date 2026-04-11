#!/usr/bin/env node
/* Run the full Gmail → Claude → Supabase sync pipeline directly.
 * Mirrors app/api/sync/route.js logic but bypasses auth so we can test it
 * without a browser session.
 *
 * Usage: set -a && source .env.local && set +a && node scripts/run-sync.js
 */
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
const Anthropic = require("@anthropic-ai/sdk").default;

const USER_ID = "115105472683255155618";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function decodeBody(payload) {
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data)
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
        return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    for (const part of payload.parts) {
      if (part.parts) { const r = decodeBody(part); if (r) return r; }
    }
  }
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  return "";
}

async function fetchEmails(sinceDate) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const gmail = google.gmail({ version: "v1", auth: client });

  const dateFilter = sinceDate
    ? ` after:${new Date(sinceDate).toISOString().split("T")[0].replace(/-/g, "/")}`
    : "";

  const queries = [
    `(from:alerts@hdfcbank.net OR from:noreply@hdfcbank.net OR (from:hdfcbank.net (subject:transaction OR subject:refund OR subject:reversal OR subject:credit)))${dateFilter}`,
    `(from:auto-confirm@amazon.in OR from:ship-confirm@amazon.in OR from:order-update@amazon.in OR from:returns@amazon.in OR (from:amazon.in (subject:refund OR subject:return OR subject:"Your order")))${dateFilter}`,
    `((from:noreply@swiggy.in subject:order) OR (from:noreply@zomato.com subject:order))${dateFilter}`,
  ];

  const seen = new Set();
  const msgs = [];
  for (const q of queries) {
    let pageToken;
    do {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken });
      for (const m of res.data.messages || []) {
        if (!seen.has(m.id)) { seen.add(m.id); msgs.push(m); }
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }

  const full = [];
  for (const m of msgs) {
    try {
      const det = await gmail.users.messages.get({ userId: "me", id: m.id, format: "full" });
      const hdrs = det.data.payload.headers;
      full.push({
        id: m.id,
        subject: hdrs.find((h) => h.name.toLowerCase() === "subject")?.value || "",
        from: hdrs.find((h) => h.name.toLowerCase() === "from")?.value || "",
        date: hdrs.find((h) => h.name.toLowerCase() === "date")?.value || "",
        body: decodeBody(det.data.payload).substring(0, 3000),
      });
    } catch (err) {
      console.error(`   fetch ${m.id} failed: ${err.message}`);
    }
  }
  return full;
}

async function parseBatch(batch) {
  const summaries = batch
    .map((e, i) => `--- Email ${i + 1} (id: ${e.id}) ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body.substring(0, 1500)}\n`)
    .join("\n");

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: `${SYSTEM_PROMPT}\n\nEmails:\n${summaries}` }],
  });

  const text = res.content[0].text;
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  const parsed = JSON.parse(m[0]);
  return parsed.map((t, i) => ({
    email_id: batch[i]?.id || `txn-${Date.now()}-${i}`,
    merchant: t.merchant || "Unknown",
    amount: parseFloat(t.amount) || 0,
    date: t.date || new Date().toISOString().split("T")[0],
    category: t.category || "other",
    has_receipt: Boolean(t.hasReceipt),
    item_description: t.itemDescription || null,
    is_refund: Boolean(t.isRefund),
    notes: t.notes || null,
    txn_time: t.time || null,
    raw_email: batch[i]?.subject || "",
  }));
}

async function main() {
  const start = new Date();
  console.log(`\n=== SYNC TEST (user ${USER_ID}) ===`);

  const { data: u } = await supabase.from("users").select("last_synced_at").eq("id", USER_ID).single();
  const cursor = u?.last_synced_at || null;
  console.log(`last_synced_at: ${cursor}`);

  console.log("\n[1/4] Fetching emails from Gmail...");
  const emails = await fetchEmails(cursor);
  console.log(`    \u2192 ${emails.length} emails matched`);

  if (!emails.length) {
    console.log("Nothing to sync. Advancing watermark anyway.");
    await supabase.from("users").update({ last_synced_at: start.toISOString() }).eq("id", USER_ID);
    return;
  }

  console.log("\n[2/4] Deduplicating against DB...");
  const { data: existing } = await supabase.from("transactions").select("email_id").eq("user_id", USER_ID);
  const existingIds = new Set((existing || []).map((e) => e.email_id));
  const newEmails = emails.filter((e) => !existingIds.has(e.id));
  console.log(`    \u2192 ${newEmails.length} new, ${emails.length - newEmails.length} already imported`);

  if (!newEmails.length) {
    console.log("All emails already in DB. Advancing watermark.");
    await supabase.from("users").update({ last_synced_at: start.toISOString() }).eq("id", USER_ID);
    return;
  }

  console.log("\n[3/4] Parsing with Claude...");
  const BATCH_SIZE = 15;
  let inserted = 0;
  let hadFailure = false;

  for (let i = 0; i < newEmails.length; i += BATCH_SIZE) {
    const batch = newEmails.slice(i, i + BATCH_SIZE);
    console.log(`    Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newEmails.length / BATCH_SIZE)} (${batch.length} emails)...`);

    let rows = null;
    let err;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        rows = await parseBatch(batch);
        err = null;
        break;
      } catch (e) {
        err = e;
        const rate = e?.status === 429 || /rate/i.test(e?.message || "");
        if (rate && attempt < 3) await sleep(10000 * attempt);
        else if (!rate) break;
      }
    }
    if (err || !rows) {
      console.error(`    \u2717 Batch failed: ${err?.message}`);
      hadFailure = true;
      continue;
    }

    const toInsert = rows.filter((r) => r.amount >= 10).map((r) => ({ ...r, user_id: USER_ID }));
    console.log(`      \u2192 parsed ${rows.length}, inserting ${toInsert.length} (filtered out < ₹10)`);

    if (toInsert.length > 0) {
      const { error } = await supabase.from("transactions").upsert(toInsert, { onConflict: "email_id,user_id" });
      if (error) {
        console.error(`    \u2717 Upsert failed: ${error.message}`);
        hadFailure = true;
      } else {
        inserted += toInsert.length;
        for (const r of toInsert) {
          console.log(`        ${r.date} ₹${r.amount} ${r.merchant}`);
        }
      }
    }

    if (i + BATCH_SIZE < newEmails.length) await sleep(3000);
  }

  console.log(`\n[4/4] ${hadFailure ? "Had failures — NOT advancing watermark" : "All batches succeeded"}`);
  if (!hadFailure) {
    await supabase.from("users").update({ last_synced_at: start.toISOString() }).eq("id", USER_ID);
    console.log(`    watermark advanced to ${start.toISOString()}`);
  }

  console.log(`\n=== DONE: inserted ${inserted} new transactions ===`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
