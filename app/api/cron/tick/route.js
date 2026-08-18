import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { syncUserTransactions } from "@/lib/sync";
import { sendMonthlyReportForUser } from "@/lib/monthly-report";
import { getCardAccount, cycleAwaitingSubmission } from "@/lib/cycles";
import { buildAndRequestApproval } from "@/lib/submission-approval";
import { rematchPendingReceipts } from "@/lib/match-service";
import { runNudge } from "@/lib/nudge";
import { runStatementJob } from "@/lib/statement-recon";
import { logError, logInfo } from "@/lib/logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Single daily cron dispatcher.
 *
 * Vercel's Hobby plan allows two cron jobs, once daily — and the app already
 * used both. Rather than pay for slots, one job runs every day and branches on
 * the date, so the schedule lives in code where it is testable and versioned.
 *
 * Every job is independently runnable with ?job=<name> for manual triggers and
 * debugging, which is worth more than the cron slots themselves.
 *
 *   sync       every day   Gmail → Claude → transactions
 *   rematch    every day   bind receipts that arrived before their bank alert
 *   nudge      every day   chase charges still lacking a receipt
 *   statement  day 18      ingest + reconcile the card statement
 *   submit     day 23      build the verified package for approval
 *   report     day 4       the existing monthly report
 */

const JOBS = ["sync", "rematch", "nudge", "statement", "submit", "report"];

function jobsForToday(day, card) {
  const statementDay = card?.statement_day ?? 18;
  const submitDay = card?.submit_day ?? 23;

  const due = ["sync", "rematch", "nudge"];
  if (day === statementDay) due.push("statement");
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
    const due = requested ? [requested] : jobsForToday(today, card);
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
  switch (job) {
    case "sync": {
      const r = await syncUserTransactions({ userId: user.id });
      return { inserted: r?.inserted ?? 0 };
    }

    case "rematch": {
      // Safety net: sync already rematches after an insert, but a receipt whose
      // charge arrived through some other path still gets picked up here.
      const r = await rematchPendingReceipts(user.id);
      return { checked: r.checked, matched: r.matched };
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
      return runStatementJob({ userId: user.id });
    }

    case "submit": {
      const cycle = await cycleAwaitingSubmission(user.id);
      if (!cycle) return { skipped: "no cycle awaiting submission" };
      return buildAndRequestApproval({ userId: user.id, cycle });
    }

    case "report": {
      const r = await sendMonthlyReportForUser({ userId: user.id });
      return { sent: r?.sent ?? false };
    }

    default:
      return { skipped: "unknown job" };
  }
}
