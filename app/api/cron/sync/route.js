import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { syncUserTransactions } from "@/lib/sync";
import { logError, logInfo } from "@/lib/logger";

export const maxDuration = 300;

/**
 * Vercel cron entrypoint — runs daily at 9 AM IST (3:30 UTC).
 */
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    await logError({
      source: "cron",
      event: "unauthorized",
      message: "Cron sync called without valid CRON_SECRET bearer",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await logInfo({ source: "cron", event: "start", message: "Cron sync started" });

  const supabase = getSupabase();

  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, last_synced_at")
    .not("last_synced_at", "is", null);

  if (error) {
    await logError({ source: "cron", event: "user_fetch_failed", error, message: "Failed to load users" });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  for (const user of users || []) {
    try {
      const result = await syncUserTransactions({ userId: user.id });
      results.push({ userId: user.id, email: user.email, ...result });
    } catch (err) {
      await logError({
        source: "cron",
        event: "user_sync_failed",
        userId: user.id,
        message: `Sync failed for ${user.email}`,
        error: err,
      });
      results.push({ userId: user.id, email: user.email, error: err.message });
    }
  }

  await logInfo({
    source: "cron",
    event: "complete",
    message: `Cron sync finished for ${results.length} users`,
    details: { results: results.map(r => ({ email: r.email, inserted: r.inserted, error: r.error })) },
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    users: results.length,
    results,
  });
}
