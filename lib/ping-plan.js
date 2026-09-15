/**
 * The decisions the receipt ping makes that need no database.
 *
 * A ping is one Telegram message per charge, sent within the hour of the
 * charge landing. Nothing is exempt: a ₹50 subscription needs its invoice as
 * much as a hotel does, so there is no amount threshold and no waiver — only
 * "no bill exists" (declared) and "ask me tomorrow".
 *
 * No @/ imports: node --test runs this file directly.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const INR = (n) => {
  const v = Number(n || 0);
  const whole = Number.isInteger(v);
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function when(txn) {
  const [y, m, d] = String(txn.date || "").split("-").map(Number);
  const day = d && m ? `${d} ${MONTHS[m - 1]}` : String(txn.date || "");
  return txn.txn_time ? `${day} ${String(txn.txn_time).slice(0, 5)}` : day;
}

export function selectPings({ transactions, pinged, recurring, pausedUntil, today, max = 5 }) {
  if (pausedUntil && String(pausedUntil).slice(0, 10) >= String(today).slice(0, 10)) return [];

  return (transactions || [])
    .filter((t) => !t.is_refund && t.receipt_status === "missing" && !pinged.has(t.id))
    .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id - a.id))
    .slice(0, max);
}

export function pingText(txn, { recurring }) {
  const isRecurring = recurring.has(txn.merchant);
  const head = `🧾 <b>${INR(txn.amount)}</b> · ${esc(txn.merchant)} · ${when(txn)}`;

  const body = isRecurring
    ? "Recurring — the invoice usually arrives by email and the harvester checks the 17th–23rd. Forward it here if it doesn't turn up."
    : "Send me the bill when you have it.";

  const row = [{ text: "🚫 No bill", callback_data: `nb:${txn.id}` }];
  if (!isRecurring) row.push({ text: "🔁 Subscription", callback_data: `sub:${txn.id}` });
  row.push({ text: "⏰ Later", callback_data: `later:${txn.id}` });

  return { text: `${head}\n${body}`, keyboard: [row] };
}
