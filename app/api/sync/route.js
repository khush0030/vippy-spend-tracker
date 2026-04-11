import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { syncUserTransactions } from "@/lib/sync";

export const maxDuration = 300;

const isSyncing = {};

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  if (isSyncing[userId]) {
    return NextResponse.json(
      { error: "Sync already in progress. Please wait for it to finish." },
      { status: 409 }
    );
  }

  isSyncing[userId] = true;

  try {
    const result = await syncUserTransactions({ userId });

    const { data: allTransactions, error } = await getSupabase()
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      transactions: allTransactions,
      message:
        result.inserted > 0
          ? `Synced ${result.inserted} new transactions. ${allTransactions.length} total.`
          : `No new transactions. ${allTransactions.length} total.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to sync emails" },
      { status: 500 }
    );
  } finally {
    isSyncing[userId] = false;
  }
}
