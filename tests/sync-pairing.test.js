import { test } from "node:test";
import assert from "node:assert/strict";
import { pairRowsWithEmails, canonicalMerchant } from "../lib/sync-pairing.js";

const batch = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];

test("rows are paired by the email id the model echoes, not by position", () => {
  // The model skipped e2 (a delivery notice), so position would put e3's
  // charge on e2.
  const parsed = [{ emailId: "e1", amount: 100 }, { emailId: "e3", amount: 300 }];
  const out = pairRowsWithEmails(parsed, batch);
  assert.deepEqual(out.map(([r, e]) => [r.amount, e.id]), [[100, "e1"], [300, "e3"]]);
});

test("a duplicate emailId keeps only the first row, so the upsert doesn't collide", () => {
  const dupeBatch = [{ id: "e1" }, { id: "e2" }];
  const parsed = [
    { emailId: "e1", amount: 1 },
    { emailId: "e1", amount: 2 },
    { emailId: "e2", amount: 3 },
  ];
  const out = pairRowsWithEmails(parsed, dupeBatch);
  assert.deepEqual(out.map(([r]) => r.amount), [1, 3]);
});

test("a row naming an email that was not in the batch is dropped", () => {
  const parsed = [{ emailId: "e1", amount: 100 }, { emailId: "zzz", amount: 5 }];
  assert.deepEqual(pairRowsWithEmails(parsed, batch).map(([r]) => r.amount), [100]);
});

test("without ids, position is trusted only when every email got exactly one row", () => {
  const full = [{ amount: 1 }, { amount: 2 }, { amount: 3 }];
  assert.deepEqual(pairRowsWithEmails(full, batch).map(([r, e]) => [r.amount, e.id]), [[1, "e1"], [2, "e2"], [3, "e3"]]);
  assert.throws(() => pairRowsWithEmails([{ amount: 1 }, { amount: 3 }], batch), /cannot pair/);
});

test("legal-entity dressing is stripped from merchant names", () => {
  assert.equal(canonicalMerchant("Zomato Limited"), "Zomato");
  assert.equal(canonicalMerchant("Amazon Pay India Private Limited"), "Amazon Pay India");
  assert.equal(canonicalMerchant("GMR Airports Ltd."), "GMR Airports");
  assert.equal(canonicalMerchant("RAMEN-ISM B.V."), "Ramen-Ism");
  assert.equal(canonicalMerchant("Prague Dream Hostel s.r.o"), "Prague Dream Hostel");
  assert.equal(canonicalMerchant("Blink Commerce Pvt Ltd"), "Blink Commerce");
  assert.equal(canonicalMerchant("Wispr AI, Inc."), "Wispr AI");
  assert.equal(canonicalMerchant("Swiggy"), "Swiggy");
  assert.equal(canonicalMerchant("OpenAI"), "OpenAI");
  assert.equal(canonicalMerchant("KFC"), "KFC");
  assert.equal(canonicalMerchant(""), "Unknown");
});
