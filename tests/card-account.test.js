import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateCardConfig, parseEmailList } from "../lib/card-account.js";

const ok = (input) => {
  const r = validateCardConfig(input);
  assert.deepEqual(r.errors, [], `unexpected errors: ${r.errors.join(", ")}`);
  return r.value;
};

describe("parseEmailList", () => {
  test("accepts the ways a person actually types a list", () => {
    assert.deepEqual(parseEmailList("a@x.com, b@x.com"), ["a@x.com", "b@x.com"]);
    assert.deepEqual(parseEmailList("a@x.com\nb@x.com;c@x.com"), ["a@x.com", "b@x.com", "c@x.com"]);
    assert.deepEqual(parseEmailList(["  a@x.com "]), ["a@x.com"]);
  });

  test("drops blanks and duplicates, keeping order", () => {
    assert.deepEqual(parseEmailList("a@x.com,,a@x.com, b@x.com"), ["a@x.com", "b@x.com"]);
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(parseEmailList(null), []);
    assert.deepEqual(parseEmailList("   "), []);
  });
});

describe("validateCardConfig", () => {
  test("fills the defaults the card was designed around", () => {
    const v = ok({});
    assert.equal(v.statement_day, 18);
    assert.equal(v.submit_day, 23);
    assert.equal(v.min_receipt_amount, 500);
    assert.equal(v.entity_name, "VIP Industries Limited");
    assert.deepEqual(v.accounts_email, []);
  });

  test("keeps only the last four digits of a card number", () => {
    assert.equal(ok({ last4: "4417" }).last4, "4417");
    assert.equal(ok({ last4: "XXXX XXXX XXXX 4417" }).last4, "4417");
    assert.equal(ok({ last4: "" }).last4, null);
  });

  test("rejects a statement day that cannot exist", () => {
    assert.match(validateCardConfig({ statement_day: 0 }).errors[0], /statement day/i);
    assert.match(validateCardConfig({ statement_day: 32 }).errors[0], /statement day/i);
    assert.deepEqual(validateCardConfig({ statement_day: 31, submit_day: 5 }).errors, []);
  });

  test("refuses to build the package the same day the statement lands", () => {
    const r = validateCardConfig({ statement_day: 18, submit_day: 18 });
    assert.match(r.errors.join(" "), /same day/i);
  });

  test("allows a submit day earlier in the month than the statement day", () => {
    // Statement on the 31st, package on the 5th of the following month is a
    // perfectly ordinary arrangement — the cycle lookup is by date, not by
    // month arithmetic.
    assert.deepEqual(validateCardConfig({ statement_day: 31, submit_day: 5 }).errors, []);
  });

  test("rejects an address that is not one", () => {
    const r = validateCardConfig({ accounts_email: "accounts@vip.com, not-an-email" });
    assert.match(r.errors.join(" "), /not-an-email/);
  });

  test("a negative threshold would waive everything, so it is refused", () => {
    assert.match(validateCardConfig({ min_receipt_amount: -1 }).errors.join(" "), /threshold/i);
  });

  test("passes the forex constants through as numbers", () => {
    const v = ok({ forex_markup_pct: "3.5", forex_gst_pct: "18" });
    assert.equal(v.forex_markup_pct, 3.5);
    assert.equal(v.forex_gst_pct, 18);
  });

  test("never carries the password into the update payload", () => {
    const v = ok({ statement_password: "VIPI4417" });
    assert.equal("statement_password" in v, false);
  });

  test("reports every problem at once rather than one per save", () => {
    const r = validateCardConfig({ statement_day: 40, min_receipt_amount: -5, accounts_email: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 3);
  });
});
