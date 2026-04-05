import { NextResponse } from "next/server";
import { fetchHDFCEmails } from "@/lib/gmail";
import { parseEmailsToTransactions } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";

export async function POST() {
  try {
    console.log("Starting Gmail sync...");

    // Fetch all emails from Gmail
    const emails = await fetchHDFCEmails();
    console.log(`Fetched ${emails.length} emails from Gmail`);

    if (!emails.length) {
      return NextResponse.json({
        transactions: [],
        message: "No transaction emails found. Check that your Gmail has HDFC alerts or Amazon order emails.",
      });
    }

    // Get existing email IDs to skip duplicates
    const { data: existing, error: fetchError } = await getSupabase()
      .from("transactions")
      .select("email_id");

    if (fetchError) {
      console.error("Supabase fetch error:", fetchError);
      throw new Error("Supabase: " + fetchError.message);
    }

    const existingIds = new Set((existing || []).map((e) => e.email_id));
    const newEmails = emails.filter((e) => !existingIds.has(e.id));
    console.log(`${newEmails.length} new emails to parse (${existingIds.size} already in DB)`);

    let newCount = 0;

    if (newEmails.length > 0) {
      // Parse only new emails with Claude
      const parsed = await parseEmailsToTransactions(newEmails);
      console.log(`Claude parsed ${parsed.length} transactions`);

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
        if (error) {
          console.error("Supabase insert error:", error);
          throw new Error("Supabase insert: " + error.message);
        }
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
