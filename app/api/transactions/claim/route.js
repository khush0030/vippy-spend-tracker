import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

// POST — claim all orphaned transactions (user_id = null) for the current user
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await getSupabase()
      .from("transactions")
      .update({ user_id: session.user.id })
      .is("user_id", null)
      .select("id");

    if (error) throw error;

    const count = data?.length || 0;
    return NextResponse.json({
      claimed: count,
      message: count > 0
        ? `Claimed ${count} existing transactions to your account.`
        : "No orphaned transactions found.",
    });
  } catch (error) {
    console.error("Claim error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to claim transactions" },
      { status: 500 }
    );
  }
}
