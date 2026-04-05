import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "csv";
  const startDate = searchParams.get("start");
  const endDate = searchParams.get("end");

  try {
    let query = getSupabase()
      .from("transactions")
      .select("*")
      .eq("user_id", session.user.id)
      .order("date", { ascending: false });

    if (startDate) query = query.gte("date", startDate);
    if (endDate) query = query.lte("date", endDate);

    const { data, error } = await query;
    if (error) throw error;

    const transactions = (data || []).filter((t) => t.amount >= 10);

    if (format === "csv") {
      const header = "Date,Time,Merchant,Category,Amount (INR),Refund,Receipt,Item Description,AI Notes,User Notes";
      const rows = transactions.map((t) =>
        [
          t.date,
          t.txn_time || "",
          `"${(t.merchant || "").replace(/"/g, '""')}"`,
          t.category,
          t.is_refund ? -t.amount : t.amount,
          t.is_refund ? "Yes" : "No",
          t.has_receipt ? "Yes" : "No",
          `"${(t.item_description || "").replace(/"/g, '""')}"`,
          `"${(t.notes || "").replace(/"/g, '""')}"`,
          `"${(t.user_notes || "").replace(/"/g, '""')}"`,
        ].join(",")
      );

      const csv = [header, ...rows].join("\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="vippy-expense-report-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    // JSON summary report
    const purchases = transactions.filter((t) => !t.is_refund);
    const refunds = transactions.filter((t) => t.is_refund);
    const totalSpend = purchases.reduce((s, t) => s + t.amount, 0);
    const totalRefunds = refunds.reduce((s, t) => s + t.amount, 0);

    const categoryBreakdown = {};
    for (const t of purchases) {
      if (!categoryBreakdown[t.category]) {
        categoryBreakdown[t.category] = { total: 0, count: 0, transactions: [] };
      }
      categoryBreakdown[t.category].total += t.amount;
      categoryBreakdown[t.category].count += 1;
      categoryBreakdown[t.category].transactions.push({
        date: t.date,
        merchant: t.merchant,
        amount: t.amount,
        item: t.item_description,
      });
    }

    const missingReceipts = transactions.filter((t) => !t.has_receipt && !t.is_refund);

    return NextResponse.json({
      report: {
        generatedAt: new Date().toISOString(),
        generatedBy: session.user.name || session.user.email,
        period: {
          start: startDate || transactions[transactions.length - 1]?.date || null,
          end: endDate || transactions[0]?.date || null,
        },
        summary: {
          totalTransactions: purchases.length,
          totalSpend,
          totalRefunds,
          netSpend: totalSpend - totalRefunds,
          refundCount: refunds.length,
          avgTransaction: purchases.length ? totalSpend / purchases.length : 0,
          missingReceipts: missingReceipts.length,
        },
        categoryBreakdown,
        missingReceipts: missingReceipts.map((t) => ({
          date: t.date,
          merchant: t.merchant,
          amount: t.amount,
        })),
      },
    });
  } catch (error) {
    console.error("Report error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate report" },
      { status: 500 }
    );
  }
}
