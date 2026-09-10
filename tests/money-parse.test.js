import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAmounts } from "../lib/money-parse.js";

const one = (text) => {
  const found = extractAmounts(text);
  assert.equal(found.length, 1, `expected exactly one amount in ${JSON.stringify(text)}, got ${JSON.stringify(found)}`);
  return found[0];
};

test("symbol before the number", () => {
  assert.deepEqual({ ...one("Total €33.90") }, { value: 33.9, currency: "EUR", raw: "€33.90" });
  assert.equal(one("Paid ₹10,168.64 today").value, 10168.64);
  assert.equal(one("£30.99").currency, "GBP");
});

test("code before the number", () => {
  assert.equal(one("CHF 34.40").value, 34.4);
  assert.equal(one("CZK 1150.46").value, 1150.46);
  assert.equal(one("INR 5,093.22").value, 5093.22);
  assert.equal(one("USD 15.68").currency, "USD");
});

test("currency after the number", () => {
  assert.equal(one("1 473,50 Kč").value, 1473.5);
  assert.equal(one("1 473,50 Kč").currency, "CZK");
  assert.equal(one("48.46 EUR").value, 48.46);
});

test("European decimal comma", () => {
  // The rightmost separator is the decimal one.
  assert.equal(one("€ 630,91").value, 630.91);
  assert.equal(one("EUR 1.234,56").value, 1234.56);
});

test("Anglo decimal point with comma grouping", () => {
  assert.equal(one("₹10,168.64").value, 10168.64);
  assert.equal(one("$1,234.56").value, 1234.56);
});

test("three digits after a separator is grouping, not decimals", () => {
  // ₹1,234 is one thousand two hundred and thirty four, never 1.234
  assert.equal(one("₹1,234").value, 1234);
  assert.equal(one("EUR 1.234").value, 1234);
});

test("two digits after a separator is decimals", () => {
  assert.equal(one("EUR 12,50").value, 12.5);
  assert.equal(one("$12.50").value, 12.5);
});

test("Swiss apostrophe grouping", () => {
  assert.equal(one("CHF 1'234.56").value, 1234.56);
});

test("non-breaking and narrow spaces group digits", () => {
  assert.equal(one("EUR 1 234,56").value, 1234.56);
  assert.equal(one("EUR 1 234,56").value, 1234.56);
});

test("Rs and US$ variants normalise", () => {
  assert.equal(one("Rs. 1,694.07").currency, "INR");
  assert.equal(one("Rs 500").currency, "INR");
  assert.equal(one("US$53.22").currency, "USD");
});

test("a bare number with no currency is not an amount", () => {
  assert.deepEqual(extractAmounts("Order 8371693382 confirmed"), []);
  assert.deepEqual(extractAmounts("12 items, 3 boxes"), []);
});

test("adjacent amounts are all found and none swallows the next", () => {
  // A currency token trailing one amount must not be stolen from the next.
  const found = extractAmounts("Subtotal €15.00 EUR 20.00 total");
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.value), [15, 20]);
});

test("a real Uber receipt body", () => {
  const body = "Thanks for riding, Khush Total €33.90 Meter fare €30.40 Booking Fee €3.50 Visa ••••7634 €33.90";
  const values = extractAmounts(body).map((f) => f.value);
  assert.deepEqual(values, [33.9, 30.4, 3.5, 33.9]);
  assert.ok(extractAmounts(body).every((f) => f.currency === "EUR"));
});

test("a real HDFC line and a Czech receipt in one body", () => {
  const found = extractAmounts("Celková splatná částka 579,99 Kč charged as ₹2,645.08");
  assert.deepEqual(found.map((f) => [f.value, f.currency]), [[579.99, "CZK"], [2645.08, "INR"]]);
});

test("four or more digits after a separator is rejected, not guessed", () => {
  assert.deepEqual(extractAmounts("ref €1,23456"), []);
});

test("deduplicates an amount written with both symbol and code", () => {
  // "€33.90 EUR" is one amount, not two.
  assert.equal(extractAmounts("€33.90 EUR").length, 1);
});

test("a currency code inside an ordinary word is not a currency", () => {
  // "hours 30" must not read as Rs 30. Email bodies are full of prose with
  // numbers in it, and a false positive files the wrong document against a
  // real charge.
  assert.deepEqual(extractAmounts("Your order arrives in 2 hours 30 minutes"), []);
  assert.deepEqual(extractAmounts("Delivery includes 3 stopovers 15 minutes apart"), []);
  assert.deepEqual(extractAmounts("We have 4 towers 12 floors each"), []);
  assert.deepEqual(extractAmounts("Supports 25 users 10 seats"), []);
});

test("genuine currency tokens still match after boundary anchoring", () => {
  assert.equal(extractAmounts("Rs. 1,694.07")[0].currency, "INR");
  assert.equal(extractAmounts("Rs 500")[0].currency, "INR");
  assert.equal(extractAmounts("US$53.22")[0].currency, "USD");
  assert.equal(extractAmounts("Total CHF 34.40")[0].value, 34.4);
  assert.equal(extractAmounts("1 473,50 Kč")[0].currency, "CZK");
});
