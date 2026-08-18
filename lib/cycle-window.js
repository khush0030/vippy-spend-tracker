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
 *
 * The statement is dated the statement day and covers the period *ending* that
 * day: HDFC's 16 August statement runs 17 July to 16 August. So a cycle closes
 * on the statement day and the next one opens the morning after. Reading it the
 * other way puts a charge made on the statement date in a different month from
 * the bank, and that is precisely the charge that then cannot be reconciled.
 *
 * Short months clamp: a 31st statement day closes on the 28th of February.
 */
export function cycleWindow(statementDay, refDate = new Date()) {
  const ref = typeof refDate === "string" ? new Date(refDate + "T00:00:00Z") : refDate;
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const day = ref.getUTCDate();

  const daysIn = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clamp = (year, month) => Math.min(statementDay, daysIn(year, month));

  // On or before this month's statement day, the cycle we are in closes this
  // month. After it, this cycle closes next month.
  const closesThisMonth = day <= clamp(y, m);
  const ey = closesThisMonth ? y : m === 11 ? y + 1 : y;
  const em = closesThisMonth ? m : m === 11 ? 0 : m + 1;

  const end = new Date(Date.UTC(ey, em, clamp(ey, em)));

  // The previous statement closed the month before; this cycle opens the day
  // after it.
  const py = em === 0 ? ey - 1 : ey;
  const pm = em === 0 ? 11 : em - 1;
  const start = new Date(Date.UTC(py, pm, clamp(py, pm)));
  start.setUTCDate(start.getUTCDate() + 1);

  return { start: iso(start), end: iso(end) };
}

/**
 * The two dates a cycle is actually counted down to: the day the statement is
 * issued (the day the cycle closes) and the day the package goes to accounts.
 *
 * Kept here rather than in the component because "how many days left" is the
 * number the whole dashboard hangs on, and off-by-one on a month boundary is
 * exactly the sort of thing that only shows up in production on the 31st.
 */
export function cycleMilestones(cycleEnd, submitDay, today = new Date()) {
  const end = new Date(`${String(cycleEnd).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;

  // The statement is dated the closing day itself, not the morning after.
  const statement = new Date(end.getTime());

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
