# Sarvam + GPT Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Anthropic from vippy-spend-tracker entirely; every model call goes to Sarvam (text chat, document extraction/OCR) or OpenAI (vision).

**Architecture:** Two new pure modules own the vendor protocols — `lib/llm.js` for OpenAI-compatible chat completions (Sarvam and OpenAI share it) and `lib/sarvam-doc.js` for Sarvam's asynchronous Document AI jobs. The four model-calling modules (`sync.js`, `harvest-ai.js`, `receipt-vision.js`, `statement-vision.js`) switch to those modules; consensus, validation, tie-out, and every prompt stay as they are. Model choice is an env var of the form `provider:model`; the defaults are Sarvam/OpenAI and there is no Anthropic branch.

**Tech Stack:** Next.js 16 (App Router, `@/` alias → repo root), Node 24 `fetch`/`FormData`/`Blob`, `node --test` for pure modules (no `@/` imports in tested files), `jszip` (new) to open Sarvam job downloads. No OpenAI or Sarvam SDK — raw `fetch`, as `receipt-vision.js` already does for OpenAI.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-14-sarvam-gpt-providers-design.md`.
- Tested modules must not import through `@/` — `node --test` has no bundler. `lib/llm.js` and `lib/sarvam-doc.js` take `fetch` (and `sleep`) as injectable options for that reason.
- Sarvam chat: `POST https://api.sarvam.ai/v1/chat/completions`, header `api-subscription-key: <SARVAM_API_KEY>`, model `sarvam-105b`, default `max_tokens` 2048 so it is always passed explicitly.
- Sarvam Document AI: `POST https://api.sarvam.ai/doc-ai/v1/job/extract` (multipart: `file`, `schema` JSON string, `language`, `output_format`), `POST .../job/digitise` (multipart: `file`, `language`, `output_format`), `GET .../job/{id}/status`, `GET .../job/{id}/download-url` → `{ method, url }` → ZIP. `output_format` values are `md`, `html`, `json` — never `markdown`. 10 pages max per file. Terminal statuses: `completed`, `partially_completed`, `failed`, `rejected`; only `completed` is accepted.
- OpenAI: Responses API `POST https://api.openai.com/v1/responses` for anything with a file; chat completions `POST https://api.openai.com/v1/chat/completions` for text.
- Model refs: `sarvam:sarvam-105b`, `openai:gpt-5.6`, `openai:gpt-5.6-mini`, `sarvam:extract`, `sarvam:digitise`. A ref without a known prefix throws.
- No `@anthropic-ai/sdk`, no `ANTHROPIC_API_KEY`, no `callAnthropic` anywhere when done.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `npm test` must stay green after every task; `npm run build` must pass at the end of Tasks 3–7.

---

### Task 1: `lib/llm.js` — one door for OpenAI-compatible chat

**Files:**
- Create: `lib/llm.js`
- Test: `tests/llm.test.js`

**Interfaces:**
- Produces:
  - `parseModelRef(ref: string) → { provider: "sarvam"|"openai", model: string }` — throws `Error("Unknown model ref: ...")` for anything else.
  - `stripJsonFence(text: string) → string` — removes a leading/trailing ```` ```json ```` fence if present, else returns the input trimmed.
  - `chatJson({ ref, system, user, maxTokens = 4096, temperature = 0, fetch = globalThis.fetch }) → Promise<{ text: string, model: string, provider: string }>` — sends `[{role:"system"},{role:"user"}]` (system omitted when falsy) and returns the assistant text. Throws `Error("<provider> <status>: <body slice>")` on non-2xx and `Error("<provider> returned no text")` on an empty choice.

- [ ] **Step 1: Write the failing tests**

```js
// tests/llm.test.js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/llm.test.js`
Expected: FAIL — `Cannot find module '.../lib/llm.js'`.

- [ ] **Step 3: Write the module**

```js
// lib/llm.js
/**
 * One door for text chat.
 *
 * Sarvam and OpenAI both speak the OpenAI chat-completions protocol, so a
 * single request shape serves both; only the host and the auth header differ.
 * Model refs carry their provider — "sarvam:sarvam-105b", "openai:gpt-5.6" —
 * so one env var can name either, and a bare model name is refused rather
 * than guessed at.
 *
 * No @/ imports: node --test runs this file directly, and `fetch` is a
 * parameter for the same reason.
 */

const PROVIDERS = {
  sarvam: {
    url: "https://api.sarvam.ai/v1/chat/completions",
    keyVar: "SARVAM_API_KEY",
    headers: (key) => ({ "api-subscription-key": key }),
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    keyVar: "OPENAI_API_KEY",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

export function parseModelRef(ref) {
  const m = /^(sarvam|openai):(.+)$/.exec(String(ref ?? "").trim());
  if (!m) throw new Error(`Unknown model ref: ${JSON.stringify(ref)} (expected sarvam:<model> or openai:<model>)`);
  return { provider: m[1], model: m[2] };
}

export function stripJsonFence(text) {
  const s = String(text ?? "").trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s);
  return m ? m[1].trim() : s;
}

export async function chatJson({
  ref,
  system = null,
  user,
  maxTokens = 4096,
  temperature = 0,
  fetch = globalThis.fetch,
}) {
  const { provider, model } = parseModelRef(ref);
  const cfg = PROVIDERS[provider];
  const key = process.env[cfg.keyVar];
  if (!key) throw new Error(`${cfg.keyVar} is not set`);

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cfg.headers(key) },
    // Sarvam's default max_tokens is 2048 and reasoning tokens count against
    // it, so the ceiling is always explicit.
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error(`${provider} returned no text`);
  return { text, model, provider };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/llm.test.js`
Expected: `ℹ pass 7`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/llm.js tests/llm.test.js
git commit -m "Add one chat-completions door for Sarvam and OpenAI

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `lib/sarvam-doc.js` — Sarvam Document AI jobs

**Files:**
- Create: `lib/sarvam-doc.js`
- Test: `tests/sarvam-doc.test.js`
- Modify: `package.json` (add `jszip`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `extractFields(buffer, mime, { schema, language = "en-IN", timeoutMs = 120000, fetch, sleep }) → Promise<object>` — parsed JSON of the extraction.
  - `digitise(buffer, mime, { language = "en-IN", timeoutMs = 120000, fetch, sleep }) → Promise<string>` — the markdown of the document.
  - `pickResultFile(names: string[], ext: "json"|"md") → string` — chooses the primary output file from a ZIP listing: the first name ending in `.ext` that is not `manifest.json` and not under `metadata/`. Throws if none.
  - Both job functions throw `Error("sarvam doc-ai job <status>")` for any terminal status other than `completed`, and `Error("sarvam doc-ai job timed out after <n>ms")` on timeout.

- [ ] **Step 1: Install jszip**

Run: `npm install jszip@^3.10.1`
Expected: `package.json` gains `"jszip": "^3.10.1"` under dependencies.

- [ ] **Step 2: Write the failing tests**

```js
// tests/sarvam-doc.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractFields, digitise, pickResultFile } from "../lib/sarvam-doc.js";

async function zipWith(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * A fake Sarvam: records every request, answers the job lifecycle in order.
 * `statuses` is the sequence returned by successive status polls.
 */
function fakeSarvam({ statuses, zip }) {
  const calls = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/job/extract") || url.endsWith("/job/digitise")) {
      return { ok: true, status: 200, json: async () => ({ job_id: "job1", status: "pending" }) };
    }
    if (url.endsWith("/job/job1/status")) {
      const status = statuses[Math.min(polls++, statuses.length - 1)];
      return { ok: true, status: 200, json: async () => ({ status }) };
    }
    if (url.endsWith("/job/job1/download-url")) {
      return { ok: true, status: 200, json: async () => ({ method: "GET", url: "https://files.example/out.zip" }) };
    }
    if (url === "https://files.example/out.zip") {
      return { ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetch, calls, sleep: async () => {} };
}

test("the primary result file is the top-level one, never the manifest or page metadata", () => {
  const names = ["manifest.json", "metadata/page_001.json", "output.json"];
  assert.equal(pickResultFile(names, "json"), "output.json");
  assert.equal(pickResultFile(["manifest.json", "doc.md", "metadata/page_001.json"], "md"), "doc.md");
  assert.throws(() => pickResultFile(["manifest.json"], "json"), /no \.json result/);
});

test("extractFields submits the schema, polls to completion and returns the parsed JSON", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const zip = await zipWith({ "manifest.json": "{}", "output.json": JSON.stringify({ total: 957, currency: "INR" }) });
  const sarvam = fakeSarvam({ statuses: ["pending", "running", "completed"], zip });
  const schema = { type: "object", properties: { total: { type: "number" } } };

  const out = await extractFields(Buffer.from("pdf"), "application/pdf", { schema, ...sarvam });

  assert.deepEqual(out, { total: 957, currency: "INR" });
  const create = sarvam.calls[0];
  assert.equal(create.url, "https://api.sarvam.ai/doc-ai/v1/job/extract");
  assert.equal(create.init.headers["api-subscription-key"], "sk-test");
  assert.equal(create.init.body.get("schema"), JSON.stringify(schema));
  assert.equal(create.init.body.get("output_format"), "json");
  assert.equal(create.init.body.get("language"), "en-IN");
  assert.equal(create.init.body.get("file").type, "application/pdf");
  assert.equal(sarvam.calls.filter((c) => c.url.endsWith("/status")).length, 3);
});

test("digitise asks for markdown and returns the markdown file", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const zip = await zipWith({ "manifest.json": "{}", "metadata/page_001.json": "{}", "document.md": "# Statement\n| a | b |" });
  const sarvam = fakeSarvam({ statuses: ["completed"], zip });

  const md = await digitise(Buffer.from("pdf"), "application/pdf", sarvam);

  assert.equal(md, "# Statement\n| a | b |");
  assert.equal(sarvam.calls[0].url, "https://api.sarvam.ai/doc-ai/v1/job/digitise");
  assert.equal(sarvam.calls[0].init.body.get("output_format"), "md");
});

test("anything but completed is a failure — a partial read is not a second opinion", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const zip = await zipWith({ "output.json": "{}" });
  for (const status of ["failed", "rejected", "partially_completed"]) {
    const sarvam = fakeSarvam({ statuses: [status], zip });
    await assert.rejects(
      extractFields(Buffer.from("x"), "image/jpeg", { schema: {}, ...sarvam }),
      new RegExp(`sarvam doc-ai job ${status}`)
    );
  }
});

test("a job that never finishes times out", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const zip = await zipWith({ "output.json": "{}" });
  const sarvam = fakeSarvam({ statuses: ["running"], zip });
  let now = 0;
  await assert.rejects(
    extractFields(Buffer.from("x"), "image/jpeg", {
      schema: {}, ...sarvam, timeoutMs: 1000, now: () => (now += 400),
    }),
    /timed out after 1000ms/
  );
});

test("a missing api key is reported before any request", async () => {
  delete process.env.SARVAM_API_KEY;
  const sarvam = fakeSarvam({ statuses: [], zip: Buffer.alloc(0) });
  await assert.rejects(digitise(Buffer.from("x"), "image/png", sarvam), /SARVAM_API_KEY is not set/);
  assert.equal(sarvam.calls.length, 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/sarvam-doc.test.js`
Expected: FAIL — `Cannot find module '.../lib/sarvam-doc.js'`.

- [ ] **Step 4: Write the module**

```js
// lib/sarvam-doc.js
import JSZip from "jszip";

/**
 * Sarvam Document AI, hidden behind two plain functions.
 *
 * The API is a job: create it with a multipart upload, poll its status, ask
 * for a download URL, download a ZIP, open the one file inside that matters.
 * Callers see none of that. They hand over bytes and get back either the
 * extracted fields (Extract, schema-driven) or the page text (Digitise, OCR).
 *
 * Only `completed` is accepted. A `partially_completed` receipt read would be
 * a second opinion with pages missing, which is worse than no second opinion.
 *
 * No @/ imports; `fetch`, `sleep` and `now` are parameters so node --test can
 * drive the whole lifecycle without a network.
 */

const BASE = "https://api.sarvam.ai/doc-ai/v1/job";
const TERMINAL = new Set(["completed", "partially_completed", "failed", "rejected"]);
const POLL_MS = 3000;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pickResultFile(names, ext) {
  const hit = names.find(
    (n) => n.endsWith(`.${ext}`) && n !== "manifest.json" && !n.startsWith("metadata/") && !n.includes("/")
  );
  if (!hit) throw new Error(`sarvam doc-ai download holds no .${ext} result (files: ${names.join(", ")})`);
  return hit;
}

function extensionFor(mime) {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  return "jpg";
}

async function runJob(kind, buffer, mime, fields, { language, timeoutMs, fetch, sleep, now }) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY is not set");
  const headers = { "api-subscription-key": key };

  const body = new FormData();
  body.set("file", new Blob([buffer], { type: mime }), `document.${extensionFor(mime)}`);
  body.set("language", language);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);

  const created = await fetch(`${BASE}/${kind}`, { method: "POST", headers, body });
  if (!created.ok) {
    const detail = await created.text?.().catch(() => "") ?? "";
    throw new Error(`sarvam doc-ai ${created.status}: ${String(detail).slice(0, 300)}`);
  }
  const { job_id: jobId } = await created.json();

  const startedAt = now();
  let status;
  for (;;) {
    const res = await fetch(`${BASE}/${jobId}/status`, { headers });
    if (!res.ok) throw new Error(`sarvam doc-ai status ${res.status}`);
    status = String((await res.json()).status || "").toLowerCase();
    if (TERMINAL.has(status)) break;
    if (now() - startedAt > timeoutMs) throw new Error(`sarvam doc-ai job timed out after ${timeoutMs}ms`);
    await sleep(POLL_MS);
  }
  if (status !== "completed") throw new Error(`sarvam doc-ai job ${status}`);

  const dl = await fetch(`${BASE}/${jobId}/download-url`, { headers });
  if (!dl.ok) throw new Error(`sarvam doc-ai download-url ${dl.status}`);
  const { url } = await dl.json();

  const file = await fetch(url);
  if (!file.ok) throw new Error(`sarvam doc-ai download ${file.status}`);
  return JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
}

function options(opts = {}) {
  return {
    language: opts.language ?? "en-IN",
    timeoutMs: opts.timeoutMs ?? 120_000,
    fetch: opts.fetch ?? globalThis.fetch,
    sleep: opts.sleep ?? defaultSleep,
    now: opts.now ?? Date.now,
  };
}

/** Schema-driven field extraction. Returns the parsed JSON the schema shaped. */
export async function extractFields(buffer, mime, opts = {}) {
  if (!opts.schema) throw new Error("extractFields needs a schema");
  const zip = await runJob("extract", buffer, mime, {
    schema: JSON.stringify(opts.schema), output_format: "json",
  }, options(opts));
  const name = pickResultFile(Object.keys(zip.files), "json");
  return JSON.parse(await zip.file(name).async("string"));
}

/** Full-page OCR. Returns the document as markdown. */
export async function digitise(buffer, mime, opts = {}) {
  const zip = await runJob("digitise", buffer, mime, { output_format: "md" }, options(opts));
  const name = pickResultFile(Object.keys(zip.files), "md");
  return zip.file(name).async("string");
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/sarvam-doc.test.js`
Expected: `ℹ pass 6`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib/sarvam-doc.js tests/sarvam-doc.test.js package.json package-lock.json
git commit -m "Wrap Sarvam Document AI jobs in extractFields and digitise

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `lib/sync.js` reads bank alerts through Sarvam

**Files:**
- Modify: `lib/sync.js:1-6` (imports, client) and `lib/sync.js:124-148` (`parseBatch`)

**Interfaces:**
- Consumes: `chatJson({ ref, user, maxTokens })` and `stripJsonFence` from `lib/llm.js`.
- Produces: unchanged `syncUserTransactions` signature. Env: `SYNC_MODEL` (default `sarvam:sarvam-105b`), `SYNC_MODEL_FALLBACK` (default `openai:gpt-5.6-mini`).

There is no unit test for `sync.js` (it imports `@/`). The proof is the replay in Task 8 and `npm run build`.

- [ ] **Step 1: Replace the import and client**

Replace lines 1–6 of `lib/sync.js`:

```js
import { chatJson, stripJsonFence } from "@/lib/llm";
import { fetchHDFCEmails } from "@/lib/gmail";
import { getSupabase } from "@/lib/supabase";
import { logError, logInfo, logWarn } from "@/lib/logger";

const SYNC_MODEL = process.env.SYNC_MODEL || "sarvam:sarvam-105b";
const SYNC_MODEL_FALLBACK = process.env.SYNC_MODEL_FALLBACK || "openai:gpt-5.6-mini";
```

- [ ] **Step 2: Replace the model call inside `parseBatch`**

Replace from `const response = await anthropic.messages.create({` through `const jsonMatch = text.match(/\[[\s\S]*\]/);` with:

```js
  // The primary is tried once and the fallback once; the daily cron is the
  // retry loop, so a batch that fails both today is simply read tomorrow.
  let text = null;
  for (const ref of [SYNC_MODEL, SYNC_MODEL_FALLBACK]) {
    try {
      ({ text } = await chatJson({
        ref,
        system: SYSTEM_PROMPT,
        user: `Emails:\n${emailSummaries}`,
        maxTokens: 4096,
      }));
      break;
    } catch (err) {
      await logWarn({ source: "sync", event: "model_failed", message: `${ref} could not parse a batch: ${err.message}` });
    }
  }
  if (!text) return [];

  const jsonMatch = stripJsonFence(text).match(/\[[\s\S]*\]/);
```

Then change the comment `// Use Claude's extracted time, ...` to `// Use the model's extracted time, ...`.

- [ ] **Step 3: Verify nothing Anthropic remains in the file and the build passes**

Run: `grep -n "anthropic\|Anthropic\|claude" lib/sync.js; npm run build 2>&1 | tail -3`
Expected: grep prints nothing; build ends with the route table, no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/sync.js
git commit -m "Parse bank alerts through Sarvam-105B with a GPT fallback

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `lib/harvest-ai.js` resolves leftovers through Sarvam

**Files:**
- Modify: `lib/harvest-ai.js:1-4` (imports) and `lib/harvest-ai.js:30-52` (client + model loop)

**Interfaces:**
- Consumes: `chatJson`, `stripJsonFence` from `lib/llm.js`; `buildPrompt`, `parseProposals` unchanged.
- Produces: unchanged `resolveLeftovers` signature. Env: `HARVEST_MODEL` (default `sarvam:sarvam-105b`), `HARVEST_MODEL_FALLBACK` (default `openai:gpt-5.6`). Note the old code read `STATEMENT_MODEL` here — that coupling ends.

- [ ] **Step 1: Replace the import**

Replace line 1 `import Anthropic from "@anthropic-ai/sdk";` with `import { chatJson, stripJsonFence } from "./llm.js";`

(`harvest-ai.js` uses relative imports already — keep that style.)

- [ ] **Step 2: Replace the client and loop**

Replace from `const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });` through the closing `}` of the `for (const model of models)` loop with:

```js
  const refs = [
    process.env.HARVEST_MODEL || "sarvam:sarvam-105b",
    process.env.HARVEST_MODEL_FALLBACK || "openai:gpt-5.6",
  ];

  let raw = null;
  for (const ref of refs) {
    try {
      const res = await chatJson({ ref, user: buildPrompt(lines, emails), maxTokens: 4000 });
      raw = stripJsonFence(res.text);
      break;
    } catch (err) {
      await logWarn({
        source: "harvest", event: "model_failed", userId,
        message: `${ref} could not resolve leftovers: ${err.message}`,
      });
    }
  }
```

- [ ] **Step 3: Verify and build**

Run: `grep -n "anthropic\|Anthropic\|claude\|STATEMENT_MODEL" lib/harvest-ai.js; npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | tail -2`
Expected: grep empty; tests pass; build clean.

- [ ] **Step 4: Commit**

```bash
git add lib/harvest-ai.js
git commit -m "Resolve harvest leftovers through Sarvam-105B with a GPT fallback

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Receipt consensus — GPT reads, Sarvam Extract reads, GPT adjudicates

**Files:**
- Modify: `lib/receipt-vision.js` (imports, model constants, provider section, `extractReceipt`)
- Test: `tests/receipt-readers.test.js` (new, for the pure pieces)
- Create: `lib/receipt-readers.js` (pure: ref → reader choice, Sarvam result → the JSON shape `validateExtraction` expects)

**Interfaces:**
- Consumes: `parseModelRef` (Task 1), `extractFields` (Task 2), `RECEIPT_SCHEMA`, `validateExtraction`, `fieldsAgree`.
- Produces:
  - `lib/receipt-readers.js`: `readerKind(ref) → "openai" | "sarvam-extract"` (throws on anything else, including `sarvam:sarvam-105b` — a text model cannot read a receipt); `sarvamSchemaFrom(RECEIPT_SCHEMA) → object` (the schema with `additionalProperties`/`required` stripped at every level — Sarvam Extract wants properties and descriptions, not validation keywords); `normaliseSarvamResult(obj) → obj` (returns the result unchanged except that a top-level `fields` or `data` wrapper, if present, is unwrapped).
  - `receipt-vision.js`: `extractReceipt(buffer, mime, { userId })` unchanged. Env: `VISION_MODEL_A` (default `openai:gpt-5.6`), `VISION_MODEL_B` (default `sarvam:extract`), `VISION_MODEL_TIEBREAK` (default `openai:gpt-5.6`, called with `reasoning: { effort: "high" }`).

- [ ] **Step 1: Write the failing tests for the pure pieces**

```js
// tests/receipt-readers.test.js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/receipt-readers.test.js`
Expected: FAIL — `Cannot find module '.../lib/receipt-readers.js'`.

- [ ] **Step 3: Write `lib/receipt-readers.js`**

```js
// lib/receipt-readers.js
import { parseModelRef } from "./llm.js";

/**
 * The decisions receipt-vision.js makes that need no network.
 *
 * Kept apart so node --test can reach them: receipt-vision.js imports
 * through @/ and cannot be loaded without a bundler.
 */

export function readerKind(ref) {
  const { provider, model } = parseModelRef(ref);
  if (provider === "openai") return "openai";
  if (provider === "sarvam" && model === "extract") return "sarvam-extract";
  throw new Error(`${ref} cannot read a receipt: use openai:<vision model> or sarvam:extract`);
}

/**
 * Sarvam Extract wants a description of the fields, not a validator. It does
 * not honour `required` or `additionalProperties`, and OpenAI's strict-mode
 * schema carries both at every level.
 */
export function sarvamSchemaFrom(schema) {
  if (Array.isArray(schema)) return schema.map(sarvamSchemaFrom);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "required" || k === "additionalProperties") continue;
    out[k] = sarvamSchemaFrom(v);
  }
  return out;
}

/** Extract results have been seen both bare and under a single wrapper key. */
export function normaliseSarvamResult(obj) {
  if (!obj || typeof obj !== "object") return obj;
  for (const key of ["fields", "data"]) {
    if (obj[key] && typeof obj[key] === "object" && Object.keys(obj).length === 1) return obj[key];
  }
  return obj;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/receipt-readers.test.js`
Expected: `ℹ pass 3`, `ℹ fail 0`.

- [ ] **Step 5: Rewrite the top of `lib/receipt-vision.js`**

Replace line 1 through the end of the `anthropic()` helper (the block from `import Anthropic` down to `return _anthropic;\n}`) with:

```js
import { SYSTEM_PROMPT, USER_PROMPT, RECEIPT_SCHEMA, parseModelJson } from "@/lib/receipt-prompt";
import { validateExtraction, fieldsAgree } from "@/lib/receipt-validate";
import { parseModelRef } from "@/lib/llm";
import { extractFields } from "@/lib/sarvam-doc";
import { readerKind, sarvamSchemaFrom, normaliseSarvamResult } from "@/lib/receipt-readers";
import { logInfo, logWarn } from "@/lib/logger";

/**
 * Receipt extraction by consensus.
 *
 * Two different model families read every receipt independently. Agreement on
 * the fields that matter is treated as evidence; disagreement is escalated to
 * an adjudicator rather than settled by picking a favourite. The adjudicator
 * is the primary family read again at higher effort — not independent of A,
 * and recorded as such in `modelsUsed`.
 *
 * A = OpenAI vision (GPT reads the image or PDF itself).
 * B = Sarvam Extract (the document model fills the receipt schema).
 */

const MODEL_A = process.env.VISION_MODEL_A || "openai:gpt-5.6";
const MODEL_B = process.env.VISION_MODEL_B || "sarvam:extract";
const MODEL_TIEBREAK = process.env.VISION_MODEL_TIEBREAK || "openai:gpt-5.6";

// Sarvam caps a request at 10 MB and OpenAI images at 20 MB; 5 MB is the
// working ceiling either way. Telegram photos land well under it; an
// uncompressed document scan may not.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SARVAM_RECEIPT_SCHEMA = sarvamSchemaFrom(RECEIPT_SCHEMA);
```

Keep the existing `assertSize` function as is. (Also delete the doc comment block that was above `MODEL_A` if it still mentions Anthropic — the new comment above replaces it.)

- [ ] **Step 6: Replace the providers section**

Delete the whole `callAnthropic` function. Change `callOpenAI`'s signature and body header to accept an effort option, and add the Sarvam reader after `extractOpenAIText`:

```js
async function callOpenAI(model, buffer, mime, { reasoningEffort = null } = {}) {
  assertSize(buffer);
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const data = buffer.toString("base64");
  const isPdf = mime === "application/pdf";

  const filePart = isPdf
    ? { type: "input_file", filename: "receipt.pdf", file_data: `data:application/pdf;base64,${data}` }
    : { type: "input_image", image_url: `data:${mime || "image/jpeg"};base64,${data}`, detail: "high" };

  const body = {
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      { role: "user", content: [filePart, { type: "input_text", text: USER_PROMPT }] },
    ],
    // The Responses API expects the schema under `text.format`. Published docs
    // are inconsistent about this versus `response_format`, so the parser below
    // tolerates plain JSON either way and validation runs regardless.
    text: {
      format: {
        type: "json_schema",
        name: "receipt",
        strict: false,
        schema: RECEIPT_SCHEMA,
      },
    },
  };
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort };
```

(the rest of `callOpenAI` — the `fetch`, error check, and `return` — stays exactly as it is.)

Then add, after `extractOpenAIText`:

```js
/**
 * Sarvam Vision fills the receipt schema itself. What comes back goes through
 * the same validateExtraction as GPT's read, so a number that arrives as a
 * string or a date in Indian order is normalised or rejected by code that
 * already exists rather than by anything Sarvam-specific here.
 */
async function callSarvamExtract(model, buffer, mime) {
  assertSize(buffer);
  const raw = await extractFields(buffer, mime, { schema: SARVAM_RECEIPT_SCHEMA });
  return { json: normaliseSarvamResult(raw), model, raw };
}

function readerFor(ref, opts = {}) {
  const { model } = parseModelRef(ref);
  const kind = readerKind(ref);
  const call = kind === "openai"
    ? (m, buffer, mime) => callOpenAI(m, buffer, mime, opts)
    : callSarvamExtract;
  return { model, call };
}
```

- [ ] **Step 7: Point the consensus at the new readers**

In `extractReceipt`, replace:

```js
  const [a, b] = await Promise.all([
    readWith(callAnthropic, MODEL_A, buffer, mime, "A"),
    readWith(callOpenAI, MODEL_B, buffer, mime, "B"),
  ]);
```

with:

```js
  const readerA = readerFor(MODEL_A);
  const readerB = readerFor(MODEL_B);
  const [a, b] = await Promise.all([
    readWith(readerA.call, readerA.model, buffer, mime, "A"),
    readWith(readerB.call, readerB.model, buffer, mime, "B"),
  ]);
```

and replace:

```js
  const t = await readWith(callAnthropic, MODEL_TIEBREAK, buffer, mime, "T");
```

with:

```js
  const tie = readerFor(MODEL_TIEBREAK, { reasoningEffort: "high" });
  const t = await readWith(tie.call, tie.model, buffer, mime, "T");
```

- [ ] **Step 8: Verify and build**

Run: `grep -n "anthropic\|Anthropic\|claude" lib/receipt-vision.js; npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | tail -2`
Expected: grep empty; tests pass; build clean.

- [ ] **Step 9: Commit**

```bash
git add lib/receipt-vision.js lib/receipt-readers.js tests/receipt-readers.test.js
git commit -m "Read receipts with GPT and Sarvam Extract, adjudicate with GPT at high effort

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Statement transcription on GPT, Sarvam OCR as the fallback

**Files:**
- Modify: `lib/statement-vision.js` (imports, `MODEL`/`MODEL_FALLBACK`, `anthropic()`, `readOnce`, the fallback branch inside `parseStatement`)

**Interfaces:**
- Consumes: `chatJson`, `stripJsonFence`, `parseModelRef` (Task 1); `digitise` (Task 2).
- Produces: `parseStatement(pdf, { userId })` unchanged. Env: `STATEMENT_MODEL` (default `openai:gpt-5.6`), `STATEMENT_MODEL_FALLBACK` (default `sarvam:digitise`). `readOnce(pdf, note, pageLabel, ref)` now takes a ref; `openai:` refs go through the Responses API with the PDF; `sarvam:digitise` OCRs the chunk and asks `sarvam-105b` to transcribe the markdown with the same `SYSTEM_PROMPT`.

- [ ] **Step 1: Replace imports and constants**

Replace line 1 `import Anthropic from "@anthropic-ai/sdk";` with:

```js
import { chatJson, stripJsonFence, parseModelRef } from "@/lib/llm";
import { digitise } from "@/lib/sarvam-doc";
```

Replace `const MODEL = process.env.STATEMENT_MODEL || "claude-opus-5";` with `const MODEL = process.env.STATEMENT_MODEL || "openai:gpt-5.6";`

Replace `const MODEL_FALLBACK = process.env.STATEMENT_MODEL_FALLBACK || "claude-sonnet-5";` with `const MODEL_FALLBACK = process.env.STATEMENT_MODEL_FALLBACK || "sarvam:digitise";`

Delete the `_client` / `anthropic()` block (four lines).

- [ ] **Step 2: Rewrite `readOnce`**

Replace the whole `readOnce` function with:

```js
function userText(note, pageLabel) {
  return [
    pageLabel
      ? `Transcribe pages ${pageLabel} of this statement. They are one slice of a longer document: transcribe every transaction row on these pages, and give header figures only where they are actually printed here.`
      : "Transcribe this statement.",
    note,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** GPT reads the PDF pages itself through the Responses API. */
async function readWithOpenAI(model, pdf, note, pageLabel) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      // Truncation produces invalid JSON rather than a short answer, so the
      // ceiling is generous for the few pages this call covers.
      max_output_tokens: 24000,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        {
          role: "user",
          content: [
            { type: "input_file", filename: "statement.pdf", file_data: `data:application/pdf;base64,${pdf.toString("base64")}` },
            { type: "input_text", text: userText(note, pageLabel) },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`openai ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json?.status === "incomplete" && json?.incomplete_details?.reason === "max_output_tokens") {
    throw new Error("Statement transcription hit the output ceiling — the JSON is incomplete.");
  }

  if (typeof json?.output_text === "string") return json.output_text;
  const parts = [];
  for (const item of json?.output || []) {
    for (const c of item?.content || []) if (typeof c?.text === "string") parts.push(c.text);
  }
  return parts.join("\n");
}

/**
 * Two hops when GPT has no capacity: Sarvam Vision turns the pages into
 * markdown, then Sarvam-105B transcribes that markdown with the same prompt.
 * The tie-out downstream is the judge of both routes alike.
 */
async function readWithSarvam(pdf, note, pageLabel) {
  const markdown = await digitise(pdf, "application/pdf");
  const { text } = await chatJson({
    ref: "sarvam:sarvam-105b",
    system: SYSTEM_PROMPT,
    user: `${userText(note, pageLabel)}\n\nThe statement pages, as OCR markdown:\n\n${markdown}`,
    maxTokens: 24000,
  });
  return text;
}

async function readOnce(pdf, note, pageLabel = null, ref = MODEL) {
  const { provider, model } = parseModelRef(ref);
  const text = provider === "openai"
    ? await readWithOpenAI(model, pdf, note, pageLabel)
    : model === "digitise"
      ? await readWithSarvam(pdf, note, pageLabel)
      : (() => { throw new Error(`${ref} cannot read a statement PDF`); })();
  return parseJson(stripJsonFence(text));
}
```

The fallback branch in `parseStatement` already calls `readOnce(chunk.pdf, note, slice, MODEL_FALLBACK)` and logs `${MODEL}` / `${MODEL_FALLBACK}` — those strings are now refs, which is what the log should say. No change needed there.

- [ ] **Step 3: Verify and build**

Run: `grep -n "anthropic\|Anthropic\|claude\|stop_reason" lib/statement-vision.js; npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | tail -2`
Expected: grep empty; tests pass; build clean.

- [ ] **Step 4: Commit**

```bash
git add lib/statement-vision.js
git commit -m "Transcribe statements with GPT, falling back to Sarvam OCR plus Sarvam-105B

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Remove Anthropic from the repository

**Files:**
- Modify: `package.json` (drop `@anthropic-ai/sdk`), `.env.local.example`, `README.md`, `.env.local` (local only, not committed)

- [ ] **Step 1: Uninstall the SDK**

Run: `npm uninstall @anthropic-ai/sdk`
Expected: `package.json` no longer lists it; lockfile updated.

- [ ] **Step 2: Replace the env example and README lines**

Run: `grep -n "ANTHROPIC\|claude\|Claude\|Anthropic" .env.local.example README.md`

In `.env.local.example`, delete the `ANTHROPIC_API_KEY=` line and add, in its place:

```
# Sarvam — text parsing (sync, harvest) and document extraction (receipts, statement OCR fallback)
SARVAM_API_KEY=
# OpenAI — vision reads (receipts, statements) and text fallbacks
OPENAI_API_KEY=
# Optional overrides, form provider:model. Defaults shown.
# SYNC_MODEL=sarvam:sarvam-105b
# SYNC_MODEL_FALLBACK=openai:gpt-5.6-mini
# HARVEST_MODEL=sarvam:sarvam-105b
# HARVEST_MODEL_FALLBACK=openai:gpt-5.6
# VISION_MODEL_A=openai:gpt-5.6
# VISION_MODEL_B=sarvam:extract
# VISION_MODEL_TIEBREAK=openai:gpt-5.6
# STATEMENT_MODEL=openai:gpt-5.6
# STATEMENT_MODEL_FALLBACK=sarvam:digitise
```

(If `OPENAI_API_KEY=` already exists in the example, do not duplicate it.)

In `README.md`, every mention of Anthropic/Claude as the parser becomes Sarvam-105B (text) or GPT-5.6 (vision); the env table gains `SARVAM_API_KEY` and loses `ANTHROPIC_API_KEY`.

- [ ] **Step 3: Local env**

In `.env.local`: remove `ANTHROPIC_API_KEY=...`, remove `STATEMENT_MODEL=` and `STATEMENT_MODEL_FALLBACK=` (they hold Claude names), add `SARVAM_API_KEY=<key from dashboard.sarvam.ai>`. Do not commit this file.

- [ ] **Step 4: Final sweep**

Run: `grep -rn "anthropic\|Anthropic\|ANTHROPIC\|claude-" lib app scripts package.json .env.local.example README.md`
Expected: nothing. (Matches inside `docs/` are history and stay.)

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"; npm run build 2>&1 | tail -2`
Expected: all pass; build clean.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.local.example README.md
git commit -m "Remove the Anthropic SDK and key; Sarvam and OpenAI are the providers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Replay scripts — prove each job on real data before deploy

**Files:**
- Create: `scripts/replay-sync.js`, `scripts/replay-receipts.js`, `scripts/replay-statement.js`

These run by hand with real keys (`node --env-file=.env.local scripts/<name>.js`). They use `esbuild-register` like `scripts/run-sync.js` so `@/` imports resolve. They are not part of `npm test`.

**Interfaces:**
- Consumes: `parseBatch` (exported in Step 1), `fetchHDFCEmails(sinceDate, { refreshToken })`, `primaryMailAccount(userId)` (returns the row with a decrypted `credential`), `extractReceipt` (Task 5), `parseStatement` (Task 6), `getSupabaseAdmin`, `get` from `lib/storage.js`.

- [ ] **Step 1: Export `parseBatch` from `sync.js`**

In `lib/sync.js`, change `async function parseBatch(emailBatch) {` to `export async function parseBatch(emailBatch) {`. Nothing else in the module changes; the replay drives the same function the cron does, on the same emails, and simply does not write.

- [ ] **Step 2: `scripts/replay-sync.js`**

```js
#!/usr/bin/env node
/* Re-parse the last N days of bank alerts through SYNC_MODEL without
 * writing, and diff against what is already in `transactions`.
 * Usage: node --env-file=.env.local scripts/replay-sync.js [days=30]
 */
const { register } = require("esbuild-register/dist/node");
register();
const { parseBatch } = require("../lib/sync.js");
const { fetchHDFCEmails } = require("../lib/gmail.js");
const { primaryMailAccount } = require("../lib/mail-account.js");
const { getSupabaseAdmin } = require("../lib/supabase.js");

const USER_ID = "115105472683255155618";
const days = Number(process.argv[2] || 30);

(async () => {
  const sb = getSupabaseAdmin();
  const since = new Date(Date.now() - days * 86400e3).toISOString();

  const primary = await primaryMailAccount(USER_ID);
  const emails = await fetchHDFCEmails(since, { refreshToken: primary.credential });
  console.log(`fetched ${emails.length} emails since ${since.slice(0, 10)}`);

  const { data: existing } = await sb
    .from("transactions").select("email_id, merchant, amount, date, category, is_refund")
    .eq("user_id", USER_ID).gte("date", since.slice(0, 10));
  const byEmail = new Map((existing || []).map((t) => [t.email_id, t]));

  const parsed = [];
  for (let i = 0; i < emails.length; i += 15) parsed.push(...(await parseBatch(emails.slice(i, i + 15))));

  let same = 0; const diffs = [];
  for (const p of parsed) {
    if (!(Number.isFinite(p.amount) && p.amount >= 10)) continue; // the cron drops these too
    const e = byEmail.get(p.email_id);
    if (!e) { diffs.push({ email_id: p.email_id, kind: "not in db", parsed: p }); continue; }
    const changed = ["merchant", "amount", "date", "category", "is_refund"].filter((f) => String(e[f]) !== String(p[f]));
    if (changed.length) diffs.push({ email_id: p.email_id, changed, was: e, now: p });
    else same++;
  }
  console.log(`parsed ${parsed.length} · identical ${same} · different ${diffs.length}`);
  for (const d of diffs) console.log(JSON.stringify(d));
  process.exit(diffs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 3: `scripts/replay-receipts.js`**

```js
#!/usr/bin/env node
/* Re-read every receipt on file with the new reader pair and compare
 * merchant/total/currency/date against the stored values.
 * Usage: node --env-file=.env.local scripts/replay-receipts.js [limit=40]
 */
const { register } = require("esbuild-register/dist/node");
register();
const { getSupabaseAdmin } = require("../lib/supabase.js");
const { get } = require("../lib/storage.js");
const { extractReceipt } = require("../lib/receipt-vision.js");

const limit = Number(process.argv[2] || 40);

(async () => {
  const sb = getSupabaseAdmin();
  const { data: rows } = await sb
    .from("receipts")
    .select("id, storage_path, mime, merchant, amount, currency, receipt_date, consensus")
    .eq("source", "telegram").not("amount", "is", null)
    .order("created_at", { ascending: false }).limit(limit);

  let agree = 0, conflict = 0, failed = 0, matched = 0;
  for (const r of rows || []) {
    const buffer = await get(r.storage_path);
    const out = await extractReceipt(buffer, r.mime, { userId: "replay" });
    if (!out.ok) { failed++; console.log(`${r.id} FAILED ${out.error}`); continue; }
    if (out.consensus === "agree") agree++; else if (out.consensus === "conflict") conflict++;
    const v = out.value;
    const ok = Number(v.total) === Number(r.amount) && v.currency === r.currency;
    if (ok) matched++;
    console.log(`${r.id} ${out.consensus.padEnd(8)} ${ok ? "same" : "DIFF"} stored=${r.currency} ${r.amount} now=${v.currency} ${v.total} (${v.merchant})`);
  }
  const n = (rows || []).length;
  console.log(`\n${n} receipts · agree ${agree} · conflict ${conflict} · failed ${failed} · total+currency match ${matched}/${n}`);
  const { data: baseline } = await sb.from("receipts").select("consensus").eq("source", "telegram").not("amount", "is", null);
  const base = (baseline || []).filter((b) => b.consensus === "agree").length / Math.max(1, (baseline || []).length);
  console.log(`stored agree rate (Claude+GPT): ${(base * 100).toFixed(0)}% · new agree rate: ${((agree / Math.max(1, n)) * 100).toFixed(0)}%`);
})().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 4: `scripts/replay-statement.js`**

```js
#!/usr/bin/env node
/* Read each reconciled statement PDF on file with STATEMENT_MODEL and report
 * whether it ties out. Both must.
 * Usage: node --env-file=.env.local scripts/replay-statement.js
 */
const { register } = require("esbuild-register/dist/node");
register();
const { getSupabaseAdmin } = require("../lib/supabase.js");
const { get } = require("../lib/storage.js");
const { parseStatement } = require("../lib/statement-vision.js");
const { decryptPdf } = require("../lib/pdf-decrypt.js");
const { getCardAccount } = require("../lib/card-account.js");

(async () => {
  const sb = getSupabaseAdmin();
  const { data: statements } = await sb
    .from("statements").select("id, user_id, storage_path, issued_on, status")
    .eq("status", "reconciled").order("issued_on", { ascending: false });

  let bad = 0;
  for (const s of statements || []) {
    const card = await getCardAccount(s.user_id);
    const encrypted = await get(s.storage_path, { bucket: "statements" });
    const pdf = await decryptPdf(encrypted, card.statement_password);
    const t0 = Date.now();
    const read = await parseStatement(pdf, { userId: s.user_id });
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`${s.issued_on}: ${read.lines.length} lines · tiesOut=${read.control.tiesOut} · ${secs}s`);
    if (!read.control.tiesOut) { bad++; console.log(JSON.stringify(read.control)); }
  }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
```

Before running, confirm the real names: `grep -n "export" lib/pdf-decrypt.js lib/card-account.js` and the statements bucket name in `lib/statement-ingest.js` (`grep -n "bucket" lib/statement-ingest.js`). Adjust the three `require`/`get` lines to the actual exports.

- [ ] **Step 5: Run all three**

Run, in order:

```
node --env-file=.env.local scripts/replay-sync.js 30
node --env-file=.env.local scripts/replay-receipts.js 40
node --env-file=.env.local scripts/replay-statement.js
```

Expected:
- replay-sync: `different 0`, or every listed difference is one where the new parse is right on inspection (record the verdict in the commit message).
- replay-receipts: `new agree rate` ≥ `stored agree rate`, `failed 0`.
- replay-statement: every statement `tiesOut=true`, exit 0.

A script that fails blocks Task 9. Fix the cause (prompt wording for Sarvam, schema description tweaks, reader options) in the module concerned, re-run `npm test`, re-run the replay, then commit the fix with the replay figures in the message.

- [ ] **Step 6: Commit**

```bash
git add scripts/replay-sync.js scripts/replay-receipts.js scripts/replay-statement.js lib/sync.js
git commit -m "Add replay scripts that prove sync, receipts and statement on real data

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Deploy

**Files:** none in the repo.

- [ ] **Step 1: Set the production environment**

Run:

```
vercel env add SARVAM_API_KEY production
vercel env rm ANTHROPIC_API_KEY production
vercel env rm STATEMENT_MODEL production
vercel env rm STATEMENT_MODEL_FALLBACK production
```

(`vercel env ls production` first; remove only the variables that exist. `OPENAI_API_KEY` is already set.)

- [ ] **Step 2: Push**

Run: `git push origin main`
Expected: Vercel builds; `vercel ls --prod` shows the new deployment `● Ready`.

- [ ] **Step 3: Smoke the live jobs**

Run: `node --env-file=.env.local --input-type=module -e 'const r = await fetch("https://vippy-spend-tracker.vercel.app/api/cron/tick?job=sync", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }); console.log(r.status, await r.text());'`
Expected: `200`, sync result JSON with no `model_failed` entries in `app_logs` (`source = 'sync'`) for the run.

Then `?job=harvest` the same way; expect `errors: 0` and, in `app_logs` (`source = 'harvest'`), a `leftovers_resolved` row and no `model_failed`.

- [ ] **Step 4: Send one receipt photo to the Telegram bot**

Expected: the reply names merchant, total, currency; the `receipts` row shows `models_used` containing `gpt-5.6` and `extract`, `consensus` of `agree` or `tiebreak`.
