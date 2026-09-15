// tests/chat-prompt.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { systemPrompt, splitTelegram } from "../lib/chat-prompt.js";

test("the system prompt states the date, the cycle and the rules that matter", () => {
  const p = systemPrompt({ today: "2026-09-15", cycle: { cycle_start: "2026-08-17", cycle_end: "2026-09-16" }, cardLabel: "HDFC Corporate ···7634" });
  assert.match(p, /2026-09-15/);
  assert.match(p, /2026-08-17/);
  assert.match(p, /HDFC Corporate/);
  assert.match(p, /every number.*tool/i);
  assert.match(p, /HTML/);
  assert.match(p, /₹1,23,456/);
});

test("long replies split at line breaks under Telegram's cap", () => {
  const line = "x".repeat(100);
  const text = Array.from({ length: 50 }, () => line).join("\n");
  const parts = splitTelegram(text, 1000);
  assert.ok(parts.length >= 5);
  for (const p of parts) assert.ok(p.length <= 1000);
  assert.equal(parts.join("\n"), text);
});

test("a short reply is one part", () => {
  assert.deepEqual(splitTelegram("hello"), ["hello"]);
});

test("the prompt forbids totals the model added up itself", () => {
  const p = systemPrompt({ today: "2026-09-15", cycle: null, cardLabel: "card" });
  assert.match(p, /never add up/i);
});
