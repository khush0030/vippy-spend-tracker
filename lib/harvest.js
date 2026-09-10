import crypto from "crypto";
import { getSupabaseAdmin } from "./supabase.js";
import { put } from "./storage.js";
import { linkReceipt } from "./match-service.js";
import { listMailAccounts, getMailAccount } from "./mail-account.js";
import { openMailbox } from "./mailbox.js";
import { searchWindow, candidateFrom } from "./harvest-plan.js";
import { matchEmailsToLines } from "./harvest-match.js";
import { resolveLeftovers } from "./harvest-ai.js";
import { renderEmailToPdf } from "./render-email.js";
import { logInfo, logWarn } from "./logger.js";

/**
 * Sweep the connected mailboxes for documents belonging to a statement.
 *
 * The statement is read first and turned into a list of amounts, and that list
 * is the only question ever put to a mailbox. An email that answers no is not
 * forgotten immediately: its subject, sender and a 500-char excerpt are first
 * offered to the model in case it explains a leftover statement line, and only
 * then is it forgotten — its message id is recorded so it is never fetched
 * twice, and nothing else about it is kept. That is what makes reading a
 * personal account defensible: anything retained is, by construction, a charge
 * already on the company card.
 */

function merchantFrom(message) {
  // "Uber Receipts <noreply@uber.com>" -> "Uber Receipts"
  const name = String(message.from || "").replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  return (name || message.subject || "Unknown").slice(0, 80);
}

async function alreadySeen(userId, accountId, cycleId) {
  // Scoped to this cycle: consecutive cycles' search windows overlap by
  // several days, and a message discarded in one cycle's overhang can belong
  // to the next cycle's statement instead. Scoping by cycle_id lets it be
  // looked at again there rather than being skipped forever.
  // `error` rows are excluded too — a transient fetch failure should be
  // retried on the next run, not treated as seen.
  const { data } = await getSupabaseAdmin()
    .from("mail_seen")
    .select("message_id")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .eq("cycle_id", cycleId)
    .neq("outcome", "error");
  return new Set((data || []).map((r) => r.message_id));
}

async function recordSeen(userId, accountId, cycleId, rows) {
  if (!rows.length) return;
  await getSupabaseAdmin().from("mail_seen").upsert(
    rows.map(({ messageId, outcome }) => ({
      user_id: userId, account_id: accountId, message_id: messageId,
      cycle_id: cycleId, outcome,
    })),
    { onConflict: "user_id,account_id,message_id" }
  );
}

/**
 * Store one matched document as a receipt and bind it to its charge.
 *
 * Returns the receipt id, or null when the same bytes are already on file —
 * the same attachment reaching both mailboxes, or a forwarded copy.
 */
async function storeDocument({ userId, account, message, link, line }) {
  const sb = getSupabaseAdmin();
  const rendered = await renderEmailToPdf(message);
  const sha256 = crypto.createHash("sha256").update(rendered.buffer).digest("hex");

  const { data: existing } = await sb
    .from("receipts")
    .select("id")
    .eq("user_id", userId)
    .eq("sha256", sha256)
    .maybeSingle();

  let receiptId = existing?.id || null;

  if (!receiptId) {
    receiptId = crypto.randomUUID();
    const path = `${userId}/gmail/${message.date.slice(0, 4)}/${message.date.slice(5, 7)}/${receiptId}.pdf`;
    await put(path, rendered.buffer, { contentType: "application/pdf" });

    const { error } = await sb.from("receipts").insert({
      id: receiptId,
      user_id: userId,
      source: "gmail",
      source_account: account.email,
      mail_message_id: message.messageId,
      storage_path: path,
      mime: "application/pdf",
      bytes: rendered.buffer.length,
      sha256,
      original_name: rendered.filename,
      merchant: merchantFrom(message),
      merchant_raw: message.subject || null,
      amount: link.value,
      currency: link.currency,
      receipt_date: message.date,
      status: "matched",
      extracted: { harvest: { kind: rendered.kind, subject: message.subject, from: message.from } },
      models_used: [],
    });

    if (error) throw new Error(`receipt insert failed: ${error.message}`);
  }

  // A statement line without a transaction is an orphan the reconciler never
  // paired up. The document is still worth keeping; it simply has nothing to
  // bind to yet, and the daily rematch will find it once one appears.
  if (line.transaction_id) {
    await linkReceipt({
      receiptId,
      transactionId: line.transaction_id,
      userId,
      score: null,
      matchedBy: "harvest",
    });
  }

  return receiptId;
}

export async function harvestCycle({ userId, cycle, statement, limitPerAccount = 400, deadlineMs = 240_000 }) {
  const sb = getSupabaseAdmin();
  const startedAt = Date.now();
  let deadlineHit = false;

  const { data: lines } = await sb
    .from("statement_lines")
    .select("id, line_no, txn_date, descriptor, amount, currency, amount_orig, direction, type, transaction_id")
    .eq("statement_id", statement.id)
    .order("line_no");

  if (!lines?.length) return { skipped: "statement has no lines" };

  const linesById = new Map(lines.map((l) => [l.id, l]));
  const window = searchWindow(cycle);
  const accounts = await listMailAccounts(userId);

  const summary = {
    accounts: 0, scanned: 0, matched: 0, ambiguous: 0, discarded: 0, errors: 0,
    unmatchedLines: [], unmatchedEmails: [],
  };

  const messagesById = new Map();
  const allCandidates = [];
  const accountByMessage = new Map();

  for (const row of accounts) {
    if (row.status !== "active") continue;

    let box = null;
    try {
      const account = await getMailAccount(userId, row.id);
      box = await openMailbox(account);

      const ids = await box.search(window);
      const skip = await alreadySeen(userId, account.id, cycle.id);
      const fresh = ids.filter((id) => !skip.has(id)).slice(0, limitPerAccount);

      let seenRows = [];

      for (const id of fresh) {
        if (Date.now() - startedAt > deadlineMs) {
          if (!deadlineHit) {
            deadlineHit = true;
            await logWarn({
              source: "harvest", event: "deadline_reached", userId,
              message: `Stopped after ${Math.round((Date.now() - startedAt) / 1000)}s with the sweep incomplete`,
            });
          }
          break;
        }

        summary.scanned += 1;
        try {
          const message = await box.fetch(id);
          const candidate = message && candidateFrom(message);
          if (!candidate || !candidate.amounts.length) {
            seenRows.push({ messageId: id, outcome: "discarded" });
            summary.discarded += 1;
            continue;
          }
          messagesById.set(id, message);
          accountByMessage.set(id, account);
          allCandidates.push(candidate);
        } catch (err) {
          // Retried on the next run rather than blocking the sweep.
          seenRows.push({ messageId: id, outcome: "error" });
          summary.errors += 1;
        }

        // Flushed periodically so a deadline mid-account still keeps the
        // progress made on it, rather than losing everything since the
        // account's own loop started.
        if (seenRows.length >= 50) {
          await recordSeen(userId, account.id, cycle.id, seenRows);
          seenRows = [];
        }
      }

      await recordSeen(userId, account.id, cycle.id, seenRows);
      await sb.from("mail_accounts")
        .update({ last_harvest_at: new Date().toISOString() })
        .eq("id", account.id);

      summary.accounts += 1;
    } catch (err) {
      summary.errors += 1;
      await logWarn({
        source: "harvest", event: "account_failed", userId,
        message: `Could not sweep ${row.email}: ${err.message}`,
      });
    } finally {
      if (box) await box.close().catch(() => {});
    }
  }

  const result = matchEmailsToLines(lines, allCandidates);
  const outcomes = new Map();

  for (const link of result.links) {
    const message = messagesById.get(link.messageId);
    const account = accountByMessage.get(link.messageId);
    const line = linesById.get(link.lineId);
    if (!message || !line) continue;

    try {
      await storeDocument({ userId, account, message, link, line });
      outcomes.set(link.messageId, "matched");
      summary.matched += 1;
    } catch (err) {
      outcomes.set(link.messageId, "error");
      summary.errors += 1;
      await logWarn({
        source: "harvest", event: "store_failed", userId,
        message: `Could not store ${link.messageId}: ${err.message}`,
      });
    }
  }

  for (const item of result.ambiguous) {
    outcomes.set(item.messageId, "ambiguous");
    summary.ambiguous += 1;
  }

  // Everything fetched but not linked is discarded, and only its id is kept.
  for (const candidate of result.unmatchedEmails) {
    if (!outcomes.has(candidate.messageId)) {
      outcomes.set(candidate.messageId, "discarded");
      summary.discarded += 1;
    }
  }

  for (const [messageId, outcome] of outcomes) {
    const account = accountByMessage.get(messageId);
    if (account) await recordSeen(userId, account.id, cycle.id, [{ messageId, outcome }]);
  }

  summary.unmatchedLines = result.unmatchedLines;
  summary.unmatchedEmails = result.unmatchedEmails
    .filter((c) => messagesById.has(c.messageId))
    .map((c) => {
      const m = messagesById.get(c.messageId);
      return {
        messageId: c.messageId, date: c.date, from: m.from,
        subject: m.subject, amounts: c.amounts,
        excerpt: (m.text || "").replace(/\s+/g, " ").slice(0, 500),
      };
    });

  // What exact matching could not see: splits, fees, and totals that appear in
  // no single email. Proposals are stored only after they add up.
  if (summary.unmatchedLines.length && summary.unmatchedEmails.length) {
    const ai = await resolveLeftovers({
      userId,
      lines: summary.unmatchedLines,
      emails: summary.unmatchedEmails,
    });

    for (const { line, parts } of ai.accepted) {
      for (const part of parts) {
        const message = messagesById.get(part.messageId);
        const account = accountByMessage.get(part.messageId);
        if (!message || !account) continue;
        try {
          await storeDocument({
            userId, account, message, line,
            link: { value: part.value, currency: part.currency },
          });
          summary.matched += 1;
          summary.discarded = Math.max(0, summary.discarded - 1);
          await recordSeen(userId, account.id, cycle.id, [{ messageId: part.messageId, outcome: "matched" }]);
        } catch (err) {
          summary.errors += 1;
        }
      }
    }

    summary.aiAccepted = ai.accepted.length;
    summary.aiRejected = ai.rejected.length;

    const resolved = new Set(ai.accepted.map((a) => a.line.id));
    summary.unmatchedLines = summary.unmatchedLines.filter((l) => !resolved.has(l.id));
  }

  await logInfo({
    source: "harvest", event: "cycle_swept", userId,
    message: `Swept ${summary.scanned} message(s): ${summary.matched} matched, ${summary.ambiguous} ambiguous`,
    details: { window, ...summary, unmatchedLines: summary.unmatchedLines.length, unmatchedEmails: summary.unmatchedEmails.length },
  });

  return summary;
}
