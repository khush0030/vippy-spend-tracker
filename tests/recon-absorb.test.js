// tests/recon-absorb.test.js — cases from the 16 Sep 2026 statement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findAbsorbed } from "../lib/recon.js";

const line = (o) => ({ line_no: 1, txn_date: "2026-09-07", descriptor: "X", amount: 100, currency: "INR", amount_orig: null, transaction_id: 1, created: true, ...o });
const txn = (o) => ({ id: 9, merchant: "X", amount: 100, date: "2026-09-07", is_refund: false, ...o });

test("a fuel alert before surcharge is the statement's fuel line", () => {
  const got = findAbsorbed(
    [line({ descriptor: "SINGHAL FILLING STATION INDORE", amount: 1517.7, transaction_id: 609 })],
    [txn({ id: 570, merchant: "Singhal Filling Station", amount: 1500 })]
  );
  assert.deepEqual(got, [{ from: 570, into: 609, why: "amount within 3% of the posted line" }]);
});

test("a foreign charge alerted in its own currency is the line whose original amount it states", () => {
  const got = findAbsorbed(
    [line({ descriptor: "OPENAIOPENAI.COM", amount: 957.45, currency: "USD", amount_orig: 10, transaction_id: 583, created: false, txn_date: "2026-08-26" })],
    [txn({ id: 584, merchant: "OpenAI", amount: 10, date: "2026-08-26" })]
  );
  assert.deepEqual(got, [{ from: 584, into: 583, why: "alert stated the USD amount as rupees" }]);
});

test("a hold and its top-up together are the one line that settled", () => {
  const got = findAbsorbed(
    [line({ descriptor: "BOLT.EU/O/2608161523Amsterdam", amount: 3240.86, currency: "EUR", amount_orig: 29.3, transaction_id: 614, txn_date: "2026-08-16" })],
    [txn({ id: 259, merchant: "Bolt", amount: 3207.67, date: "2026-08-16" }), txn({ id: 256, merchant: "Bolt", amount: 33.18, date: "2026-08-16" })]
  );
  assert.deepEqual(got.map((a) => a.from).sort(), [256, 259]);
  assert.ok(got.every((a) => a.into === 614));
});

test("a charge that will post next month, or another merchant, is left alone", () => {
  const lines = [line({ descriptor: "BLINK COMMERCE PVT LTDBANGALORE", amount: 1894, transaction_id: 564, created: false, txn_date: "2026-09-11" })];
  assert.deepEqual(findAbsorbed(lines, [txn({ id: 602, merchant: "Blinkit", amount: 2072, date: "2026-09-16" })]), []);
  assert.deepEqual(findAbsorbed([line({ descriptor: "SINGHAL FILLING STATION", amount: 1517.7 })], [txn({ merchant: "Swiggy", amount: 1500 })]), []);
  assert.deepEqual(findAbsorbed([line({ descriptor: "SINGHAL FILLING STATION", amount: 1517.7, created: false })], [txn({ merchant: "Singhal", amount: 1500 })]), []);
});
