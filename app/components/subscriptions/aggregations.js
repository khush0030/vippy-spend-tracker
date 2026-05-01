export function buildSubscriptions(allTransactions) {
  const subs = (allTransactions || []).filter((t) => t.category === "subscriptions" && !t.isRefund);
  const byMerchant = {};
  for (const t of subs) {
    if (!byMerchant[t.merchant]) byMerchant[t.merchant] = [];
    byMerchant[t.merchant].push(t);
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
