import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPings, pingText, INR } from "../lib/ping-plan.js";

const t = (id, over = {}) => ({
  id, merchant: "Swiggy", amount: 1372, date: "2026-09-14", txn_time: "19:42",
  is_refund: false, receipt_status: "missing", ...over,
});

test("every missing charge is pinged, however small — nothing is waived", () => {
  const out = selectPings({
    transactions: [t(1, { amount: 50 }), t(2, { amount: 5000 })],
    pinged: new Set(), recurring: new Set(), pausedUntil: null, today: "2026-09-15",
  });
  assert.deepEqual(out.map((x) => x.id), [2, 1]);
});

test("refunds, attached, declared and already-pinged charges are skipped", () => {
  const out = selectPings({
    transactions: [
      t(1, { is_refund: true }),
      t(2, { receipt_status: "attached" }),
      t(3, { receipt_status: "declared" }),
      t(4),
      t(5),
    ],
    pinged: new Set([4]), recurring: new Set(), pausedUntil: null, today: "2026-09-15",
  });
  assert.deepEqual(out.map((x) => x.id), [5]);
});

test("a recurring merchant is still pinged", () => {
  const out = selectPings({
    transactions: [t(1, { merchant: "Netflix" })],
    pinged: new Set(), recurring: new Set(["Netflix"]), pausedUntil: null, today: "2026-09-15",
  });
  assert.equal(out.length, 1);
});

test("pings pause until the date given, inclusive", () => {
  const args = { transactions: [t(1)], pinged: new Set(), recurring: new Set() };
  assert.equal(selectPings({ ...args, pausedUntil: "2026-09-15", today: "2026-09-15" }).length, 0);
  assert.equal(selectPings({ ...args, pausedUntil: "2026-09-14", today: "2026-09-15" }).length, 1);
});

test("at most five per tick, newest first", () => {
  const txns = Array.from({ length: 8 }, (_, i) => t(i + 1, { date: `2026-09-0${i + 1}` }));
  const out = selectPings({ transactions: txns, pinged: new Set(), recurring: new Set(), pausedUntil: null, today: "2026-09-15" });
  assert.deepEqual(out.map((x) => x.id), [8, 7, 6, 5, 4]);
});

test("rupees are grouped the Indian way", () => {
  assert.equal(INR(1372), "₹1,372");
  assert.equal(INR(123456), "₹1,23,456");
  assert.equal(INR(9066.95), "₹9,066.95");
});

test("the ping names the charge and offers no-bill, subscription and later", () => {
  const { text, keyboard } = pingText(t(7), { recurring: new Set() });
  assert.match(text, /₹1,372/);
  assert.match(text, /Swiggy/);
  assert.match(text, /14 Sep 19:42/);
  assert.deepEqual(keyboard.flat().map((b) => b.callback_data), ["nb:7", "sub:7", "later:7"]);
});

test("a recurring merchant gets the emailed-invoice wording and no subscription button", () => {
  const { text, keyboard } = pingText(t(7, { merchant: "Netflix" }), { recurring: new Set(["Netflix"]) });
  assert.match(text, /harvester/i);
  assert.deepEqual(keyboard.flat().map((b) => b.callback_data), ["nb:7", "later:7"]);
});

test("merchant names are HTML-escaped", () => {
  const { text } = pingText(t(7, { merchant: "Kara <K&Y>" }), { recurring: new Set() });
  assert.match(text, /Kara &lt;K&amp;Y&gt;/);
});
