import { NextResponse } from "next/server";
import { fetchHDFCEmails } from "@/lib/gmail";
import { parseEmailsToTransactions } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";

export async function POST() {
  try {
    // Fetch all emails from Gmail
    const emails = await fetchHDFCEmails();

    if (!emails.length) {
      return NextResponse.json({
        transactions: [],
        message: "No transaction emails found.",
      });
    }

    // Get existing email IDs to skip duplicates
    const { data: existing } = await getSupabase()
      .from("transactions")
      .select("email_id");

    const existingIds = new Set((existing || []).map((e) => e.email_id));
    const newEmails = emails.filter((e) => !existingIds.has(e.id));

    let newCount = 0;

    if (newEmails.length > 0) {
      // Parse only new emails with Claude
      const parsed = await parseEmailsToTransactions(newEmails);

      // Insert into Supabase
      const rows = parsed.map((t) => ({
        email_id: t.id,
        merchant: t.merchant,
        amount: t.amount,
        date: t.date,
        category: t.category,
        has_receipt: t.hasReceipt,
        item_description: t.itemDescription,
        raw_email: t.rawEmail,
      }));

      if (rows.length > 0) {
        const { error } = await getSupabase().from("transactions").insert(rows);
        if (error) throw error;
        newCount = rows.length;
      }
    }

    // Return all transactions
    const { data: allTransactions, error } = await getSupabase()
      .from("transactions")
      .select("*")
      .order("date", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      transactions: allTransactions,
      message: newCount > 0
        ? `Synced ${newCount} new transactions. ${allTransactions.length} total.`
        : `No new transactions. ${allTransactions.length} total.`,
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to sync emails" },
      { status: 500 }
    );
  }
}
