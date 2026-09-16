import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArgs, CATEGORIES } from "../lib/chat-args.js";

test("ids must be positive integers", () => {
  assert.equal(validateArgs("declare_no_bill", { transaction_id: 415 }).ok, true);
  assert.equal(validateArgs("declare_no_bill", { transaction_id: "415" }).args.transaction_id, 415);
  assert.match(validateArgs("declare_no_bill", { transaction_id: -1 }).error, /transaction_id/);
  assert.match(validateArgs("declare_no_bill", {}).error, /transaction_id/);
});

test("categories come from the fixed list", () => {
  assert.equal(CATEGORIES.includes("swiggy"), true);
  assert.equal(validateArgs("set_category", { transaction_id: 1, category: "dining" }).ok, true);
  assert.match(validateArgs("set_category", { transaction_id: 1, category: "food" }).error, /category/);
});

test("limits are clamped and defaulted", () => {
  assert.equal(validateArgs("spend_by_merchant", { period: "this_cycle" }).args.top, 10);
  assert.equal(validateArgs("spend_by_merchant", { period: "this_cycle", top: 500 }).args.top, 40);
  assert.equal(validateArgs("search_transactions", { limit: 0 }).args.limit, 1);
});

test("merchants are trimmed and bounded; dates must be ISO", () => {
  assert.equal(validateArgs("rename_merchant", { from: "  Zomato Limited ", to: "Zomato" }).args.from, "Zomato Limited");
  assert.match(validateArgs("rename_merchant", { from: "", to: "Zomato" }).error, /from/);
  assert.match(validateArgs("rename_merchant", { from: "a", to: "x".repeat(81) }).error, /to/);
  assert.equal(validateArgs("snooze_pings", { until_date: "2026-09-20" }).ok, true);
  assert.match(validateArgs("snooze_pings", { until_date: "next monday" }).error, /until_date/);
});

test("an unknown tool is rejected", () => {
  assert.match(validateArgs("drop_table", {}).error, /Unknown tool/);
});

test("waiting_receipts needs no arguments", () => {
  assert.deepEqual(validateArgs("waiting_receipts", {}), { ok: true, args: {} });
});
