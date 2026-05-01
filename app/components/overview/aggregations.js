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

const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

export function priorWindow(allTxns, startDate, endDate) {
  if (!startDate || !endDate || !allTxns || allTxns.length === 0) {
    return { prior: [], priorStart: null, priorEnd: null };
  }
  const span = daysBetween(startDate, endDate);
  const priorEnd = addDays(startDate, -1);
  const priorStart = addDays(priorEnd, -span);
  const prior = allTxns.filter((t) => t.date >= priorStart && t.date <= priorEnd);
  return { prior, priorStart, priorEnd };
}

export function delta(curr, prev) {
  const c = Number(curr) || 0;
  const p = Number(prev) || 0;
  const abs = c - p;
  if (p === 0) {
    return { abs, pct: c === 0 ? 0 : null, dir: c === 0 ? "flat" : "up" };
  }
  const pct = (abs / Math.abs(p)) * 100;
  const dir = Math.abs(pct) < 2 ? "flat" : pct > 0 ? "up" : "down";
  return { abs, pct, dir };
}

export function projectMonthEnd(allTxns, today = new Date()) {
  const yr = today.getFullYear();
  const mo = today.getMonth();
  const monthStart = ymd(new Date(yr, mo, 1));
  const monthEndDate = new Date(yr, mo + 1, 0);
  const totalDays = monthEndDate.getDate();
  const todayIso = ymd(today);
  const daysElapsed = today.getDate();
  const daysRemaining = totalDays - daysElapsed;

  const mtd = (allTxns || []).filter((t) => t.date >= monthStart && t.date <= todayIso && !t.isRefund);
  const mtdSpend = mtd.reduce((s, t) => s + t.amount, 0);
  const dailyPace = daysElapsed > 0 ? mtdSpend / daysElapsed : 0;
  const projected = dailyPace * totalDays;

  const lastMo = new Date(yr, mo - 1, 1);
  const lastMoStart = ymd(lastMo);
  const lastMoEnd = ymd(new Date(yr, mo, 0));
  const lastMoTxns = (allTxns || []).filter(
    (t) => t.date >= lastMoStart && t.date <= lastMoEnd && !t.isRefund
  );
  const lastMoTotal = lastMoTxns.reduce((s, t) => s + t.amount, 0);
  const lastMoDays = new Date(yr, mo, 0).getDate();
  const lastMoSameSpan = lastMoTxns
    .filter((t) => parseInt(t.date.slice(8, 10), 10) <= daysElapsed)
    .reduce((s, t) => s + t.amount, 0);

  const paceVsLastMonth = lastMoSameSpan > 0 ? ((mtdSpend - lastMoSameSpan) / lastMoSameSpan) * 100 : null;

  return {
    mtdSpend,
    projected,
    daysElapsed,
    daysRemaining,
    totalDays,
    lastMoTotal,
    lastMoSameSpan,
    paceVsLastMonth,
    monthStart,
    monthEnd: ymd(monthEndDate),
  };
}

export function dowHourMatrix(txns) {
  const matrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ amount: 0, count: 0 }))
  );
  for (const t of purchasesOnly(txns)) {
    if (!t.txnTime) continue;
    const hr = parseInt(t.txnTime.split(":")[0], 10);
    if (!Number.isFinite(hr) || hr < 0 || hr > 23) continue;
    const dow = parseDate(t.date).getDay();
    matrix[dow][hr].amount += t.amount;
    matrix[dow][hr].count += 1;
  }
  let max = 0;
  for (const row of matrix) for (const cell of row) if (cell.amount > max) max = cell.amount;
  return { matrix, max };
}

export function anomalies(txns, { sigma = 2, minBaseline = 3, limit = 8 } = {}) {
  const purchases = purchasesOnly(txns);
  const byMerchant = new Map();
  for (const t of purchases) {
    const k = normalizeMerchant(t.merchant);
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push(t);
  }
  const flagged = [];
  for (const [merchant, list] of byMerchant) {
    if (list.length < minBaseline + 1) continue;
    for (const t of list) {
      const others = list.filter((x) => x.id !== t.id);
      if (others.length < minBaseline) continue;
      const mean = others.reduce((s, x) => s + x.amount, 0) / others.length;
      const variance = others.reduce((s, x) => s + (x.amount - mean) ** 2, 0) / others.length;
      const stddev = Math.sqrt(variance);
      if (stddev < 1) continue;
      const z = (t.amount - mean) / stddev;
      if (z >= sigma) {
        flagged.push({ txn: t, merchant, baseline: mean, stddev, sigma: z });
      }
    }
  }
  return flagged.sort((a, b) => b.sigma - a.sigma).slice(0, limit);
}

export function merchantTrend(allTxns, merchantCanonical, buckets = 6, refDate = new Date()) {
  const out = [];
  for (let i = buckets - 1; i >= 0; i--) {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
    const start = ymd(d);
    const end = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const total = (allTxns || [])
      .filter(
        (t) =>
          !t.isRefund &&
          t.date >= start &&
          t.date <= end &&
          normalizeMerchant(t.merchant) === merchantCanonical
      )
      .reduce((s, t) => s + t.amount, 0);
    out.push({ month: start.slice(0, 7), amount: total });
  }
  return out;
}

export function recurringVsDiscretionary(txns) {
  const purchases = purchasesOnly(txns);
  let recurring = 0;
  let discretionary = 0;
  for (const t of purchases) {
    if (t.category === "subscriptions") recurring += t.amount;
    else discretionary += t.amount;
  }
  const total = recurring + discretionary;
  return {
    recurring,
    discretionary,
    total,
    recurringPct: total > 0 ? (recurring / total) * 100 : 0,
    discretionaryPct: total > 0 ? (discretionary / total) * 100 : 0,
  };
}

export function categoryDrift(currTxns, priorTxns) {
  const curr = byCategory(currTxns);
  const prior = byCategory(priorTxns);
  const priorMap = new Map(prior.map((c) => [c.category, c]));
  const allCats = new Set([...curr.map((c) => c.category), ...prior.map((c) => c.category)]);
  return [...allCats]
    .map((cat) => {
      const c = curr.find((x) => x.category === cat) || { amount: 0, pct: 0, count: 0 };
      const p = priorMap.get(cat) || { amount: 0, pct: 0, count: 0 };
      return {
        category: cat,
        currAmount: c.amount,
        prevAmount: p.amount,
        currPct: c.pct,
        prevPct: p.pct,
        deltaPct: c.pct - p.pct,
        deltaAbs: c.amount - p.amount,
      };
    })
    .sort((a, b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs));
}

export const HISTOGRAM_BUCKETS = [
  { key: "tiny", label: "< ₹500", min: 0, max: 500 },
  { key: "small", label: "₹500–2K", min: 500, max: 2000 },
  { key: "mid", label: "₹2K–10K", min: 2000, max: 10000 },
  { key: "large", label: "₹10K–50K", min: 10000, max: 50000 },
  { key: "huge", label: "₹50K+", min: 50000, max: Infinity },
];

export function spendHistogram(txns) {
  const out = HISTOGRAM_BUCKETS.map((b) => ({ ...b, count: 0, sum: 0 }));
  for (const t of purchasesOnly(txns)) {
    const idx = HISTOGRAM_BUCKETS.findIndex((b) => t.amount >= b.min && t.amount < b.max);
    if (idx >= 0) {
      out[idx].count += 1;
      out[idx].sum += t.amount;
    }
  }
  return out;
}

export function topMovers(currTxns, priorTxns, limit = 3) {
  const drift = categoryDrift(currTxns, priorTxns);
  const moved = drift.filter((d) => d.prevAmount > 0 || d.currAmount > 0);
  const increases = [...moved]
    .filter((d) => d.deltaAbs > 0)
    .sort((a, b) => b.deltaAbs - a.deltaAbs)
    .slice(0, limit);
  const decreases = [...moved]
    .filter((d) => d.deltaAbs < 0)
    .sort((a, b) => a.deltaAbs - b.deltaAbs)
    .slice(0, limit);
  return { increases, decreases };
}

export function refundRecoveryByCategory(allInPeriod) {
  const spend = new Map();
  const refund = new Map();
  for (const t of allInPeriod) {
    if (t.isRefund) refund.set(t.category, (refund.get(t.category) || 0) + t.amount);
    else spend.set(t.category, (spend.get(t.category) || 0) + t.amount);
  }
  return [...spend.entries()]
    .map(([cat, s]) => {
      const r = refund.get(cat) || 0;
      return { category: cat, spend: s, refund: r, rate: s > 0 ? (r / s) * 100 : 0 };
    })
    .filter((row) => row.refund > 0)
    .sort((a, b) => b.rate - a.rate);
}

export function cumulativeByDay(txns, startIso, endIso) {
  const purchases = purchasesOnly(txns)
    .filter((t) => (!startIso || t.date >= startIso) && (!endIso || t.date <= endIso))
    .sort((a, b) => a.date.localeCompare(b.date));
  const days = [];
  if (!startIso) return days;
  let running = 0;
  const buckets = new Map();
  for (const t of purchases) {
    buckets.set(t.date, (buckets.get(t.date) || 0) + t.amount);
  }
  let cursor = startIso;
  const stop = endIso || ymd(new Date());
  while (cursor <= stop) {
    running += buckets.get(cursor) || 0;
    days.push({ date: cursor, cumulative: running, daily: buckets.get(cursor) || 0 });
    cursor = addDays(cursor, 1);
  }
  return days;
}
