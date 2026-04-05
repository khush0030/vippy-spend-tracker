import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET — load all transactions
export async function GET() {
  try {
    const { data, error } = await getSupabase()
      .from("transactions")
      .select("*")
      .order("date", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ transactions: data });
  } catch (error) {
    console.error("Load error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load transactions" },
      { status: 500 }
    );
  }
}

// PATCH — toggle receipt status
export async function PATCH(request) {
  try {
    const { id, hasReceipt } = await request.json();

    const { error } = await getSupabase()
      .from("transactions")
      .update({ has_receipt: hasReceipt })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update transaction" },
      { status: 500 }
    );
  }
}
