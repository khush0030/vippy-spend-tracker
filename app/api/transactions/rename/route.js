import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { renameMerchant } from "@/lib/merchant-alias";

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

    const { updated, aliasStored } = await renameMerchant({ supabase, userId, from: fromName, to: toName });
    return NextResponse.json({ success: true, updated, aliasStored });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to rename merchant" },
      { status: 500 }
    );
  }
}
