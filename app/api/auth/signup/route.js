import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { getSupabase } from "@/lib/supabase";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body?.email?.toLowerCase().trim();
  const password = body?.password;
  const name = body?.name?.trim() || null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: existing, error: lookupError } = await supabase
    .from("users")
    .select("id, password_hash, provider")
    .eq("email", email)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (existing?.password_hash) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  if (existing && !existing.password_hash) {
    return NextResponse.json(
      { error: "This email is linked to a Google sign-in. Use 'Continue with Google' instead." },
      { status: 409 }
    );
  }

  const password_hash = await bcrypt.hash(password, 10);
  const id = randomUUID();

  const { error: insertError } = await supabase.from("users").insert({
    id,
    email,
    name,
    password_hash,
    provider: "credentials",
    last_login: new Date().toISOString(),
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id });
}
