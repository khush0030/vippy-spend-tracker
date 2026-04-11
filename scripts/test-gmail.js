#!/usr/bin/env node
/* Test the Gmail connection + fetchHDFCEmails pipeline end-to-end.
 * Usage: set -a && source .env.local && set +a && node scripts/test-gmail.js
 */
const { google } = require("googleapis");

async function main() {
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
    if (!process.env[k]) {
      console.error(`Missing env: ${k}`);
      process.exit(1);
    }
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  console.log("1. Exchanging refresh token for access token...");
  let accessToken;
  try {
    const res = await client.getAccessToken();
    accessToken = res.token;
    console.log(`   \u2713 Got access token (${accessToken?.slice(0, 12)}...)`);
  } catch (err) {
    console.error(`   \u2717 FAILED: ${err.message}`);
    console.error("   Refresh token is dead. Re-run OAuth to get a new one.");
    process.exit(1);
  }

  const gmail = google.gmail({ version: "v1", auth: client });

  console.log("2. Getting profile...");
  try {
    const profile = await gmail.users.getProfile({ userId: "me" });
    console.log(`   \u2713 ${profile.data.emailAddress} (${profile.data.messagesTotal?.toLocaleString()} messages)`);
  } catch (err) {
    console.error(`   \u2717 FAILED: ${err.message}`);
    process.exit(1);
  }

  console.log("3. Running the real fetchHDFCEmails queries (last 7 days only)...");

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000)
    .toISOString().split("T")[0].replace(/-/g, "/");
  const dateFilter = ` after:${sevenDaysAgo}`;

  const queries = [
    `(from:alerts@hdfcbank.net OR from:noreply@hdfcbank.net OR (from:hdfcbank.net (subject:transaction OR subject:refund OR subject:reversal OR subject:credit)))${dateFilter}`,
    `(from:auto-confirm@amazon.in OR from:ship-confirm@amazon.in OR from:order-update@amazon.in OR from:returns@amazon.in OR (from:amazon.in (subject:refund OR subject:return OR subject:"Your order")))${dateFilter}`,
    `((from:noreply@swiggy.in subject:order) OR (from:noreply@zomato.com subject:order))${dateFilter}`,
  ];

  const seen = new Set();
  for (const q of queries) {
    try {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 50 });
      const n = res.data.messages?.length || 0;
      console.log(`   Query \u2192 ${n} matches: ${q.slice(0, 70)}...`);
      (res.data.messages || []).forEach((m) => seen.add(m.id));
    } catch (err) {
      console.error(`   \u2717 Query failed: ${err.message}`);
    }
  }

  console.log(`\n\u2713 Total unique emails in last 7 days across all queries: ${seen.size}`);

  if (seen.size > 0) {
    console.log("\nSample message subjects:");
    const ids = [...seen].slice(0, 5);
    for (const id of ids) {
      const det = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Subject", "From", "Date"] });
      const subj = det.data.payload.headers.find((h) => h.name === "Subject")?.value || "(no subject)";
      const from = det.data.payload.headers.find((h) => h.name === "From")?.value || "";
      console.log(`  \u2022 ${subj.slice(0, 80)}  \u2014  ${from.slice(0, 40)}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
