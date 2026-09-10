import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getTokensFromCode } from "@/lib/gmail";
import { saveMailAccount, listMailAccounts } from "@/lib/mail-account";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Where Google returns after consent.
 *
 * This used to render the refresh token as HTML so it could be pasted into
 * .env.local by hand. A long-lived mailbox credential in a page, a
 * scrollback or a screenshot is a credential leaked, so it is encrypted and
 * stored now and never sent to a browser at all.
 */
export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.redirect(new URL("/", request.url));

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const denied = searchParams.get("error");

  const back = (params) => {
    const url = new URL("/", request.url);
    url.hash = "settings";
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
  };

  if (denied) return back({ mailbox: "denied" });
  if (!code) return back({ mailbox: "error", reason: "no code returned" });

  try {
    const tokens = await getTokensFromCode(code);

    // Google withholds the refresh token when this account has already granted
    // consent. prompt=consent in getAuthUrl() is what forces a fresh one.
    if (!tokens.refresh_token) {
      return back({ mailbox: "error", reason: "no refresh token — revoke access at myaccount.google.com/permissions and retry" });
    }

    const email = tokens.id_token
      ? JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()).email?.toLowerCase() || null
      : null;
    if (!email) return back({ mailbox: "error", reason: "Google did not identify the account" });

    // The first mailbox connected becomes the primary one, since bank alerts
    // and the statement have to come from somewhere.
    const existing = await listMailAccounts(session.user.id);
    const already = existing.find((a) => a.email === email);
    // Re-connecting a mailbox keeps its role: an expired token on the primary
    // account must not demote it. A new mailbox becomes primary only when
    // nothing else is, since bank alerts have to come from somewhere.
    const role = already
      ? already.role
      : existing.some((a) => a.role === "primary") ? "invoices" : "primary";

    await saveMailAccount(session.user.id, {
      email, auth_kind: "oauth", credential: tokens.refresh_token, role,
    });

    await logInfo({
      source: "mailbox", event: "connected", userId: session.user.id,
      message: `Connected ${email} as ${role}`,
    });

    return back({ mailbox: "connected" });
  } catch (err) {
    await logError({
      source: "mailbox", event: "connect_failed", userId: session.user.id,
      message: "OAuth callback failed", error: err,
    });
    return back({ mailbox: "error", reason: err.message });
  }
}
