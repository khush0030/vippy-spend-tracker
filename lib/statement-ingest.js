import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchStatementPdfs } from "@/lib/gmail";
import { decryptPdf } from "@/lib/pdf-decrypt";
import { parseStatement } from "@/lib/statement-vision";
import { put } from "@/lib/storage";
import { getCardAccount, currentCycle } from "@/lib/cycles";
import { decryptSecret } from "@/lib/secret-box";
import { logError, logInfo, logWarn } from "@/lib/logger";

/**
 * Getting the bank's own ledger into the database.
 *
 * Gmail sync already matches HDFC senders, so the statement arrives on its own
 * — nothing to forward, nothing to upload. The work here is opening it,
 * transcribing it, and writing down every line before anything tries to
 * interpret them.
 *
 * The password never leaves this call chain and is never logged.
 */

/** How far back to look for statements we have not already ingested. */
const LOOKBACK_DAYS = 45;

function shift(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDate(value, fallback) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : fallback;
}

/**
 * Ingest every statement email not already on file.
 * Returns one result per statement found, ingested or skipped.
 */
export async function ingestStatements({ userId, since = null, force = false } = {}) {
  const card = await getCardAccount(userId);
  if (!card) return { skipped: "no card configured", statements: [] };

  const today = new Date().toISOString().slice(0, 10);
  const emails = await fetchStatementPdfs({ since: since || shift(today, -LOOKBACK_DAYS) });

  if (!emails.length) {
    await logInfo({
      source: "statement",
      event: "none_found",
      userId,
      message: "No statement email with a PDF attachment in the window",
    });
    return { statements: [], found: 0 };
  }

  const sb = getSupabaseAdmin();
  const { data: already } = await sb
    .from("statements")
    .select("id, email_id, status")
    .eq("user_id", userId)
    .in("email_id", emails.map((e) => e.id));

  const seen = new Map((already || []).map((s) => [s.email_id, s]));
  const results = [];

  for (const email of emails) {
    if (seen.has(email.id) && !force) {
      const row = seen.get(email.id);
      results.push({
        emailId: email.id,
        statementId: row.id,
        status: row.status,
        skipped: "already ingested",
      });
      continue;
    }

    try {
      results.push(await ingestOne({ userId, card, email }));
    } catch (err) {
      await logError({
        source: "statement",
        event: "ingest_failed",
        userId,
        message: `Could not ingest statement from ${email.date}`,
        error: err,
        details: { emailId: email.id, subject: email.subject },
      });
      results.push({ emailId: email.id, error: err.message });
    }
  }

  return { found: emails.length, statements: results };
}

async function ingestOne({ userId, card, email }) {
  const sb = getSupabaseAdmin();

  if (!card.statement_password) {
    // Worth saying plainly: without it there is nothing this job can do.
    throw new Error("No statement password on file — add it in Settings → Corporate Card.");
  }

  const pdf = await decryptPdf(email.buffer, decryptSecret(card.statement_password));
  const parsed = await parseStatement(pdf, { userId });

  if (!parsed?.lines?.length) {
    throw new Error("The statement PDF opened but no transaction rows could be read.");
  }

  const issuedOn = isoDate(parsed.header.statementDate, isoDate(email.date, new Date().toISOString().slice(0, 10)));
  const periodEnd = parsed.header.periodEnd || shift(issuedOn, -1);
  const periodStart = parsed.header.periodStart || null;

  // Keep the opened copy: accounts may ask for it, and a re-parse after a
  // prompt improvement must not need the password again.
  const storagePath = `${userId}/statements/${issuedOn}-${email.id}.pdf`;
  let stored = null;
  try {
    await put(storagePath, pdf, { contentType: "application/pdf" });
    stored = storagePath;
  } catch (err) {
    // Storing the copy is a convenience; failing it must not lose the parse.
    await logWarn({
      source: "statement",
      event: "store_failed",
      userId,
      message: `Could not store the decrypted statement: ${err.message}`,
    });
  }

  const cycle = await currentCycle(userId, new Date(`${periodEnd}T00:00:00Z`));

  const { data: statement, error } = await sb
    .from("statements")
    .upsert(
      {
        user_id: userId,
        card_account_id: card.id,
        cycle_id: cycle?.id || null,
        email_id: email.id,
        issued_on: issuedOn,
        period_start: periodStart,
        period_end: periodEnd,
        opening_balance: parsed.header.openingBalance,
        closing_balance: parsed.header.closingBalance,
        total_debits: parsed.totals?.debits ?? null,
        total_credits: parsed.totals?.credits ?? null,
        tie_out_diff: parsed.control?.diff ?? null,
        storage_path: stored,
        parsed: { header: parsed.header, attempts: parsed.attempts, totals: parsed.totals },
        status: "parsed",
      },
      { onConflict: "user_id,email_id" }
    )
    .select()
    .single();

  if (error) throw new Error(`statement insert failed: ${error.message}`);

  // Re-ingesting replaces the lines rather than appending a second copy.
  await sb.from("statement_lines").delete().eq("statement_id", statement.id);

  const rows = parsed.lines.map((l) => ({
    statement_id: statement.id,
    user_id: userId,
    line_no: l.lineNo,
    txn_date: l.txnDate,
    post_date: l.postDate,
    descriptor: l.descriptor,
    amount: l.amount,
    direction: l.direction,
    type: l.type,
    currency: l.currency,
    amount_orig: l.amountOrig,
    recon_status: "unmatched",
  }));

  const { error: lineError } = await sb.from("statement_lines").insert(rows);
  if (lineError) throw new Error(`statement lines insert failed: ${lineError.message}`);

  await logInfo({
    source: "statement",
    event: "ingested",
    userId,
    message: `Statement ${issuedOn}: ${rows.length} lines, ${
      parsed.control?.tiesOut ? "ties out" : `off by ${parsed.control?.diff}`
    }`,
    details: { statementId: statement.id, attempts: parsed.attempts, cycleId: cycle?.id || null },
  });

  return {
    emailId: email.id,
    statementId: statement.id,
    issuedOn,
    lines: rows.length,
    tiesOut: Boolean(parsed.control?.tiesOut),
    diff: parsed.control?.diff ?? null,
    attempts: parsed.attempts,
  };
}
