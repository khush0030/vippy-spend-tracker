import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nudgeKindForDay } from "../lib/nudge-plan.js";

describe("nudgeKindForDay", () => {
  test("three days out escalates", () => {
    assert.deepEqual(nudgeKindForDay(15, 18), { kind: "closing", daysRemaining: 3 });
  });

  test("the day before escalates", () => {
    assert.deepEqual(nudgeKindForDay(17, 18), { kind: "closing", daysRemaining: 1 });
  });

  test("ordinary days get the short daily chase", () => {
    assert.deepEqual(nudgeKindForDay(5, 18), { kind: "daily" });
    assert.deepEqual(nudgeKindForDay(16, 18), { kind: "daily" });
  });

  test("statement day itself is not a closing nudge — reconciliation takes over", () => {
    assert.deepEqual(nudgeKindForDay(18, 18), { kind: "daily" });
  });

  test("after the statement day the new cycle is simply daily", () => {
    assert.deepEqual(nudgeKindForDay(20, 18), { kind: "daily" });
  });
});
