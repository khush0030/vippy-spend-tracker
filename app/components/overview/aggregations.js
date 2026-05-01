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

export const DOW_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
export const DOW_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const purchasesOnly = (txns) => txns.filter((t) => !t.isRefund);

const parseDate = (d) => new Date(d + "T00:00:00");
const ymd = (d) => d.toISOString().slice(0, 10);

export function rolling12Weeks(txns, today = new Date()) {
  const totals = new Map();
  for (const t of purchasesOnly(txns)) {
    totals.set(t.date, (totals.get(t.date) || 0) + t.amount);
  }
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  const startDow = end.getDay();
  end.setDate(end.getDate() + (6 - startDow));
  const cells = [];
  for (let i = 12 * 7 - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = ymd(d);
    cells.push({ date: key, dow: d.getDay(), week: Math.floor((12 * 7 - 1 - i) / 7), amount: totals.get(key) || 0 });
  }
  let max = 0;
  for (const c of cells) if (c.amount > max) max = c.amount;
  return { cells, max };
}

export function byDowHour(txns) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of purchasesOnly(txns)) {
    if (!t.txnTime) continue;
    const dow = parseDate(t.date).getDay();
    const hr = parseInt(t.txnTime.split(":")[0], 10);
    if (Number.isFinite(hr)) grid[dow][hr] += t.amount;
  }
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  const points = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      points.push({ x: h, y: d, v: grid[d][h] });
    }
  }
  return { grid, points, max };
}

export function byCategory(txns) {
  const totals = new Map();
  for (const t of purchasesOnly(txns)) {
    totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
  }
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function byCategoryDow(txns) {
  const cats = new Set();
  const grid = {};
  for (const t of purchasesOnly(txns)) {
    cats.add(t.category);
    const dow = parseDate(t.date).getDay();
    grid[t.category] = grid[t.category] || Array(7).fill(0);
    grid[t.category][dow] += t.amount;
  }
  const ordered = [...cats].sort((a, b) => {
    const sa = grid[a].reduce((s, v) => s + v, 0);
    const sb = grid[b].reduce((s, v) => s + v, 0);
    return sb - sa;
  });
  return { categories: ordered, grid };
}

export function byMerchant(txns, limit = 30) {
  const m = new Map();
  for (const t of purchasesOnly(txns)) {
    const k = t.merchant || "Unknown";
    if (!m.has(k)) m.set(k, { merchant: k, total: 0, count: 0, hourSum: 0, hourN: 0, category: t.category });
    const e = m.get(k);
    e.total += t.amount;
    e.count += 1;
    if (t.txnTime) {
      const [h, mn] = t.txnTime.split(":").map(Number);
      if (Number.isFinite(h)) {
        e.hourSum += h + (Number.isFinite(mn) ? mn / 60 : 0);
        e.hourN += 1;
      }
    }
  }
  return [...m.values()]
    .map((e) => ({
      ...e,
      avgHour: e.hourN ? e.hourSum / e.hourN : 12,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
