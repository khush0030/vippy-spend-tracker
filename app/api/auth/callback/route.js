import { NextResponse } from "next/server";
import { getTokensFromCode } from "@/lib/gmail";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json({ error: "No code provided" }, { status: 400 });
    }

    const tokens = await getTokensFromCode(code);

    // Display the refresh token so the user can add it to .env.local
    return new NextResponse(
      `<html>
        <body style="font-family: sans-serif; padding: 40px; max-width: 600px; margin: 0 auto;">
          <h2>Google OAuth Success</h2>
          <p>Add this refresh token to your <code>.env.local</code> file:</p>
          <pre style="background: #f5f5f5; padding: 16px; border-radius: 8px; word-break: break-all;">${tokens.refresh_token || "No refresh token returned (you may already have one)"}</pre>
          <p style="margin-top: 16px;"><a href="/" style="color: #2196F3;">Back to Dashboard</a></p>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (error) {
    console.error("Callback error:", error);
    return NextResponse.json(
      { error: "OAuth callback failed: " + error.message },
      { status: 500 }
    );
  }
}
