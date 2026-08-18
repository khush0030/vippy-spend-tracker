import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage, esc } from "@/lib/telegram";
import { currentCycle, cycleCoverage } from "@/lib/cycles";
import { logInfo } from "@/lib/logger";
import { nudgeKindForDay } from "@/lib/nudge-plan";

/**
 * The reverse direction: the bot chasing you, not the other way round.
 *
 * This is what actually kills the month-end scramble. Capture rate matters more
 * than match accuracy — a tool with perfect matching and 40% capture is worse
 * than one with 90% matching and 95% capture — so the nudge is deliberately
 * short, actionable, and silent when there is nothing to chase.
 */

const INR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

async function chatFor(userId) {
  const { data } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("tg_chat_id")
    .eq("user_id", userId)
    .not("linked_at", "is", null)
    .maybeSingle();
  return data?.tg_chat_id || null;
}

function shiftDate(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function outstanding(userId, cycle, { since = null } = {}) {
  const minAmount = cycle.card?.min_receipt_amount ?? 500;

  let q = getSupabaseAdmin()
    .from("transactions")
    .select("id, merchant, amount, date")
    .eq("user_id", userId)
    .eq("is_refund", false)
    .eq("receipt_status", "missing")
    .gte("date", since || cycle.cycle_start)
    .lte("date", cycle.cycle_end)
    .gte("amount", minAmount)
    .order("amount", { ascending: false });

  const { data } = await q.limit(20);
  return data || [];
}

/**
 * Daily chase, limited to the last 48 hours.
 *
 * Deliberately narrow: a long list every evening trains you to ignore it. Only
 * what is fresh enough that you might still have the paper in your pocket.
 */
export async function dailyNudge(userId) {
  const chatId = await chatFor(userId);
  if (!chatId) return { skipped: "no linked chat" };

  const cycle = await currentCycle(userId);
  if (!cycle) return { skipped: "no card configured" };

  const today = new Date().toISOString().slice(0, 10);
  const rows = await outstanding(userId, cycle, { since: shiftDate(today, -2) });

  if (!rows.length) return { sent: false, reason: "nothing outstanding" };

  const lines = rows
    .slice(0, 6)
    .map((t) => `<code>${t.date} · ${esc(t.merchant).slice(0, 22)} · ${INR(t.amount)}</code>`);

  const more = rows.length > 6 ? `\n<i>+${rows.length - 6} more</i>` : "";

  await sendMessage(
    chatId,
    `📌 <b>${rows.length} recent charge${rows.length === 1 ? "" : "s"} without a receipt</b>\n${lines.join(
      "\n"
    )}${more}\n\nSend a photo and I'll file it.`,
    {
      keyboard: [
        [
          { text: "🚫 No bill exists", callback_data: `dq:${rows[0].id}` },
          { text: "⏰ Tomorrow", callback_data: "snooze" },
        ],
      ],
    }
  );

  await logInfo({
    source: "nudge",
    event: "daily",
    userId,
    message: `Chased ${rows.length} charge(s)`,
  });

  return { sent: true, count: rows.length };
}

/**
 * Escalation as the cycle closes: the full outstanding list, sorted by value,
 * with the coverage number stated plainly so the gap is visible.
 */
export async function closingNudge(userId, daysRemaining) {
  const chatId = await chatFor(userId);
  if (!chatId) return { skipped: "no linked chat" };

  const cycle = await currentCycle(userId);
  if (!cycle) return { skipped: "no card configured" };

  const rows = await outstanding(userId, cycle);
  const coverage = await cycleCoverage(userId, cycle);

  if (!rows.length) {
    await sendMessage(
      chatId,
      `✅ <b>Cycle closes in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}</b>\nCoverage <b>100%</b> — nothing outstanding.`
    );
    return { sent: true, count: 0 };
  }

  const lines = rows
    .slice(0, 12)
    .map((t) => `<code>${t.date} · ${esc(t.merchant).slice(0, 22)} · ${INR(t.amount)}</code>`);

  await sendMessage(
    chatId,
    [
      `⏳ <b>Cycle closes in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}</b>`,
      `Coverage <b>${coverage.coveragePct}%</b> · ${rows.length} outstanding`,
      "",
      ...lines,
      rows.length > 12 ? `<i>+${rows.length - 12} more</i>` : "",
      "",
      "Send photos for what you have. For anything with no invoice, reply /declare and I'll record the reason.",
    ]
      .filter(Boolean)
      .join("\n")
  );

  return { sent: true, count: rows.length };
}

export { nudgeKindForDay };

export async function runNudge(userId, { day, statementDay }) {
  const plan = nudgeKindForDay(day, statementDay);
  return plan.kind === "closing"
    ? closingNudge(userId, plan.daysRemaining)
    : dailyNudge(userId);
}
