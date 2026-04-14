"use client";

import { cn } from "@/lib/utils";

export function DateRangePicker({ startDate, endDate, onStartChange, onEndChange, onPreset, activePreset }) {
  return (
    <div className="flex gap-2 flex-wrap items-center mb-5 px-4 py-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)]">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">Period</span>
      <input
        type="date"
        value={startDate}
        onChange={(e) => onStartChange(e.target.value)}
        className="px-2.5 py-1.5 border border-[var(--border)] rounded-md text-sm bg-[var(--bg-card)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none transition-colors"
      />
      <span className="text-xs text-[var(--text-tertiary)]">&ndash;</span>
      <input
        type="date"
        value={endDate}
        onChange={(e) => onEndChange(e.target.value)}
        className="px-2.5 py-1.5 border border-[var(--border)] rounded-md text-sm bg-[var(--bg-card)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none transition-colors"
      />
      <div className="flex gap-1">
        {[{ l: "7D", d: 7 }, { l: "30D", d: 30 }, { l: "90D", d: 90 }, { l: "1Y", d: 365 }, { l: "All", d: 0 }].map((p) => {
          const isActive = activePreset === p.d;
          return (
            <button
              key={p.l}
              onClick={() => onPreset(p.d)}
              aria-pressed={isActive}
              className={cn(
                "px-3 py-1 rounded-md text-[11px] font-medium border transition-all duration-150",
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)] font-semibold"
                  : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              )}
            >
              {p.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
