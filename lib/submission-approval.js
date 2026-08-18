import { buildSubmission } from "@/lib/submission";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage, sendDocument } from "@/lib/telegram";
import { logInfo } from "@/lib/logger";

const INR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Build the package and put it in front of the human.
 *
 * Deliberately stops here. The cron can prepare a submission but cannot send
 * one — the send route requires a session or an explicit approval tap, so an
 * automated job can never mail the accounts department on its own.
 */
export async function buildAndRequestApproval({ userId, cycle, force = false }) {
  let built;
  try {
    built = await buildSubmission({ userId, cycle, force });
  } catch (err) {
    // A blocked cycle is news, not a silent cron failure — say so in chat.
    await notifyBlocked(userId, cycle, err.message);
    throw err;
  }

  const { submission, zip, zipName, stats } = built;

  const { data: link } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("tg_chat_id")
    .eq("user_id", userId)
    .not("linked_at", "is", null)
    .maybeSingle();

  if (!link?.tg_chat_id) {
    return { built: true, submissionId: submission.id, notified: false, ...stats };
  }

  const chatId = link.tg_chat_id;
  const recipients = (cycle.card?.accounts_email || []).filter(Boolean);

  // Send the package itself, so the preview is the actual artefact rather than
  // a description of one. Under 50 MB is Telegram's document limit.
  if (zip.length < 45 * 1024 * 1024) {
    await sendDocument(chatId, zip, zipName, { mime: "application/zip" });
  }

  await sendMessage(
    chatId,
    [
      `📦 <b>Ready · ${cycle.cycle_start} – ${cycle.cycle_end}</b>`,
      `${stats.lines} lines · ${INR(stats.total)}`,
      `${stats.attached} receipts attached · <b>${stats.coverage}%</b>`,
      stats.verified ? `✅ ${stats.statementNote}` : `⚠️ ${stats.statementNote}`,
      recipients.length ? `→ ${recipients.join(", ")}` : "⚠️ No accounts email configured yet",
      "",
      "Nothing is sent until you approve.",
    ].join("\n"),
    {
      keyboard: recipients.length
        ? [[{ text: "✅ Approve & send", callback_data: `send:${submission.id}` }]]
        : null,
    }
  );

  await logInfo({
    source: "submission",
    event: "approval_requested",
    userId,
    message: `Package for ${cycle.cycle_start} awaiting approval`,
    details: { submissionId: submission.id },
  });

  return { built: true, submissionId: submission.id, notified: true, ...stats };
}

async function notifyBlocked(userId, cycle, reason) {
  const { data: link } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("tg_chat_id")
    .eq("user_id", userId)
    .not("linked_at", "is", null)
    .maybeSingle();

  if (!link?.tg_chat_id) return;

  await sendMessage(
    link.tg_chat_id,
    [
      `⛔ <b>Package held · ${cycle.cycle_start} – ${cycle.cycle_end}</b>`,
      reason,
      "",
      "Nothing has been sent. Resolve it and the package will build on the next run.",
    ].join("\n")
  );
}
