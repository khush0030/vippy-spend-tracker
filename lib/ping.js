// lib/ping.js
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage, editMessage } from "@/lib/telegram";
import { getCardAccount } from "@/lib/cycles";
import { logInfo, logWarn } from "@/lib/logger";
import { selectPings, pingText, INR, esc } from "@/lib/ping-plan";

/**
 * The receipt ping: one message per charge, within the hour.
 *
 * Runs on every cron tick right after sync. Anything sync just inserted and
 * has no receipt is asked about once; the answer buttons write straight to
 * transactions.receipt_status. The morning digest picks up whatever was
 * asked and not answered.
 */

async function chatFor(userId) {
  const { data } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("tg_chat_id")
    .eq("user_id", userId)
    .not("linked_at", "is", null)
    .maybeSingle();
  return data?.tg_chat_id || null;
}

async function recurringFor(userId) {
  const { data } = await getSupabaseAdmin().from("recurring_merchants").select("merchant").eq("user_id", userId);
  return new Set((data || []).map((r) => r.merchant));
}

export async function runPing(userId) {
  const sb = getSupabaseAdmin();
  const chatId = await chatFor(userId);
  if (!chatId) return { sent: 0, skipped: "no linked chat" };

  const card = await getCardAccount(userId).catch(() => null);
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 26 * 3600e3).toISOString();

  const { data: candidates } = await sb
    .from("transactions")
    .select("id, merchant, amount, date, txn_time, is_refund, receipt_status")
    .eq("user_id", userId)
    .gte("created_at", since);

  const ids = (candidates || []).map((t) => t.id);
  const { data: already } = ids.length
    ? await sb.from("receipt_pings").select("transaction_id").in("transaction_id", ids)
    : { data: [] };

  const recurring = await recurringFor(userId);
  const chosen = selectPings({
    transactions: candidates || [],
    pinged: new Set((already || []).map((r) => r.transaction_id)),
    recurring,
    pausedUntil: card?.pings_paused_until || null,
    today,
  });

  let sent = 0;
  for (const txn of chosen) {
    const { text, keyboard } = pingText(txn, { recurring });
    try {
      const msg = await sendMessage(chatId, text, { keyboard });
      await sb.from("receipt_pings").insert({
        transaction_id: txn.id, user_id: userId, tg_message_id: msg?.message_id ?? null,
      });
      sent++;
    } catch (err) {
      await logWarn({ source: "ping", event: "send_failed", userId, message: `Ping for txn ${txn.id} failed: ${err.message}` });
    }
  }

  if (sent) await logInfo({ source: "ping", event: "sent", userId, message: `Pinged ${sent} charge(s)` });
  return { sent };
}

/** Transactions pinged today and still unanswered — the digest leaves those alone. */
export async function pingedTodayUnanswered(userId, today) {
  const { data } = await getSupabaseAdmin()
    .from("receipt_pings")
    .select("transaction_id")
    .eq("user_id", userId)
    .is("answered_at", null)
    .gte("sent_at", `${today}T00:00:00Z`);
  return new Set((data || []).map((r) => r.transaction_id));
}

export async function answerPing({ userId, chatId, messageId, action, transactionId }) {
  const sb = getSupabaseAdmin();
  const { data: txn } = await sb
    .from("transactions")
    .select("id, merchant, amount")
    .eq("id", transactionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!txn) return editMessage(chatId, messageId, "That charge is no longer here.");

  const label = `${INR(txn.amount)} ${esc(txn.merchant)}`;
  let answer, text;

  if (action === "nb") {
    await sb.from("transactions").update({ receipt_status: "declared", declared_reason: "no bill exists" }).eq("id", txn.id);
    answer = "no_bill";
    text = `Noted — no bill for ${label}.`;
  } else if (action === "sub") {
    await sb.from("recurring_merchants").upsert({ user_id: userId, merchant: txn.merchant }, { onConflict: "user_id,merchant" });
    answer = "subscription";
    text = `Noted as recurring — ${esc(txn.merchant)} invoices usually arrive by email; the harvester checks the 17th–23rd. Forward it here if it doesn't turn up. This charge still needs its invoice.`;
  } else {
    answer = "later";
    text = `Okay — ${label} goes in tomorrow's list.`;
  }

  await sb
    .from("receipt_pings")
    .upsert({ transaction_id: txn.id, user_id: userId, answered_at: new Date().toISOString(), answer }, { onConflict: "transaction_id" });
  await logInfo({ source: "ping", event: answer, userId, message: `${label} → ${answer}` });
  return editMessage(chatId, messageId, text);
}
