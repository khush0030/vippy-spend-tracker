import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMerchant,
  merchantSimilarity,
  dayDiff,
  scoreCandidate,
  decide,
  expectedInrBand,
  findSplit,
  isSameBill,
  isCovered,
  tippedBill,
  suggestCharges,
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

describe("findSplit", () => {
  const r = (id, amount, o = {}) => ({ id, amount, currency: "INR", receipt_date: "2026-08-31", ...o });
  const charge = { id: 578, amount: 11297, date: "2026-08-31" };

  test("one order billed as three invoices binds to the single charge", () => {
    const got = findSplit([r("a", 8999), r("b", 1149), r("c", 1149), r("d", 499)], charge);
    assert.deepEqual(got.map((x) => x.id).sort(), ["a", "b", "c"]);
  });

  test("receipts from different days never combine", () => {
    assert.equal(findSplit([r("a", 8999), r("b", 1149), r("c", 1149, { receipt_date: "2026-08-30" })], charge), null);
  });

  test("a sum reachable two ways is ambiguous and left alone", () => {
    assert.equal(findSplit([r("a", 100), r("b", 200), r("c", 150), r("d", 150)], { id: 1, amount: 300, date: "2026-08-31" }), null);
  });

  test("a lone receipt, foreign money or a date out of window is not a split", () => {
    assert.equal(findSplit([r("a", 11297)], charge), null);
    assert.equal(findSplit([r("a", 8999, { currency: "USD" }), r("b", 2298, { currency: "USD" })], charge), null);
    assert.equal(findSplit([r("a", 8999), r("b", 2298)], { ...charge, date: "2026-09-20" }), null);
  });
});

describe("isSameBill", () => {
  const b = (o = {}) => ({ merchant: "Shreemaya Bakery", amount: 260, currency: "INR", receipt_date: "2026-08-24", receipt_time: "18:03", invoice_no: "115", ...o });

  test("two photos of one bill: same amount, day, merchant and time", () => {
    assert.ok(isSameBill(b(), b({ invoice_no: "031121" })));
    assert.ok(isSameBill(b({ merchant: "Kara by K&Y" }), b({ merchant: "Kara" })));
  });

  test("the same invoice number is the same bill even without a time", () => {
    assert.ok(isSameBill(b({ receipt_time: null, invoice_no: "X1" }), b({ receipt_time: null, invoice_no: "X1" })));
  });

  test("two items of one order are separate bills", () => {
    const c = { merchant: "Clicktech Retail Private Limited", amount: 1149, currency: "INR", receipt_date: "2026-08-31", receipt_time: null };
    assert.equal(isSameBill({ ...c, invoice_no: "BOM7-1207947" }, { ...c, invoice_no: "BBX1-472105" }), false);
  });

  test("different amount, day, currency or merchant is never the same bill", () => {
    assert.equal(isSameBill(b(), b({ amount: 261 })), false);
    assert.equal(isSameBill(b(), b({ receipt_date: "2026-08-25" })), false);
    assert.equal(isSameBill(b(), b({ currency: "USD" })), false);
    assert.equal(isSameBill(b(), b({ merchant: "Veritrade" })), false);
    assert.equal(isSameBill(b({ receipt_time: null, invoice_no: null }), b({ receipt_time: null, invoice_no: null })), false);
  });
});

describe("isCovered", () => {
  const charge = { amount: 11297 };
  test("a charge is covered once its bills reach its amount", () => {
    assert.equal(isCovered(charge, [{ amount: 8999, currency: "INR" }, { amount: 1149, currency: "INR" }]), false);
    assert.ok(isCovered(charge, [{ amount: 8999, currency: "INR" }, { amount: 1149, currency: "INR" }, { amount: 1149, currency: "INR" }]));
    assert.equal(isCovered(charge, []), false);
  });
  test("any foreign bill covers its charge, since the amounts never add up in rupees", () => {
    assert.ok(isCovered({ amount: 7884.8 }, [{ amount: 79.24, currency: "USD" }]));
  });
});

describe("tippedBill", () => {
  const meal = { category: "dining", amount: 8153.96 };
  const pre = { id: "pre", amount: 70.3, currency: "EUR", receipt_date: "2026-08-10" };
  const tipped = { id: "tip", amount: 73.82, currency: "EUR", receipt_date: "2026-08-10" };

  test("two bills from one restaurant visit: the larger has the tip, so it is the one kept", () => {
    assert.deepEqual(tippedBill(meal, [pre], tipped), { keep: tipped, drop: pre });
    assert.deepEqual(tippedBill(meal, [tipped], pre), { keep: tipped, drop: pre });
    assert.deepEqual(tippedBill({ ...meal, category: "swiggy" }, [pre], tipped), { keep: tipped, drop: pre });
  });

  test("not a restaurant, another day or another currency: no preference", () => {
    assert.equal(tippedBill({ ...meal, category: "travel" }, [pre], tipped), null);
    assert.equal(tippedBill(meal, [pre], { ...tipped, receipt_date: "2026-08-11" }), null);
    assert.equal(tippedBill(meal, [pre], { ...tipped, currency: "INR" }), null);
  });
});

describe("merchantSimilarity — the company on the bill vs the brand on the card", () => {
  test("legal names read as the brand the statement shows", () => {
    assert.ok(merchantSimilarity("Swinsta Ent - Freeganj", "Swiggy") >= 0.8);
    assert.ok(merchantSimilarity("Instamart", "Swiggy") >= 0.8);
    assert.ok(merchantSimilarity("Blink Commerce Pvt Ltd", "Blinkit") >= 0.8);
    assert.ok(merchantSimilarity("Clicktech Retail Private Limited", "Amazon") >= 0.8);
  });
  test("and nothing else is pulled together", () => {
    assert.ok(merchantSimilarity("Swinsta Ent", "Zomato") < 0.5);
    assert.ok(merchantSimilarity("Pine Labs", "Amazon") < 0.5);
  });
});

describe("the 26 Aug Swiggy bill", () => {
  test("files itself against the only charge it can be", () => {
    const r = { amount: 863.98, currency: "INR", receipt_date: "2026-08-26", merchant: "Swinsta Ent - Freeganj" };
    const s = scoreCandidate(r, { id: 587, amount: 864, date: "2026-08-26", merchant: "Swiggy", receipt_status: "missing" });
    assert.equal(decide([{ ...s, transaction_id: 587 }]).action, "auto");
  });
});

describe("suggestCharges", () => {
  const missing = [
    { id: 10, merchant: "ZOMATO", amount: 267.9, date: "2026-08-21" },
    { id: 11, merchant: "UBER INDIA", amount: 314.8, date: "2026-09-09" },
    { id: 12, merchant: "AIRTEL", amount: 349, date: "2026-08-25" },
    { id: 13, merchant: "YOUTUBE", amount: 299, date: "2026-08-28" },
  ];

  test("a misread amount still finds the same merchant", () => {
    const out = suggestCharges({ merchant: "Zomato", amount: 170882, currency: "INR", receipt_date: "2026-09-05" }, missing);
    assert.equal(out[0].txn.id, 10);
  });

  test("a misread date still finds the exact amount", () => {
    const out = suggestCharges({ merchant: "Uber", amount: 314.8, currency: "INR", receipt_date: "2026-05-09" }, missing);
    assert.equal(out[0].txn.id, 11);
  });

  test("an unrelated bill suggests nothing", () => {
    const out = suggestCharges({ merchant: "Baan Ying Plant-Based", amount: 951, currency: "THB", receipt_date: "2025-09-10" }, missing);
    assert.deepEqual(out, []);
  });

  test("the exact amount alone is enough, whatever the name", () => {
    const out = suggestCharges({ merchant: "Bharti Hexacom", amount: 349, currency: "INR", receipt_date: "2026-08-25" }, missing);
    assert.equal(out[0].txn.id, 12);
  });

  test("at most `limit`, best first", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: i, merchant: "Zomato", amount: 100 + i, date: "2026-08-21" }));
    const out = suggestCharges({ merchant: "Zomato", amount: 107, currency: "INR", receipt_date: "2026-08-21" }, many, { limit: 3 });
    assert.equal(out.length, 3);
    assert.equal(out[0].txn.id, 7);
  });
});
