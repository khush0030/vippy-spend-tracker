import { getSupabaseAdmin } from "@/lib/supabase";
import { cycleWindow, previousWindow, billingWindow, localToday } from "@/lib/cycle-window";

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
  return cycleRow(userId, card, cycleWindow(card.statement_day, dayOf(refDate)), "open");
}

// Cycle boundaries are Indian dates; a Date is read in IST, a string as given.
const dayOf = (ref) => (typeof ref === "string" ? ref.slice(0, 10) : localToday(ref));

/**
 * The cycle whose bill is being paid, and so whose receipts are being chased.
 *
 * The morning after the statement closes, the open cycle is a day old and
 * empty, while the cycle that just closed still has to be receipted and sent
 * to accounts. It stays the one shown until its package is due (submit day)
 * or has been submitted; then the open cycle takes over. Nothing older ever
 * comes back. The date rule itself is billingWindow, tested without a database.
 */
export async function billingCycle(userId, refDate = new Date()) {
  const card = await getCardAccount(userId);
  if (!card) return null;
  const today = dayOf(refDate);

  const prev = previousWindow(card.statement_day, today);
  const { data: prevRow } = await getSupabaseAdmin()
    .from("statement_cycles")
    .select("status")
    .eq("card_account_id", card.id)
    .eq("cycle_start", prev.start)
    .maybeSingle();

  const w = billingWindow({
    statementDay: card.statement_day,
    submitDay: card.submit_day ?? 23,
    today,
    previousSubmitted: prevRow?.status === "submitted",
  });
  return cycleRow(userId, card, w, w.closed ? "closing" : "open");
}

async function cycleRow(userId, card, { start, end }, status) {
  // Only used when the row does not exist yet.
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
      status,
    })
    .select()
    .single();

  if (error) throw new Error(`cycle create failed: ${error.message}`);
  return { ...data, card };
}

/**
 * Which charges belong to a cycle, as a filter for a transactions query.
 *
 * Once the cycle's statement is reconciled, exactly the charges on it: a
 * charge swiped on the 15th that posts after the statement closes is next
 * month's bill, and one swiped before the last statement closed that posted
 * late is this one's. Until then, the charges dated inside the window.
 */
export async function cycleScope(cycle) {
  const byDate = (q) => q.gte("date", cycle.cycle_start).lte("date", cycle.cycle_end);
  if (!cycle?.id) return byDate;

  const sb = getSupabaseAdmin();
  const { data: statement } = await sb
    .from("statements")
    .select("id")
    .eq("cycle_id", cycle.id)
    .eq("status", "reconciled")
    .order("issued_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!statement) return byDate;

  const { data: lines } = await sb.from("statement_lines").select("transaction_id").eq("statement_id", statement.id);
  const ids = [...new Set((lines || []).map((l) => l.transaction_id).filter(Boolean))];
  return (q) => q.in("id", ids.length ? ids : [-1]);
}

/**
 * Coverage for a cycle, measured against transactions.
 *
 * Once a statement has been reconciled this is recomputed against statement
 * lines instead — the bank's ledger outranks the app's picture of the month.
 */
export async function cycleCoverage(userId, cycle) {
  const minAmount = cycle?.card?.min_receipt_amount ?? 0;

  const scope = await cycleScope(cycle);
  const { data: rows } = await scope(
    getSupabaseAdmin()
      .from("transactions")
      .select("id, amount, receipt_status, is_refund")
      .eq("user_id", userId)
  );

  const txns = (rows || []).filter((t) => !t.is_refund);
  const total = txns.reduce((sum, t) => sum + Number(t.amount || 0), 0);

  // Small charges are auto-waived, so they must not drag coverage down; nor
  // may a charge waived for any other reason (a fee, a released hold).
  const chaseable = txns.filter((t) => Number(t.amount) >= minAmount && t.receipt_status !== "waived");
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
 * The latest closed cycle, if its package has not been sent.
 *
 * Only ever the cycle immediately before the open one: once a newer statement
 * arrives the older one is paid and done, so an unsent package for it is
 * never picked up again. On the 23rd the open cycle started on the 17th, so
 * this is the one before it.
 */
export async function cycleAwaitingSubmission(userId, refDate = new Date()) {
  const card = await getCardAccount(userId);
  if (!card) return null;
  const prev = previousWindow(card.statement_day, dayOf(refDate));

  const { data } = await getSupabaseAdmin()
    .from("statement_cycles")
    .select("*, card:card_accounts(*)")
    .eq("card_account_id", card.id)
    .eq("cycle_start", prev.start)
    .neq("status", "submitted")
    .maybeSingle();

  return data || null;
}
