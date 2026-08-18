import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { currentCycle } from "@/lib/cycles";
import { buildSubmission } from "@/lib/submission";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Submission history for the dashboard. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await getSupabaseAdmin()
    .from("submissions")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(24);

  return NextResponse.json({ submissions: data || [] });
}

/** Build a draft package for a cycle. Never sends — that is a separate call. */
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const sb = getSupabaseAdmin();

    let cycle;
    if (body.cycleId) {
      const { data } = await sb
        .from("statement_cycles")
        .select("*, card:card_accounts(*)")
        .eq("id", body.cycleId)
        .eq("user_id", session.user.id)
        .single();
      cycle = data;
    } else {
      cycle = await currentCycle(session.user.id);
    }

    if (!cycle) {
      return NextResponse.json({ error: "No cycle found — configure your card first" }, { status: 400 });
    }

    const { submission, stats } = await buildSubmission({ userId: session.user.id, cycle });
    return NextResponse.json({ submission, stats });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
