import { extractAmounts } from "./money-parse.js";

/**
 * The decisions the sweep makes that need no mailbox and no database.
 *
 * Split out for the same reason lib/cycle-window.js is split out of
 * lib/cycles.js: node --test has no bundler, so a module that reaches an
 * aliased import cannot be tested at all — and the window arithmetic is
 * exactly the sort of thing that fails silently on a month boundary.
 */

function shift(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Two days before the cycle opens, because a receipt precedes its charge, and
 * five days after it closes, because invoices arrive late — a good many of
 * August's did.
 */
export function searchWindow(cycle) {
  return { after: shift(cycle.cycle_start, -2), before: shift(cycle.cycle_end, 5) };
}

export function candidateFrom(message) {
  if (!message?.date) return null;

  const haystack = [message.subject || "", message.text || message.html || ""].join("\n");
  const found = extractAmounts(haystack);

  // A receipt states its total two or three times over. Collapse to the set.
  const seen = new Set();
  const amounts = [];
  for (const a of found) {
    const key = `${a.currency}:${a.value.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    amounts.push(a);
  }

  return { messageId: message.messageId, date: message.date, amounts };
}

/**
 * "Uber Receipts <noreply@uber.com>" -> "Uber Receipts". Some senders carry no
 * display name at all — Instamart is one — so the domain's first label stands
 * in rather than the bare address ending up in the accounts package.
 */
export function merchantFrom(message) {
  const from = String(message?.from || "");
  const name = from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  if (name && !name.includes("@")) return name.slice(0, 80);

  const domain = from.match(/@([^\s>]+)/)?.[1];
  const label = domain?.split(".")[0];
  if (label) return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();

  return String(message?.subject || "Unknown").slice(0, 80);
}
