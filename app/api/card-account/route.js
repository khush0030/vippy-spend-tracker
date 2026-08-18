import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { validateCardConfig } from "@/lib/card-account";
import { encryptSecret, hasEncryptionKey, isCiphertext } from "@/lib/secret-box";

export const dynamic = "force-dynamic";

/**
 * The card configuration behind every scheduled job.
 *
 * Without a row here `getCardAccount()` returns null and the whole rail sits
 * idle, so this is the first thing to fill in. The statement password is
 * write-only over this API: it goes in, and only ever comes back as a boolean.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await getSupabaseAdmin()
    .from("card_accounts")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ card: null, encryptionReady: hasEncryptionKey() });
  }

  const { statement_password, ...card } = data;

  return NextResponse.json({
    card: {
      ...card,
      hasStatementPassword: Boolean(statement_password),
      // Surfaced so an older hand-written row can be spotted and re-saved.
      statementPasswordEncrypted: isCiphertext(statement_password),
    },
    encryptionReady: hasEncryptionKey(),
  });
}

export async function PUT(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { ok, errors, value } = validateCardConfig(body);
  if (!ok) return NextResponse.json({ error: errors.join(" "), errors }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: existing } = await sb
    .from("card_accounts")
    .select("id")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const patch = { ...value, user_id: session.user.id };

  // Absent means "leave it alone"; an empty string means "clear it". Anything
  // else is encrypted here and never written in the open.
  if (typeof body.statement_password === "string") {
    if (body.statement_password === "") {
      patch.statement_password = null;
    } else {
      try {
        patch.statement_password = encryptSecret(body.statement_password);
      } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }
  }

  const query = existing
    ? sb.from("card_accounts").update(patch).eq("id", existing.id).select().single()
    : sb.from("card_accounts").insert(patch).select().single();

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { statement_password, ...card } = data;
  return NextResponse.json({
    card: { ...card, hasStatementPassword: Boolean(statement_password), statementPasswordEncrypted: isCiphertext(statement_password) },
  });
}
