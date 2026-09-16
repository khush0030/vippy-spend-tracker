// lib/chat-confirm.js
/**
 * Every write a chat turn proposed, as the one thing a Confirm button applies.
 * A model filing six receipts calls the tool six times; keeping only the first
 * silently dropped the other five. No @/ imports.
 */

const MAX_BATCH = 10;

export function bundleConfirms(confirms) {
  const seen = new Set();
  const charges = new Set();
  const items = [];
  for (const c of confirms || []) {
    const key = JSON.stringify([c.kind, c.payload]);
    if (seen.has(key)) continue;
    seen.add(key);
    // Two copies of one bill filed against the same charge is a duplicate, not a split.
    if (c.kind === "match_receipt") {
      const target = JSON.stringify([...c.payload.transaction_ids].sort((a, b) => a - b));
      if (charges.has(target)) continue;
      charges.add(target);
    }
    items.push(c);
  }
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  const kept = items.slice(0, MAX_BATCH);
  return {
    kind: "batch",
    summary: kept.map((c, i) => `${i + 1}. ${c.summary}`).join("\n"),
    payload: { items: kept },
  };
}
