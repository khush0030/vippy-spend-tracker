import { test } from "node:test";
import assert from "node:assert/strict";
import { readerKind, sarvamSchemaFrom, normaliseSarvamResult } from "../lib/receipt-readers.js";
import { RECEIPT_SCHEMA } from "../lib/receipt-prompt.js";

test("a reader is chosen by the ref's provider; text models cannot read receipts", () => {
  assert.equal(readerKind("openai:gpt-5.6"), "openai");
  assert.equal(readerKind("sarvam:extract"), "sarvam-extract");
  assert.throws(() => readerKind("sarvam:sarvam-105b"), /cannot read a receipt/);
  assert.throws(() => readerKind("anthropic:claude-opus-5"), /Unknown model ref/);
});

test("the Sarvam schema keeps properties and descriptions but drops validation keywords", () => {
  const s = sarvamSchemaFrom(RECEIPT_SCHEMA);
  assert.equal(s.type, "object");
  assert.ok(s.properties.total);
  assert.ok(s.properties.line_items.items.properties.desc);
  const walk = (node) => {
    assert.equal("required" in node, false);
    assert.equal("additionalProperties" in node, false);
    for (const v of Object.values(node.properties || {})) walk(v);
    if (node.items) walk(node.items);
  };
  walk(s);
  // The original is untouched.
  assert.ok(Array.isArray(RECEIPT_SCHEMA.required));
});

test("a wrapped Sarvam result is unwrapped, a bare one is returned as is", () => {
  const bare = { total: 957, currency: "INR" };
  assert.deepEqual(normaliseSarvamResult(bare), bare);
  assert.deepEqual(normaliseSarvamResult({ fields: bare }), bare);
  assert.deepEqual(normaliseSarvamResult({ data: bare }), bare);
  assert.equal(normaliseSarvamResult(null), null);
});
