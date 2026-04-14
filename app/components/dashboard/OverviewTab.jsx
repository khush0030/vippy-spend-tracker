"use client";

import { Doughnut, Bar } from "react-chartjs-2";
import { CATEGORIES } from "@/lib/categories";
import { fmt } from "@/lib/formatters";
import { MetricCard } from "./MetricCard";
import { InsightsPanel } from "./InsightsPanel";

export function OverviewTab({ transactions, chartColors = {} }) {
  const purchases = transactions.filter((t) => !t.isRefund);
  const refunds = transactions.filter((t) => t.isRefund);
  const totalR = refunds.reduce((s, t) => s + t.amount, 0);
  const catTotals = {};
  for (const t of purchases) catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
  for (const t of refunds) catTotals[t.category] = (catTotals[t.category] || 0) - t.amount;
  const cats = Object.entries(catTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = purchases.reduce((s, t) => s + t.amount, 0) - totalR;
  const rcpt = transactions.filter((t) => t.hasReceipt).length;

  const donutData = {
    labels: cats.map(([c]) => CATEGORIES[c]?.label || c),
    datasets: [{
      data: cats.map(([, v]) => v),
      backgroundColor: cats.map(([c]) => CATEGORIES[c]?.color || "#795548"),
      borderWidth: 3,
      borderColor: "var(--bg-card)",
    }],
  };
  const barData = {
    labels: cats.map(([c]) => CATEGORIES[c]?.label || c),
    datasets: [{
      label: "Spend",
      data: cats.map(([, v]) => v),
      backgroundColor: cats.map(([c]) => CATEGORIES[c]?.color || "#795548"),
      borderRadius: 6,
    }],
  };

  const byDay = {};
  for (const t of purchases) byDay[t.date] = (byDay[t.date] || 0) + t.amount;
  const daysSorted = Object.keys(byDay).sort();
  const dailyData = {
    labels: daysSorted.map((d) => { const dt = new Date(d + "T00:00:00"); return `${dt.getDate()} ${dt.toLocaleString("en-IN", { month: "short" })}`; }),
    datasets: [{
      label: "Daily",
      data: daysSorted.map((d) => byDay[d]),
      backgroundColor: "#1e40af",
      borderRadius: 4,
    }],
  };

  const tc = chartColors.text || "#111827";
  const tcl = chartColors.textLight || "#6b7280";
  const chartFont = { size: 13, weight: "bold" };

  return (
    <div>
      <div className="flex gap-3 max-md:gap-2 flex-wrap mb-5">
        <MetricCard title="Net Spend" value={fmt(total)} sub="After refunds" accent="#2eaadc" />
        <MetricCard title="Purchases" value={purchases.length} sub={`${refunds.length} refunds`} accent="#4CAF50" />
        <MetricCard title="Refunds" value={fmt(totalR)} sub={`${refunds.length} returns`} accent="#FF9900" />
        <MetricCard title="Receipts" value={`${rcpt}/${transactions.length}`} sub="Attached" accent="#9C27B0" />
      </div>

      <InsightsPanel transactions={transactions} />

      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-5 max-md:gap-4 mb-5">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 max-md:p-4 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4 text-[var(--text)] tracking-tight">Category Split</h3>
          <div className="max-w-[260px] max-md:max-w-[220px] mx-auto">
            <Doughnut data={donutData} options={{
              cutout: "62%",
              plugins: {
                legend: { position: "bottom", labels: { boxWidth: 12, padding: 10, color: tc, font: chartFont } },
              },
            }} />
          </div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 max-md:p-4 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4 text-[var(--text)] tracking-tight">Category Breakdown</h3>
          <Bar data={barData} options={{
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN"), color: tcl, font: chartFont } },
              y: { grid: { display: false }, ticks: { color: tc, font: chartFont } },
            },
          }} />
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 max-md:p-4 shadow-sm">
        <h3 className="text-[15px] font-bold mb-4 text-[var(--text)] tracking-tight">Daily Spend</h3>
        <Bar data={dailyData} options={{
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: tcl, font: chartFont, maxRotation: 45, minRotation: 30 } },
            y: { grid: { color: "var(--border)" }, ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN"), color: tcl, font: chartFont } },
          },
        }} />
      </div>
    </div>
  );
}
