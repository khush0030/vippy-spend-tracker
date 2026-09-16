import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePeriod } from "../lib/chat-periods.js";

const ctx = { today: "2026-09-15", cycle: { cycle_start: "2026-08-17", cycle_end: "2026-09-16" } };

test("cycle-relative periods come from the current cycle", () => {
  assert.deepEqual(resolvePeriod("this_cycle", ctx), { start: "2026-08-17", end: "2026-09-16", label: "this cycle (17 Aug – 16 Sep)" });
  assert.deepEqual(resolvePeriod("last_cycle", ctx), { start: "2026-07-17", end: "2026-08-16", label: "last cycle (17 Jul – 16 Aug)" });
});

test("calendar months, by number or name, and relative months", () => {
  assert.deepEqual(resolvePeriod("2026-08", ctx), { start: "2026-08-01", end: "2026-08-31", label: "August 2026" });
  assert.equal(resolvePeriod("august", ctx).start, "2026-08-01");
  assert.equal(resolvePeriod("Aug", ctx).start, "2026-08-01");
  // A month name after today's month means last year's.
  assert.equal(resolvePeriod("december", ctx).start, "2025-12-01");
  assert.deepEqual(resolvePeriod("this_month", ctx), { start: "2026-09-01", end: "2026-09-30", label: "September 2026" });
  assert.deepEqual(resolvePeriod("last_month", ctx), { start: "2026-08-01", end: "2026-08-31", label: "August 2026" });
});

test("day windows", () => {
  assert.deepEqual(resolvePeriod("last_30_days", ctx), { start: "2026-08-17", end: "2026-09-15", label: "last 30 days" });
  assert.deepEqual(resolvePeriod("today", ctx), { start: "2026-09-15", end: "2026-09-15", label: "today" });
  assert.deepEqual(resolvePeriod("yesterday", ctx), { start: "2026-09-14", end: "2026-09-14", label: "yesterday" });
  assert.deepEqual(resolvePeriod("2026-08-01..2026-08-10", ctx), { start: "2026-08-01", end: "2026-08-10", label: "1 Aug – 10 Aug" });
});

test("a month boundary in a day window is handled", () => {
  assert.equal(resolvePeriod("last_7_days", { ...ctx, today: "2026-09-03" }).start, "2026-08-28");
});

test("unknown specs throw", () => {
  assert.throws(() => resolvePeriod("whenever", ctx), /Unknown period/);
  assert.throws(() => resolvePeriod("", ctx), /Unknown period/);
  assert.throws(() => resolvePeriod("2026-13", ctx), /Unknown period/);
});

test("last_cycle survives a cycle that opens at a month end", () => {
  // Statement day 30: March's cycle closes on the 30th, so April's opens on
  // the 31st. Subtracting a calendar month from 31 March must not land in
  // March again.
  const c = { today: "2026-04-10", cycle: { cycle_start: "2026-03-31", cycle_end: "2026-04-30" } };
  assert.deepEqual(resolvePeriod("last_cycle", c), { start: "2026-03-01", end: "2026-03-30", label: "last cycle (1 Mar – 30 Mar)" });
  // And a February close, where the statement day itself is clamped.
  const f = { today: "2026-02-10", cycle: { cycle_start: "2026-01-31", cycle_end: "2026-02-28" } };
  assert.deepEqual(resolvePeriod("last_cycle", f), { start: "2025-12-31", end: "2026-01-30", label: "last cycle (31 Dec – 30 Jan)" });
});

test("a lone date is that one day", () => {
  const ctx = { today: "2026-09-15", cycle: null };
  assert.deepEqual(resolvePeriod("2026-09-09", ctx), { start: "2026-09-09", end: "2026-09-09", label: "9 Sep" });
  assert.throws(() => resolvePeriod("2026-02-30", ctx), /Unknown period/);
});

test("billing_cycle is the cycle being paid, not the one that opened today", () => {
  const cycle = { cycle_start: "2026-09-17", cycle_end: "2026-10-16" };
  const billing = { cycle_start: "2026-08-17", cycle_end: "2026-09-16" };
  const p = resolvePeriod("billing_cycle", { today: "2026-09-17", cycle, billing });
  assert.equal(p.start, "2026-08-17");
  assert.equal(p.end, "2026-09-16");
  assert.equal(resolvePeriod("this_cycle", { today: "2026-09-17", cycle, billing }).start, "2026-09-17");
});
