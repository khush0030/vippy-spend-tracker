import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { syncUserTransactions } from "@/lib/sync";

export const maxDuration = 300;

/**
 * Vercel cron entrypoint — runs daily at 9 AM IST (3:30 UTC).
 * Loops every user who has at least one synced transaction and runs an
 * incremental sync for each. Auth via CRON_SECRET bearer header.
 */
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, last_synced_at")
    .not("last_synced_at", "is", null);

  if (error) {
    console.error("[cron/sync] failed to load users:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  for (const user of users || []) {
    try {
      const result = await syncUserTransactions({ userId: user.id });
      results.push({ userId: user.id, email: user.email, ...result });
      console.log(`[cron/sync] ${user.email}: ${result.message}`);
    } catch (err) {
      console.error(`[cron/sync] ${user.email} failed:`, err.message);
      results.push({ userId: user.id, email: user.email, error: err.message });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    users: results.length,
    results,
  });
}
