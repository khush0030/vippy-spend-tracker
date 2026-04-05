import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await getSupabase()
      .from("transactions")
      .select("*")
      .eq("user_id", session.user.id)
      .order("date", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ transactions: data });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load transactions" },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "Missing transaction id" }, { status: 400 });
    }

    const updates = {};
    if (body.hasReceipt !== undefined) updates.has_receipt = body.hasReceipt;
    if (body.userNotes !== undefined) updates.user_notes = body.userNotes;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error } = await getSupabase()
      .from("transactions")
      .update(updates)
      .eq("id", id)
      .eq("user_id", session.user.id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to update transaction" },
      { status: 500 }
    );
  }
}
