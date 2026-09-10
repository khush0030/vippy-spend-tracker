import { getSupabaseAdmin } from "./supabase.js";
import { sendMessage, esc } from "./telegram.js";
import { listMailAccounts, getMailAccount, markRevoked, markActive } from "./mail-account.js";
import { openMailbox } from "./mailbox.js";
import { logInfo, logWarn } from "./logger.js";

/**
 * A dead mailbox must be loud.
 *
 * The credentials chosen in the design are the durable ones — an Internal
 * consent screen is exempt from Google's seven-day expiry, and an app password
 * lives until it is revoked — but neither is immortal. An app password can be
 * cancelled from a security page by accident, and an Internal app stops
 * working the day its owner leaves the Workspace.
 *
 * This app has already lost two months of sync to a credential that failed in
 * silence. So the alert fires on the transition into failure: once, naming the
 * mailbox, never repeated daily into deafness.
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

export async function checkMailboxes(userId) {
  const accounts = await listMailAccounts(userId);
  const result = { checked: 0, revoked: 0, recovered: 0, alerted: 0 };
  const chatId = await chatFor(userId);

  for (const row of accounts) {
    result.checked += 1;
    let alive = false;
    let reason = "";

    let box = null;
    try {
      const account = await getMailAccount(userId, row.id);
      box = await openMailbox(account);
      alive = await box.probe();
    } catch (err) {
      reason = err.message;
    } finally {
      if (box) await box.close().catch(() => {});
    }

    if (alive) {
      const changed = await markActive(userId, row.id);
      if (changed) {
        result.recovered += 1;
        if (chatId) {
          await sendMessage(chatId, `✅ <b>${esc(row.email)}</b> is readable again.`);
          result.alerted += 1;
        }
      }
      continue;
    }

    const changed = await markRevoked(userId, row.id);
    result.revoked += 1;

    await logWarn({
      source: "mailbox", event: "credential_dead", userId,
      message: `${row.email} could not be opened: ${reason}`,
    });

    // Only on the way in. A daily repeat trains you to ignore it.
    if (changed && chatId) {
      await sendMessage(
        chatId,
        [
          `⛔ <b>${esc(row.email)} stopped working</b>`,
          row.auth_kind === "imap_app_password"
            ? "The app password was rejected. Generate a new one at myaccount.google.com/apppasswords and re-add the mailbox in Settings."
            : "Google refused the credential. Reconnect the account in Settings.",
          "",
          `<i>${esc(reason).slice(0, 200)}</i>`,
          "",
          row.role === "primary"
            ? "This is the primary mailbox, so bank alerts and the statement have stopped too."
            : "Invoice harvesting from this mailbox has stopped.",
        ].join("\n")
      );
      result.alerted += 1;
    }
  }

  await logInfo({
    source: "mailbox", event: "health_checked", userId,
    message: `${result.checked} mailbox(es): ${result.revoked} dead, ${result.recovered} recovered`,
  });

  return result;
}
