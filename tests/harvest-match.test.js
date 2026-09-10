// tests/harvest-match.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { targetAmount, matchEmailsToLines, validateProposal } from "../lib/harvest-match.js";

const line = (over = {}) => ({
  id: "l1", line_no: 1, txn_date: "2026-08-12", descriptor: "UBER *TRIP",
  amount: 3738.33, currency: "EUR", amount_orig: 33.9,
  direction: "debit", type: "purchase", ...over,
});

const email = (over = {}) => ({
  messageId: "m1", date: "2026-08-12", amounts: [{ value: 33.9, currency: "EUR" }], ...over,
});

test("a foreign line is looked for in its own currency, not rupees", () => {
  assert.deepEqual(targetAmount(line()), { value: 33.9, currency: "EUR" });
});

test("a domestic line is looked for in rupees", () => {
  const t = targetAmount(line({ currency: "INR", amount_orig: null, amount: 1668 }));
  assert.deepEqual(t, { value: 1668, currency: "INR" });
});

test("a foreign line with no origin amount falls back to rupees", () => {
  const t = targetAmount(line({ amount_orig: null }));
  assert.deepEqual(t, { value: 3738.33, currency: "INR" });
});

test("fees, payments and credits are never chased for a receipt", () => {
  assert.equal(targetAmount(line({ type: "fee" })), null);
  assert.equal(targetAmount(line({ type: "payment", direction: "credit" })), null);
  assert.equal(targetAmount(line({ direction: "credit" })), null);
});

test("an exact amount inside the window links", () => {
  const r = matchEmailsToLines([line()], [email()]);
  assert.equal(r.links.length, 1);
  assert.deepEqual(
    { ...r.links[0] },
    { lineId: "l1", lineNo: 1, messageId: "m1", value: 33.9, currency: "EUR", dayDelta: 0 }
  );
  assert.equal(r.unmatchedLines.length, 0);
  assert.equal(r.unmatchedEmails.length, 0);
});

test("the window is asymmetric: a charge posts after the receipt, not long before", () => {
  // -1 through +3 inclusive.
  const days = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-15", "2026-08-16"];
  const got = days.map((d) => matchEmailsToLines([line()], [email({ date: d })]).links.length);
  assert.deepEqual(got, [0, 1, 1, 1, 0]);
});

test("the same amount in a different currency does not link", () => {
  const r = matchEmailsToLines([line()], [email({ amounts: [{ value: 33.9, currency: "CHF" }] })]);
  assert.equal(r.links.length, 0);
  assert.equal(r.unmatchedEmails.length, 1);
});

test("several emails may document one line", () => {
  // Saravanaa Bhavan: the restaurant bill and the card slip are both evidence.
  const r = matchEmailsToLines(
    [line()],
    [email({ messageId: "bill" }), email({ messageId: "slip" })]
  );
  assert.equal(r.links.length, 2);
  assert.deepEqual(r.links.map((l) => l.messageId).sort(), ["bill", "slip"]);
  assert.equal(r.unmatchedLines.length, 0);
});

test("one email against two candidate lines takes the nearer date", () => {
  // Two Bulldog Hotel charges at EUR 7.10 on consecutive days.
  const a = line({ id: "same-day", txn_date: "2026-08-12", amount_orig: 7.1 });
  const b = line({ id: "next-day", line_no: 2, txn_date: "2026-08-13", amount_orig: 7.1 });
  const r = matchEmailsToLines([a, b], [email({ date: "2026-08-12", amounts: [{ value: 7.1, currency: "EUR" }] })]);
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].lineId, "same-day");
  assert.equal(r.ambiguous.length, 0);
  assert.deepEqual(r.unmatchedLines.map((l) => l.id), ["next-day"]);
});

test("a genuine tie is held for a human, never guessed", () => {
  // Equidistant: one day before, one day after.
  const a = line({ id: "before", txn_date: "2026-08-11", amount_orig: 7.1 });
  const b = line({ id: "after", line_no: 2, txn_date: "2026-08-13", amount_orig: 7.1 });
  const r = matchEmailsToLines([a, b], [email({ date: "2026-08-12", amounts: [{ value: 7.1, currency: "EUR" }] })]);
  assert.equal(r.links.length, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].messageId, "m1");
  assert.deepEqual(r.ambiguous[0].lineIds.sort(), ["after", "before"]);
});

test("an email carrying many amounts matches on any one of them", () => {
  const r = matchEmailsToLines([line()], [email({
    amounts: [{ value: 30.4, currency: "EUR" }, { value: 3.5, currency: "EUR" }, { value: 33.9, currency: "EUR" }],
  })]);
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].value, 33.9);
});

test("rounding noise within a hundredth still matches", () => {
  const r = matchEmailsToLines([line()], [email({ amounts: [{ value: 33.900001, currency: "EUR" }] })]);
  assert.equal(r.links.length, 1);
});

test("a proposed split must sum to the line or it is refused", () => {
  const l = line({ currency: "INR", amount_orig: null, amount: 1668 });
  const good = validateProposal(l, [
    { messageId: "a", value: 555, currency: "INR" },
    { messageId: "b", value: 878, currency: "INR" },
    { messageId: "c", value: 235, currency: "INR" },
  ]);
  assert.equal(good.ok, true);
  assert.equal(good.sum, 1668);

  const bad = validateProposal(l, [
    { messageId: "a", value: 555, currency: "INR" },
    { messageId: "b", value: 878, currency: "INR" },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.delta, 235);
});

test("a split in the wrong currency is refused however well it adds up", () => {
  const l = line({ currency: "INR", amount_orig: null, amount: 1668 });
  const r = validateProposal(l, [{ messageId: "a", value: 1668, currency: "EUR" }]);
  assert.equal(r.ok, false);
});

test("tolerance is the larger of one rupee or half a percent", () => {
  const small = line({ currency: "INR", amount_orig: null, amount: 100 });
  assert.equal(validateProposal(small, [{ messageId: "a", value: 100.9, currency: "INR" }]).ok, true);
  assert.equal(validateProposal(small, [{ messageId: "a", value: 102, currency: "INR" }]).ok, false);

  const large = line({ currency: "INR", amount_orig: null, amount: 40000 });
  assert.equal(validateProposal(large, [{ messageId: "a", value: 40150, currency: "INR" }]).ok, true);
  assert.equal(validateProposal(large, [{ messageId: "a", value: 41000, currency: "INR" }]).ok, false);
});

test("an empty proposal is refused rather than treated as zero", () => {
  assert.equal(validateProposal(line(), []).ok, false);
});

test("the date window is safe across a year/month/leap boundary", () => {
  // A charge on the last day of December, receipt lands two days later in
  // January of the next year. Also exercise a leap-day crossing (Feb 29
  // 2028) to make sure day math is calendar-correct, not string math.
  const dec = line({ txn_date: "2026-12-31" });
  const jan = matchEmailsToLines([dec], [email({ date: "2027-01-02" })]);
  assert.equal(jan.links.length, 1);
  assert.equal(jan.links[0].dayDelta, 2);

  const leapIn = line({ txn_date: "2028-02-28" });
  const leap = matchEmailsToLines([leapIn], [email({ date: "2028-02-29" })]);
  assert.equal(leap.links.length, 1);
  assert.equal(leap.links[0].dayDelta, 1);

  const marAfterLeap = line({ txn_date: "2028-02-29" });
  const mar = matchEmailsToLines([marAfterLeap], [email({ date: "2028-03-01" })]);
  assert.equal(mar.links.length, 1);
  assert.equal(mar.links[0].dayDelta, 1);
});
