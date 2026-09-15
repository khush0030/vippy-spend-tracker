// lib/chat-prompt.js
/**
 * What the assistant is told about itself. Kept short: the tools carry the
 * knowledge, the prompt carries the manners. No @/ imports.
 */

export function systemPrompt({ today, cycle, cardLabel }) {
  const cycleLine = cycle
    ? `The current statement cycle runs ${cycle.cycle_start} to ${cycle.cycle_end}.`
    : "No card is configured yet.";
  return [
    `You are the Receipt Rail assistant on Telegram for one person's corporate card (${cardLabel}). Today is ${today}. ${cycleLine} Amounts are INR unless a tool says otherwise.`,
    "Every number you state must come from a tool call in this conversation — never estimate, never recall from earlier turns. Never add up rows yourself: quote totals a tool returned (spend_summary has period and per-category totals), or list the items without a total. If a tool returns an error, say what you could not look up.",
    "Reply in Telegram HTML: <b>bold</b>, <i>italic</i>, <code>code</code>; no Markdown, no headings. Format rupees with Indian grouping (₹1,23,456). Keep it under 12 lines unless a list was asked for; lead with the answer, then the detail.",
    "For advice questions (overspending, budgeting), answer from the aggregates you fetched and show the numbers; do not invent benchmarks.",
    "Write tools only propose; the user confirms with a button. After proposing, say what will happen and stop.",
    "If the user writes in Hinglish or Hindi, answer the same way.",
  ].join("\n\n");
}

export function splitTelegram(text, max = 3900) {
  const s = String(text ?? "");
  if (s.length <= max) return [s];
  const parts = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut + (rest[cut] === "\n" ? 1 : 0));
  }
  parts.push(rest);
  return parts;
}

/**
 * Keep only history both APIs accept: an assistant message with tool_calls
 * must be followed by a tool result for every call id, and a tool result
 * must answer a call made before it. Anything else — a turn cut off after
 * the calls, a window edge, a row saved by an older bug — is dropped rather
 * than letting one bad row reject every later turn.
 */
export function sanitizeHistory(messages) {
  const list = messages || [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.role === "assistant" && m.tool_calls?.length) {
      const answered = new Set();
      let j = i + 1;
      for (; j < list.length && list[j].role === "tool"; j++) answered.add(list[j].tool_call_id);
      if (!m.tool_calls.every((tc) => answered.has(tc.id))) continue;
      const ids = new Set(m.tool_calls.map((tc) => tc.id));
      out.push(m);
      for (let k = i + 1; k < j; k++) if (ids.has(list[k].tool_call_id)) out.push(list[k]);
      i = j - 1;
      continue;
    }
    // Tool rows reached here have no assistant call right before them.
    if (m.role === "tool") continue;
    out.push(m);
  }
  return out;
}
