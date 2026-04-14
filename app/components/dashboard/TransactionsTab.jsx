"use client";

import { useState } from "react";
import { Search, Check, Circle } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { fmt, fmtDate, fmtTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export function TransactionsTab({ transactions, onToggleReceipt, onSelect }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = transactions.filter((t) => {
    if (filter !== "all" && t.category !== filter) return false;
    if (search && !t.merchant.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      {/* Search + count */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <div className="relative w-full md:w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search merchant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--bg-card)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none transition-colors"
          />
        </div>
        <span className="text-xs text-[var(--text-tertiary)]">{filtered.length} results</span>
      </div>

      {/* Category filter pills */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-0.5">
        {[{ key: "all", label: "All", Icon: null, color: null }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ key: k, label: v.label, Icon: v.icon, color: v.color }))].map((cat) => (
          <button
            key={cat.key}
            onClick={() => setFilter(cat.key)}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-full border text-[11px] font-medium whitespace-nowrap transition-all duration-150 shrink-0",
              filter === cat.key
                ? "font-semibold"
                : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            )}
            style={filter === cat.key ? {
              borderColor: cat.color || "var(--accent)",
              background: (cat.color || "var(--accent)") + "18",
              color: cat.color || "var(--accent)",
            } : undefined}
          >
            {cat.Icon && <cat.Icon size={12} />}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Transaction list */}
      <div className="flex flex-col gap-0.5">
        {filtered.map((t) => {
            const cat = CATEGORIES[t.category] || CATEGORIES.other;
            const CatIcon = cat.icon;
            return (
              <div
                key={t.id}
                onClick={() => onSelect(t)}
                className="flex items-center gap-3 px-4 py-3 max-md:px-3 bg-[var(--bg-card)] rounded-lg cursor-pointer border-l-[3px] border-l-transparent transition-all duration-150 hover:bg-[var(--bg-hover)] hover:translate-x-0.5"
                style={{ "--hover-accent": cat.color }}
                onMouseOver={(e) => e.currentTarget.style.borderLeftColor = cat.color}
                onMouseOut={(e) => e.currentTarget.style.borderLeftColor = "transparent"}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: cat.color + "18" }}
                >
                  <CatIcon size={16} style={{ color: cat.color }} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[var(--text)] truncate">{t.merchant}</div>
                  <div className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium flex items-center gap-1.5 flex-wrap">
                    <span>{fmtDate(t.date)}</span>
                    {t.txnTime && <span className="text-[var(--text-tertiary)] font-normal">{fmtTime(t.txnTime)}</span>}
                    {t.isRefund && (
                      <span className="text-[var(--success)] font-bold text-[10px] tracking-wider px-1.5 py-px rounded bg-[var(--success-bg)]">
                        REFUND
                      </span>
                    )}
                  </div>
                  {t.notes && <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5 truncate">{t.notes}</div>}
                </div>
                <div className={cn(
                  "font-semibold text-sm whitespace-nowrap tabular-nums",
                  t.isRefund ? "text-[var(--success)]" : "text-[var(--text)]"
                )}>
                  {t.isRefund ? "+" : ""}{fmt(t.amount)}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleReceipt(t.id); }}
                  title={t.hasReceipt ? "Receipt attached \u2014 click to remove" : "Mark receipt as attached"}
                  aria-label={t.hasReceipt ? "Receipt attached" : "Receipt missing"}
                  className={cn(
                    "w-7 h-7 rounded-md border flex items-center justify-center shrink-0 transition-all duration-150",
                    t.hasReceipt
                      ? "bg-[var(--success)] border-[var(--success)] text-white"
                      : "bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-tertiary)] hover:border-[var(--success)]"
                  )}
                >
                  {t.hasReceipt ? <Check size={14} /> : <Circle size={14} />}
                </button>
              </div>
            );
          })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--text-tertiary)]">
            <Search size={32} className="mx-auto mb-2 opacity-30" />
            <div className="text-sm font-medium mb-1 text-[var(--text-secondary)]">No transactions found</div>
            <div className="text-xs">Try a different search term or category filter.</div>
          </div>
        )}
      </div>
    </div>
  );
}
