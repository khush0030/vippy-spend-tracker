import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendSubmission } from "@/lib/submission-mail";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The one route that emails accounts.
 *
 * Requires an authenticated session and an explicit submission id, so no
 * background job can reach it. `params` is a promise in this Next version.
 */
export async function POST(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const result = await sendSubmission({
      userId: session.user.id,
      submissionId: id,
      approvedBy: session.user.email || "dashboard",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
