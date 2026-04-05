import { NextResponse } from "next/server";

export async function GET() {
  const hasRefreshToken =
    !!process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GOOGLE_REFRESH_TOKEN !== "your_google_refresh_token_here";

  return NextResponse.json({ connected: hasRefreshToken });
}
