"use client";

import { BarChart3, Flame, RefreshCw, CalendarDays, Tag } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { fmt } from "@/lib/formatters";

export function InsightsPanel({ transactions }) {
  const purchases = transactions.filter((t) => !t.isRefund);
  if (purchases.length === 0) return null;

  const catTotals = {};
  const merchCounts = {};
  for (const t of purchases) {
    catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
    merchCounts[t.merchant] = (merchCounts[t.merchant] || 0) + 1;
  }

  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  const topMerch = Object.entries(merchCounts).sort((a, b) => b[1] - a[1])[0];
  const total = purchases.reduce((s, t) => s + t.amount, 0);
  const avg = total / purchases.length;
  const highest = purchases.reduce((m, t) => t.amount > m.amount ? t : m, purchases[0]);
  const days = [...new Set(purchases.map((t) => t.date))].length;
  const topCatInfo = CATEGORIES[topCat[0]] || CATEGORIES.other;
  const TopCatIcon = topCatInfo.icon;

  const items = [
    { Icon: TopCatIcon, title: "Top Category", val: topCatInfo.label, sub: fmt(topCat[1]), col: topCatInfo.color },
    { Icon: BarChart3, title: "Avg Transaction", val: fmt(avg), sub: `${purchases.length} purchases`, col: "#2196F3" },
    { Icon: Flame, title: "Highest Spend", val: fmt(highest.amount), sub: highest.merchant, col: "#E91E63" },
    { Icon: RefreshCw, title: "Most Frequent", val: topMerch[0], sub: `${topMerch[1]} times`, col: "#FF9900" },
    { Icon: CalendarDays, title: "Daily Average", val: fmt(total / (days || 1)), sub: `${days} active days`, col: "#4CAF50" },
    { Icon: Tag, title: "Categories", val: Object.keys(catTotals).length, sub: "spending types", col: "#9C27B0" },
  ];

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 max-md:p-4 mb-5 shadow-sm">
      <h3 className="text-sm font-semibold mb-4 text-[var(--text)]">Spending Insights</h3>
      <div className="grid grid-cols-3 max-md:grid-cols-2 gap-3">
        {items.map((it) => (
          <div
            key={it.title}
            className="p-3.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] cursor-default transition-all duration-200 hover:shadow-md hover:scale-[1.02]"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <it.Icon size={14} style={{ color: it.col }} strokeWidth={2.5} />
              <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider font-semibold">
                {it.title}
              </span>
            </div>
            <div className="text-[15px] font-bold tracking-tight" style={{ color: it.col }}>
              {it.val}
            </div>
            <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{it.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
