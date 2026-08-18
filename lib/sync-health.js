/**
 * Noticing when the ledger stops moving.
 *
 * The transaction feed once stalled for two months: a pinned model had been
 * retired, every batch 404'd, and the cron dutifully reported "0 new" every
 * night. Nothing was lost — the cursor refuses to advance through a failure —
 * but nothing was said either, and a receipt cannot match a charge that was
 * never imported.
 *
 * So: no sync for two days, or a sync that failed a batch, is worth a message.
 * Both are rate-limited to one a day, because an alarm that repeats hourly is
 * an alarm you learn to swipe away.
 */

const HOUR = 3600_000;
const DEFAULT_STALE_HOURS = 48;
const DEFAULT_COOLDOWN_HOURS = 24;

/** How long a match may lean on the existing ledger before refreshing it. */
const SYNC_COOLDOWN_MINUTES = 10;

function hoursBetween(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / HOUR;
}

function humanAge(hours) {
  if (hours == null) return "never";
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * `{ stale, ageHours, shouldAlert, reason, message }` for one user's sync state.
 * Pure: the caller supplies `now`, the cursor, and when it last complained.
 */
export function assessSyncHealth({
  lastSyncedAt,
  now,
  hadBatchFailure = false,
  lastAlertAt = null,
  staleAfterHours = DEFAULT_STALE_HOURS,
  cooldownHours = DEFAULT_COOLDOWN_HOURS,
} = {}) {
  const ageHours = lastSyncedAt ? hoursBetween(lastSyncedAt, now) : null;
  const stale = ageHours === null || ageHours >= staleAfterHours;

  const sinceAlert = lastAlertAt ? hoursBetween(lastAlertAt, now) : null;
  const muted = sinceAlert !== null && sinceAlert < cooldownHours;

  const reason = hadBatchFailure ? "batch_failure" : stale ? "stale" : null;
  const shouldAlert = Boolean(reason) && !muted;

  const message = hadBatchFailure
    ? "⚠️ <b>Sync trouble</b>\nSome bank alerts could not be read, so the ledger is behind. Receipts sent now may not find their charge yet."
    : stale
      ? `⚠️ <b>Transactions are ${humanAge(ageHours)} old</b>\nThe last successful sync was ${humanAge(
          ageHours
        )} ago. Receipts sent now may not find their charge.`
      : null;

  return { stale, ageHours, shouldAlert, reason, message };
}

/**
 * Whether to refresh the ledger before telling the sender we found nothing.
 *
 * Only when there was nothing to compare against at all. Candidates that
 * scored badly mean the charge is already imported and the reading is the
 * problem — another sync would change nothing and cost a minute.
 */
export function shouldSyncBeforeGivingUp({
  verdict,
  lastSyncedAt,
  now,
  cooldownMinutes = SYNC_COOLDOWN_MINUTES,
} = {}) {
  if (!verdict || verdict.action === "auto") return false;
  if (verdict.candidates?.length) return false;

  if (!lastSyncedAt) return true;
  const minutes = (hoursBetween(lastSyncedAt, now) ?? Infinity) * 60;
  return minutes >= cooldownMinutes;
}
