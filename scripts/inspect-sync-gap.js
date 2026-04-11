#!/usr/bin/env node
/* Inspect the gap between last DB transaction and current emails.
 * Usage: set -a && source .env.local && set +a && node scripts/inspect-sync-gap.js
 */
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function main() {
  const USER_ID = "115105472683255155618";

  // 1. Most recent transactions in DB
  const { data: latest } = await supabase
    .from("transactions")
    .select("date, merchant, amount, email_id, created_at")
    .eq("user_id", USER_ID)
    .order("date", { ascending: false })
    .limit(10);

  console.log("=== Latest 10 transactions in DB ===");
  for (const t of latest) {
    console.log(`${t.date}  ₹${t.amount}  ${t.merchant}  (${t.email_id.slice(0, 12)})`);
  }

  // 2. User's last_synced_at
  const { data: user } = await supabase
    .from("users")
    .select("last_synced_at")
    .eq("id", USER_ID)
    .single();
  console.log(`\nlast_synced_at: ${user.last_synced_at}`);

  // 3. Existing email_id set so we know what's already imported
  const { data: allEmailIds } = await supabase
    .from("transactions")
    .select("email_id")
    .eq("user_id", USER_ID);
  const existingIds = new Set(allEmailIds.map((r) => r.email_id));
  console.log(`Total email_ids in DB: ${existingIds.size}`);

  // 4. Query Gmail for everything after 2026-03-25 — cover the gap
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const gmail = google.gmail({ version: "v1", auth: client });

  const dateFilter = " after:2026/03/25";
  const queries = [
    `(from:alerts@hdfcbank.net OR from:noreply@hdfcbank.net OR (from:hdfcbank.net (subject:transaction OR subject:refund OR subject:reversal OR subject:credit)))${dateFilter}`,
    `(from:auto-confirm@amazon.in OR from:ship-confirm@amazon.in OR from:order-update@amazon.in OR from:returns@amazon.in OR (from:amazon.in (subject:refund OR subject:return OR subject:"Your order")))${dateFilter}`,
    `((from:noreply@swiggy.in subject:order) OR (from:noreply@zomato.com subject:order))${dateFilter}`,
  ];

  console.log(`\n=== Gmail emails matching queries since 2026/03/25 ===`);
  const allMatches = new Map();

  for (const q of queries) {
    let pageToken;
    do {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken });
      for (const m of res.data.messages || []) {
        if (!allMatches.has(m.id)) allMatches.set(m.id, null);
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }

  console.log(`Total unique matching emails: ${allMatches.size}`);

  let inDB = 0;
  let missing = 0;
  const missingList = [];

  for (const id of allMatches.keys()) {
    if (existingIds.has(id)) {
      inDB++;
    } else {
      missing++;
      if (missingList.length < 20) missingList.push(id);
    }
  }

  console.log(`  Already in DB: ${inDB}`);
  console.log(`  Missing from DB: ${missing}`);

  if (missingList.length > 0) {
    console.log(`\n=== Sample of missing emails (subjects) ===`);
    for (const id of missingList) {
      try {
        const det = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        });
        const subj = det.data.payload.headers.find((h) => h.name === "Subject")?.value || "";
        const from = det.data.payload.headers.find((h) => h.name === "From")?.value || "";
        const date = det.data.payload.headers.find((h) => h.name === "Date")?.value || "";
        console.log(`  ${date.slice(0, 25)}  ${subj.slice(0, 70)}  [${from.slice(0, 30)}]`);
      } catch (err) {
        console.log(`  ${id}: fetch failed — ${err.message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
