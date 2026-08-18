import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createLinkCode } from "@/lib/tg-handlers";

export const dynamic = "force-dynamic";

/** Current link state for the Settings → Receipt Bot card. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("tg_username, linked_at, link_code, code_expires_at")
    .eq("user_id", session.user.id)
    .maybeSingle();

  return NextResponse.json({
    linked: Boolean(data?.linked_at),
    username: data?.tg_username || null,
    linkedAt: data?.linked_at || null,
    pendingCode: data?.linked_at ? null : data?.link_code || null,
    codeExpiresAt: data?.linked_at ? null : data?.code_expires_at || null,
  });
}

/** Issue a fresh single-use code. Valid 15 minutes. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { code, expiresAt } = await createLinkCode(session.user.id);
    return NextResponse.json({ code, expiresAt });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Unlink — revokes the bound chat immediately. */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await getSupabaseAdmin()
    .from("telegram_links")
    .update({ tg_chat_id: null, linked_at: null, link_code: null, code_expires_at: null })
    .eq("user_id", session.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
