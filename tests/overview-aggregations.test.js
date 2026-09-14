import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cumulativeByDay, priorWindow } from "../app/components/overview/aggregations.js";

// The browser runs in the user's zone (IST, UTC+5:30). Day arithmetic must
// stay in local dates — converting through UTC lands on the previous day
// and the day cursor never advances.
process.env.TZ = "Asia/Kolkata";

const txn = (date, amount) => ({ date, amount, isRefund: false, merchant: "X", category: "food" });

describe("cumulativeByDay", () => {
  test("walks every day of the window in a UTC+ timezone", () => {
    const days = cumulativeByDay([txn("2026-09-09", 100), txn("2026-09-11", 50)], "2026-09-08", "2026-09-12");
    assert.deepEqual(days.map((d) => d.date), ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"]);
    assert.equal(days.at(-1).cumulative, 150);
  });
});

describe("priorWindow", () => {
  test("prior window ends the day before the current one starts", () => {
    const { priorStart, priorEnd } = priorWindow([txn("2026-09-01", 1)], "2026-09-08", "2026-09-14");
    assert.equal(priorEnd, "2026-09-07");
    assert.equal(priorStart, "2026-09-01");
  });
});
