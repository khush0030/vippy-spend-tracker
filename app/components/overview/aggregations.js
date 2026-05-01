export const CATEGORY_COLORS = {
  amazon: "#7C3AED",
  fuel: "#10B981",
  dining: "#F59E0B",
  swiggy: "#FC8019",
  utilities: "#EF4444",
  subscriptions: "#0EA5E9",
  office: "#94A3B8",
  travel: "#06B6D4",
  other: "#64748B",
};

export const CATEGORY_LABELS = {
  amazon: "Amazon",
  fuel: "Fuel",
  dining: "Dining",
  swiggy: "Swiggy",
  utilities: "Utilities",
  subscriptions: "Subscriptions",
  office: "Office",
  travel: "Travel",
  other: "Other",
};

export const colorOf = (c) => CATEGORY_COLORS[c] || CATEGORY_COLORS.other;
export const labelOf = (c) => CATEGORY_LABELS[c] || "Other";

export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const TIME_BUCKETS = [
  { key: "morning", label: "Morning", range: "6 AM – 12 PM", from: 6, to: 12 },
  { key: "afternoon", label: "Afternoon", range: "12 PM – 5 PM", from: 12, to: 17 },
  { key: "evening", label: "Evening", range: "5 PM – 9 PM", from: 17, to: 21 },
  { key: "night", label: "Night", range: "9 PM – 6 AM", from: 21, to: 30 },
];

export const purchasesOnly = (txns) => txns.filter((t) => !t.isRefund);
export const refundsOnly = (txns) => txns.filter((t) => t.isRefund);

const MERCHANT_ALIASES = [
  { match: /amazon/i, canonical: "Amazon" },
  { match: /swiggy/i, canonical: "Swiggy" },
  { match: /zomato/i, canonical: "Zomato" },
  { match: /uber/i, canonical: "Uber" },
  { match: /ola\b/i, canonical: "Ola" },
  { match: /flipkart/i, canonical: "Flipkart" },
  { match: /cleartrip/i, canonical: "Cleartrip" },
  { match: /makemytrip|mmt\b/i, canonical: "MakeMyTrip" },
  { match: /netflix/i, canonical: "Netflix" },
  { match: /spotify/i, canonical: "Spotify" },
  { match: /claude/i, canonical: "Claude AI" },
  { match: /chatgpt|openai/i, canonical: "OpenAI" },
  { match: /google\s*(workspace|cloud|one)/i, canonical: "Google Workspace" },
  { match: /apple|icloud/i, canonical: "Apple" },
];

export function normalizeMerchant(raw) {
  if (!raw) return "Unknown";
  const trimmed = raw.trim();
  for (const { match, canonical } of MERCHANT_ALIASES) {
    if (match.test(trimmed)) return canonical;
  }
  return trimmed;
}

const parseDate = (d) => new Date(d + "T00:00:00");

export function summarize(txns) {
  const purchases = purchasesOnly(txns);
  const refunds = refundsOnly(txns);
  const totalSpend = purchases.reduce((s, t) => s + t.amount, 0);
  const totalRefunds = refunds.reduce((s, t) => s + t.amount, 0);
  const days = new Set(purchases.map((t) => t.date)).size || 1;
  return {
    purchases,
    refunds,
    totalSpend,
    totalRefunds,
    netSpend: totalSpend - totalRefunds,
    txnCount: purchases.length,
    refundCount: refunds.length,
    activeDays: days,
    dailyAverage: totalSpend / days,
    avgTransaction: purchases.length > 0 ? totalSpend / purchases.length : 0,
  };
}

export function byCategory(txns) {
  const totals = new Map();
  const counts = new Map();
  for (const t of purchasesOnly(txns)) {
    totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
    counts.set(t.category, (counts.get(t.category) || 0) + 1);
  }
  const total = [...totals.values()].reduce((s, v) => s + v, 0);
  return [...totals.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      count: counts.get(category) || 0,
      pct: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function byDay(txns) {
  const m = new Map();
  for (const t of purchasesOnly(txns)) {
    m.set(t.date, (m.get(t.date) || 0) + t.amount);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount }));
}

export function byDow(txns) {
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (const t of purchasesOnly(txns)) {
    const dow = parseDate(t.date).getDay();
    totals[dow] += t.amount;
    counts[dow] += 1;
  }
  return DOW_LABELS.map((label, i) => ({ label, amount: totals[i], count: counts[i] }));
}

export function byTimeBucket(txns) {
  const totals = Object.fromEntries(TIME_BUCKETS.map((b) => [b.key, 0]));
  const counts = Object.fromEntries(TIME_BUCKETS.map((b) => [b.key, 0]));
  for (const t of purchasesOnly(txns)) {
    if (!t.txnTime) continue;
    const hr = parseInt(t.txnTime.split(":")[0], 10);
    if (!Number.isFinite(hr)) continue;
    for (const b of TIME_BUCKETS) {
      const inRange = b.key === "night" ? hr >= 21 || hr < 6 : hr >= b.from && hr < b.to;
      if (inRange) {
        totals[b.key] += t.amount;
        counts[b.key] += 1;
        break;
      }
    }
  }
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  return TIME_BUCKETS.map((b) => ({
    ...b,
    amount: totals[b.key],
    count: counts[b.key],
    pct: total > 0 ? (totals[b.key] / total) * 100 : 0,
  }));
}

export function topMerchants(txns, limit = 8) {
  const m = new Map();
  for (const t of purchasesOnly(txns)) {
    const k = normalizeMerchant(t.merchant);
    if (!m.has(k)) m.set(k, { merchant: k, total: 0, count: 0, category: t.category });
    const e = m.get(k);
    e.total += t.amount;
    e.count += 1;
  }
  return [...m.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export const fmtINRcompact = (n) => {
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
};
