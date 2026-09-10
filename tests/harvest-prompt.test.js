import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseProposals } from "../lib/harvest-prompt.js";

const line = { id: "l7", line_no: 7, txn_date: "2026-07-17", descriptor: "AMAZON PAY INDIA",
  amount: 1668, currency: "INR", amount_orig: null, direction: "debit", type: "purchase" };

const email = { messageId: "e1", date: "2026-07-17", from: "Amazon", subject: "Order shipped",
  amounts: [{ value: 555, currency: "INR" }], excerpt: "Your order total ₹555" };

test("the prompt states both sides and the currency to work in", () => {
  const p = buildPrompt([line], [email]);
  assert.match(p, /AMAZON PAY INDIA/);
  assert.match(p, /1668/);
  assert.match(p, /INR/);
  assert.match(p, /e1/);
});

test("the prompt says splits must add up", () => {
  // The model is told the rule it will be judged by, which improves compliance
  // even though compliance is verified independently afterwards.
  assert.match(buildPrompt([line], [email]), /sum|add up|exactly/i);
});

test("clean JSON parses", () => {
  const raw = '{"proposals":[{"lineNo":7,"parts":[{"messageId":"e1","value":555,"currency":"INR"}]}]}';
  assert.deepEqual(parseProposals(raw), [
    { lineNo: 7, parts: [{ messageId: "e1", value: 555, currency: "INR" }] },
  ]);
});

test("JSON wrapped in a fence or in chat parses", () => {
  const raw = 'Sure!\n```json\n{"proposals":[{"lineNo":7,"parts":[]}]}\n```\nHope that helps.';
  assert.deepEqual(parseProposals(raw), [{ lineNo: 7, parts: [] }]);
});

test("unparseable output yields nothing rather than throwing", () => {
  // A model outage must leave the exact matches intact, not crash the sweep.
  assert.deepEqual(parseProposals("I could not determine any matches."), []);
  assert.deepEqual(parseProposals(""), []);
  assert.deepEqual(parseProposals(null), []);
});

test("malformed proposals are dropped individually", () => {
  const raw = '{"proposals":[{"lineNo":7,"parts":[{"messageId":"e1","value":555,"currency":"INR"}]},{"noLineNo":true},{"lineNo":"x","parts":[]}]}';
  const got = parseProposals(raw);
  assert.equal(got.length, 1);
  assert.equal(got[0].lineNo, 7);
});
