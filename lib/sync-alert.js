import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage } from "@/lib/telegram";
import { assessSyncHealth } from "@/lib/sync-health";
import { logInfo, logWarn } from "@/lib/logger";

/**
 * Telling the owner when the ledger has stopped moving.
 *
 * The decision itself lives in `sync-health.js` and is pure; this reads the
 * cursor, finds the last complaint in the log, and sends the message. The log
 * doubles as the rate limiter, which keeps the alarm out of the schema.
 */

async function lastAlertAt(userId) {
  const { data } = await getSupabaseAdmin()
    .from("app_logs")
    .select("created_at")
    .eq("user_id", userId)
    .eq("source", "sync")
    .eq("event", "stale_alert")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at || null;
}

async function chatFor(userId) {
  const { data } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("tg_chat_id")
    .eq("user_id", userId)
    .not("linked_at", "is", null)
    .maybeSingle();
  return data?.tg_chat_id || null;
}

/**
 * Check one user's sync state and message them if it warrants it.
 * Returns what it decided, so the cron result shows the reasoning.
 */
export async function alertIfSyncUnhealthy(userId, { hadBatchFailure = false } = {}) {
  const sb = getSupabaseAdmin();

  const { data: user } = await sb
    .from("users")
    .select("last_synced_at")
    .eq("id", userId)
    .maybeSingle();

  const health = assessSyncHealth({
    lastSyncedAt: user?.last_synced_at || null,
    now: new Date().toISOString(),
    hadBatchFailure,
    lastAlertAt: await lastAlertAt(userId),
  });

  if (!health.shouldAlert) return { alerted: false, stale: health.stale };

  const chatId = await chatFor(userId);
  if (!chatId) {
    // Still worth recording: without a linked chat there is nowhere to shout.
    await logWarn({
      source: "sync",
      event: "stale_unreported",
      userId,
      message: `Sync is unhealthy (${health.reason}) but no chat is linked`,
    });
    return { alerted: false, stale: health.stale, reason: "no linked chat" };
  }

  await sendMessage(chatId, health.message);

  // Logged under the event the cooldown looks for, so this is both the record
  // and the rate limit.
  await logInfo({
    source: "sync",
    event: "stale_alert",
    userId,
    message: `Warned about sync health: ${health.reason}`,
    details: { ageHours: health.ageHours, reason: health.reason },
  });

  return { alerted: true, stale: health.stale, reason: health.reason };
}
