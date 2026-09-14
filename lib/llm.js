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
  think = true,
  fetch = globalThis.fetch,
}) {
  const { provider, model } = parseModelRef(ref);
  const cfg = PROVIDERS[provider];
  const key = process.env[cfg.keyVar];
  if (!key) throw new Error(`${cfg.keyVar} is not set`);

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const body = { model, messages, max_tokens: maxTokens, temperature };
  // Sarvam-105B thinks by default, and its reasoning tokens come out of
  // max_tokens: a 15-email batch spent all 4096 thinking and returned no
  // answer. Structured extraction does not need it, so callers switch it off.
  if (provider === "sarvam" && !think) body.reasoning_effort = null;

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cfg.headers(key) },
    // Sarvam's default max_tokens is 2048 and reasoning tokens count against
    // it, so the ceiling is always explicit.
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const choice = json?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    const why = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
    throw new Error(`${provider} returned no text${why}`);
  }
  return { text, model, provider };
}
