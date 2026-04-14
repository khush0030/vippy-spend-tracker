import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { currentPassword, newPassword } = body;

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: user, error: fetchErr } = await supabase
    .from("users")
    .select("password_hash, provider")
    .eq("id", session.user.id)
    .maybeSingle();

  if (fetchErr || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (user.provider === "google" && !user.password_hash) {
    // Google-only user setting a password for the first time
    const hash = await bcrypt.hash(newPassword, 10);
    const { error: updateErr } = await supabase
      .from("users")
      .update({ password_hash: hash })
      .eq("id", session.user.id);

    if (updateErr) {
      return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Verify current password
  if (!currentPassword) {
    return NextResponse.json({ error: "Current password is required" }, { status: 400 });
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  const { error: updateErr } = await supabase
    .from("users")
    .update({ password_hash: hash })
    .eq("id", session.user.id);

  if (updateErr) {
    return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
