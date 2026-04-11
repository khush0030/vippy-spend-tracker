import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const userId = session.user.id;

  const { count: txCount } = await getSupabase()
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const { data: distinctUserIds } = await getSupabase()
    .from("transactions")
    .select("user_id")
    .limit(500);

  const uniqueIds = [...new Set((distinctUserIds || []).map((r) => r.user_id))];

  return NextResponse.json({
    session_user_id: userId,
    session_email: session.user.email,
    session_provider: session.provider,
    transactions_for_this_user: txCount ?? 0,
    distinct_user_ids_in_db: uniqueIds,
  });
}
