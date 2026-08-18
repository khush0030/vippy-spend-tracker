import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLine,
  normalizeStatementLine,
  sumByDirection,
  controlTotal,
} from "../lib/statement-lines.js";

describe("classifyLine", () => {
  test("an ordinary swipe is a purchase", () => {
    assert.equal(classifyLine({ descriptor: "SWIGGY BANGALORE IN", direction: "debit" }), "purchase");
  });

  test("HDFC's own fee lines are fees, not purchases", () => {
    const fees = [
      "ANNUAL MEMBERSHIP FEE",
      "LATE PAYMENT CHARGES",
      "FINANCE CHARGES",
      "INTEREST CHARGED",
      "CROSS CURRENCY MARKUP",
      "IGST @18% ON MARKUP",
      "CGST 9.00%",
      "CASH ADVANCE FEE",
      "OVER LIMIT CHARGE",
      "RENEWAL FEE",
    ];
    for (const d of fees) {
      assert.equal(classifyLine({ descriptor: d, direction: "debit" }), "fee", d);
    }
  });

  test("a merchant whose name merely contains a fee word is still a purchase", () => {
    // "FEEDBACK" and "INTERESTING" must not trip the fee regex.
    assert.equal(classifyLine({ descriptor: "FEEDBACK LABS PVT LTD", direction: "debit" }), "purchase");
    assert.equal(classifyLine({ descriptor: "INTERESTING TIMES CAFE", direction: "debit" }), "purchase");
  });

  test("a payment to the card is a payment, never a refund", () => {
    for (const d of [
      "PAYMENT RECEIVED - THANK YOU",
      "NEFT PAYMENT RECD",
      "AUTOPAY DEBIT RECEIVED",
      "PAYMENT - THANK YOU",
    ]) {
      assert.equal(classifyLine({ descriptor: d, direction: "credit" }), "payment", d);
    }
  });

  test("a credit from a merchant is a refund", () => {
    assert.equal(classifyLine({ descriptor: "AMAZON RETAIL REFUND", direction: "credit" }), "refund");
    assert.equal(classifyLine({ descriptor: "CROMA STORE 118", direction: "credit" }), "refund");
  });

  test("a dispute credit is a chargeback, not a merchant refund", () => {
    assert.equal(classifyLine({ descriptor: "CHARGEBACK PROVISIONAL CREDIT", direction: "credit" }), "chargeback");
    assert.equal(classifyLine({ descriptor: "DISPUTE RESOLUTION REVERSAL", direction: "credit" }), "chargeback");
  });

  test("a re-debited chargeback stays a chargeback", () => {
    assert.equal(classifyLine({ descriptor: "CHARGEBACK REVERSED - DISPUTE DECLINED", direction: "debit" }), "chargeback");
  });

  test("a fuel surcharge waiver is a credit, and a fee reversal not a refund", () => {
    assert.equal(classifyLine({ descriptor: "FUEL SURCHARGE WAIVER", direction: "credit" }), "fee");
  });
});

describe("normalizeStatementLine", () => {
  test("carries a debit through with a positive amount", () => {
    const line = normalizeStatementLine(
      { date: "2026-07-22", description: "SWIGGY  BANGALORE", amount: 1240.5, direction: "debit" },
      0
    );
    assert.equal(line.lineNo, 1);
    assert.equal(line.amount, 1240.5);
    assert.equal(line.direction, "debit");
    assert.equal(line.type, "purchase");
    assert.equal(line.descriptor, "SWIGGY BANGALORE");
  });

  test("reads direction from a signed amount when the parser gave none", () => {
    const line = normalizeStatementLine({ date: "2026-07-22", description: "REFUND", amount: -900 }, 3);
    assert.equal(line.direction, "credit");
    assert.equal(line.amount, 900);
  });

  test("trusts an explicit Cr marker over the sign", () => {
    const line = normalizeStatementLine(
      { date: "2026-07-22", description: "CROMA", amount: 4199, cr: true },
      0
    );
    assert.equal(line.direction, "credit");
    assert.equal(line.amount, 4199);
  });

  test("keeps the origin currency of a foreign line", () => {
    const line = normalizeStatementLine(
      {
        date: "2026-07-04",
        description: "HOTEL DU NORD PARIS FR",
        amount: 5921.4,
        direction: "debit",
        currency: "EUR",
        amountOriginal: 62.5,
      },
      1
    );
    assert.equal(line.currency, "EUR");
    assert.equal(line.amountOrig, 62.5);
    assert.equal(line.amount, 5921.4);
  });

  test("parses amounts written the way a statement prints them", () => {
    assert.equal(normalizeStatementLine({ amount: "1,58,204.00", direction: "debit" }, 0).amount, 158204);
    assert.equal(normalizeStatementLine({ amount: "4,199.00 Cr" }, 0).amount, 4199);
    assert.equal(normalizeStatementLine({ amount: "4,199.00 Cr" }, 0).direction, "credit");
  });

  test("post date falls back to the transaction date", () => {
    const line = normalizeStatementLine({ date: "2026-07-22", amount: 100, direction: "debit" }, 0);
    assert.equal(line.postDate, "2026-07-22");
  });
});

describe("sumByDirection", () => {
  const lines = [
    { amount: 1000, direction: "debit", type: "purchase" },
    { amount: 500, direction: "debit", type: "fee" },
    { amount: 300, direction: "credit", type: "refund" },
    { amount: 2000, direction: "credit", type: "payment" },
  ];

  test("keeps payments out of credits so the control total balances", () => {
    const s = sumByDirection(lines);
    assert.equal(s.debits, 1500);
    assert.equal(s.credits, 300);
    assert.equal(s.payments, 2000);
  });
});

describe("controlTotal", () => {
  test("ties out when the arithmetic reproduces the printed closing balance", () => {
    const r = controlTotal({ opening: 10000, debits: 25000, credits: 1000, payments: 10000, closing: 24000 });
    assert.equal(r.expected, 24000);
    assert.equal(r.diff, 0);
    assert.equal(r.tiesOut, true);
  });

  test("reports the shortfall to the rupee when it does not", () => {
    const r = controlTotal({ opening: 10000, debits: 25000, credits: 1000, payments: 10000, closing: 19801 });
    assert.equal(r.diff, 4199);
    assert.equal(r.tiesOut, false);
  });

  test("a missing closing balance can never tie out", () => {
    const r = controlTotal({ opening: 0, debits: 100, credits: 0, payments: 0, closing: null });
    assert.equal(r.tiesOut, false);
    assert.equal(r.diff, null);
  });

  test("absorbs float noise but not a real one-rupee gap", () => {
    assert.equal(controlTotal({ opening: 0.1, debits: 0.2, credits: 0, payments: 0, closing: 0.3 }).tiesOut, true);
    assert.equal(controlTotal({ opening: 0, debits: 100, credits: 0, payments: 0, closing: 99 }).tiesOut, false);
  });
});
