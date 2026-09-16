// tests/chat-confirm.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleConfirms } from "../lib/chat-confirm.js";

const m = (ref, txn) => ({ kind: "match_receipt", summary: `File ${ref} against #${txn}`, payload: { receipt_id: ref, transaction_ids: [txn] } });

test("nothing proposed is nothing to confirm", () => {
  assert.equal(bundleConfirms([]), null);
});

test("a single proposal stays as it is", () => {
  assert.deepEqual(bundleConfirms([m("a", 1)]), m("a", 1));
});

test("several proposals become one batch, one line each", () => {
  const b = bundleConfirms([m("a", 563), m("b", 566), m("c", 589)]);
  assert.equal(b.kind, "batch");
  assert.equal(b.payload.items.length, 3);
  assert.equal(b.summary, "1. File a against #563\n2. File b against #566\n3. File c against #589");
});

test("a second copy of a receipt aimed at a charge already in the batch is dropped", () => {
  const b = bundleConfirms([m("kara1", 579), m("shree1", 589), m("kara2", 579), m("shree2", 589), m("kara1", 579)]);
  assert.deepEqual(b.payload.items.map((i) => i.payload.receipt_id), ["kara1", "shree1"]);
});

test("identical non-receipt proposals collapse, and a batch is capped", () => {
  const s = { kind: "snooze_pings", summary: "Pause", payload: { until_date: "2026-09-20" } };
  assert.deepEqual(bundleConfirms([s, s]), s);
  assert.equal(bundleConfirms(Array.from({ length: 15 }, (_, i) => m(`r${i}`, i + 1))).payload.items.length, 10);
});
