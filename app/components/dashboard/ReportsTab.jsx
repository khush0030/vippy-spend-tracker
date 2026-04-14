"use client";

import { FileText, Download } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { fmt, fmtDate } from "@/lib/formatters";

export function ReportsTab({ transactions, startDate, endDate }) {
  const purchases = transactions.filter((t) => !t.isRefund);
  const refunds = transactions.filter((t) => t.isRefund);
  const totalSpend = purchases.reduce((s, t) => s + t.amount, 0);
  const totalRefunds = refunds.reduce((s, t) => s + t.amount, 0);
  const missingReceipts = transactions.filter((t) => !t.hasReceipt && !t.isRefund);

  const catTotals = {};
  for (const t of purchases) catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
  const catsSorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

  const downloadCSV = () => {
    const p = new URLSearchParams(); p.set("format", "csv");
    if (startDate) p.set("start", startDate); if (endDate) p.set("end", endDate);
    window.open(`/api/reports?${p.toString()}`, "_blank");
  };

  const period = startDate && endDate ? `${fmtDate(startDate)} \u2013 ${fmtDate(endDate)}` : "All time";

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <button
          onClick={downloadCSV}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] text-sm font-medium shadow-sm hover:bg-[var(--bg-hover)] hover:shadow-md transition-all"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 max-md:p-4 shadow-sm">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-bold tracking-tight text-[var(--text)]">Expense Report</h3>
          <span className="text-[11px] text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-3 py-1 rounded-full">{period}</span>
        </div>

        <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3 mb-6">
          {[
            { l: "GROSS SPEND", v: fmt(totalSpend) },
            { l: "REFUNDS", v: fmt(totalRefunds), c: "var(--success)" },
            { l: "NET SPEND", v: fmt(totalSpend - totalRefunds) },
            { l: "MISSING RECEIPTS", v: missingReceipts.length, c: missingReceipts.length > 0 ? "var(--danger)" : undefined },
          ].map((it) => (
            <div key={it.l} className="p-3 bg-[var(--bg-secondary)] rounded-lg">
              <div className="text-[10px] text-[var(--text-tertiary)] mb-1 font-semibold tracking-wider">{it.l}</div>
              <div className="text-lg font-bold tabular-nums" style={{ color: it.c || "var(--text)" }}>{it.v}</div>
            </div>
          ))}
        </div>

        <h4 className="text-sm font-semibold mb-3 text-[var(--text)]">Category Breakdown</h4>
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] px-4 py-2 bg-[var(--bg-secondary)] text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
            <span>Category</span><span className="text-right">Amount</span><span className="text-right">%</span><span className="text-right">Count</span>
          </div>
          {catsSorted.map(([cat, total]) => {
            const info = CATEGORIES[cat] || CATEGORIES.other;
            const CatIcon = info.icon;
            const count = purchases.filter((t) => t.category === cat).length;
            return (
              <div key={cat} className="grid grid-cols-[2fr_1fr_1fr_1fr] px-4 py-2 border-t border-[var(--border)] text-sm items-center">
                <span className="flex items-center gap-2">
                  <CatIcon size={14} style={{ color: info.color }} strokeWidth={2} />
                  <span className="font-medium text-[var(--text)]">{info.label}</span>
                </span>
                <span className="text-right font-semibold text-[var(--text)] tabular-nums">{fmt(total)}</span>
                <span className="text-right text-[var(--text-secondary)]">{totalSpend > 0 ? ((total / totalSpend) * 100).toFixed(1) : 0}%</span>
                <span className="text-right text-[var(--text-secondary)]">{count}</span>
              </div>
            );
          })}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] px-4 py-2 border-t-2 border-[var(--border-strong)] text-sm font-bold bg-[var(--bg-secondary)] text-[var(--text)]">
            <span>Total</span><span className="text-right tabular-nums">{fmt(totalSpend)}</span><span className="text-right">100%</span><span className="text-right">{purchases.length}</span>
          </div>
        </div>

        {missingReceipts.length > 0 && (
          <>
            <h4 className="text-sm font-semibold mt-5 mb-2 text-[var(--danger)]">Missing Receipts ({missingReceipts.length})</h4>
            <div className="rounded-lg border border-[var(--border)] overflow-hidden">
              {missingReceipts.map((t, i) => (
                <div key={t.id} className={`flex justify-between px-4 py-2 text-sm text-[var(--text)] ${i > 0 ? "border-t border-[var(--border)]" : ""}`}>
                  <span>{t.merchant}</span>
                  <span className="flex gap-4">
                    <span className="text-[var(--text-tertiary)]">{fmtDate(t.date)}</span>
                    <span className="font-semibold tabular-nums">{fmt(t.amount)}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
