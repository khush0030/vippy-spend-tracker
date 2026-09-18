// tests/restricted.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { restrictedGoods } from "../lib/restricted.js";

test("the 3 Sep Instamart invoice: cigarettes by name and by HSN code", () => {
  const hits = restrictedGoods({
    items: [{ desc: "ABOOVE Lighter Jetty Wind Proof assorted colour", amount: 40 }, { desc: "Classic Connect Cigarette - 20 Sticks", amount: 390 }],
    text: "4. Classic Connect Cigarette - 20 Sticks 1 NOS 24022090 278.57",
  });
  assert.ok(hits.includes("cigarette"));
  assert.ok(hits.includes("HSN 24022090"));
});

test("alcohol on a restaurant bill", () => {
  assert.deepEqual(restrictedGoods({ items: [{ desc: "Paneer Tikka" }, { desc: "Kingfisher Ultra Beer 650ml" }] }), ["beer"]);
  assert.ok(restrictedGoods({ text: "2x Old Monk rum 60ml, 1 Jameson whiskey" }).length >= 2);
  assert.deepEqual(restrictedGoods({ text: "Heineken 330ml" }), ["heineken"]);
  assert.deepEqual(restrictedGoods({ items: [{ desc: "Gold Flake Kings 10s" }] }), ["gold flake"]);
});

test("soft drinks, mocktails and food that only look like it are fine", () => {
  for (const t of ["Ginger Ale", "Root beer float", "Non-alcoholic beer", "Alcohol-free wine", "Virgin Mojito", "Rumali Roti", "Ginger lemon tea", "Mocktail", "Kale salad", "Sparkling water 0.0%"]) {
    assert.deepEqual(restrictedGoods({ text: t }), [], t);
  }
});

test("a plain bill, an amount like 2205.00, and a short number are fine", () => {
  assert.deepEqual(restrictedGoods({ items: [{ desc: "Delivery fee" }], text: "Total 2205.00, order 240112" }), []);
  assert.deepEqual(restrictedGoods({}), []);
});
