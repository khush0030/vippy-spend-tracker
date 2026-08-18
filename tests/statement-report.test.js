import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatReconReport, summarise, shortDate } from "../lib/statement-report.js";
import { reconcile } from "../lib/recon.js";
import { normalizeStatementLine } from "../lib/statement-lines.js";

describe("shortDate", () => {
  test("prints the way a person would say it", () => {
    assert.equal(shortDate("2026-08-18"), "18 Aug");
    assert.equal(shortDate(null), "");
  });
});

describe("formatReconReport", () => {
  const base = {
    issuedOn: "2026-08-18",
    submitDay: 23,
    daysToSubmit: 5,
    lineCount: 47,
    spend: 158204,
    tiesOut: true,
    diff: 0,
    tied: 41,
    created: [{ merchant: "INDIAN OIL PUNE", amount: 3000 }],
    refundsConfirmed: { count: 3, total: 6880 },
    refundsMissing: [{ merchant: "Croma", amount: 4199, ageDays: 41 }],
    fees: 3,
    chargebacks: 0,
    rolledForward: 0,
    coverage: { coveragePct: 91, missing: 2 },
  };

  test("leads with whether it ties out", () => {
    const out = formatReconReport(base);
    assert.match(out, /Statement received · 18 Aug/);
    assert.match(out, /47 lines · ₹1,58,204 · closing balance <b>ties out<\/b> ✅/);
  });

  test("names the refund that has not come back, with its age", () => {
    const out = formatReconReport(base);
    assert.match(out, /Croma · ₹4,199 · 41d/);
  });

  test("says plainly when the cycle is blocked", () => {
    const out = formatReconReport({ ...base, tiesOut: false, diff: -4199 });
    assert.match(out, /off by ₹4,199/);
    assert.match(out, /blocked from submission/);
  });

  test("stays quiet about buckets that are empty", () => {
    const out = formatReconReport({
      ...base,
      created: [],
      refundsMissing: [],
      refundsConfirmed: { count: 0, total: 0 },
      fees: 0,
      coverage: { coveragePct: 100, missing: 0 },
    });
    assert.doesNotMatch(out, /never saw/);
    assert.doesNotMatch(out, /still missing/);
    assert.doesNotMatch(out, /fee line/);
    assert.doesNotMatch(out, /need a receipt/);
    assert.match(out, /Coverage <b>100%<\/b>/);
  });

  test("escapes a merchant name that would otherwise break the markup", () => {
    const out = formatReconReport({
      ...base,
      created: [{ merchant: "Bits & <Bytes>", amount: 100 }],
    });
    assert.match(out, /Bits &amp; &lt;Bytes&gt;/);
    assert.doesNotMatch(out, /<Bytes>/);
  });

  test("counts days to the submission date, and handles the day itself", () => {
    assert.match(formatReconReport(base), /5 days to the 23rd/);
    assert.match(formatReconReport({ ...base, daysToSubmit: 1 }), /1 day to the 23rd/);
    assert.match(formatReconReport({ ...base, daysToSubmit: 0 }), /Submitting today/);
  });
});

describe("summarise", () => {
  test("turns a reconciliation into the numbers the message quotes", () => {
    const line = (o) => normalizeStatementLine(o, o.i ?? 0);
    const recon = reconcile({
      lines: [
        line({ i: 0, date: "2026-07-22", description: "SWIGGY", amount: 1000, direction: "debit" }),
        line({ i: 1, date: "2026-07-25", description: "ANNUAL FEE", amount: 500, direction: "debit" }),
        line({ i: 2, date: "2026-08-02", description: "AMAZON REFUND", amount: 300, direction: "credit" }),
      ],
      transactions: [
        { id: 1, merchant: "Swiggy", amount: 1000, date: "2026-07-22", is_refund: false, receipt_status: "attached" },
        { id: 2, merchant: "Amazon", amount: 300, date: "2026-07-28", is_refund: true },
      ],
      statement: { opening: 0, closing: 1200, periodStart: "2026-07-18", periodEnd: "2026-08-17" },
    });

    const s = summarise(recon, { issuedOn: "2026-08-18", daysToSubmit: 5 });
    assert.equal(s.tied, 1);
    assert.equal(s.fees, 1);
    assert.equal(s.refundsConfirmed.count, 1);
    assert.equal(s.refundsConfirmed.total, 300);
    assert.equal(s.tiesOut, true);
    assert.equal(s.coverage.coveragePct, 100);
  });
});
