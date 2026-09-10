import { test } from "node:test";
import assert from "node:assert/strict";
import { searchWindow, candidateFrom } from "../lib/harvest-plan.js";

test("the search window overhangs the cycle at both ends", () => {
  // Two days early because a receipt precedes its charge; five days late
  // because an invoice can arrive after the statement closes.
  const w = searchWindow({ cycle_start: "2026-07-17", cycle_end: "2026-08-16" });
  assert.deepEqual(w, { after: "2026-07-15", before: "2026-08-21" });
});

test("the window survives a month boundary", () => {
  const w = searchWindow({ cycle_start: "2026-03-01", cycle_end: "2026-03-31" });
  assert.deepEqual(w, { after: "2026-02-27", before: "2026-04-05" });
});

test("a candidate carries amounts from the plain text body", () => {
  const c = candidateFrom({
    messageId: "m1", date: "2026-08-12", subject: "trip", from: "uber",
    text: "Total €33.90 fare €30.40", html: "", attachments: [],
  });
  assert.equal(c.messageId, "m1");
  assert.deepEqual(c.amounts.map((a) => a.value), [33.9, 30.4]);
});

test("html is read when there is no plain text", () => {
  const c = candidateFrom({
    messageId: "m2", date: "2026-08-12", subject: "s", from: "f",
    text: "", html: "<p>Total <b>CHF 34.40</b></p>", attachments: [],
  });
  assert.deepEqual(c.amounts, [{ value: 34.4, currency: "CHF", raw: "CHF 34.40" }]);
});

test("the subject line is searched too", () => {
  // "Your order of ₹1,668.00 has shipped" — sometimes the only place it appears.
  const c = candidateFrom({
    messageId: "m3", date: "2026-07-17", subject: "Your order of ₹1,668.00 has shipped",
    from: "amazon", text: "Thanks!", html: "", attachments: [],
  });
  assert.deepEqual(c.amounts.map((a) => a.value), [1668]);
});

test("duplicate amounts are collapsed", () => {
  // Receipts repeat the total in a summary block; it is one amount, not three.
  const c = candidateFrom({
    messageId: "m4", date: "2026-08-12", subject: "", from: "",
    text: "Total €33.90 ... paid €33.90 ... €33.90", html: "", attachments: [],
  });
  assert.equal(c.amounts.length, 1);
});

test("a message with no date yields no candidate", () => {
  assert.equal(candidateFrom({ messageId: "m5", date: null, text: "€10.00" }), null);
});
