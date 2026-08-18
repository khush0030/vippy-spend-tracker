import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabase";
import { get as storageGet, signedUrl } from "@/lib/storage";
import { logError, logInfo } from "@/lib/logger";

/**
 * The only path that emails the accounts department.
 *
 * Requires an explicit approval action carrying a submission id — no cron, no
 * pipeline stage and no error handler can reach it by accident.
 */

const INR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function body({ cycle, stats, card, linkUrl }) {
  return `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">
    <p>Hi team,</p>
    <p>Attached is the reconciled statement for <b>${cycle.cycle_start} – ${cycle.cycle_end}</b>
       on the ${card?.entity_name || "VIP Industries Limited"} corporate card ending
       <b>${card?.last4 || "----"}</b>.</p>

    <table cellpadding="6" style="border-collapse:collapse;margin:14px 0;font-size:13px">
      <tr><td style="border-bottom:1px solid #e2e8f0">Total charged</td>
          <td style="border-bottom:1px solid #e2e8f0;text-align:right"><b>${INR(stats.total)}</b></td></tr>
      <tr><td style="border-bottom:1px solid #e2e8f0">Lines</td>
          <td style="border-bottom:1px solid #e2e8f0;text-align:right"><b>${stats.lines}</b></td></tr>
      <tr><td style="border-bottom:1px solid #e2e8f0">Receipts attached</td>
          <td style="border-bottom:1px solid #e2e8f0;text-align:right"><b>${stats.attached} (${stats.coverage}%)</b></td></tr>
    </table>

    <p>The CSV's <b>receipt_file</b> column gives the exact filename inside the
       <code>receipts/</code> folder — each row's receipt is attached in full,
       ready to file against the payment line.</p>

    ${linkUrl ? `<p style="font-size:12px;color:#64748b">Full-resolution archive (valid 30 days): <a href="${linkUrl}">download</a></p>` : ""}

    <p style="font-size:12px;color:#94a3b8">Prepared automatically by Receipt Rail.</p>
  </div>`;
}

export async function sendSubmission({ userId, submissionId, approvedBy = "user" }) {
  const sb = getSupabaseAdmin();

  const { data: submission, error } = await sb
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .eq("user_id", userId)
    .single();

  if (error || !submission) throw new Error("submission not found");
  if (submission.status === "sent") {
    return { alreadySent: true, sentAt: submission.sent_at, resendId: submission.resend_id };
  }

  const { data: cycle } = await sb
    .from("statement_cycles")
    .select("*, card:card_accounts(*)")
    .eq("id", submission.cycle_id)
    .single();

  const recipients = (cycle?.card?.accounts_email || []).filter(Boolean);
  if (!recipients.length) {
    throw new Error("No accounts email configured — set it in Settings before sending");
  }

  const zip = await storageGet(submission.zip_path);
  const filename = submission.zip_path.split("/").pop();
  const link = await signedUrl(submission.zip_path, { expiresIn: 30 * 24 * 3600 }).catch(() => null);

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error: sendError } = await resend.emails.send({
    from: process.env.RESEND_FROM || "receipts@vippysoya.com",
    to: recipients,
    cc: (cycle?.card?.cc_email || []).filter(Boolean),
    subject: `Corp Card ••${cycle?.card?.last4 || "----"} — ${cycle.cycle_start} to ${cycle.cycle_end}, reconciled (${submission.line_count} lines, ${INR(submission.total_amount)}) + ${submission.receipt_count} receipts`,
    html: body({
      cycle,
      card: cycle?.card,
      stats: {
        total: submission.total_amount,
        lines: submission.line_count,
        attached: submission.receipt_count,
        coverage: submission.coverage_pct,
      },
      linkUrl: link,
    }),
    attachments: [{ filename, content: zip }],
  });

  if (sendError) {
    await sb
      .from("submissions")
      .update({ status: "failed", error: sendError.message })
      .eq("id", submissionId);

    await logError({
      source: "submission",
      event: "send_failed",
      userId,
      message: `Send to accounts failed: ${sendError.message}`,
    });
    throw new Error(sendError.message || "Failed to send");
  }

  await sb
    .from("submissions")
    .update({
      status: "sent",
      resend_id: data?.id || null,
      sent_at: new Date().toISOString(),
      sent_to: recipients,
    })
    .eq("id", submissionId);

  await sb.from("statement_cycles").update({ status: "submitted" }).eq("id", cycle.id);

  await logInfo({
    source: "submission",
    event: "sent",
    userId,
    message: `Sent to ${recipients.join(", ")} (approved by ${approvedBy})`,
    details: { submissionId, resendId: data?.id },
  });

  return { sent: true, resendId: data?.id, recipients };
}
