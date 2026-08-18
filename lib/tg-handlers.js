import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage, editMessage, answerCallback, extractAttachment, esc } from "@/lib/telegram";
import { intakeFromTelegram } from "@/lib/receipt-intake";
import { processReceipt } from "@/lib/receipt-pipeline";
import { linkReceipt, unlinkReceipt, matchReceipt } from "@/lib/match-service";
import { sendSubmission } from "@/lib/submission-mail";
import { currentCycle, cycleCoverage } from "@/lib/cycles";
import { logError, logInfo, logWarn } from "@/lib/logger";

const INR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** Only chats bound to a user via a one-time code may talk to the bot. */
export async function resolveUser(chatId) {
  const { data } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("user_id, tg_username")
    .eq("tg_chat_id", chatId)
    .not("linked_at", "is", null)
    .maybeSingle();
  return data?.user_id || null;
}

export async function createLinkCode(userId) {
  const code = "VIP-" + crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5);
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error } = await getSupabaseAdmin().from("telegram_links").upsert(
    { user_id: userId, link_code: code, code_expires_at: expires },
    { onConflict: "user_id" }
  );
  if (error) throw new Error(`link code failed: ${error.message}`);

  return { code, expiresAt: expires };
}

async function consumeLinkCode(code, chatId, username) {
  const sb = getSupabaseAdmin();

  const { data: row } = await sb
    .from("telegram_links")
    .select("user_id, code_expires_at")
    .eq("link_code", code)
    .maybeSingle();

  if (!row) return { ok: false, reason: "unknown" };
  if (row.code_expires_at && new Date(row.code_expires_at) < new Date()) {
    return { ok: false, reason: "expired" };
  }

  const { error } = await sb
    .from("telegram_links")
    .update({
      tg_chat_id: chatId,
      tg_username: username || null,
      linked_at: new Date().toISOString(),
      link_code: null,
      code_expires_at: null,
    })
    .eq("user_id", row.user_id);

  if (error) return { ok: false, reason: "db" };
  return { ok: true, userId: row.user_id };
}

const HELP = [
  "<b>Receipt Rail</b> — send me a photo of any bill and I'll file it against the right charge.",
  "",
  "/status — this cycle's coverage and totals",
  "/missing — charges still without a receipt",
  "/unmatched — receipts still waiting for a transaction",
  "/last — show and undo the last match",
  "/statement — how the last statement reconciled",
  "/help — this list",
].join("\n");

/**
 * Read-only view of the last reconciliation.
 *
 * Deliberately does not re-run one: reading a statement costs a model call and
 * the numbers do not change between runs, so the stored verdict is the answer.
 */
async function statementText(userId) {
  const sb = getSupabaseAdmin();

  const { data: statement } = await sb
    .from("statements")
    .select("*")
    .eq("user_id", userId)
    .order("issued_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!statement) {
    return "No statement has arrived yet. HDFC issues it on the 18th and I pick it up from Gmail automatically.";
  }

  const { data: lines } = await sb
    .from("statement_lines")
    .select("type, recon_status, amount, descriptor")
    .eq("statement_id", statement.id);

  const rows = lines || [];
  const count = (fn) => rows.filter(fn).length;
  const diff = Number(statement.tie_out_diff ?? 0);
  const tiesOut = statement.status === "reconciled" && Math.abs(diff) <= 0.5;

  return [
    `📄 <b>Statement ${statement.issued_on}</b>`,
    `${statement.period_start || "?"} → ${statement.period_end || "?"} · ${rows.length} lines`,
    tiesOut
      ? "Closing balance <b>ties out</b> ✅"
      : `Closing balance <b>off by ₹${Math.abs(diff).toLocaleString("en-IN")}</b> ⛔`,
    "",
    `✅ ${count((l) => l.recon_status === "tied")} matched to charges we already had`,
    `➕ ${count((l) => l.recon_status === "created")} created from the statement`,
    `💳 ${count((l) => l.type === "fee")} fee lines · ${count((l) => l.type === "payment")} payments`,
    count((l) => l.recon_status === "unexplained")
      ? `⚠️ ${count((l) => l.recon_status === "unexplained")} unexplained`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function statusText(userId) {
  const cycle = await currentCycle(userId);
  if (!cycle) {
    return "No card configured yet. Add your card details in Settings → Corporate Card first.";
  }

  const c = await cycleCoverage(userId, cycle);
  return [
    `<b>Cycle ${cycle.cycle_start} → ${cycle.cycle_end}</b>`,
    `${c.txnCount} charges · ${INR(c.total)}`,
    `${c.withReceipt} receipts on file · <b>${c.coveragePct}%</b>`,
    c.missing > 0 ? `${c.missing} still missing` : "Nothing outstanding 👍",
  ].join("\n");
}

/** Charges in the open cycle still lacking a receipt, biggest first. */
async function missingText(userId) {
  const cycle = await currentCycle(userId);
  if (!cycle) return "No card configured yet.";

  const minAmount = cycle.card?.min_receipt_amount ?? 500;
  const { data } = await getSupabaseAdmin()
    .from("transactions")
    .select("id, merchant, amount, date")
    .eq("user_id", userId)
    .eq("is_refund", false)
    .eq("receipt_status", "missing")
    .gte("date", cycle.cycle_start)
    .lte("date", cycle.cycle_end)
    .gte("amount", minAmount)
    .order("amount", { ascending: false })
    .limit(15);

  if (!data?.length) return "Nothing outstanding in this cycle 👍";

  const lines = data.map(
    (t) => `<code>${t.date} · ${esc(t.merchant).slice(0, 22)} · ${INR(t.amount)}</code>`
  );
  return `<b>${data.length} charge(s) without a receipt</b>\n${lines.join("\n")}`;
}

/** Receipts that have no home yet — usually waiting on the bank alert. */
async function unmatchedText(userId) {
  const { data } = await getSupabaseAdmin()
    .from("receipts")
    .select("id, merchant, amount, currency, receipt_date")
    .eq("user_id", userId)
    .eq("status", "unmatched")
    .order("receipt_date", { ascending: false })
    .limit(15);

  if (!data?.length) return "Every receipt is filed 👍";

  const lines = data.map(
    (r) =>
      `<code>${r.receipt_date || "?"} · ${esc(r.merchant || "unknown").slice(0, 20)} · ${money(
        r.amount,
        r.currency
      )}</code>`
  );
  return `<b>${data.length} receipt(s) waiting for a charge</b>\n${lines.join(
    "\n"
  )}\n\nThese bind automatically once the matching alert arrives.`;
}

/** The most recent match, with an undo button. */
async function sendLastMatch(chatId, userId) {
  const { data } = await getSupabaseAdmin()
    .from("receipt_transactions")
    .select("receipt_id, transaction_id, match_score, matched_by, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  const link = data?.[0];
  if (!link) return sendMessage(chatId, "No matches yet.");

  const { data: receipt } = await getSupabaseAdmin()
    .from("receipts")
    .select("*")
    .eq("id", link.receipt_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!receipt) return sendMessage(chatId, "No matches yet.");

  return sendMessage(
    chatId,
    `<b>Last match</b> · Txn #${link.transaction_id} · ${esc(link.matched_by)}\n${receiptSummary(
      receipt
    )}`,
    { keyboard: [[{ text: "↩︎ Undo", callback_data: `u:${receipt.id}` }]] }
  );
}

/**
 * Route one Telegram update.
 *
 * Called from `after()` in the webhook, so it runs once the 200 is already on
 * the wire. Nothing here may throw into the response path.
 */
export async function handleUpdate(update) {
  try {
    if (update.callback_query) return await handleCallback(update.callback_query);
    if (update.message) return await handleMessage(update.message);
  } catch (err) {
    await logError({
      source: "telegram",
      event: "handler_failed",
      message: "Unhandled error processing update",
      error: err,
      details: { updateId: update?.update_id },
    });
  }
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const text = (message.text || "").trim();

  // Linking is the only thing an unknown chat may do.
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (!code) {
      return sendMessage(
        chatId,
        "Send <code>/start &lt;code&gt;</code> using the code from Settings → Receipt Bot in your dashboard."
      );
    }
    const result = await consumeLinkCode(code.toUpperCase(), chatId, message.from?.username);
    if (!result.ok) {
      const why = {
        unknown: "That code isn't recognised.",
        expired: "That code has expired — generate a fresh one in Settings.",
        db: "Something went wrong linking this chat. Try again.",
      }[result.reason];
      return sendMessage(chatId, why);
    }

    await logInfo({
      source: "telegram",
      event: "linked",
      userId: result.userId,
      message: `Chat ${chatId} linked`,
    });

    const status = await statusText(result.userId).catch(() => "");
    return sendMessage(
      chatId,
      `<b>Linked.</b> 👋\n\nSend me a photo of any bill and I'll file it against the right charge. /help for commands.\n\n${status}`
    );
  }

  const userId = await resolveUser(chatId);
  if (!userId) {
    // Unknown chat: no storage write, no model call, no cost. Just a nudge.
    await logWarn({
      source: "telegram",
      event: "unlinked_chat",
      message: `Message from unlinked chat ${chatId}`,
    });
    return sendMessage(
      chatId,
      "This chat isn't linked to an account. Open Settings → Receipt Bot in the dashboard and send me the code."
    );
  }

  const attachment = extractAttachment(message);
  if (attachment) return handleAttachment({ userId, chatId, message, attachment });

  if (text.startsWith("/help")) return sendMessage(chatId, HELP);
  if (text.startsWith("/status")) return sendMessage(chatId, await statusText(userId));
  if (text.startsWith("/missing")) return sendMessage(chatId, await missingText(userId));
  if (text.startsWith("/unmatched")) return sendMessage(chatId, await unmatchedText(userId));
  if (text.startsWith("/last")) return sendLastMatch(chatId, userId);
  if (text.startsWith("/statement")) return sendMessage(chatId, await statementText(userId));

  if (text) {
    return sendMessage(
      chatId,
      "Send me a photo of a bill, or use /status to see where this cycle stands. /help for everything."
    );
  }
}

function money(amount, currency = "INR") {
  const n = Number(amount || 0);
  if (currency && currency !== "INR") {
    return `${currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  }
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function receiptSummary(r) {
  const bits = [`<b>${esc(r.merchant || "Unknown merchant")}</b> · ${money(r.amount, r.currency)}`];
  if (r.currency && r.currency !== "INR" && r.amount_inr) {
    bits.push(`≈ ${money(r.amount_inr)} incl. markup`);
  }
  const when = [r.receipt_date, r.receipt_time].filter(Boolean).join(" ");
  if (when) bits.push(esc(when));
  if (r.tax_id) bits.push(`<code>${esc(r.tax_id)}</code>`);
  return bits.join("\n");
}

/** Render the outcome of one receipt as a single editable message. */
function renderVerdict(receipt, extraction, verdict) {
  const head = receiptSummary(receipt);
  const conf = extraction?.confidence != null ? ` · ${Math.round(extraction.confidence * 100)}%` : "";

  if (verdict.conflicted) {
    return {
      text: `⚠️ <b>Models disagreed</b>${conf}\n${head}\n\nTwo independent reads differed on ${esc(
        (extraction.conflicts || []).join(", ") || "a key field"
      )}. Confirm before I file it.`,
      keyboard: [[{ text: "✅ Values look right", callback_data: `ok:${receipt.id}` }]],
    };
  }

  if (verdict.action === "auto") {
    const t = verdict.best.txn;
    return {
      text: `✅ <b>Matched · ${verdict.best.score}</b>${conf}\n${head}\n→ Txn #${t.id} <code>${esc(
        t.merchant
      )} · ${money(t.amount)}</code>`,
      keyboard: [[{ text: "↩︎ Wrong match", callback_data: `u:${receipt.id}` }]],
    };
  }

  if (verdict.action === "ask") {
    const rows = verdict.candidates.map((c) => [
      {
        text: `${c.txn.date} · ${c.txn.merchant} · ${money(c.txn.amount)} (${c.score})`.slice(0, 60),
        callback_data: `p:${receipt.id}:${c.transaction_id}`,
      },
    ]);
    rows.push([{ text: "✳︎ None of these — hold it", callback_data: `n:${receipt.id}` }]);
    return {
      text: `🤔 <b>${verdict.candidates.length} charge${
        verdict.candidates.length === 1 ? "" : "s"
      } could fit</b>${conf}\n${head}`,
      keyboard: rows,
    };
  }

  return {
    text: `📥 <b>Saved</b>${conf}\n${head}\n\nNo matching charge yet — I'll bind it automatically when the bank alert arrives.`,
    keyboard: null,
  };
}

async function handleAttachment({ userId, chatId, message, attachment }) {
  const ack = await sendMessage(chatId, "Reading…", { replyTo: message.message_id });

  let receiptId;
  try {
    const { receipt, duplicate } = await intakeFromTelegram({
      userId,
      attachment,
      chatId,
      messageId: ack.message_id,
    });

    if (duplicate) {
      return editMessage(
        chatId,
        ack.message_id,
        `Already have this one.\n${receiptSummary(receipt)}`
      );
    }
    receiptId = receipt.id;
  } catch (err) {
    await logError({
      source: "receipt",
      event: "intake_failed",
      userId,
      message: "Receipt intake failed",
      error: err,
    });
    return editMessage(chatId, ack.message_id, `⚠️ ${esc(err.message)}`);
  }

  // Intake succeeded, so the file is safe no matter what happens next.
  try {
    const result = await processReceipt({ userId, receiptId });

    if (!result.ok) {
      return editMessage(
        chatId,
        ack.message_id,
        `⚠️ Couldn't read that one — I'll retry automatically.\n<i>${esc(result.error || "")}</i>`
      );
    }

    const { text, keyboard } = renderVerdict(result.receipt, result.extraction, result.verdict);
    return editMessage(chatId, ack.message_id, text, { keyboard });
  } catch (err) {
    await logError({
      source: "receipt",
      event: "pipeline_failed",
      userId,
      message: "Receipt pipeline failed after intake",
      error: err,
      details: { receiptId },
    });
    return editMessage(
      chatId,
      ack.message_id,
      "📥 Saved, but I couldn't read it just now. It's queued and I'll retry."
    );
  }
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const userId = await resolveUser(chatId);

  if (!userId) return answerCallback(query.id, "This chat isn't linked.");

  // Telegram caps callback_data at 64 bytes, so it is a terse "action:id[:id]".
  const [action, targetId, txnId] = String(query.data || "").split(":");
  const sb = getSupabaseAdmin();

  try {
    if (action === "p") {
      const { data: txn } = await sb
        .from("transactions")
        .select("id, merchant, amount")
        .eq("id", Number(txnId))
        .eq("user_id", userId)
        .single();

      await linkReceipt({
        receiptId: targetId,
        transactionId: Number(txnId),
        userId,
        score: null,
        matchedBy: "user",
      });

      await answerCallback(query.id, "Filed");
      return editMessage(
        chatId,
        messageId,
        `✅ <b>Filed against Txn #${txn.id}</b>\n<code>${esc(txn.merchant)}</code>`,
        { keyboard: [[{ text: "↩︎ Undo", callback_data: `u:${targetId}` }]] }
      );
    }

    if (action === "u") {
      await unlinkReceipt({ receiptId: targetId, userId });
      await answerCallback(query.id, "Unlinked");
      return editMessage(
        chatId,
        messageId,
        "↩︎ <b>Unlinked.</b> Held as unmatched — send /unmatched to bind it manually."
      );
    }

    if (action === "n") {
      await sb
        .from("receipts")
        .update({ status: "unmatched" })
        .eq("id", targetId)
        .eq("user_id", userId);

      await answerCallback(query.id, "Held");
      return editMessage(
        chatId,
        messageId,
        "📥 <b>Held.</b> I'll try again when new charges arrive."
      );
    }

    if (action === "send") {
      await answerCallback(query.id, "Sending…");
      const result = await sendSubmission({
        userId,
        submissionId: targetId,
        approvedBy: "telegram",
      });
      return editMessage(
        chatId,
        messageId,
        result.alreadySent
          ? "Already sent."
          : `📨 <b>Sent</b> → ${esc((result.recipients || []).join(", "))}\nLogged. I'll flag any bounce.`
      );
    }

    if (action === "ok") {
      const { data: receipt } = await sb
        .from("receipts")
        .select("*")
        .eq("id", targetId)
        .eq("user_id", userId)
        .single();

      const verdict = await matchReceipt(userId, receipt);
      await answerCallback(query.id, "Matching…");

      const { text, keyboard } = renderVerdict(receipt, null, verdict);
      return editMessage(chatId, messageId, text, { keyboard });
    }

    await answerCallback(query.id);
  } catch (err) {
    await logError({
      source: "telegram",
      event: "callback_failed",
      userId,
      message: `Callback ${query.data} failed`,
      error: err,
    });
    await answerCallback(query.id, "Something went wrong");
  }
}
