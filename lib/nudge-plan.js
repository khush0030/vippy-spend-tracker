/**
 * Pure nudge scheduling — no imports, no I/O, directly testable.
 */

/**
 * Decide which nudge today calls for. Pure enough to reason about: the cron
 * passes the date, this decides the flavour.
 */
export function nudgeKindForDay(day, statementDay) {
  const daysToClose = statementDay - day;
  if (daysToClose === 3 || daysToClose === 1) return { kind: "closing", daysRemaining: daysToClose };
  return { kind: "daily" };
}
