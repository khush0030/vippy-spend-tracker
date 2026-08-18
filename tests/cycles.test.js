import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cycleWindow, cycleMilestones } from "../lib/cycle-window.js";

// The statement is DATED the statement day and covers the period ending that
// day — HDFC's 16 August statement runs 17 July to 16 August. So the cycle
// closes on the statement day rather than opening on it. Getting this backwards
// puts a charge made on the statement date in the wrong month from the bank's,
// which is exactly the charge that cannot be reconciled.
describe("cycleWindow — statement day 18", () => {
  test("mid-cycle date sits in the window that opened after the last statement", () => {
    assert.deepEqual(cycleWindow(18, "2026-08-20"), {
      start: "2026-08-19",
      end: "2026-09-18",
    });
  });

  test("a date before the statement day belongs to the closing window", () => {
    assert.deepEqual(cycleWindow(18, "2026-08-12"), {
      start: "2026-07-19",
      end: "2026-08-18",
    });
  });

  test("the statement day itself closes its cycle rather than opening the next", () => {
    assert.deepEqual(cycleWindow(18, "2026-08-18"), {
      start: "2026-07-19",
      end: "2026-08-18",
    });
  });

  test("the day after opens the new cycle", () => {
    assert.deepEqual(cycleWindow(18, "2026-08-19"), {
      start: "2026-08-19",
      end: "2026-09-18",
    });
  });

  test("crosses the year boundary backwards", () => {
    assert.deepEqual(cycleWindow(18, "2026-01-05"), {
      start: "2025-12-19",
      end: "2026-01-18",
    });
  });

  test("crosses the year boundary forwards", () => {
    assert.deepEqual(cycleWindow(18, "2026-12-20"), {
      start: "2026-12-19",
      end: "2027-01-18",
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
  test("a 31st statement day clamps to the end of February", () => {
    const w = cycleWindow(31, "2026-02-15");
    assert.equal(w.start, "2026-02-01"); // the day after January's 31st
    assert.equal(w.end, "2026-02-28"); // Feb 2026 has 28 days
  });

  test("a 30th statement day survives February", () => {
    const w = cycleWindow(30, "2026-03-05");
    assert.equal(w.start, "2026-03-01"); // February closed on the 28th
    assert.equal(w.end, "2026-03-30");
  });
});

describe("cycleMilestones", () => {
  test("the statement is dated the day the cycle closes", () => {
    const m = cycleMilestones("2026-08-18", 23, "2026-08-12");
    assert.equal(m.statementDate, "2026-08-18");
    assert.equal(m.daysToStatement, 6);
    assert.equal(m.submitDate, "2026-08-23");
    assert.equal(m.daysToSubmit, 11);
  });

  test("a submit day earlier in the month than the statement falls next month", () => {
    const m = cycleMilestones("2026-08-31", 5, "2026-08-31");
    assert.equal(m.statementDate, "2026-08-31");
    assert.equal(m.submitDate, "2026-09-05");
  });

  test("crosses the year boundary without losing a month", () => {
    const m = cycleMilestones("2026-12-31", 5, "2026-12-31");
    assert.equal(m.statementDate, "2026-12-31");
    assert.equal(m.submitDate, "2027-01-05");
  });

  test("clamps a submit day that the month does not have", () => {
    const m = cycleMilestones("2027-01-31", 31, "2027-02-01");
    assert.equal(m.statementDate, "2027-01-31");
    assert.equal(m.submitDate, "2027-02-28");
  });

  test("counts backwards once the date has passed", () => {
    const m = cycleMilestones("2026-08-18", 23, "2026-08-25");
    assert.equal(m.daysToSubmit, -2);
  });

  test("a nonsense cycle end returns nothing rather than a wrong date", () => {
    assert.equal(cycleMilestones("not-a-date", 23), null);
  });
});
