import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runStatementJob, reconcileStatement } from "@/lib/statement-recon";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Statement history, newest first, with each line's reconciliation outcome. */
export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabaseAdmin();
  const statementId = new URL(request.url).searchParams.get("id");

  if (statementId) {
    const { data: statement } = await sb
      .from("statements")
      .select("*")
      .eq("id", statementId)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: lines } = await sb
      .from("statement_lines")
      .select("*")
      .eq("statement_id", statementId)
      .order("line_no", { ascending: true });

    return NextResponse.json({ statement, lines: lines || [] });
  }

  const { data } = await sb
    .from("statements")
    .select("id, issued_on, period_start, period_end, opening_balance, closing_balance, total_debits, total_credits, tie_out_diff, status")
    .eq("user_id", session.user.id)
    .order("issued_on", { ascending: false })
    .limit(24);

  return NextResponse.json({ statements: data || [] });
}

/**
 * Run the statement job by hand.
 *
 * `{ statementId }` re-reconciles one already on file — cheap, no model call.
 * Without it, Gmail is checked for anything new, which does cost a read.
 */
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));

    if (body.statementId) {
      const r = await reconcileStatement({
        userId: session.user.id,
        statementId: body.statementId,
      });
      return NextResponse.json({ statementId: r.statementId, summary: r.summary });
    }

    const result = await runStatementJob({
      userId: session.user.id,
      force: Boolean(body.force),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
