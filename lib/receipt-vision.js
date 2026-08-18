import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, USER_PROMPT, RECEIPT_SCHEMA, parseModelJson } from "@/lib/receipt-prompt";
import { validateExtraction, fieldsAgree } from "@/lib/receipt-validate";
import { logInfo, logWarn } from "@/lib/logger";

/**
 * Receipt extraction by consensus.
 *
 * Two different model families read every receipt independently. Agreement on
 * the fields that can corrupt a submission — total, date, currency — is strong
 * evidence. Disagreement is escalated to a third model rather than settled by
 * a coin toss. Accuracy was the stated priority; this is where it is bought.
 *
 * Model ids are env-overridable because provider naming moves faster than this
 * codebase does.
 */

const MODEL_A = process.env.VISION_MODEL_A || "claude-sonnet-5";
const MODEL_B = process.env.VISION_MODEL_B || "gpt-5.6";
const MODEL_TIEBREAK = process.env.VISION_MODEL_TIEBREAK || "claude-opus-5";

// Anthropic rejects base64 images over 5 MB. Telegram photos land well under
// this; an uncompressed document scan may not.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

let _anthropic = null;
function anthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function assertSize(buffer) {
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB. Send a photo rather than a full-resolution scan.`
    );
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function callAnthropic(model, buffer, mime) {
  assertSize(buffer);
  const data = buffer.toString("base64");
  const isPdf = mime === "application/pdf";

  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data } };

  const res = await anthropic().messages.create({
    model,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [block, { type: "text", text: USER_PROMPT }] }],
  });

  const text = (res.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return { json: parseModelJson(text), model, raw: text };
}

async function callOpenAI(model, buffer, mime) {
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

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`openai ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  return { json: parseModelJson(extractOpenAIText(json)), model, raw: json };
}

/** Responses API returns a tree; `output_text` is the convenience field. */
function extractOpenAIText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;

  const parts = [];
  for (const item of payload?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Consensus
// ---------------------------------------------------------------------------

async function readWith(provider, model, buffer, mime, label) {
  try {
    const { json, raw } = await provider(model, buffer, mime);
    if (!json) return { model, label, ok: false, error: "no parseable JSON" };

    const validated = validateExtraction(json, {});
    return { model, label, ok: true, json, validated, raw };
  } catch (err) {
    await logWarn({
      source: "vision",
      event: "model_failed",
      message: `${label} (${model}) failed: ${err.message}`,
    });
    return { model, label, ok: false, error: err.message };
  }
}

/**
 * Read one receipt.
 *
 * Returns the agreed value plus a full audit trail of what each model said —
 * stored on the row so a later prompt improvement can be re-derived without
 * paying for the vision call again.
 */
export async function extractReceipt(buffer, mime, { userId } = {}) {
  const [a, b] = await Promise.all([
    readWith(callAnthropic, MODEL_A, buffer, mime, "A"),
    readWith(callOpenAI, MODEL_B, buffer, mime, "B"),
  ]);

  const usable = [a, b].filter((r) => r.ok && r.validated?.usable);

  // Both providers failed or neither produced a usable read.
  if (usable.length === 0) {
    return {
      ok: false,
      consensus: "failed",
      error: a.error || b.error || "no usable extraction",
      models: [a, b],
    };
  }

  // Only one model came back — usable, but explicitly lower confidence, and
  // never auto-matched on its own downstream.
  if (usable.length === 1) {
    const only = usable[0];
    await logWarn({
      source: "vision",
      event: "single_model",
      userId,
      message: `Only ${only.label} returned a usable read; confidence reduced`,
    });
    return {
      ok: true,
      consensus: "single",
      value: only.validated.value,
      confidence: clamp((only.json.confidence ?? 0.7) - 0.15 - only.validated.confidencePenalty),
      modelsUsed: [only.model],
      issues: only.validated.issues,
      raw: { a: a.json ?? null, b: b.json ?? null },
    };
  }

  const agreement = fieldsAgree(a.validated.value, b.validated.value);

  if (agreement.agree) {
    const confidence = clamp(
      Math.min(a.json.confidence ?? 0.9, b.json.confidence ?? 0.9) +
        0.05 - // independent agreement is itself evidence
        Math.max(a.validated.confidencePenalty, b.validated.confidencePenalty)
    );

    await logInfo({
      source: "vision",
      event: "consensus",
      userId,
      message: `Both models agree (${confidence.toFixed(2)})`,
    });

    return {
      ok: true,
      consensus: "agree",
      value: mergeReadings(a.validated.value, b.validated.value),
      confidence,
      modelsUsed: [a.model, b.model],
      issues: [...a.validated.issues, ...b.validated.issues],
      raw: { a: a.json, b: b.json },
    };
  }

  // They disagree on something that matters. Pay for an adjudicator.
  const t = await readWith(callAnthropic, MODEL_TIEBREAK, buffer, mime, "T");

  if (!t.ok || !t.validated?.usable) {
    return {
      ok: true,
      consensus: "conflict",
      value: a.validated.value, // surfaced to the human, never auto-matched
      confidence: 0.4,
      conflicts: agreement.conflicts,
      modelsUsed: [a.model, b.model],
      issues: a.validated.issues,
      raw: { a: a.json, b: b.json },
    };
  }

  // The adjudicator siding with one of the two settles it.
  const withA = fieldsAgree(t.validated.value, a.validated.value).agree;
  const withB = fieldsAgree(t.validated.value, b.validated.value).agree;
  const winner = withA ? a : withB ? b : t;

  await logInfo({
    source: "vision",
    event: "tiebreak",
    userId,
    message: `Models disagreed on ${agreement.conflicts.join(", ")}; tiebreak sided with ${winner.label}`,
  });

  return {
    ok: true,
    consensus: "tiebreak",
    value: winner.validated.value,
    confidence: withA || withB ? 0.8 : 0.55,
    conflicts: agreement.conflicts,
    modelsUsed: [a.model, b.model, t.model],
    issues: winner.validated.issues,
    raw: { a: a.json, b: b.json, tiebreak: t.json },
  };
}

/**
 * When both agree on the numbers, prefer whichever read a field at all —
 * one model often catches an invoice number or GSTIN the other misses.
 */
function mergeReadings(a, b) {
  const out = { ...b, ...a };
  for (const key of Object.keys(out)) {
    if (out[key] == null && b[key] != null) out[key] = b[key];
    if (out[key] == null && a[key] != null) out[key] = a[key];
  }
  return out;
}

function clamp(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}
