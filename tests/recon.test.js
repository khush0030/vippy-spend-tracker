import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconcile, BUCKETS } from "../lib/recon.js";
import { normalizeStatementLine } from "../lib/statement-lines.js";

const line = (o) => normalizeStatementLine(o, (o.i ?? 0));
const txn = (o = {}) => ({
  id: o.id ?? 1,
  merchant: o.merchant ?? "Swiggy",
  amount: o.amount ?? 1240.5,
  date: o.date ?? "2026-07-22",
  is_refund: o.is_refund ?? false,
  receipt_status: o.receipt_status ?? "missing",
  category: o.category ?? "dining",
});

const statement = {
  opening: 0,
  closing: 0,
  periodStart: "2026-07-18",
  periodEnd: "2026-08-17",
};

describe("reconcile — every line lands in exactly one bucket", () => {
  test("a charge the app already knows about ties out", () => {
    const r = reconcile({
      lines: [line({ date: "2026-07-22", description: "SWIGGY BANGALORE IN", amount: 1240.5, direction: "debit" })],
      transactions: [txn()],
      statement,
    });

    assert.equal(r.tied.length, 1);
    assert.equal(r.tied[0].transaction.id, 1);
    assert.equal(r.tied[0].line.recon_status, "tied");
    assert.equal(r.createdFromStatement.length, 0);
  });

  test("posting a day or two after the alert still ties out", () => {
    const r = reconcile({
      lines: [line({ date: "2026-07-24", description: "SWIGGY BANGALORE IN", amount: 1240.5, direction: "debit" })],
      transactions: [txn({ date: "2026-07-22" })],
      statement,
    });
    assert.equal(r.tied.length, 1);
  });

  test("a charge the app never saw is created from the statement", () => {
    const r = reconcile({
      lines: [line({ date: "2026-07-30", description: "INDIAN OIL PETROL PUNE", amount: 3000, direction: "debit" })],
      transactions: [],
      statement,
    });

    assert.equal(r.createdFromStatement.length, 1);
    assert.equal(r.createdFromStatement[0].line.recon_status, "created");
    assert.equal(r.createdFromStatement[0].transaction.merchant, "INDIAN OIL PETROL PUNE");
    assert.equal(r.createdFromStatement[0].transaction.amount, 3000);
    assert.equal(r.createdFromStatement[0].transaction.is_refund, false);
  });

  test("two identical charges on the same day each claim their own line", () => {
    const r = reconcile({
      lines: [
        line({ i: 0, date: "2026-07-22", description: "STARBUCKS MUMBAI", amount: 480, direction: "debit" }),
        line({ i: 1, date: "2026-07-22", description: "STARBUCKS MUMBAI", amount: 480, direction: "debit" }),
      ],
      transactions: [
        txn({ id: 1, merchant: "Starbucks", amount: 480 }),
        txn({ id: 2, merchant: "Starbucks", amount: 480 }),
      ],
      statement,
    });

    assert.equal(r.tied.length, 2);
    assert.notEqual(r.tied[0].transaction.id, r.tied[1].transaction.id);
  });

  test("a charge in the app but not on the statement rolls forward, it is not deleted", () => {
    const r = reconcile({
      lines: [],
      transactions: [txn({ id: 7, merchant: "Hotel Pre-Auth", amount: 15000, date: "2026-08-16" })],
      statement,
    });

    assert.equal(r.rolledForward.length, 1);
    assert.equal(r.rolledForward[0].id, 7);
    assert.equal(r.createdFromStatement.length, 0);
  });

  test("only charges inside the statement period are judged against it", () => {
    const r = reconcile({
      lines: [],
      transactions: [txn({ id: 9, date: "2026-06-02" })],
      statement,
    });
    assert.equal(r.rolledForward.length, 0);
    assert.equal(r.outOfPeriod.length, 1);
  });
});

describe("reconcile — refunds, the ones that quietly get lost", () => {
  test("a credit that matches an expected refund confirms it received", () => {
    const r = reconcile({
      lines: [line({ date: "2026-08-02", description: "AMAZON RETAIL REFUND", amount: 2199, direction: "credit" })],
      transactions: [txn({ id: 4, merchant: "Amazon", amount: 2199, date: "2026-07-25", is_refund: true })],
      statement,
    });

    assert.equal(r.refundsConfirmed.length, 1);
    assert.equal(r.refundsConfirmed[0].transaction.id, 4);
    assert.equal(r.tied.length, 0, "a refund is reported as a refund, not as a tied purchase");
  });

  test("a refund the app expected but the bank never credited is escalated with its age", () => {
    const r = reconcile({
      lines: [],
      transactions: [txn({ id: 5, merchant: "Croma", amount: 4199, date: "2026-07-08", is_refund: true })],
      statement,
      asOf: "2026-08-18",
    });

    assert.equal(r.refundsMissing.length, 1);
    assert.equal(r.refundsMissing[0].transaction.id, 5);
    assert.equal(r.refundsMissing[0].ageDays, 41);
    assert.equal(r.rolledForward.length, 0, "a missing refund is not a roll-forward");
  });

  test("a credit with nothing expecting it is still recorded, never dropped", () => {
    const r = reconcile({
      lines: [line({ date: "2026-08-02", description: "SOME MERCHANT REVERSAL", amount: 800, direction: "credit" })],
      transactions: [],
      statement,
    });

    assert.equal(r.refundsConfirmed.length, 0);
    assert.equal(r.createdFromStatement.length, 1);
    assert.equal(r.createdFromStatement[0].transaction.is_refund, true);
  });
});

describe("reconcile — fees, payments and disputes", () => {
  test("fee lines become waived transactions and are never chased", () => {
    const r = reconcile({
      lines: [line({ date: "2026-08-01", description: "CROSS CURRENCY MARKUP", amount: 210.5, direction: "debit" })],
      transactions: [],
      statement,
    });

    assert.equal(r.fees.length, 1);
    assert.equal(r.fees[0].transaction.category, "fee");
    assert.equal(r.fees[0].transaction.receipt_status, "waived");
    assert.equal(r.createdFromStatement.length, 0, "a fee is not a charge to chase");
  });

  test("a payment to the card creates nothing — it is not a spend", () => {
    const r = reconcile({
      lines: [line({ date: "2026-08-05", description: "PAYMENT RECEIVED - THANK YOU", amount: 158204, direction: "credit" })],
      transactions: [],
      statement,
    });

    assert.equal(r.payments.length, 1);
    assert.equal(r.payments[0].line.recon_status, "orphan");
    assert.equal(r.createdFromStatement.length, 0);
    assert.equal(r.refundsConfirmed.length, 0);
  });

  test("a provisional dispute credit is tracked apart from a settled refund", () => {
    const r = reconcile({
      lines: [line({ date: "2026-08-05", description: "CHARGEBACK PROVISIONAL CREDIT", amount: 9800, direction: "credit" })],
      transactions: [],
      statement,
    });

    assert.equal(r.chargebacks.length, 1);
    assert.equal(r.refundsConfirmed.length, 0);
    assert.equal(r.createdFromStatement.length, 0);
  });
});

describe("reconcile — the control total", () => {
  test("reproduces the statement's own closing balance", () => {
    const r = reconcile({
      lines: [
        line({ i: 0, date: "2026-07-22", description: "SWIGGY", amount: 1000, direction: "debit" }),
        line({ i: 1, date: "2026-07-25", description: "ANNUAL FEE", amount: 500, direction: "debit" }),
        line({ i: 2, date: "2026-08-02", description: "AMAZON REFUND", amount: 300, direction: "credit" }),
        line({ i: 3, date: "2026-08-05", description: "PAYMENT RECEIVED - THANK YOU", amount: 2000, direction: "credit" }),
      ],
      transactions: [],
      statement: { ...statement, opening: 10000, closing: 9200 },
    });

    assert.equal(r.totals.debits, 1500);
    assert.equal(r.totals.credits, 300);
    assert.equal(r.totals.payments, 2000);
    assert.equal(r.control.tiesOut, true);
    assert.equal(r.control.diff, 0);
  });

  test("a gap blocks the cycle and is stated to the rupee", () => {
    const r = reconcile({
      lines: [line({ date: "2026-07-22", description: "SWIGGY", amount: 1000, direction: "debit" })],
      transactions: [],
      statement: { ...statement, opening: 0, closing: 4199 },
    });

    assert.equal(r.control.tiesOut, false);
    assert.equal(r.control.diff, -3199);
    assert.equal(r.blocked, true);
  });
});

describe("reconcile — coverage against the bank, not against our guess", () => {
  test("counts receipts over the statement's own charge lines", () => {
    const r = reconcile({
      lines: [
        line({ i: 0, date: "2026-07-22", description: "SWIGGY", amount: 1000, direction: "debit" }),
        line({ i: 1, date: "2026-07-23", description: "UBER", amount: 2000, direction: "debit" }),
        line({ i: 2, date: "2026-07-24", description: "CHAI STALL", amount: 60, direction: "debit" }),
        line({ i: 3, date: "2026-07-25", description: "ANNUAL FEE", amount: 500, direction: "debit" }),
      ],
      transactions: [
        txn({ id: 1, merchant: "Swiggy", amount: 1000, date: "2026-07-22", receipt_status: "attached" }),
        txn({ id: 2, merchant: "Uber", amount: 2000, date: "2026-07-23" }),
      ],
      statement,
      minReceiptAmount: 500,
    });

    // Chaseable: Swiggy + Uber. The ₹60 chai is below the threshold and the fee
    // is never chased, so neither may drag coverage down.
    assert.equal(r.coverage.chaseable, 2);
    assert.equal(r.coverage.withReceipt, 1);
    assert.equal(r.coverage.coveragePct, 50);
  });

  test("every line is accounted for exactly once", () => {
    const lines = [
      line({ i: 0, date: "2026-07-22", description: "SWIGGY", amount: 1000, direction: "debit" }),
      line({ i: 1, date: "2026-07-25", description: "ANNUAL FEE", amount: 500, direction: "debit" }),
      line({ i: 2, date: "2026-08-02", description: "AMAZON REFUND", amount: 300, direction: "credit" }),
      line({ i: 3, date: "2026-08-05", description: "PAYMENT RECEIVED", amount: 2000, direction: "credit" }),
      line({ i: 4, date: "2026-08-06", description: "DISPUTE CREDIT", amount: 50, direction: "credit" }),
    ];
    const r = reconcile({ lines, transactions: [], statement });

    const claimed = BUCKETS.flatMap((b) => r[b] || [])
      .map((e) => e.line?.line_no)
      .filter((n) => n != null);

    assert.equal(claimed.length, lines.length);
    assert.equal(new Set(claimed).size, lines.length);
    assert.equal(r.unexplained.length, 0);
  });
});
