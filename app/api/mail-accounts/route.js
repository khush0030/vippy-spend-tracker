import crypto from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/secret-box";
import {
  listMailAccounts, saveMailAccount, removeMailAccount,
  getMailAccount, validateAccountInput, OAUTH_STATE_COOKIE,
} from "@/lib/mail-account";
import { openMailbox } from "@/lib/mailbox";
import { getAuthUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

/**
 * Connected mailboxes. Credentials are write-only over this API: they go in
 * and never come back, not even redacted.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A random per-request state, echoed back by Google and checked against
  // this cookie in the callback, is what stops a login-CSRF: without it an
  // attacker's own authorization code could be walked into a signed-in
  // victim's browser and get bound to the victim's account.
  const state = crypto.randomBytes(16).toString("hex");

  const response = NextResponse.json({
    accounts: await listMailAccounts(session.user.id),
    encryptionReady: hasEncryptionKey(),
    connectUrl: getAuthUrl(state),
  });

  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  return response;
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const input = {
    email: body.email,
    auth_kind: "imap_app_password",
    credential: body.app_password,
    role: "invoices",
  };

  const check = validateAccountInput(input);
  if (!check.ok) return NextResponse.json({ error: check.errors.join(" ") }, { status: 400 });

  let account;
  try {
    account = await saveMailAccount(session.user.id, input);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // Prove the credential works now, while someone is watching, rather than
  // discovering it at 3am on the 17th.
  try {
    const withCredential = await getMailAccount(session.user.id, account.id);
    const box = await openMailbox(withCredential);
    try {
      await box.probe();
    } finally {
      await box.close();
    }
  } catch (err) {
    await removeMailAccount(session.user.id, account.id);
    return NextResponse.json(
      { error: `Could not sign in to that mailbox: ${err.message}` },
      { status: 400 }
    );
  }

  return NextResponse.json({ account });
}

export async function DELETE(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await removeMailAccount(session.user.id, id);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
