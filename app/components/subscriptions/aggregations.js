import { normalizeMerchant } from "../overview/aggregations";

export function buildSubscriptions(allTransactions) {
  const subs = (allTransactions || []).filter((t) => t.category === "subscriptions" && !t.isRefund);
  const byMerchant = {};
  for (const t of subs) {
    const k = normalizeMerchant(t.merchant);
    if (!byMerchant[k]) byMerchant[k] = [];
    byMerchant[k].push(t);
  }

  return Object.entries(byMerchant)
    .map(([merchant, txns]) => {
      const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
      const total = txns.reduce((s, t) => s + t.amount, 0);
      const avg = total / txns.length;
      const lastDate = sorted[sorted.length - 1].date;
      const firstDate = sorted[0].date;
      const daySpan = (new Date(lastDate) - new Date(firstDate)) / 86400000;
      const freq = txns.length > 1 ? Math.round(daySpan / (txns.length - 1)) : 0;

      let cycle = "one-time";
      if (freq >= 25 && freq <= 35) cycle = "monthly";
      else if (freq >= 80 && freq <= 100) cycle = "quarterly";
      else if (freq >= 350 && freq <= 380) cycle = "annual";
      else if (freq > 0 && txns.length >= 2) cycle = "irregular";

      let nextDate = null;
      if (freq > 0 && txns.length >= 2) {
        const last = new Date(lastDate + "T00:00:00");
        last.setDate(last.getDate() + freq);
        nextDate = last.toISOString().slice(0, 10);
      }

      const monthlyEst = freq > 0 ? (avg / freq) * 30 : avg;
      return { merchant, count: txns.length, avg, total, freq, cycle, lastDate, nextDate, monthlyEst };
    })
    .sort((a, b) => b.monthlyEst - a.monthlyEst);
}

export const CYCLE_COLORS = {
  monthly: "#7C3AED",
  quarterly: "#0EA5E9",
  annual: "#10B981",
  irregular: "#F59E0B",
  "one-time": "#64748B",
};

export function upcoming30Days(subs, today = new Date()) {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);

  const items = [];
  for (const s of subs || []) {
    if (!s.nextDate) continue;
    if (s.cycle === "one-time") continue;
    const next = new Date(s.nextDate + "T00:00:00");
    if (next < start || next > end) continue;
    const daysAway = Math.round((next - start) / 86400000);
    items.push({
      merchant: s.merchant,
      nextDate: s.nextDate,
      amount: s.avg,
      cycle: s.cycle,
      daysAway,
    });
  }
  return items.sort((a, b) => a.daysAway - b.daysAway);
}

export function priceHikes(allTransactions, { minIncreasePct = 10, window = 3 } = {}) {
  const subs = (allTransactions || []).filter((t) => t.category === "subscriptions" && !t.isRefund);
  const grouped = new Map();
  for (const t of subs) {
    const k = normalizeMerchant(t.merchant);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(t);
  }

  const hikes = [];
  for (const [merchant, txns] of grouped) {
    if (txns.length < window * 2) continue;
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
    const recent = sorted.slice(-window);
    const prior = sorted.slice(-window * 2, -window);
    const recentAvg = recent.reduce((s, t) => s + t.amount, 0) / window;
    const priorAvg = prior.reduce((s, t) => s + t.amount, 0) / window;
    if (priorAvg <= 0) continue;
    const pct = ((recentAvg - priorAvg) / priorAvg) * 100;
    if (Math.abs(pct) >= minIncreasePct) {
      hikes.push({
        merchant,
        priorAvg,
        recentAvg,
        deltaPct: pct,
        deltaAbs: recentAvg - priorAvg,
        sampleCount: txns.length,
        latest: sorted[sorted.length - 1].date,
      });
    }
  }
  return hikes.sort((a, b) => b.deltaPct - a.deltaPct);
}

export function monthlyRamp(allTransactions, months = 12, refDate = new Date()) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const monthDate = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
    const start = monthDate.toISOString().slice(0, 10);
    const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).toISOString().slice(0, 10);
    const inMonth = (allTransactions || []).filter(
      (t) => t.category === "subscriptions" && !t.isRefund && t.date >= start && t.date <= end
    );
    const monthlyRecurring = inMonth.reduce((s, t) => s + t.amount, 0);
    out.push({
      month: start.slice(0, 7),
      monthlyRecurring,
      count: inMonth.length,
    });
  }
  return out;
}
