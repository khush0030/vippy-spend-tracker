import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { from, to } = await request.json();
    const fromName = (from || "").trim();
    const toName = (to || "").trim();

    if (!fromName || !toName) {
      return NextResponse.json({ error: "Missing 'from' or 'to'" }, { status: 400 });
    }
    if (fromName === toName) {
      return NextResponse.json({ success: true, updated: 0 });
    }
    if (toName.length > 80) {
      return NextResponse.json({ error: "New name too long (max 80 chars)" }, { status: 400 });
    }

    const supabase = getSupabase();
    const userId = session.user.id;

    const { data: updatedRows, error: updateError } = await supabase
      .from("transactions")
      .update({ merchant: toName })
      .eq("user_id", userId)
      .eq("merchant", fromName)
      .select("id");

    if (updateError) throw updateError;

    const { error: aliasError } = await supabase
      .from("merchant_aliases")
      .upsert(
        { user_id: userId, original_merchant: fromName, alias: toName },
        { onConflict: "user_id,original_merchant" }
      );

    if (aliasError && aliasError.code !== "42P01") {
      // 42P01 = table doesn't exist; tolerate so rename still works without the table
      throw aliasError;
    }

    return NextResponse.json({
      success: true,
      updated: updatedRows?.length || 0,
      aliasStored: !aliasError,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to rename merchant" },
      { status: 500 }
    );
  }
}
