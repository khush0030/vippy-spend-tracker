"use client";

import { fmtINR } from "../overview/aggregations";

/** Change vs the prior window. `invert` marks increases as bad (spend). */
export default function DeltaBadge({ delta, invert = false, mode = "pct", compact = false }) {
  if (!delta || delta.dir === "flat" || delta.pct === null) {
    return <span className="small muted num">— vs prior</span>;
  }
  const isUp = delta.dir === "up";
  const isBad = invert ? isUp : !isUp;
  const value = mode === "abs" ? fmtINR(Math.abs(delta.abs)) : `${Math.abs(delta.pct).toFixed(1)}%`;
  return (
    <span
      className="num"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: compact ? 0 : "2px 7px",
        borderRadius: 6,
        background: compact ? "transparent" : isBad ? "var(--danger-bg)" : "var(--success-bg)",
        color: isBad ? "var(--danger)" : "var(--success)",
        fontSize: compact ? 11 : 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {isUp ? "▲" : "▼"} {value}
      {!compact && <span style={{ color: "var(--text-muted)", marginLeft: 2 }}>vs prior</span>}
    </span>
  );
}
