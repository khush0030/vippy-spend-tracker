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

/**
 * The request both providers accept, with the three places they differ:
 * the token-ceiling field name, whether temperature may be sent, and how
 * reasoning is switched off.
 */
function requestBody({ provider, model, messages, maxTokens, temperature, think, tools, toolChoice }) {
  const body = { model, messages };
  // GPT reasoning models 400 on any temperature but the default; Sarvam
  // takes it and 0 keeps its extraction deterministic.
  if (provider === "sarvam") body.temperature = temperature;
  // OpenAI's /v1/chat/completions rejects `max_tokens` outright ("Use
  // 'max_completion_tokens'"); Sarvam's protocol still expects `max_tokens`.
  if (provider === "openai") body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;
  // Sarvam-105B thinks by default and its reasoning tokens come out of
  // max_tokens; OpenAI's reasoning models do the same from
  // max_completion_tokens. Structured work does not need it. GPT-5.6 refuses
  // function tools on chat/completions at any effort but "none" (live, 2026-09-15).
  if (!think) body.reasoning_effort = provider === "sarvam" ? null : tools ? "none" : "low";
  if (tools) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  return body;
}

// A hung provider would otherwise hold the request open until the platform
// kills it. chatJson serves long statement and vision jobs, so only callers
// that pass timeoutMs get one.
async function post({ provider, model, body, fetch, timeoutMs = null }) {
  const cfg = PROVIDERS[provider];
  const key = process.env[cfg.keyVar];
  if (!key) throw new Error(`${cfg.keyVar} is not set`);
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cfg.headers(key) },
    body: JSON.stringify(body),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

export async function chatJson({
  ref,
  system = null,
  user,
  maxTokens = 4096,
  temperature = 0,
  think = true,
  timeoutMs = null,
  fetch = globalThis.fetch,
}) {
  const { provider, model } = parseModelRef(ref);

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const body = requestBody({ provider, model, messages, maxTokens, temperature, think });
  const json = await post({ provider, model, body, fetch, timeoutMs });

  const choice = json?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    const why = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
    throw new Error(`${provider} returned no text${why}`);
  }
  if (choice?.finish_reason === "length") {
    throw new Error(`${provider} output truncated (finish_reason: length)`);
  }
  return { text, model, provider };
}

/**
 * One turn of a tool-calling conversation. The caller owns the loop: it runs
 * the tools named in `message.tool_calls`, appends `{ role: "tool" }` results
 * and calls again.
 */
export async function chatWithTools({
  ref, messages, tools, toolChoice = "auto", maxTokens = 2048, think = false, timeoutMs = 45000, fetch = globalThis.fetch,
}) {
  const { provider, model } = parseModelRef(ref);
  const body = requestBody({ provider, model, messages, maxTokens, temperature: 0, think, tools, toolChoice });
  const json = await post({ provider, model, body, fetch, timeoutMs });
  const choice = json?.choices?.[0];
  if (!choice?.message) throw new Error(`${provider} returned no message`);
  return { message: choice.message, finishReason: choice.finish_reason || "stop" };
}
