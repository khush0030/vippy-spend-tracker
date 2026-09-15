import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { syncUserTransactions } from "@/lib/sync";
import { sendMonthlyReportForUser } from "@/lib/monthly-report";
import { getCardAccount, cycleAwaitingSubmission, currentCycle } from "@/lib/cycles";
import { runPing } from "@/lib/ping";
import { buildAndRequestApproval } from "@/lib/submission-approval";
import { rematchPendingReceipts } from "@/lib/match-service";
import { retryFailedExtractions } from "@/lib/receipt-pipeline";
import { alertIfSyncUnhealthy } from "@/lib/sync-alert";
import { runNudge } from "@/lib/nudge";
import { runStatementJob } from "@/lib/statement-recon";
import { harvestCycle } from "@/lib/harvest";
import { checkMailboxes } from "@/lib/mailbox-health";
import { primaryMailAccount } from "@/lib/mail-account";
import { logError, logInfo } from "@/lib/logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Single cron dispatcher.
 *
 * The cron fires hourly (Vercel Pro); sync and ping run every tick, the rest
 * at 03:30 UTC. Rather than pay for more slots, one job runs every hour and
 * branches on the date and hour, so the schedule lives in code where it is
 * testable and versioned.
 *
 * Every job is independently runnable with ?job=<name> for manual triggers and
 * debugging, which is worth more than the cron slots themselves.
 *
 *   sync       every tick     Gmail → Claude → transactions
 *   ping       every tick     instant receipt pings for new charges
 *   rematch    03:30 UTC      bind receipts that arrived before their bank alert
 *   nudge      03:30 UTC      chase charges still lacking a receipt
 *   mailboxes  03:30 UTC      credential health check, alert on failure transition
 *   statement  03:30, days 17-19  ingest + reconcile the card statement
 *   harvest    03:30, days 17-23  sweep invoices from email and bind them to charges
 *   submit     03:30, day 23  build the verified package for approval
 *   report     03:30, day 4   the existing monthly report
 */

const JOBS = ["sync", "ping", "rematch", "nudge", "harvest", "statement", "submit", "report", "mailboxes"];

/**
 * The cron fires every hour. Sync and the receipt ping run on every tick;
 * everything else belongs to the 03:30 UTC tick (09:00 IST), where it has
 * always run.
 */
function jobsForToday(day, card, hourUtc) {
  const due = ["sync", "ping"];
  if (hourUtc !== 3) return due;

  const statementDay = card?.statement_day ?? 18;
  const submitDay = card?.submit_day ?? 23;

  due.push("rematch", "nudge", "mailboxes");
  // The statement is dated on `statement_day` but the email lands a day or two
  // later, so the ingest is attempted on the following three days. Repeats are
  // free: a statement already on file is skipped by its Gmail message id.
  if (day > statementDay && day <= statementDay + 3) due.push("statement");
  // Harvesting runs every day from the statement closing until the package
  // goes out. It is idempotent, so a daily sweep simply catches the invoices
  // that arrive late — and most of them do.
  if (day > statementDay && day <= submitDay) due.push("harvest");
  if (day === submitDay) due.push("submit");
  if (day === 4) due.push("report");
  return due;
}

export async function GET(request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    await logError({
      source: "cron",
      event: "unauthorized",
      message: "Tick called without a valid CRON_SECRET bearer",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get("job");
  if (requested && !JOBS.includes(requested)) {
    return NextResponse.json({ error: `Unknown job. One of: ${JOBS.join(", ")}` }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: users, error } = await sb
    .from("users")
    .select("id, email, last_synced_at")
    .not("last_synced_at", "is", null);

  if (error) {
    await logError({ source: "cron", event: "user_fetch_failed", error, message: "Failed to load users" });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const today = new Date().getUTCDate();
  const results = [];

  for (const user of users || []) {
    const card = await getCardAccount(user.id).catch(() => null);
    const due = requested ? [requested] : jobsForToday(today, card, new Date().getUTCHours());
    const perUser = { email: user.email, ran: [] };

    for (const job of due) {
      try {
        const outcome = await runJob(job, user);
        perUser.ran.push({ job, ...outcome });
      } catch (err) {
        await logError({
          source: "cron",
          event: `${job}_failed`,
          userId: user.id,
          message: `Job ${job} failed for ${user.email}`,
          error: err,
        });
        perUser.ran.push({ job, error: err.message });
      }
    }
    results.push(perUser);
  }

  await logInfo({
    source: "cron",
    event: "tick_complete",
    message: `Tick ran for ${results.length} user(s)`,
    details: { day: today, requested: requested || null, results },
  });

  return NextResponse.json({ ranAt: new Date().toISOString(), day: today, results });
}

async function runJob(job, user) {
  // The mail_accounts row is authoritative when present; the env var in
  // lib/gmail.js stays as the fallback for users with no row, so this
  // changes nothing when nothing has been connected.
  const primary = await primaryMailAccount(user.id).catch(() => null);
  const refreshToken = primary?.credential ?? null;

  switch (job) {
    case "sync": {
      const r = await syncUserTransactions({ userId: user.id, refreshToken });
      // A sync that fails quietly is how the ledger went two months stale, so
      // the health check runs on the way out rather than on its own schedule.
      const health = await alertIfSyncUnhealthy(user.id, {
        hadBatchFailure: r?.advanced === false,
      });
      return { inserted: r?.inserted ?? 0, alerted: health.alerted };
    }

    case "ping":
      return runPing(user.id);

    case "rematch": {
      // Safety net: sync already rematches after an insert, but a receipt whose
      // charge arrived through some other path still gets picked up here.
      // A read that failed on a provider outage is retried first, so a
      // recovered receipt can be matched in the same pass.
      const retried = await retryFailedExtractions(user.id);
      const r = await rematchPendingReceipts(user.id);
      return { checked: r.checked, matched: r.matched, ...retried };
    }

    case "nudge": {
      const card = await getCardAccount(user.id);
      if (!card) return { skipped: "no card configured" };
      return runNudge(user.id, {
        day: new Date().getUTCDate(),
        statementDay: card.statement_day,
      });
    }

    case "statement": {
      // Ingest whatever HDFC sent, reconcile it, and post the verdict in chat.
      // Idempotent: a statement already on file is skipped, so a manual
      // ?job=statement on the 19th is safe.
      return runStatementJob({ userId: user.id, refreshToken });
    }

    case "submit": {
      const cycle = await cycleAwaitingSubmission(user.id);
      if (!cycle) return { skipped: "no cycle awaiting submission" };
      return buildAndRequestApproval({ userId: user.id, cycle });
    }

    case "harvest": {
      const cycle = await currentCycle(user.id);
      if (!cycle) return { skipped: "no card configured" };

      const { data: statement } = await getSupabaseAdmin()
        .from("statements")
        .select("id, cycle_id, issued_on, status")
        .eq("user_id", user.id)
        .eq("status", "reconciled")
        .order("issued_on", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Nothing to look for until the bank has told us what was charged.
      if (!statement) return { skipped: "no reconciled statement yet" };
      // Falling back to the open cycle would sweep invoices against the
      // wrong cycle's statement lines when the statement isn't linked yet.
      if (!statement.cycle_id) return { skipped: "statement not linked to a cycle" };

      const { data: cycleRow } = await getSupabaseAdmin()
        .from("statement_cycles")
        .select("*, card:card_accounts(*)")
        .eq("id", statement.cycle_id)
        .maybeSingle();

      const summary = await harvestCycle({
        userId: user.id,
        cycle: cycleRow || cycle,
        statement,
      });

      return {
        scanned: summary.scanned ?? 0,
        matched: summary.matched ?? 0,
        ambiguous: summary.ambiguous ?? 0,
        errors: summary.errors ?? 0,
      };
    }

    case "mailboxes":
      return checkMailboxes(user.id);

    case "report": {
      const r = await sendMonthlyReportForUser({ userId: user.id });
      return { sent: r?.sent ?? false };
    }

    default:
      return { skipped: "unknown job" };
  }
}
