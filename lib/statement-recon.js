import { getSupabaseAdmin } from "@/lib/supabase";
import { reconcile } from "@/lib/recon";
import { summarise, formatReconReport } from "@/lib/statement-report";
import { sendMessage } from "@/lib/telegram";
import { getCardAccount } from "@/lib/cycles";
import { ingestStatements } from "@/lib/statement-ingest";
import { logInfo, logWarn } from "@/lib/logger";

/**
 * Applying the bank's ledger to ours.
 *
 * `reconcile()` decides; this writes the decision down. The order matters:
 * transactions the statement proves exist are created first, then every line
 * is stamped with what happened to it, then the cycle is either marked
 * verified or held. A cycle that does not tie out is never marked verified,
 * which is what stops a wrong number reaching accounts.
 */

// A refund raised months ago can still be outstanding, so the transaction
// window reaches back well past the statement period.
const REFUND_LOOKBACK_DAYS = 120;

function shift(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toDomain(row) {
  return {
    lineNo: row.line_no,
    txnDate: row.txn_date,
    postDate: row.post_date,
    descriptor: row.descriptor,
    amount: Number(row.amount),
    direction: row.direction || (row.type === "purchase" || row.type === "fee" ? "debit" : "credit"),
    type: row.type,
    currency: row.currency,
    amountOrig: row.amount_orig,
    id: row.id,
  };
}

export async function reconcileStatement({ userId, statementId, asOf = null }) {
  const sb = getSupabaseAdmin();

  const { data: statement } = await sb
    .from("statements")
    .select("*, cycle:statement_cycles(*)")
    .eq("id", statementId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!statement) throw new Error(`Statement ${statementId} not found`);

  const { data: lineRows } = await sb
    .from("statement_lines")
    .select("*")
    .eq("statement_id", statementId)
    .order("line_no", { ascending: true });

  if (!lineRows?.length) throw new Error("Statement has no lines to reconcile");

  const card = await getCardAccount(userId);
  const periodEnd = statement.period_end || statement.issued_on;
  const periodStart = statement.period_start || shift(periodEnd, -30);

  const { data: txnRows } = await sb
    .from("transactions")
    .select("id, merchant, amount, date, is_refund, receipt_status, category, statement_line_id")
    .eq("user_id", userId)
    .gte("date", shift(periodStart, -REFUND_LOOKBACK_DAYS))
    .lte("date", periodEnd)
    .order("date", { ascending: true });

  const lines = lineRows.map(toDomain);
  const idByLineNo = new Map(lineRows.map((r) => [r.line_no, r.id]));

  const recon = reconcile({
    lines,
    transactions: txnRows || [],
    statement: {
      opening: statement.opening_balance,
      closing: statement.closing_balance,
      periodStart,
      periodEnd,
    },
    minReceiptAmount: card?.min_receipt_amount ?? 500,
    asOf: asOf || new Date().toISOString().slice(0, 10),
    sourceRef: statement.id,
  });

  // --- 1. create what the statement proves exists and the app had missed ---

  const toCreate = [...recon.createdFromStatement, ...recon.fees];
  const createdIds = await createMissingTransactions(userId, toCreate);

  // --- 2. stamp every line with its outcome ---

  const updates = [];
  const pushLine = (entry, transactionId) => {
    const id = idByLineNo.get(entry.line.line_no);
    if (!id) return;
    updates.push({ id, recon_status: entry.line.recon_status, transaction_id: transactionId ?? null });
  };

  for (const e of recon.tied) pushLine(e, e.transaction.id);
  for (const e of recon.refundsConfirmed) pushLine(e, e.transaction.id);
  for (const e of toCreate) pushLine(e, createdIds.get(e.transaction.email_id) ?? null);
  for (const e of [...recon.payments, ...recon.chargebacks, ...recon.unexplained]) pushLine(e, null);

  await applyLineUpdates(updates);

  // --- 3. point the transactions back at their statement line ---

  await linkTransactions(userId, updates);

  // --- 4. the cycle's verdict ---

  const tiesOut = Boolean(recon.control.tiesOut);
  await sb
    .from("statements")
    .update({
      tie_out_diff: recon.control.diff,
      total_debits: recon.totals.debits,
      total_credits: recon.totals.credits,
      status: "reconciled",
    })
    .eq("id", statement.id);

  if (statement.cycle_id) {
    // `verified` is the gate the submission builder checks. A blocked cycle
    // stays `closing` — visibly not ready — rather than silently proceeding.
    const { data: cycle } = await sb
      .from("statement_cycles")
      .select("status")
      .eq("id", statement.cycle_id)
      .maybeSingle();

    if (cycle && cycle.status !== "submitted") {
      await sb
        .from("statement_cycles")
        .update({ status: recon.blocked ? "closing" : "verified" })
        .eq("id", statement.cycle_id);
    }
  }

  const summary = summarise(recon, {
    issuedOn: statement.issued_on,
    submitDay: card?.submit_day ?? 23,
    daysToSubmit: daysUntilSubmit(card?.submit_day ?? 23, asOf),
  });

  await logInfo({
    source: "statement",
    event: "reconciled",
    userId,
    message: `Statement ${statement.issued_on}: ${lines.length} lines, ${
      tiesOut ? "ties out" : `off by ${recon.control.diff}`
    }, coverage ${recon.coverage.coveragePct}%`,
    details: {
      statementId: statement.id,
      created: recon.createdFromStatement.length,
      fees: recon.fees.length,
      refundsMissing: recon.refundsMissing.length,
      rolledForward: recon.rolledForward.length,
    },
  });

  return { statementId: statement.id, summary, recon, tiesOut, blocked: recon.blocked };
}

/**
 * Insert the charges the app never saw.
 *
 * Upserted on the synthetic `email_id` the reconciler generates, so re-running
 * a reconciliation corrects the same rows instead of duplicating the month.
 */
async function createMissingTransactions(userId, entries) {
  const map = new Map();
  if (!entries.length) return map;

  const rows = entries.map((e) => ({ ...e.transaction, user_id: userId }));

  const { data, error } = await getSupabaseAdmin()
    .from("transactions")
    .upsert(rows, { onConflict: "email_id,user_id" })
    .select("id, email_id");

  if (error) throw new Error(`creating statement transactions failed: ${error.message}`);
  for (const r of data || []) map.set(r.email_id, r.id);
  return map;
}

async function applyLineUpdates(updates) {
  const sb = getSupabaseAdmin();
  const CHUNK = 20;

  for (let i = 0; i < updates.length; i += CHUNK) {
    await Promise.all(
      updates.slice(i, i + CHUNK).map((u) =>
        sb
          .from("statement_lines")
          .update({ recon_status: u.recon_status, transaction_id: u.transaction_id })
          .eq("id", u.id)
      )
    );
  }
}

async function linkTransactions(userId, updates) {
  const sb = getSupabaseAdmin();
  const linked = updates.filter((u) => u.transaction_id);
  const CHUNK = 20;

  for (let i = 0; i < linked.length; i += CHUNK) {
    await Promise.all(
      linked.slice(i, i + CHUNK).map((u) =>
        sb
          .from("transactions")
          .update({ statement_line_id: u.id })
          .eq("id", u.transaction_id)
          .eq("user_id", userId)
      )
    );
  }
}

function daysUntilSubmit(submitDay, asOf) {
  const today = asOf ? new Date(`${String(asOf).slice(0, 10)}T00:00:00Z`) : new Date();
  const day = today.getUTCDate();
  if (day <= submitDay) return submitDay - day;

  // Already past this month's submission date — count to next month's.
  const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, submitDay));
  return Math.round((next - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day)) / 86400000);
}

/**
 * The whole job for the 18th: fetch what arrived, reconcile it, and put the
 * verdict in chat. Safe to re-run — already-ingested statements are skipped.
 */
export async function runStatementJob({ userId, force = false, asOf = null } = {}) {
  const ingest = await ingestStatements({ userId, force });

  if (ingest.skipped) return { skipped: ingest.skipped };
  if (!ingest.statements?.length) return { found: 0, reconciled: 0 };

  const results = [];
  for (const s of ingest.statements) {
    if (!s.statementId) {
      results.push(s);
      continue;
    }

    // A statement already on file and already reconciled is left alone —
    // otherwise the 45-day ingest window would repost last month's verdict
    // every time this job runs.
    if (s.skipped && s.status === "reconciled" && !force) {
      results.push(s);
      continue;
    }

    try {
      const r = await reconcileStatement({ userId, statementId: s.statementId, asOf });
      await postReport(userId, r.summary);
      results.push({
        statementId: s.statementId,
        issuedOn: s.issuedOn,
        tiesOut: r.tiesOut,
        blocked: r.blocked,
        coverage: r.summary.coverage.coveragePct,
      });
    } catch (err) {
      await logWarn({
        source: "statement",
        event: "reconcile_failed",
        userId,
        message: `Reconciliation failed for statement ${s.statementId}: ${err.message}`,
      });
      results.push({ statementId: s.statementId, error: err.message });
    }
  }

  return { found: ingest.found, reconciled: results.filter((r) => r.tiesOut != null).length, results };
}

async function postReport(userId, summary) {
  const { data: link } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("tg_chat_id")
    .eq("user_id", userId)
    .not("linked_at", "is", null)
    .maybeSingle();

  if (!link?.tg_chat_id) return false;
  await sendMessage(link.tg_chat_id, formatReconReport(summary));
  return true;
}
