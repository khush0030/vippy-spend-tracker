/**
 * What the chat looks like on the 18th.
 *
 * Pure, so the wording of the one message that decides whether a month is
 * trusted can be tested without a Telegram token. Deliberately short: the
 * headline is whether it ties out, and the only items listed by name are the
 * ones that need a human — chiefly refunds that never arrived.
 */

const INR = (n) =>
  "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2026-08-18" → "18 Aug" */
export function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    d.getUTCMonth()
  ];
  return `${d.getUTCDate()} ${month}`;
}

export function formatReconReport(s = {}) {
  const lines = [];

  lines.push(`📄 <b>Statement received · ${shortDate(s.issuedOn)}</b>`);
  lines.push(
    `${plural(s.lineCount || 0, "line")} · ${INR(s.spend)} · closing balance ${
      s.tiesOut ? "<b>ties out</b> ✅" : `<b>off by ${INR(Math.abs(s.diff || 0))}</b> ⛔`
    }`
  );

  if (!s.tiesOut) {
    lines.push("");
    lines.push(
      "The statement does not reconcile, so this cycle is <b>blocked from submission</b> until it does."
    );
  }

  lines.push("");
  lines.push(`✅ ${plural(s.tied || 0, "charge")} matched`);

  if (s.created?.length) {
    lines.push(`➕ <b>${plural(s.created.length, "charge")} the app never saw</b> — added`);
    for (const c of s.created.slice(0, 5)) {
      lines.push(`   <code>${esc(c.merchant).slice(0, 24)} · ${INR(c.amount)}</code>`);
    }
    if (s.created.length > 5) lines.push(`   <i>+${s.created.length - 5} more</i>`);
  }

  if (s.refundsConfirmed?.count) {
    lines.push(
      `↩︎ ${plural(s.refundsConfirmed.count, "refund")} confirmed · ${INR(s.refundsConfirmed.total)}`
    );
  }

  if (s.refundsMissing?.length) {
    lines.push(`⚠️ <b>${plural(s.refundsMissing.length, "refund")} still missing</b>`);
    for (const r of s.refundsMissing.slice(0, 5)) {
      lines.push(
        `   <code>${esc(r.merchant).slice(0, 24)} · ${INR(r.amount)} · ${r.ageDays}d</code>`
      );
    }
    if (s.refundsMissing.length > 5) lines.push(`   <i>+${s.refundsMissing.length - 5} more</i>`);
  }

  if (s.chargebacks) lines.push(`⚖️ ${plural(s.chargebacks, "dispute")} in progress`);
  if (s.fees) lines.push(`💳 ${plural(s.fees, "fee line")} auto-categorised`);
  if (s.rolledForward) {
    lines.push(`↪︎ ${plural(s.rolledForward, "charge")} not on the statement — rolled forward`);
  }

  lines.push("");
  if (s.coverage?.missing) {
    lines.push(`📎 <b>${plural(s.coverage.missing, "charge")} still need a receipt</b>`);
  }

  const days = s.daysToSubmit;
  const tail = [
    days != null && days >= 0
      ? `${days === 0 ? "Submitting today" : `${plural(days, "day")} to the ${ordinal(s.submitDay)}`}.`
      : null,
    `Coverage <b>${s.coverage?.coveragePct ?? 100}%</b> against the statement.`,
  ]
    .filter(Boolean)
    .join(" ");
  lines.push(tail);

  return lines.filter((l) => l !== undefined).join("\n");
}

function ordinal(n) {
  const v = Number(n || 23);
  const suffix = v % 10 === 1 && v !== 11 ? "st" : v % 10 === 2 && v !== 12 ? "nd" : v % 10 === 3 && v !== 13 ? "rd" : "th";
  return `${v}${suffix}`;
}

/** The compact summary the formatter above consumes, built from a reconcile(). */
export function summarise(recon, { issuedOn, submitDay = 23, daysToSubmit = null } = {}) {
  const refundTotal = (recon.refundsConfirmed || []).reduce(
    (sum, r) => sum + Number(r.line?.amount || 0),
    0
  );

  return {
    issuedOn,
    submitDay,
    daysToSubmit,
    lineCount: recon.coverage?.lines ?? 0,
    spend: recon.spend ?? 0,
    tiesOut: Boolean(recon.control?.tiesOut),
    diff: recon.control?.diff ?? null,
    blocked: Boolean(recon.blocked),
    tied: (recon.tied || []).length,
    created: (recon.createdFromStatement || []).map((e) => ({
      merchant: e.transaction.merchant,
      amount: e.transaction.amount,
    })),
    refundsConfirmed: { count: (recon.refundsConfirmed || []).length, total: refundTotal },
    refundsMissing: (recon.refundsMissing || []).map((r) => ({
      merchant: r.transaction.merchant,
      amount: r.transaction.amount,
      ageDays: r.ageDays,
    })),
    fees: (recon.fees || []).length,
    payments: (recon.payments || []).length,
    chargebacks: (recon.chargebacks || []).length,
    rolledForward: (recon.rolledForward || []).length,
    coverage: recon.coverage,
  };
}
