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
  // What Extract actually returns: the fields beside per-field confidences.
  assert.deepEqual(normaliseSarvamResult({ data: bare, field_confidence: { total: 1 }, field_sources: {} }), bare);
  assert.equal(normaliseSarvamResult(null), null);
});

test("the Sarvam schema gives every node a single type — union types collapse to their first non-null member", () => {
  const s = sarvamSchemaFrom({
    type: "object",
    properties: {
      total: { type: ["number", "string", "null"], description: "grand total" },
      tax_id: { type: ["string", "null"] },
      confidence: { type: ["number", "null"] },
      items: { type: "array", items: { type: "object", properties: { amount: { type: ["number", "null"] } } } },
    },
  });
  assert.equal(s.properties.total.type, "number");
  assert.equal(s.properties.total.description, "grand total");
  assert.equal(s.properties.tax_id.type, "string");
  assert.equal(s.properties.confidence.type, "number");
  assert.equal(s.properties.items.items.properties.amount.type, "number");
  const real = sarvamSchemaFrom(RECEIPT_SCHEMA);
  const walk = (n) => { assert.equal(typeof n.type, "string", JSON.stringify(n)); for (const v of Object.values(n.properties || {})) walk(v); if (n.items) walk(n.items); };
  walk(real);
});

test("every Sarvam schema field carries a description, taken from the prompt's own definitions", () => {
  const s = sarvamSchemaFrom(RECEIPT_SCHEMA);
  const walk = (n, path) => {
    for (const [k, v] of Object.entries(n.properties || {})) {
      assert.ok(typeof v.description === "string" && v.description.length > 0, `${path}${k} has no description`);
      walk(v, `${path}${k}.`);
    }
    if (n.items) walk(n.items, `${path}[].`);
  };
  walk(s, "");
  assert.match(s.properties.total.description, /grand total/);
  assert.match(s.properties.line_items.items.properties.desc.description, /line/i);
  // corners are a photograph geometry question, not a document field; Sarvam is not asked
  assert.equal("corners" in s.properties, false);
});
