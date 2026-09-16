// lib/chat-prompt.js
/**
 * What the assistant is told about itself. Kept short: the tools carry the
 * knowledge, the prompt carries the manners. No @/ imports.
 */

export function systemPrompt({ today, cycle, billing = cycle, cardLabel }) {
  let cycleLine = "No card is configured yet.";
  if (cycle && billing && billing.cycle_start !== cycle.cycle_start) {
    cycleLine = `The billing cycle — the statement being paid, whose receipts are still being chased — runs ${billing.cycle_start} to ${billing.cycle_end}; "missing receipts" means this cycle unless the user names another. A new cycle opened ${cycle.cycle_start}.`;
  } else if (cycle) {
    cycleLine = `The current statement cycle runs ${cycle.cycle_start} to ${cycle.cycle_end}.`;
  }
  return [
    `You are the Receipt Rail assistant on Telegram for one person's corporate card (${cardLabel}). Today is ${today}. ${cycleLine} Amounts are INR unless a tool says otherwise.`,
    "Every number you state must come from a tool call made for this message — never estimate, never repeat figures from earlier replies. Receipts and charges change between messages (a receipt photo can arrive at any time), so re-run the tool even when you answered the same question a minute ago. Never add up rows yourself: quote totals a tool returned (spend_summary has period and per-category totals), or list the items without a total. If a tool returns an error, say what you could not look up.",
    "Reply in Telegram HTML: <b>bold</b>, <i>italic</i>, <code>code</code>; no Markdown, no headings. Format rupees with Indian grouping (₹1,23,456). Keep it under 12 lines unless a list was asked for; lead with the answer, then the detail.",
    "Two different things are 'pending': charges without a receipt (missing_receipts) and receipts the user sent that have not matched a charge yet (waiting_receipts). For a vague question like 'what is pending' or 'what is left', check both. When a waiting receipt has could_be, offer to file it with match_receipt.",
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

/**
 * Telegram HTML as plain text, for when Telegram refuses the markup: tags go,
 * the three entities the prompt's HTML uses become their characters again.
 */
export function htmlToPlain(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * A receipt filed through the photo path, as a history pair the chat model
 * reads next turn. Without it the model never learns a receipt arrived and
 * answers "what's left" from its last reply.
 */
export function receiptNote(receipt, verdict) {
  const r = receipt || {};
  const what = [r.merchant || "unknown merchant", r.amount != null ? `${r.currency || "INR"} ${r.amount}` : null, r.receipt_date]
    .filter(Boolean)
    .join(" · ");
  let outcome;
  if (!verdict) outcome = "It could not be read yet and will be retried.";
  else if (verdict.action === "duplicate") outcome = `Not filed — transaction ${verdict.best?.transaction_id} already has its bill, so this is kept aside as a duplicate copy.`;
  else if (verdict.action === "auto") outcome = `Matched to transaction ${verdict.best?.transaction_id}.`;
  else if (verdict.action === "ask") {
    const n = verdict.candidates?.length || 0;
    outcome = verdict.conflicted || !n
      ? "Not matched yet — the user was asked to confirm the values."
      : `Not matched yet — ${n} charge${n === 1 ? "" : "s"} could fit and the user was asked to pick one.`;
  } else outcome = "Not matched to a charge yet — it is waiting for the bank alert.";
  return [
    { role: "user", content: "[sent a receipt photo]" },
    { role: "assistant", content: `Saved receipt: ${what}. ${outcome}` },
  ];
}

/** Whether a reply states amounts or counts — which only a tool call may supply. */
export function statesFigures(text) {
  return /₹|\d{2,}/.test(htmlToPlain(text));
}

/**
 * Rupee figures in a reply that no tool result from this turn contains.
 * A model with a long history will copy last turn's total even after a
 * fresh lookup returned a different one.
 */
export function ungroundedAmounts(text, toolContents) {
  const known = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === "object") return Object.values(v).forEach(walk);
    const n = Number(v);
    if (v !== "" && Number.isFinite(n)) known.add(n.toFixed(2));
  };
  for (const c of toolContents || []) {
    try { walk(JSON.parse(c)); } catch { /* not JSON: nothing to ground on */ }
  }
  const out = [];
  for (const m of htmlToPlain(text).matchAll(/₹\s?(\d[\d,]*(?:\.\d+)?)/g)) {
    if (!known.has(Number(m[1].replace(/,/g, "")).toFixed(2))) out.push(m[0]);
  }
  return out;
}
