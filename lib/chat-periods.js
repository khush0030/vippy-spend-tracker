/**
 * "This cycle", "August", "last 30 days" — turned into dates once, here, so
 * every tool agrees on what a period means. No @/ imports.
 */

import { cycleWindow } from "./cycle-window.js";

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function shift(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthRange(y, m) {
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end, label: `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}` };
}

function dayLabel(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${SHORT[m - 1]}`;
}

function isIso(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

export function resolvePeriod(spec, { today, cycle }) {
  const s = String(spec ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const [ty, tm] = today.split("-").map(Number);

  if (s === "this_cycle" && cycle) {
    return { start: cycle.cycle_start, end: cycle.cycle_end, label: `this cycle (${dayLabel(cycle.cycle_start)} – ${dayLabel(cycle.cycle_end)})` };
  }
  if (s === "last_cycle" && cycle) {
    // The previous cycle is the window containing the day before this one
    // opened. The statement day is read off the cycle itself: the close date's
    // day, or one less than the open date's when a short month clamped the
    // close (a 30th statement closes February on the 28th).
    const end = shift(cycle.cycle_start, -1);
    const statementDay = Math.max(Number(cycle.cycle_end.slice(8, 10)), Number(cycle.cycle_start.slice(8, 10)) - 1);
    const { start } = cycleWindow(statementDay, end);
    return { start, end, label: `last cycle (${dayLabel(start)} – ${dayLabel(end)})` };
  }
  if (s === "today") return { start: today, end: today, label: "today" };
  if (s === "yesterday") { const d = shift(today, -1); return { start: d, end: d, label: "yesterday" }; }
  if (s === "this_month") return monthRange(ty, tm);
  if (s === "last_month") return tm === 1 ? monthRange(ty - 1, 12) : monthRange(ty, tm - 1);

  let m;
  if ((m = /^last_(\d{1,3})_days$/.exec(s))) {
    const n = Number(m[1]);
    return { start: shift(today, -(n - 1)), end: today, label: `last ${n} days` };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) {
    const y = Number(m[1]), mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return monthRange(y, mo);
  }
  if ((m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(s)) && isIso(m[1]) && isIso(m[2])) {
    return { start: m[1], end: m[2], label: `${dayLabel(m[1])} – ${dayLabel(m[2])}` };
  }
  const idx = MONTHS.findIndex((name) => name === s || name.slice(0, 3) === s);
  if (idx >= 0) {
    const mo = idx + 1;
    return monthRange(mo > tm ? ty - 1 : ty, mo);
  }
  throw new Error(`Unknown period: ${JSON.stringify(spec)}`);
}
