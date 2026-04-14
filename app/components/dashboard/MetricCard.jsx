"use client";

import { cn } from "@/lib/utils";

export function MetricCard({ title, value, sub, accent, className }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm",
        "flex-1 basis-[170px] min-w-[150px]",
        "max-md:basis-[calc(50%-6px)] max-md:min-w-0 max-md:p-4",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        className
      )}
    >
      {accent && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
          style={{ background: `linear-gradient(180deg, ${accent}, ${accent}55)` }}
        />
      )}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
        {title}
      </p>
      <p className="text-2xl max-md:text-lg font-bold text-[var(--text)] tabular-nums tracking-tight">
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-[var(--text-tertiary)] mt-1">{sub}</p>
      )}
    </div>
  );
}
