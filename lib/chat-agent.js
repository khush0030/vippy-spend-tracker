// lib/chat-agent.js
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { chatWithTools } from "@/lib/llm";
import { TOOL_DEFS, runTool, executeWrite } from "@/lib/chat-tools";
import { systemPrompt, splitTelegram, sanitizeHistory, htmlToPlain } from "@/lib/chat-prompt";
import { currentCycle } from "@/lib/cycles";
import { sendMessage, editMessage, esc } from "@/lib/telegram";
import { logInfo, logWarn, logError } from "@/lib/logger";

/**
 * A question in, an answer out, with tools in between.
 *
 * Sarvam-105B first; if any step of the turn throws, the whole turn is retried
 * once on GPT with the same messages. The model proposes writes; the Confirm
 * button performs them.
 */

const CHAT_MODEL = process.env.CHAT_MODEL || "sarvam:sarvam-105b";
const CHAT_MODEL_FALLBACK = process.env.CHAT_MODEL_FALLBACK || "openai:gpt-5.6";
const HISTORY = 20;
const MAX_TOOL_CALLS = 6;

async function history(chatId, userId) {
  const { data } = await getSupabaseAdmin()
    .from("tg_conversations")
    .select("role, content, tool_calls, tool_call_id")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .limit(HISTORY);
  // confirm:<uuid> rows are pending-write state, not conversation — a tool
  // row with no parent tool_calls would be rejected by both models.
  const rows = (data || []).filter((r) => !String(r.tool_call_id || "").startsWith("confirm:")).reverse();
  // The window edge can cut a call from its results; sanitizeHistory drops
  // any half of a pair the API would reject.
  return sanitizeHistory(rows.map((r) => {
    if (r.role === "tool") return { role: "tool", tool_call_id: r.tool_call_id, content: r.content || "" };
    if (r.role === "assistant" && r.tool_calls) return { role: "assistant", content: r.content, tool_calls: r.tool_calls };
    return { role: r.role, content: r.content || "" };
  }));
}

async function remember(chatId, userId, rows) {
  if (!rows.length) return;
  await getSupabaseAdmin().from("tg_conversations").insert(
    rows.map((m) => ({
      chat_id: chatId, user_id: userId, role: m.role, content: m.content ?? null,
      tool_calls: m.tool_calls ?? null, tool_call_id: m.tool_call_id ?? null,
    }))
  );
}

// The model's HTML is not always valid Telegram HTML; a rejected part is
// resent as plain text so the user still gets an answer.
async function sendPart(chatId, text, opts = {}) {
  try {
    return await sendMessage(chatId, text, opts);
  } catch (err) {
    if (!String(err.message).includes("can't parse entities")) throw err;
    return sendMessage(chatId, htmlToPlain(text), { ...opts, plain: true });
  }
}

async function runLoop({ ref, userId, system, prior, userText, today }) {
  const messages = [{ role: "system", content: system }, ...prior, { role: "user", content: userText }];
  const fresh = [{ role: "user", content: userText }];
  let confirm = null;
  let calls = 0;

  for (;;) {
    const exhausted = calls >= MAX_TOOL_CALLS;
    const { message } = await chatWithTools({
      ref, messages, tools: TOOL_DEFS, toolChoice: exhausted ? "none" : "auto", maxTokens: 2048, think: false,
    });
    // With tool_choice "none" a model may still emit tool_calls; nothing will
    // answer them, and a saved call without results poisons every later turn.
    if (!message.tool_calls?.length || exhausted) {
      const text = message.content ?? "";
      fresh.push({ role: "assistant", content: text });
      return { text, fresh, confirm };
    }
    messages.push(message);
    fresh.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });

    for (const tc of message.tool_calls) {
      calls++;
      // A single message can carry more tool calls than the budget allows —
      // check per call, not per iteration, and still answer every call id.
      if (calls > MAX_TOOL_CALLS) {
        const toolMsg = { role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "tool budget for this turn is used up" }) };
        messages.push(toolMsg);
        fresh.push(toolMsg);
        continue;
      }
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
      const result = await runTool({ userId, name: tc.function.name, args, today });
      const parsed = JSON.parse(result);
      if (parsed.confirm && !confirm) confirm = parsed.confirm;
      const toolMsg = { role: "tool", tool_call_id: tc.id, content: result };
      messages.push(toolMsg);
      fresh.push(toolMsg);
    }
  }
}

export async function chatTurn({ userId, chatId, text }) {
  const today = new Date().toISOString().slice(0, 10);
  const cycle = await currentCycle(userId).catch(() => null);
  const cardLabel = cycle?.card ? `${cycle.card.label} ···${cycle.card.last4}` : "corporate card";
  const system = systemPrompt({ today, cycle, cardLabel });
  const prior = await history(chatId, userId);

  let out = null;
  for (const ref of [CHAT_MODEL, CHAT_MODEL_FALLBACK]) {
    try {
      out = await runLoop({ ref, userId, system, prior, userText: text, today });
      await logInfo({ source: "chat", event: "turn", userId, message: `${ref}: ${text.slice(0, 80)}` });
      break;
    } catch (err) {
      await logWarn({ source: "chat", event: "model_failed", userId, message: `${ref}: ${err.message.slice(0, 200)}` });
    }
  }

  if (!out) {
    await logError({ source: "chat", event: "turn_failed", userId, message: `Both models failed for: ${text.slice(0, 80)}` });
    return sendMessage(chatId, "I couldn't look that up just now. Try again in a minute.");
  }

  await remember(chatId, userId, out.fresh);

  if (out.confirm) {
    const confirmId = crypto.randomUUID();
    await remember(chatId, userId, [{ role: "tool", tool_call_id: `confirm:${confirmId}`, content: JSON.stringify(out.confirm) }]);
    const summary = out.text?.trim() || esc(out.confirm.summary);
    // confirm.summary carries raw merchant names (e.g. "AT&T") — escape it,
    // but leave `summary` (the model's own HTML) alone.
    const combined = `${summary}\n\n<i>${esc(out.confirm.summary)}</i>`;
    const keyboard = [[
      { text: "✅ Confirm", callback_data: `cf:${confirmId}` },
      { text: "✖ Cancel", callback_data: `cx:${confirmId}` },
    ]];
    const parts = splitTelegram(combined);
    for (let i = 0; i < parts.length; i++) {
      await sendPart(chatId, parts[i], i === parts.length - 1 ? { keyboard } : {});
    }
    return;
  }

  for (const part of splitTelegram(out.text || "…")) await sendPart(chatId, part);
}

const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

async function pending(chatId, confirmId) {
  const { data } = await getSupabaseAdmin()
    .from("tg_conversations")
    .select("id, user_id, content, created_at")
    .eq("chat_id", chatId)
    .eq("tool_call_id", `confirm:${confirmId}`)
    .maybeSingle();
  return data ? { row: data, confirm: JSON.parse(data.content) } : null;
}

export async function confirmWrite({ userId, chatId, messageId, confirmId }) {
  const sb = getSupabaseAdmin();
  const p = await pending(chatId, confirmId);
  const expired = () => editMessage(chatId, messageId, "That confirmation has expired.");
  if (!p || p.row.user_id !== userId) return expired();
  // Claim the row before writing: a double tap finds nothing left to claim.
  const { data: claimed } = await sb.from("tg_conversations").delete().eq("id", p.row.id).eq("user_id", userId).select("id");
  if (!claimed?.length) return expired();
  if (Date.now() - new Date(p.row.created_at).getTime() > CONFIRM_TTL_MS) return expired();

  let done;
  try {
    done = await executeWrite({ userId, kind: p.confirm.kind, payload: p.confirm.payload });
  } catch (err) {
    // Put the proposal back so the button still works once the cause is fixed.
    await sb.from("tg_conversations").insert({
      chat_id: chatId, user_id: userId, role: "tool", tool_call_id: `confirm:${confirmId}`, content: p.row.content,
    });
    await logWarn({ source: "chat", event: "write_failed", userId, message: `${p.confirm.kind}: ${String(err.message).slice(0, 200)}` });
    return editMessage(chatId, messageId, esc("Couldn't apply that — nothing changed."));
  }
  await remember(chatId, userId, [{ role: "user", content: `[confirmed: ${p.confirm.summary}]` }, { role: "assistant", content: done }]);
  await logInfo({ source: "chat", event: "write", userId, message: `${p.confirm.kind}: ${p.confirm.summary}` });
  return editMessage(chatId, messageId, `✅ ${esc(done)}`);
}

export async function cancelWrite({ userId, chatId, messageId, confirmId }) {
  const p = await pending(chatId, confirmId);
  if (p && p.row.user_id === userId) await getSupabaseAdmin().from("tg_conversations").delete().eq("id", p.row.id);
  return editMessage(chatId, messageId, "Cancelled — nothing changed.");
}
