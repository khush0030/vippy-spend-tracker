import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMerchant,
  merchantSimilarity,
  dayDiff,
  scoreCandidate,
  decide,
  expectedInrBand,
} from "../lib/matcher.js";

const txn = (o = {}) => ({
  id: 1,
  amount: 3400,
  date: "2026-08-12",
  merchant: "Indian Oil",
  txn_time: "18:42",
  receipt_status: "missing",
  ...o,
});

const receipt = (o = {}) => ({
  amount: 3400,
  currency: "INR",
  receipt_date: "2026-08-12",
  receipt_time: "18:42",
  merchant: "Indian Oil Corporation",
  merchant_raw: "IOCL RETAIL OUTLET, ANDHERI E",
  card_last4: null,
  country: "IN",
  ...o,
});

describe("normalizeMerchant", () => {
  test("strips case, punctuation and spacing", () => {
    assert.equal(normalizeMerchant("AMAZONIN"), "amazonin");
    assert.equal(normalizeMerchant("Amazon.in"), "amazonin");
    assert.equal(normalizeMerchant("  Amazon  In "), "amazonin");
  });

  test("handles null and undefined", () => {
    assert.equal(normalizeMerchant(null), "");
    assert.equal(normalizeMerchant(undefined), "");
  });
});

describe("merchantSimilarity", () => {
  test("identical after normalisation scores 1", () => {
    assert.equal(merchantSimilarity("Amazon.in", "AMAZONIN"), 1);
  });

  test("containment scores high but below exact", () => {
    const s = merchantSimilarity("Indian Oil", "INDIAN OIL CORPORATION LTD");
    assert.ok(s >= 0.8 && s < 1, `expected 0.8..1, got ${s}`);
  });

  test("unrelated merchants score low", () => {
    assert.ok(merchantSimilarity("Indian Oil", "Taj Hotels") < 0.3);
  });

  test("empty input scores 0 rather than throwing", () => {
    assert.equal(merchantSimilarity("", "Amazon"), 0);
    assert.equal(merchantSimilarity(null, null), 0);
  });

  test("partial overlap on a real HDFC descriptor", () => {
    // The bank descriptor is noisy; the receipt name is clean.
    const s = merchantSimilarity("SOCIAL OFFLINE", "Social Offline Bandra");
    assert.ok(s > 0.5, `expected >0.5, got ${s}`);
  });
});

describe("dayDiff", () => {
  test("same day is 0", () => {
    assert.equal(dayDiff("2026-08-12", "2026-08-12"), 0);
  });

  test("is signed: positive when first is later", () => {
    assert.equal(dayDiff("2026-08-14", "2026-08-12"), 2);
    assert.equal(dayDiff("2026-08-12", "2026-08-14"), -2);
  });

  test("crosses month boundaries", () => {
    assert.equal(dayDiff("2026-09-01", "2026-08-30"), 2);
  });
});

describe("scoreCandidate — domestic", () => {
  test("a strong match scores well into auto-link territory", () => {
    // 100 is unreachable here by design: no card tail is configured (-10) and
    // the receipt name differs from the bank descriptor, so merchant is ~0.87
    // rather than 1.0. Comfortably above the 75 auto threshold is what matters.
    const { score } = scoreCandidate(receipt(), txn());
    assert.ok(score >= 85, `expected >=85, got ${score}`);
  });

  test("everything aligned, including the card tail, approaches 100", () => {
    const { score } = scoreCandidate(
      receipt({ merchant: "Indian Oil", card_last4: "4821" }),
      txn(),
      { cardLast4: "4821" }
    );
    assert.equal(score, 100);
  });

  test("exact amount earns full amount points", () => {
    const { breakdown } = scoreCandidate(receipt(), txn());
    assert.equal(breakdown.amount, 40);
  });

  test("amount within 0.5% earns reduced points", () => {
    const { breakdown } = scoreCandidate(receipt({ amount: 3410 }), txn());
    assert.ok(breakdown.amount > 0 && breakdown.amount < 40);
  });

  test("amount off by more than 5% disqualifies the candidate", () => {
    const { score, disqualified } = scoreCandidate(receipt({ amount: 5000 }), txn());
    assert.equal(disqualified, true);
    assert.equal(score, 0);
  });

  test("a tip pushes the charge above the bill but stays matchable", () => {
    // Bill 2000, card charged 2200 (10% tip) — outside the band, disqualified.
    const far = scoreCandidate(receipt({ amount: 2000 }), txn({ amount: 2200 }));
    assert.equal(far.disqualified, true);
    // Bill 2000, card charged 2040 (2%) — still in band.
    const near = scoreCandidate(receipt({ amount: 2000 }), txn({ amount: 2040 }));
    assert.equal(near.disqualified, false);
    assert.ok(near.breakdown.amount > 0);
  });

  test("date scoring decays with distance", () => {
    const same = scoreCandidate(receipt(), txn()).breakdown.date;
    const one = scoreCandidate(receipt({ receipt_date: "2026-08-11" }), txn()).breakdown.date;
    const three = scoreCandidate(receipt({ receipt_date: "2026-08-09" }), txn()).breakdown.date;
    assert.equal(same, 25);
    assert.ok(one < same && three < one);
  });

  test("date beyond the window disqualifies", () => {
    const { disqualified } = scoreCandidate(receipt({ receipt_date: "2026-07-01" }), txn());
    assert.equal(disqualified, true);
  });

  test("matching card last 4 adds points", () => {
    const without = scoreCandidate(receipt(), txn()).score;
    const with4 = scoreCandidate(receipt({ card_last4: "4821" }), txn(), {
      cardLast4: "4821",
    }).score;
    assert.equal(with4 - without, 10);
  });

  test("a mismatched card tail does not earn points", () => {
    const { breakdown } = scoreCandidate(receipt({ card_last4: "1111" }), txn(), {
      cardLast4: "4821",
    });
    assert.equal(breakdown.cardLast4, 0);
  });

  test("a transaction that already has a receipt is penalised", () => {
    const clean = scoreCandidate(receipt(), txn()).score;
    const taken = scoreCandidate(receipt(), txn({ receipt_status: "attached" })).score;
    assert.equal(clean - taken, 30);
  });
});

describe("expectedInrBand — foreign charges", () => {
  test("band spans the markup, low end is the raw conversion", () => {
    const band = expectedInrBand({ amount: 48.5, fxRate: 94.1 });
    assert.ok(Math.abs(band.low - 48.5 * 94.1) < 0.01);
    assert.ok(band.high > band.low);
  });

  test("markup band covers roughly 6% by default", () => {
    const band = expectedInrBand({ amount: 100, fxRate: 100 });
    assert.ok(band.high >= 10500 && band.high <= 10700, `got ${band.high}`);
  });

  test("a real HDFC posting falls inside the band", () => {
    // EUR 48.50 at ECB 94.10 posted as INR 4751 (+4.1%).
    const band = expectedInrBand({ amount: 48.5, fxRate: 94.1 });
    assert.ok(4751 >= band.low && 4751 <= band.high);
  });
});

describe("scoreCandidate — foreign", () => {
  const eurReceipt = (o = {}) =>
    receipt({
      amount: 48.5,
      currency: "EUR",
      country: "PT",
      receipt_date: "2026-06-12",
      merchant: "Cervejaria Ramiro",
      merchant_raw: "CERVEJARIA RAMIRO LISBOA",
      fx_rate: 94.1,
      ...o,
    });

  const eurTxn = (o = {}) =>
    txn({
      amount: 4751,
      date: "2026-06-14", // settlement lag
      merchant: "CERVEJARIA RAMIRO LISBOA PT",
      txn_time: null,
      ...o,
    });

  test("matches despite the amount never being equal", () => {
    const { score, disqualified } = scoreCandidate(eurReceipt(), eurTxn());
    assert.equal(disqualified, false);
    assert.ok(score >= 45, `expected >=45, got ${score}`);
  });

  test("uses the foreign weighting, not the domestic one", () => {
    const { breakdown, weights } = scoreCandidate(eurReceipt(), eurTxn());
    assert.equal(weights.amount, 30);
    assert.equal(weights.merchant, 25);
    assert.ok(breakdown.country > 0);
  });

  test("accepts posting up to five days later but not before the purchase", () => {
    const late = scoreCandidate(eurReceipt(), eurTxn({ date: "2026-06-17" }));
    assert.equal(late.disqualified, false);
    const early = scoreCandidate(eurReceipt(), eurTxn({ date: "2026-06-09" }));
    assert.equal(early.disqualified, true);
  });

  test("an INR amount far outside the markup band disqualifies", () => {
    const { disqualified } = scoreCandidate(eurReceipt(), eurTxn({ amount: 9000 }));
    assert.equal(disqualified, true);
  });

  test("a DCC receipt matches exactly on the INR amount", () => {
    const r = eurReceipt({ dcc_amount_inr: 4900 });
    const { breakdown } = scoreCandidate(r, eurTxn({ amount: 4900 }));
    assert.equal(breakdown.amount, 30, "DCC should earn full foreign amount points");
  });

  test("without an fx rate it defers rather than guessing", () => {
    const { disqualified, reason } = scoreCandidate(
      eurReceipt({ fx_rate: null }),
      eurTxn()
    );
    assert.equal(disqualified, true);
    assert.match(reason, /fx/i);
  });
});

describe("decide", () => {
  const scored = (arr) => arr.map((s, i) => ({ transaction_id: i + 1, score: s }));

  test("auto-links a clear winner", () => {
    const d = decide(scored([88, 40]));
    assert.equal(d.action, "auto");
    assert.equal(d.best.transaction_id, 1);
  });

  test("asks when two candidates are close", () => {
    const d = decide(scored([88, 80]));
    assert.equal(d.action, "ask");
  });

  test("asks when the best is decent but not conclusive", () => {
    assert.equal(decide(scored([60])).action, "ask");
  });

  test("defers when nothing is plausible", () => {
    assert.equal(decide(scored([30, 20])).action, "defer");
    assert.equal(decide([]).action, "defer");
  });

  test("foreign receipts need a higher bar to auto-link", () => {
    const d = decide(scored([78, 40]), { foreign: true });
    assert.equal(d.action, "ask", "78 should not auto-link a foreign receipt");
    assert.equal(decide(scored([85, 40]), { foreign: true }).action, "auto");
  });

  test("offers at most three options when asking", () => {
    const d = decide(scored([70, 68, 66, 64, 62]));
    assert.equal(d.action, "ask");
    assert.equal(d.candidates.length, 3);
  });

  test("candidates come back sorted best first", () => {
    const d = decide([
      { transaction_id: 1, score: 50 },
      { transaction_id: 2, score: 70 },
      { transaction_id: 3, score: 60 },
    ]);
    assert.deepEqual(
      d.candidates.map((c) => c.transaction_id),
      [2, 3, 1]
    );
  });

  test("ignores disqualified candidates entirely", () => {
    const d = decide([
      { transaction_id: 1, score: 0, disqualified: true },
      { transaction_id: 2, score: 90 },
    ]);
    assert.equal(d.action, "auto");
    assert.equal(d.best.transaction_id, 2);
  });
});
