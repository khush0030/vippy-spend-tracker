# Sarvam + GPT as the model providers — design

**Date:** 2026-09-14
**Status:** approved
**Scope:** replace every Anthropic call with Sarvam (text, document OCR/extraction) or OpenAI
(vision), behind environment switches, with Claude defaults kept until each job is cut over.

## Why

Four jobs call a model. All four currently depend on Anthropic; today the Anthropic balance ran
dry and the harvester's leftover step and the daily sync both stopped. Sarvam-105B is roughly
ten times cheaper than Sonnet on text and is a GA Indian provider; GPT-5.6 is already the second
reader in receipt consensus and is the strongest reader of European receipts available to us.
The end state uses two vendors, neither of them Anthropic.

## Model jobs and their new homes

| Job | File | Input | Today | After |
|---|---|---|---|---|
| Bank-alert parsing | `lib/sync.js` | text | `claude-sonnet-5` | `sarvam-105b`, fallback `gpt-5.6-mini` |
| Harvest leftovers | `lib/harvest-ai.js` | text | `claude-opus-5` → `claude-sonnet-5` | `sarvam-105b`, fallback `gpt-5.6` |
| Receipt consensus | `lib/receipt-vision.js` | image/PDF | A `claude-sonnet-5`, B `gpt-5.6`, tiebreak `claude-opus-5` | A `gpt-5.6`, B Sarvam Extract, tiebreak `gpt-5.6` at `reasoning.effort: "high"` |
| Statement transcription | `lib/statement-vision.js` | PDF | `claude-opus-5` → `claude-sonnet-5` | `gpt-5.6`, fallback Sarvam Digitise → `sarvam-105b` |

Every choice is an environment variable with the *current* Claude model as its default, so the
deployed app changes nothing until a variable is set. The Anthropic client and SDK are removed
only in the final step, after every default has been flipped.

## Component 1 — `lib/llm.js`, one text-chat door

Sarvam and OpenAI both speak the OpenAI chat-completions protocol, so one module owns both:

```js
chatJson({ provider, model, system, user, maxTokens, temperature })
  // -> { text, model, provider }
```

- `provider: "sarvam"` → `new OpenAI({ apiKey: SARVAM_API_KEY, baseURL: "https://api.sarvam.ai/v1" })`.
  Sarvam accepts `Authorization: Bearer` for OpenAI-compatible tooling. Default `max_tokens`
  there is 2048, so it is always passed explicitly; reasoning tokens count against it.
- `provider: "openai"` → the stock client. Uses `chat.completions` too; the Responses API stays
  only in the vision paths, which need `input_file` / `input_image`.
- Model strings carry their provider as a prefix, `sarvam:sarvam-105b`, `openai:gpt-5.6`, so a
  single env var names both. `parseModelRef("sarvam:sarvam-105b")` → `{ provider, model }`. A
  bare name with no prefix is an error, not a guess.
- No retries or fallbacks inside `chatJson`; callers already have their own fallback loops
  (`harvest-ai.js`) or none by design (`sync.js`, which the cron retries daily).

Pure and tested: `parseModelRef`, and a `stripJsonFence` helper shared with
`receipt-prompt.js`'s `parseModelJson` (Sarvam-105B fences JSON in markdown more readily than
Claude does).

## Component 2 — `lib/sarvam-doc.js`, the Document AI job lifecycle

Sarvam Vision is asynchronous: create a job, poll `/doc-ai/v1/job/{id}/status`, fetch a download
URL, download a ZIP. This module hides that behind two functions:

```js
extractFields(buffer, mime, { schema, language = "en-IN", timeoutMs })  // -> parsed JSON
digitise(buffer, mime, { timeoutMs })                                     // -> markdown string
```

Uses the `sarvamai` npm client (`client.docAi.extract` / `digitise`, `getStatus`,
`getDownloadUrl`). Polls every 3 s; terminal statuses are `completed`, `partially_completed`,
`failed`, `rejected`. Anything but `completed` throws — a partially read receipt is not a
second opinion. The ZIP is opened with the `zip.js` machinery already in the repo, or `jszip`
if that proves write-only; the JSON file inside is the result. Limits enforced before upload:
10 pages, 200 MB; a statement chunk from `pdf-pages.js` is already ≤ 10 pages.

`api-subscription-key` header authentication; `SARVAM_API_KEY` env var.

## Component 3 — receipt consensus with a Sarvam reader

`receipt-vision.js` keeps its shape: two independent reads, `fieldsAgree`, adjudicate on
conflict. What changes is who reads.

- **A** `callOpenAI(VISION_MODEL_A)` — unchanged code path, now the primary.
- **B** `callSarvamExtract` — `extractFields` with a JSON schema derived from `RECEIPT_SCHEMA`
  in `receipt-prompt.js` (same field names: `doc_type, merchant, merchant_raw, total, subtotal,
  tax_total, currency, date, tax_id, dcc_amount_inr, line_items, tax_breakdown, …`). The result
  goes through the same `validateExtraction` as A's, so a Sarvam quirk (a number as a string,
  a date in Indian order) is normalised or rejected by code that already exists.
- **Tiebreak** `callOpenAI(VISION_MODEL_TIEBREAK, { reasoningEffort: "high" })` — a fresh
  read, not a judgement of A and B. This is the same family as A; that is an accepted loss of
  independence, recorded in the audit trail as `modelsUsed`.

The reader is chosen by the provider prefix of the env var, so `VISION_MODEL_B=sarvam:extract`
selects the Sarvam path and `openai:gpt-5.6` or `anthropic:claude-sonnet-5` select the others
while Anthropic still exists.

## Component 4 — statement transcription on GPT

`statement-vision.js` already chunks the PDF and retries per chunk. `readOnce` gains a provider
switch: for `openai:` models it sends the chunk as `input_file` through the Responses API with
the same system prompt and the same `max_output_tokens` budget; the `stop_reason ===
"max_tokens"` guard becomes a check on `incomplete_details.reason === "max_output_tokens"`.

Fallback when GPT has no capacity: `digitise` the chunk with Sarvam, then ask `sarvam-105b` to
turn the markdown into the statement JSON with the existing prompt. Two hops, and the tie-out
gate in `statement-recon.js` remains the judge: rows that do not sum to the printed totals fail
the statement, as they do today.

## Configuration

```
SARVAM_API_KEY=
SYNC_MODEL=sarvam:sarvam-105b            SYNC_MODEL_FALLBACK=openai:gpt-5.6-mini
HARVEST_MODEL=sarvam:sarvam-105b         HARVEST_MODEL_FALLBACK=openai:gpt-5.6
VISION_MODEL_A=openai:gpt-5.6            VISION_MODEL_B=sarvam:extract
VISION_MODEL_TIEBREAK=openai:gpt-5.6
STATEMENT_MODEL=openai:gpt-5.6           STATEMENT_MODEL_FALLBACK=sarvam:digitise
```

Until set, each defaults to today's `anthropic:` value. `ANTHROPIC_API_KEY` and
`@anthropic-ai/sdk` are deleted in the last task, together with the `anthropic:` branch.

## Cutover, one job at a time

1. **Sync** — replay the last 30 days of HDFC alert emails through `sarvam-105b` with a script,
   diff the JSON against the `transactions` rows Claude produced. Flip `SYNC_MODEL` only when
   the diff is empty or every difference is Sarvam being right.
2. **Harvest leftovers** — flip; the sum check makes a wrong proposal harmless.
3. **Receipts** — run the Sarvam reader over the receipts already on file and compare against
   the stored consensus values. Flip when the agreement rate is at least what Claude-vs-GPT
   achieved (the `consensus` field on existing rows gives the baseline).
4. **Statement** — run GPT over the two reconciled statements on file; both must pass tie-out.
   Flip.
5. Remove Anthropic.

## Testing

- `tests/llm.test.js` — `parseModelRef`, `stripJsonFence`.
- `tests/sarvam-doc.test.js` — polling loop against a fake client: completes, fails, times out,
  rejects `partially_completed`.
- `tests/receipt-vision.test.js` — the Sarvam reader's output goes through `validateExtraction`
  and `fieldsAgree` like any other (fixture JSON, no network).
- Replay scripts under `scripts/` for the four cutover checks; they hit real APIs and are run by
  hand, not by `npm test`.

## Out of scope

- Changing any prompt beyond what a different model needs to return the same JSON.
- Gemma 4 or GLM models; beta, and nothing here needs them.
- Sarvam speech, translation, or the dashboard products.
