import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { google } from "googleapis";

export const maxDuration = 60;

function getOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

/**
 * GET: inspect current sync state without running a sync.
 * Returns last_synced_at, raw per-query Gmail counts, and latest 5 txns in DB.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const userId = session.user.id;

  const { data: userRow } = await supabase
    .from("users")
    .select("email, last_synced_at")
    .eq("id", userId)
    .single();

  const { data: recentTxns } = await supabase
    .from("transactions")
    .select("date, merchant, amount, email_id")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(5);

  const lastSyncedAt = userRow?.last_synced_at;
  const dateFilter = lastSyncedAt
    ? ` after:${new Date(lastSyncedAt).toISOString().split("T")[0].replace(/-/g, "/")}`
    : "";

  const queries = [
    { name: "hdfc", q: `(from:alerts@hdfcbank.net OR from:noreply@hdfcbank.net OR (from:hdfcbank.net (subject:transaction OR subject:refund OR subject:reversal OR subject:credit)))${dateFilter}` },
    { name: "hdfc_broad", q: `(from:hdfcbank.net OR from:hdfc.com OR subject:"HDFC Bank") newer_than:7d` },
    { name: "amazon", q: `(from:auto-confirm@amazon.in OR from:ship-confirm@amazon.in OR from:order-update@amazon.in OR from:returns@amazon.in OR (from:amazon.in (subject:refund OR subject:return OR subject:"Your order")))${dateFilter}` },
    { name: "amazon_7d", q: `from:amazon.in newer_than:7d` },
    { name: "swiggy_zomato", q: `((from:noreply@swiggy.in subject:order) OR (from:noreply@zomato.com subject:order))${dateFilter}` },
  ];

  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const results = [];
  try {
    const { token } = await auth.getAccessToken();
    if (!token) {
      return NextResponse.json({
        error: "No access token \u2014 GOOGLE_REFRESH_TOKEN is revoked or expired",
        lastSyncedAt, recentTxns,
      });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message, lastSyncedAt, recentTxns });
  }

  for (const { name, q } of queries) {
    try {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 100 });
      results.push({ name, query: q, count: res.data.messages?.length || 0, resultSizeEstimate: res.data.resultSizeEstimate });
    } catch (err) {
      results.push({ name, query: q, error: err.message });
    }
  }

  return NextResponse.json({
    userEmail: userRow?.email,
    lastSyncedAt,
    dateFilter: dateFilter || "(none \u2014 fetches all)",
    recentTxns,
    gmailQueries: results,
  });
}

/**
 * POST: reset last_synced_at so next sync fetches everything again.
 * Body: { reset: true }
 */
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body.reset) return NextResponse.json({ error: "Pass { reset: true } to clear last_synced_at" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase
    .from("users")
    .update({ last_synced_at: null })
    .eq("id", session.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, message: "last_synced_at cleared. Next sync will re-fetch all emails." });
}
