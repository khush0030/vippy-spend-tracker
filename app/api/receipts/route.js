import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { currentCycle, cycleCoverage } from "@/lib/cycles";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Everything the Receipts tab needs about the cycle in flight.
 *
 * Cycle-scoped rather than period-scoped: the dashboard's date picker is about
 * spend analysis, but a receipt belongs to whichever statement cycle will
 * claim it, and that boundary is the 18th, not the 1st.
 */
export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const sb = getSupabaseAdmin();
  const id = new URL(request.url).searchParams.get("id");

  // Detail: a short-lived signed URL, minted only when someone asks to look.
  // Receipt images are private and must never be handed out in a list.
  if (id) {
    const { data: receipt } = await sb
      .from("receipts")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let url = null;
    try {
      url = await signedUrl(receipt.storage_path);
    } catch {
      // The row can outlive its object; the card still renders without a preview.
    }

    const { statement_password, ...safe } = receipt;
    return NextResponse.json({ receipt: safe, url });
  }

  const cycle = await currentCycle(userId).catch(() => null);
  if (!cycle) {
    return NextResponse.json({
      configured: false,
      cycle: null,
      coverage: null,
      receipts: [],
      outstanding: [],
    });
  }

  const coverage = await cycleCoverage(userId, cycle);
  const minAmount = cycle.card?.min_receipt_amount ?? 500;

  const [{ data: receipts }, { data: outstanding }] = await Promise.all([
    sb
      .from("receipts")
      .select("id, merchant, amount, currency, amount_inr, receipt_date, status, consensus, confidence, doc_type, country, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60),
    sb
      .from("transactions")
      .select("id, merchant, amount, date, category")
      .eq("user_id", userId)
      .eq("is_refund", false)
      .eq("receipt_status", "missing")
      .gte("date", cycle.cycle_start)
      .lte("date", cycle.cycle_end)
      .gte("amount", minAmount)
      .order("amount", { ascending: false })
      .limit(50),
  ]);

  // Which charge each receipt ended up on, so the list can show the binding
  // rather than just "matched".
  const ids = (receipts || []).map((r) => r.id);
  const { data: links } = ids.length
    ? await sb.from("receipt_transactions").select("receipt_id, transaction_id, match_score, matched_by").in("receipt_id", ids)
    : { data: [] };

  const txnIds = [...new Set((links || []).map((l) => l.transaction_id))];
  const { data: txns } = txnIds.length
    ? await sb.from("transactions").select("id, merchant, amount, date").in("id", txnIds)
    : { data: [] };

  const txnById = new Map((txns || []).map((t) => [t.id, t]));
  const linkByReceipt = new Map((links || []).map((l) => [l.receipt_id, l]));

  return NextResponse.json({
    configured: true,
    cycle: {
      id: cycle.id,
      start: cycle.cycle_start,
      end: cycle.cycle_end,
      status: cycle.status,
      statementDay: cycle.card?.statement_day ?? 18,
      submitDay: cycle.card?.submit_day ?? 23,
      minReceiptAmount: minAmount,
      accountsEmail: cycle.card?.accounts_email || [],
    },
    coverage,
    receipts: (receipts || []).map((r) => {
      const link = linkByReceipt.get(r.id);
      return { ...r, match: link ? { ...link, transaction: txnById.get(link.transaction_id) || null } : null };
    }),
    outstanding: outstanding || [],
  });
}
