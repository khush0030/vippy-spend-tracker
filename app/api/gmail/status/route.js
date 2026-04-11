import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasClientId = Boolean(process.env.GOOGLE_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET);
  const hasRefreshToken = Boolean(process.env.GOOGLE_REFRESH_TOKEN);

  if (!hasClientId || !hasClientSecret || !hasRefreshToken) {
    return NextResponse.json({
      connected: false,
      reason: "missing_env",
      detail: `Missing env: ${[
        !hasClientId && "GOOGLE_CLIENT_ID",
        !hasClientSecret && "GOOGLE_CLIENT_SECRET",
        !hasRefreshToken && "GOOGLE_REFRESH_TOKEN",
      ].filter(Boolean).join(", ")}`,
    });
  }

  try {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
    );
    client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

    const { token: accessToken } = await client.getAccessToken();
    if (!accessToken) {
      return NextResponse.json({
        connected: false,
        reason: "no_access_token",
        detail: "Refresh token did not return an access token. It is likely revoked or expired.",
      });
    }

    const gmail = google.gmail({ version: "v1", auth: client });
    const profile = await gmail.users.getProfile({ userId: "me" });

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:1d",
      maxResults: 1,
    });

    return NextResponse.json({
      connected: true,
      email: profile.data.emailAddress,
      totalMessages: profile.data.messagesTotal,
      recentMessageFound: Boolean(listRes.data.messages?.length),
    });
  } catch (err) {
    const code = err?.response?.data?.error || err?.code || "unknown_error";
    const message = err?.response?.data?.error_description || err?.message || "Unknown Gmail error";
    return NextResponse.json({
      connected: false,
      reason: code,
      detail: message,
    });
  }
}
