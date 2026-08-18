import { getSupabaseAdmin } from "@/lib/supabase";
import { cycleWindow } from "@/lib/cycle-window";

/**
 * Statement cycles.
 *
 * The card statement is issued on `statement_day` (18th) and covers the period
 * ending the day before. So the cycle that a given date belongs to runs from
 * the 18th of one month to the 17th of the next.
 *
 * Cycles are materialised rows rather than computed on the fly: once a cycle
 * is submitted it must freeze, so changing `statement_day` next year can never
 * rewrite what accounts already received.
 */

export { cycleWindow };

export async function getCardAccount(userId) {
  const { data } = await getSupabaseAdmin()
    .from("card_accounts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/** Find or create the open cycle covering today. */
export async function currentCycle(userId, refDate = new Date()) {
  const card = await getCardAccount(userId);
  if (!card) return null;

  const { start, end } = cycleWindow(card.statement_day, refDate);
  const sb = getSupabaseAdmin();

  const { data: existing } = await sb
    .from("statement_cycles")
    .select("*")
    .eq("card_account_id", card.id)
    .eq("cycle_start", start)
    .maybeSingle();

  if (existing) return { ...existing, card };

  const { data, error } = await sb
    .from("statement_cycles")
    .insert({
      user_id: userId,
      card_account_id: card.id,
      cycle_start: start,
      cycle_end: end,
      status: "open",
    })
    .select()
    .single();

  if (error) throw new Error(`cycle create failed: ${error.message}`);
  return { ...data, card };
}

/**
 * Coverage for a cycle, measured against transactions.
 *
 * Once a statement has been reconciled this is recomputed against statement
 * lines instead — the bank's ledger outranks the app's picture of the month.
 */
export async function cycleCoverage(userId, cycle) {
  const minAmount = cycle?.card?.min_receipt_amount ?? 500;

  const { data: rows } = await getSupabaseAdmin()
    .from("transactions")
    .select("id, amount, receipt_status, is_refund")
    .eq("user_id", userId)
    .gte("date", cycle.cycle_start)
    .lte("date", cycle.cycle_end);

  const txns = (rows || []).filter((t) => !t.is_refund);
  const total = txns.reduce((sum, t) => sum + Number(t.amount || 0), 0);

  // Small charges are auto-waived, so they must not drag coverage down.
  const chaseable = txns.filter((t) => Number(t.amount) >= minAmount);
  const withReceipt = chaseable.filter(
    (t) => t.receipt_status === "attached" || t.receipt_status === "declared"
  ).length;

  return {
    txnCount: txns.length,
    total,
    chaseable: chaseable.length,
    withReceipt,
    missing: chaseable.length - withReceipt,
    coveragePct: chaseable.length ? Math.round((withReceipt / chaseable.length) * 100) : 100,
  };
}

/**
 * The most recent closed cycle that has not been submitted.
 *
 * On the 23rd the *open* cycle is the one that started on the 18th, so the
 * package being built is for the cycle before it. Looked up explicitly rather
 * than inferred by date arithmetic, so a late submission still finds its work.
 */
export async function cycleAwaitingSubmission(userId, refDate = new Date()) {
  const today = (typeof refDate === "string" ? new Date(refDate) : refDate)
    .toISOString()
    .slice(0, 10);

  const { data } = await getSupabaseAdmin()
    .from("statement_cycles")
    .select("*, card:card_accounts(*)")
    .eq("user_id", userId)
    .neq("status", "submitted")
    .lt("cycle_end", today)
    .order("cycle_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}
