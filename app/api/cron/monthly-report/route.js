import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { sendMonthlyReportForUser } from "@/lib/monthly-report";

export const maxDuration = 300;

/**
 * Vercel cron entrypoint — runs on the 4th of every month at 9 AM IST (3:30 UTC).
 * Also: first tops up the sync so the latest transactions are in the report.
 */
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  const { data: users, error } = await supabase
    .from("users")
    .select("id, email")
    .not("last_synced_at", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  for (const user of users || []) {
    try {
      const result = await sendMonthlyReportForUser({ userId: user.id });
      console.log(`[cron/monthly-report] ${user.email}: sent=${result.sent}`);
      results.push({ email: user.email, ...result });
    } catch (err) {
      console.error(`[cron/monthly-report] ${user.email} failed:`, err.message);
      results.push({ email: user.email, error: err.message });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
