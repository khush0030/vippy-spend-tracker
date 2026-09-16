// tests/chat-prompt.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { systemPrompt, splitTelegram, sanitizeHistory, htmlToPlain, receiptNote, statesFigures, ungroundedAmounts } from "../lib/chat-prompt.js";

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

test("history keeps complete tool call/result pairs", () => {
  const msgs = [
    { role: "user", content: "hi" },
    { role: "assistant", content: null, tool_calls: [{ id: "a" }, { id: "b" }] },
    { role: "tool", tool_call_id: "a", content: "1" },
    { role: "tool", tool_call_id: "b", content: "2" },
    { role: "assistant", content: "done" },
  ];
  assert.deepEqual(sanitizeHistory(msgs), msgs);
});

test("history drops an assistant message whose tool calls were never answered", () => {
  const msgs = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", tool_calls: [{ id: "a" }, { id: "b" }] },
    { role: "tool", tool_call_id: "a", content: "1" },
    { role: "user", content: "again" },
    { role: "assistant", content: "", tool_calls: [{ id: "c" }] },
  ];
  assert.deepEqual(sanitizeHistory(msgs), [
    { role: "user", content: "hi" },
    { role: "user", content: "again" },
  ]);
});

test("history drops stray and leading tool rows", () => {
  const msgs = [
    { role: "tool", tool_call_id: "x", content: "old" },
    { role: "user", content: "hi" },
    { role: "tool", tool_call_id: "y", content: "stray" },
    { role: "assistant", content: "ok" },
  ];
  assert.deepEqual(sanitizeHistory(msgs), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "ok" },
  ]);
});

test("HTML the model wrote reads right as plain text", () => {
  assert.equal(htmlToPlain("<b>AT&amp;T</b> &lt;₹500&gt; <i>ok</i>"), "AT&T <₹500> ok");
  assert.equal(htmlToPlain("&amp;lt;"), "&lt;");
});

test("a filed receipt becomes a history note the model can read", () => {
  const r = { merchant: "Veritrade", amount: 499, currency: "INR", receipt_date: "2026-09-07" };
  assert.deepEqual(receiptNote(r, { action: "defer" }), [
    { role: "user", content: "[sent a receipt photo]" },
    { role: "assistant", content: "Saved receipt: Veritrade · INR 499 · 2026-09-07. Not matched to a charge yet — it is waiting for the bank alert." },
  ]);
  assert.match(receiptNote({ ...r, merchant: null }, { action: "auto", best: { transaction_id: 591 } })[1].content, /unknown merchant.*Matched to transaction 591/);
  assert.match(receiptNote(r, { action: "ask", candidates: [{}, {}] })[1].content, /2 charges could fit/);
  assert.match(receiptNote(r, null)[1].content, /could not be read yet/);
  assert.match(receiptNote(r, { action: "duplicate", best: { transaction_id: 579 } })[1].content, /579 already has its bill.*duplicate/);
});

test("a reply that states figures is caught; a plain one is not", () => {
  assert.ok(statesFigures("You now have <b>31 transactions</b> without receipts, totaling ₹63,652.96."));
  assert.ok(statesFigures("Top: Amazon — 11,297"));
  assert.equal(statesFigures("You're welcome! Anything else?"), false);
  assert.equal(statesFigures(""), false);
});

test("rupee figures not in this turn's tool results are flagged", () => {
  const tools = [JSON.stringify({ total_missing: 55183.74, rows: [{ amount: 11297 }, { amount: "170882" }] })];
  assert.deepEqual(ungroundedAmounts("<b>₹55,183.74</b> left; Amazon Pay — ₹11,297; Zomato ₹1,70,882", tools), []);
  assert.deepEqual(ungroundedAmounts("totaling <b>₹63,652.96</b>, Amazon ₹11,297.00", tools), ["₹63,652.96"]);
  assert.deepEqual(ungroundedAmounts("Nothing to add", []), []);
});
