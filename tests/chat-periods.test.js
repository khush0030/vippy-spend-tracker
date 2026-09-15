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
