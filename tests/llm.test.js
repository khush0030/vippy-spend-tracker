import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelRef, stripJsonFence, chatJson, chatWithTools } from "../lib/llm.js";

test("model refs carry their provider", () => {
  assert.deepEqual(parseModelRef("sarvam:sarvam-105b"), { provider: "sarvam", model: "sarvam-105b" });
  assert.deepEqual(parseModelRef("openai:gpt-5.4-mini"), { provider: "openai", model: "gpt-5.4-mini" });
  assert.throws(() => parseModelRef("claude-sonnet-5"), /Unknown model ref/);
  assert.throws(() => parseModelRef("anthropic:claude-opus-5"), /Unknown model ref/);
  assert.throws(() => parseModelRef(""), /Unknown model ref/);
});

test("a markdown fence around JSON is removed, plain text is left alone", () => {
  assert.equal(stripJsonFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripJsonFence('```\n[1,2]\n```'), "[1,2]");
  assert.equal(stripJsonFence('  {"a":1}  '), '{"a":1}');
});

function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(url, init);
  };
  return { fetch, calls };
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) });

test("sarvam refs go to api.sarvam.ai with the subscription-key header", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const { fetch, calls } = fakeFetch(() => ok({ choices: [{ message: { content: "hello" } }] }));
  const res = await chatJson({ ref: "sarvam:sarvam-105b", system: "sys", user: "usr", maxTokens: 123, fetch });
  assert.equal(res.text, "hello");
  assert.equal(res.provider, "sarvam");
  assert.equal(res.model, "sarvam-105b");
  assert.equal(calls[0].url, "https://api.sarvam.ai/v1/chat/completions");
  assert.equal(calls[0].init.headers["api-subscription-key"], "sk-test");
  assert.equal(calls[0].body.model, "sarvam-105b");
  assert.equal(calls[0].body.max_tokens, 123);
  assert.deepEqual(calls[0].body.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "usr" },
  ]);
});

test("openai refs go to api.openai.com with a bearer token and no system message when none is given", async () => {
  process.env.OPENAI_API_KEY = "oa-test";
  const { fetch, calls } = fakeFetch(() => ok({ choices: [{ message: { content: "[]" } }] }));
  const res = await chatJson({ ref: "openai:gpt-5.4-mini", user: "usr", fetch });
  assert.equal(res.text, "[]");
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer oa-test");
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "usr" }]);
  assert.equal(calls[0].body.max_completion_tokens, 4096);
  // GPT reasoning models reject any temperature but the default.
  assert.equal("temperature" in calls[0].body, false);
  assert.equal("max_tokens" in calls[0].body, false);
});

test("a non-2xx answer becomes an error naming the provider and status", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const { fetch } = fakeFetch(() => ({ ok: false, status: 429, text: async () => "rate limited" }));
  await assert.rejects(
    chatJson({ ref: "sarvam:sarvam-105b", user: "u", fetch }),
    /sarvam 429: rate limited/
  );
});

test("an empty choice is an error, not an empty string", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const { fetch } = fakeFetch(() => ok({ choices: [] }));
  await assert.rejects(chatJson({ ref: "sarvam:sarvam-105b", user: "u", fetch }), /returned no text/);
});

test("a missing api key is reported before any request is made", async () => {
  delete process.env.SARVAM_API_KEY;
  const { fetch, calls } = fakeFetch(() => ok({}));
  await assert.rejects(chatJson({ ref: "sarvam:sarvam-105b", user: "u", fetch }), /SARVAM_API_KEY is not set/);
  assert.equal(calls.length, 0);
});

test("think: false turns Sarvam reasoning off; OpenAI switches to a low reasoning_effort", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  process.env.OPENAI_API_KEY = "oa-test";
  const { fetch, calls } = fakeFetch(() => ok({ choices: [{ message: { content: "[]" } }] }));
  await chatJson({ ref: "sarvam:sarvam-105b", user: "u", think: false, fetch });
  await chatJson({ ref: "sarvam:sarvam-105b", user: "u", fetch });
  await chatJson({ ref: "openai:gpt-5.4-mini", user: "u", think: false, fetch });
  assert.equal("reasoning_effort" in calls[0].body, true);
  assert.equal(calls[0].body.reasoning_effort, null);
  assert.equal("reasoning_effort" in calls[1].body, false);
  assert.equal(calls[2].body.reasoning_effort, "low");
});

test("an answer cut off by the token ceiling says so", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const { fetch } = fakeFetch(() => ok({ choices: [{ finish_reason: "length", message: { content: null, reasoning_content: "..." } }] }));
  await assert.rejects(chatJson({ ref: "sarvam:sarvam-105b", user: "u", fetch }), /returned no text \(finish_reason: length\)/);
});

test("truncated but non-empty content is reported as truncated, not accepted", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const { fetch } = fakeFetch(() => ok({ choices: [{ finish_reason: "length", message: { content: "partial answer" } }] }));
  await assert.rejects(chatJson({ ref: "sarvam:sarvam-105b", user: "u", fetch }), /output truncated \(finish_reason: length\)/);
});

test("chatWithTools sends tools and returns the assistant message with its tool_calls", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const call = { id: "call_1", type: "function", function: { name: "spend_summary", arguments: '{"period":"this_cycle"}' } };
  const { fetch, calls } = fakeFetch(() => ok({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call] } }] }));
  const tools = [{ type: "function", function: { name: "spend_summary", parameters: { type: "object" } } }];
  const res = await chatWithTools({ ref: "sarvam:sarvam-105b", messages: [{ role: "user", content: "hi" }], tools, fetch });
  assert.equal(res.finishReason, "tool_calls");
  assert.deepEqual(res.message.tool_calls, [call]);
  assert.deepEqual(calls[0].body.tools, tools);
  assert.equal(calls[0].body.tool_choice, "auto");
  assert.equal(calls[0].body.reasoning_effort, null);
  assert.equal(calls[0].body.max_tokens, 2048);
});

test("chatWithTools on openai uses max_completion_tokens and honours tool_choice none", async () => {
  process.env.OPENAI_API_KEY = "oa-test";
  const { fetch, calls } = fakeFetch(() => ok({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done" } }] }));
  const res = await chatWithTools({ ref: "openai:gpt-5.6", messages: [{ role: "user", content: "hi" }], tools: [], toolChoice: "none", fetch });
  assert.equal(res.message.content, "done");
  assert.equal(calls[0].body.max_completion_tokens, 2048);
  assert.equal(calls[0].body.tool_choice, "none");
  assert.equal("temperature" in calls[0].body, false);
});

test("chatWithTools reports a missing choice as an error", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const { fetch } = fakeFetch(() => ok({ choices: [] }));
  await assert.rejects(chatWithTools({ ref: "sarvam:sarvam-105b", messages: [], tools: [], fetch }), /returned no message/);
});
