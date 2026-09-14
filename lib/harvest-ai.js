import { chatJson, stripJsonFence } from "./llm.js";
import { validateProposal } from "./harvest-match.js";
import { buildPrompt, parseProposals, MAX_LINES, MAX_EMAILS } from "./harvest-prompt.js";
import { logInfo, logWarn } from "./logger.js";

/**
 * What exact matching cannot see.
 *
 * A ₹1,668 Amazon Pay charge is three orders of ₹555, ₹878 and ₹235, and no
 * single email mentions the total. A ₹957 Swiggy charge is a ₹944 invoice plus
 * a handling fee. These need reading rather than arithmetic — but only to
 * *propose*. Every proposal is then made to add up to the statement line in
 * the line's own currency, and discarded if it does not.
 *
 * The model gets one batched call for the whole cycle, not one per email, and
 * it is never believed. That division — it suggests, the sum decides — is what
 * keeps a fluent wrong answer out of the accounts department.
 */

export async function resolveLeftovers({ userId, lines, emails }) {
  if (!lines?.length || !emails?.length) return { accepted: [], rejected: [], proposals: 0 };

  if (lines.length > MAX_LINES || emails.length > MAX_EMAILS) {
    await logWarn({
      source: "harvest", event: "leftovers_truncated", userId,
      message: `Model sees ${Math.min(lines.length, MAX_LINES)} of ${lines.length} lines and ${Math.min(emails.length, MAX_EMAILS)} of ${emails.length} emails`,
    });
  }

  const refs = [
    process.env.HARVEST_MODEL || "sarvam:sarvam-105b",
    process.env.HARVEST_MODEL_FALLBACK || "openai:gpt-5.6",
  ];

  let raw = null;
  for (const ref of refs) {
    try {
      const res = await chatJson({ ref, user: buildPrompt(lines, emails), maxTokens: 4000, think: false });
      raw = stripJsonFence(res.text);
      break;
    } catch (err) {
      await logWarn({
        source: "harvest", event: "model_failed", userId,
        message: `${ref} could not resolve leftovers: ${err.message}`,
      });
    }
  }

  const proposals = parseProposals(raw);
  const byLineNo = new Map(lines.map((l) => [l.line_no, l]));
  const emailIds = new Set(emails.map((e) => e.messageId));

  const accepted = [];
  const rejected = [];
  const claimed = new Set();

  for (const proposal of proposals) {
    const line = byLineNo.get(proposal.lineNo);
    if (!line) {
      rejected.push({ ...proposal, why: "no such line" });
      continue;
    }

    // Nothing invented, and nothing used twice.
    if (proposal.parts.some((p) => !emailIds.has(p.messageId))) {
      rejected.push({ ...proposal, why: "cites an email that was not offered" });
      continue;
    }
    if (proposal.parts.some((p) => claimed.has(p.messageId))) {
      rejected.push({ ...proposal, why: "reuses an email already assigned" });
      continue;
    }

    const check = validateProposal(line, proposal.parts);
    if (!check.ok) {
      rejected.push({ ...proposal, why: `does not sum: ${check.sum} against ${check.target}` });
      continue;
    }

    for (const p of proposal.parts) claimed.add(p.messageId);
    accepted.push({ line, parts: proposal.parts });
  }

  await logInfo({
    source: "harvest", event: "leftovers_resolved", userId,
    message: `Model proposed ${proposals.length}, ${accepted.length} survived the sum check`,
    details: { rejected: rejected.map((r) => ({ lineNo: r.lineNo, why: r.why })) },
  });

  return { accepted, rejected, proposals: proposals.length };
}
