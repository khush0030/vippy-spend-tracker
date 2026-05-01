"use client";

import { fmtINR } from "../overview/aggregations";

export default function DeltaBadge({ delta, invert = false, mode = "pct", compact = false }) {
  if (!delta || delta.dir === "flat" || delta.pct === null) {
    return (
      <span
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          fontWeight: 600,
          letterSpacing: "0.02em",
          fontFamily: "var(--font-display)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        — vs prior
      </span>
    );
  }

  const isUp = delta.dir === "up";
  const isBad = invert ? !isUp : isUp;
  const color = isBad ? "var(--danger, #EF4444)" : "var(--success, #10B981)";
  const arrow = isUp ? "↑" : "↓";
  const value =
    mode === "abs" ? fmtINR(Math.abs(delta.abs)) : `${Math.abs(delta.pct).toFixed(1)}%`;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: compact ? 10 : 11,
        color,
        fontWeight: 700,
        fontFamily: "var(--font-display)",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "0.02em",
      }}
    >
      <span>{arrow}</span>
      <span>{value}</span>
      {!compact && (
        <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>vs prior</span>
      )}
    </span>
  );
}
