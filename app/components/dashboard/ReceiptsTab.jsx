"use client";

import { Check } from "lucide-react";
import { fmt, fmtDate } from "@/lib/formatters";
import { MetricCard } from "./MetricCard";

export function ReceiptsTab({ transactions, onToggleReceipt }) {
  const missing = transactions.filter((t) => !t.hasReceipt && !t.isRefund);
  const attached = transactions.filter((t) => t.hasReceipt);

  return (
    <div>
      <div className="flex gap-3 max-md:gap-2 mb-5 flex-wrap">
        <MetricCard title="Missing" value={missing.length} sub="Action needed" accent="var(--danger)" />
        <MetricCard title="Attached" value={attached.length} sub="All good" accent="var(--success)" />
      </div>

      {missing.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mb-2 text-[var(--danger)]">Missing Receipts</h3>
          <div className="flex flex-col gap-0.5 mb-6">
            {missing.map((t, i) => (
              <div
                key={t.id}
                className="flex items-center gap-3 py-2.5 px-4 bg-[var(--bg-card)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
              >
                <div className="flex-1">
                  <span className="font-medium text-sm text-[var(--text)]">{t.merchant}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)] ml-2">{fmtDate(t.date)}</span>
                </div>
                <span className="font-semibold text-sm text-[var(--text)] tabular-nums">{fmt(t.amount)}</span>
                <button
                  onClick={() => onToggleReceipt(t.id)}
                  className="px-3 py-1 rounded-md border border-[var(--success)] text-[var(--success)] text-[11px] font-semibold hover:bg-[var(--success)] hover:text-white transition-all duration-150"
                >
                  Attach
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {attached.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mb-2 text-[var(--success)]">Attached ({attached.length})</h3>
          <div className="flex flex-col gap-0.5">
            {attached.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5 px-4 bg-[var(--bg-card)] rounded-lg">
                <div className="flex-1">
                  <span className="font-medium text-sm text-[var(--text)]">{t.merchant}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)] ml-2">{fmtDate(t.date)}</span>
                </div>
                <span className="font-semibold text-sm text-[var(--text)] tabular-nums">{fmt(t.amount)}</span>
                <Check size={14} className="text-[var(--success)]" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
