import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cycleWindow, cycleMilestones } from "../lib/cycle-window.js";

describe("cycleWindow — statement day 18", () => {
  test("mid-cycle date sits in the window that opened this month", () => {
    // 20 Aug is after the 18th, so the cycle opened 18 Aug.
    assert.deepEqual(cycleWindow(18, "2026-08-20"), {
      start: "2026-08-18",
      end: "2026-09-17",
    });
  });

  test("a date before the statement day belongs to the previous window", () => {
    assert.deepEqual(cycleWindow(18, "2026-08-12"), {
      start: "2026-07-18",
      end: "2026-08-17",
    });
  });

  test("the statement day itself opens the new cycle", () => {
    assert.deepEqual(cycleWindow(18, "2026-08-18"), {
      start: "2026-08-18",
      end: "2026-09-17",
    });
  });

  test("the day before rolls into the closing cycle", () => {
    assert.deepEqual(cycleWindow(18, "2026-08-17"), {
      start: "2026-07-18",
      end: "2026-08-17",
    });
  });

  test("crosses the year boundary backwards", () => {
    assert.deepEqual(cycleWindow(18, "2026-01-05"), {
      start: "2025-12-18",
      end: "2026-01-17",
    });
  });

  test("crosses the year boundary forwards", () => {
    assert.deepEqual(cycleWindow(18, "2026-12-20"), {
      start: "2026-12-18",
      end: "2027-01-17",
    });
  });

  test("windows are contiguous with no gap or overlap", () => {
    const a = cycleWindow(18, "2026-07-20");
    const b = cycleWindow(18, "2026-08-20");
    const dayAfterA = new Date(a.end + "T00:00:00Z");
    dayAfterA.setUTCDate(dayAfterA.getUTCDate() + 1);
    assert.equal(dayAfterA.toISOString().slice(0, 10), b.start);
  });
});

describe("cycleWindow — short months", () => {
  test("a 31st statement day clamps into February", () => {
    const w = cycleWindow(31, "2026-02-15");
    assert.equal(w.start, "2026-01-31");
    assert.equal(w.end, "2026-02-27"); // Feb 2026 has 28 days; cycle ends the day before
  });

  test("a 30th statement day survives February", () => {
    const w = cycleWindow(30, "2026-03-05");
    assert.equal(w.start, "2026-02-28");
  });
});

describe("cycleMilestones", () => {
  test("the statement lands the day after the cycle closes", () => {
    const m = cycleMilestones("2026-08-17", 23, "2026-08-12");
    assert.equal(m.statementDate, "2026-08-18");
    assert.equal(m.daysToStatement, 6);
    assert.equal(m.submitDate, "2026-08-23");
    assert.equal(m.daysToSubmit, 11);
  });

  test("a submit day before the statement day falls in the next month", () => {
    const m = cycleMilestones("2026-08-30", 5, "2026-08-31");
    assert.equal(m.statementDate, "2026-08-31");
    assert.equal(m.submitDate, "2026-09-05");
  });

  test("crosses the year boundary without losing a month", () => {
    const m = cycleMilestones("2026-12-31", 5, "2026-12-31");
    assert.equal(m.statementDate, "2027-01-01");
    assert.equal(m.submitDate, "2027-01-05");
  });

  test("clamps a submit day that the month does not have", () => {
    const m = cycleMilestones("2027-01-31", 31, "2027-02-01");
    assert.equal(m.statementDate, "2027-02-01");
    assert.equal(m.submitDate, "2027-02-28");
  });

  test("counts backwards once the date has passed", () => {
    const m = cycleMilestones("2026-08-17", 23, "2026-08-25");
    assert.equal(m.daysToSubmit, -2);
  });

  test("a nonsense cycle end returns nothing rather than a wrong date", () => {
    assert.equal(cycleMilestones("not-a-date", 23), null);
  });
});
