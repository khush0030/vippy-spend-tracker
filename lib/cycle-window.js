/**
 * Pure statement-cycle date maths — no imports, no I/O, directly testable.
 *
 * Kept separate from lib/cycles.js (which touches the database) so the window
 * logic can be tested without a Supabase client or the Next `@/` alias.
 */

function iso(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * The cycle window containing `refDate`. Pure — no I/O, safe to test.
 * Clamps the day for short months (a 31st statement day lands on the 28th/30th).
 */
export function cycleWindow(statementDay, refDate = new Date()) {
  const ref = typeof refDate === "string" ? new Date(refDate + "T00:00:00Z") : refDate;
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const day = ref.getUTCDate();

  const daysIn = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clamp = (year, month) => Math.min(statementDay, daysIn(year, month));

  // On or after this month's statement day, the current cycle opened this month.
  const startsThisMonth = day >= clamp(y, m);
  const sy = startsThisMonth ? y : m === 0 ? y - 1 : y;
  const sm = startsThisMonth ? m : m === 0 ? 11 : m - 1;

  const start = new Date(Date.UTC(sy, sm, clamp(sy, sm)));
  const endMonth = sm === 11 ? 0 : sm + 1;
  const endYear = sm === 11 ? sy + 1 : sy;
  const end = new Date(Date.UTC(endYear, endMonth, clamp(endYear, endMonth)));
  end.setUTCDate(end.getUTCDate() - 1); // cycle ends the day before the next statement

  return { start: iso(start), end: iso(end) };
}

/**
 * The two dates a cycle is actually counted down to: the day the statement
 * lands (the day after the cycle closes) and the day the package goes to
 * accounts.
 *
 * Kept here rather than in the component because "how many days left" is the
 * number the whole dashboard hangs on, and off-by-one on a month boundary is
 * exactly the sort of thing that only shows up in production on the 31st.
 */
export function cycleMilestones(cycleEnd, submitDay, today = new Date()) {
  const end = new Date(`${String(cycleEnd).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;

  const statement = new Date(end.getTime());
  statement.setUTCDate(statement.getUTCDate() + 1);

  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  // The submit day in the statement's own month, unless that has already
  // passed — a submit day earlier in the month than the statement day means
  // the package goes out the following month.
  let sy = statement.getUTCFullYear();
  let sm = statement.getUTCMonth();
  let submit = new Date(Date.UTC(sy, sm, Math.min(submitDay, daysIn(sy, sm))));
  if (submit <= statement) {
    sm = sm === 11 ? 0 : sm + 1;
    sy = sm === 0 ? sy + 1 : sy;
    submit = new Date(Date.UTC(sy, sm, Math.min(submitDay, daysIn(sy, sm))));
  }

  const now =
    typeof today === "string"
      ? new Date(`${today.slice(0, 10)}T00:00:00Z`)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const days = (d) => Math.round((d.getTime() - now.getTime()) / 86400000);

  return {
    statementDate: iso(statement),
    submitDate: iso(submit),
    daysToStatement: days(statement),
    daysToSubmit: days(submit),
  };
}
