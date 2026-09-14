import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelRef, stripJsonFence, chatJson } from "../lib/llm.js";

test("model refs carry their provider", () => {
  assert.deepEqual(parseModelRef("sarvam:sarvam-105b"), { provider: "sarvam", model: "sarvam-105b" });
  assert.deepEqual(parseModelRef("openai:gpt-5.6-mini"), { provider: "openai", model: "gpt-5.6-mini" });
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
  const res = await chatJson({ ref: "openai:gpt-5.6-mini", user: "usr", fetch });
  assert.equal(res.text, "[]");
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer oa-test");
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "usr" }]);
  assert.equal(calls[0].body.max_tokens, 4096);
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
