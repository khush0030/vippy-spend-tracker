import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

/**
 * Return recent app logs for the authenticated user.
 * Query params: ?level=error|warn|info&limit=100&source=sync
 */
export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const level = searchParams.get("level");
  const source = searchParams.get("source");
  const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 500);

  const supabase = getSupabase();
  let query = supabase
    .from("app_logs")
    .select("*")
    .or(`user_id.eq.${session.user.id},user_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (level) query = query.eq("level", level);
  if (source) query = query.eq("source", source);

  const { data, error } = await query;

  if (error) {
    // Likely: table missing. Return a friendly hint.
    if (error.message?.includes("relation") && error.message?.includes("does not exist")) {
      return NextResponse.json({
        logs: [],
        error: "app_logs table not set up. Run scripts/create-app-logs-table.sql in Supabase.",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data || [] });
}
