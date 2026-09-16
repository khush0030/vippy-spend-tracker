// tests/reversals.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findReversals } from "../lib/reversals.js";

const t = (id, o) => ({ id, merchant: "Uber", amount: 1433.34, date: "2026-08-02", is_refund: false, receipt_status: "missing", ...o });

test("a hold and its release on the same card pair up", () => {
  const pairs = findReversals([t(406), t(326, { is_refund: true }), t(1, { amount: 50 })]);
  assert.deepEqual(pairs, [[406, 326]]);
});

test("each refund cancels one charge only, nearest first", () => {
  const pairs = findReversals([t(1, { date: "2026-08-01" }), t(2), t(3, { is_refund: true })]);
  assert.deepEqual(pairs, [[2, 3]]);
});

test("a charge that already has a bill, another merchant, or a late refund is left alone", () => {
  assert.deepEqual(findReversals([t(1, { receipt_status: "attached" }), t(2, { is_refund: true })]), []);
  assert.deepEqual(findReversals([t(1), t(2, { is_refund: true, merchant: "Bolt" })]), []);
  assert.deepEqual(findReversals([t(1), t(2, { is_refund: true, date: "2026-08-09" })]), []);
});
