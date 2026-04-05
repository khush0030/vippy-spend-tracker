import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);

  return NextResponse.json({
    connected: !!session,
    user: session?.user || null,
  });
}
