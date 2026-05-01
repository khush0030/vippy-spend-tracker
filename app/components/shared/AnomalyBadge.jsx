"use client";

import { fmtINR } from "../overview/aggregations";

export default function AnomalyBadge({ baseline, sigma, compact = false }) {
  const tip = `${sigma.toFixed(1)}σ above usual ${fmtINR(baseline)}`;
  return (
    <span
      title={tip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: compact ? "1px 5px" : "2px 7px",
        borderRadius: 4,
        background: "color-mix(in srgb, #F59E0B 15%, transparent)",
        color: "#D97706",
        fontSize: compact ? 9 : 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "var(--font-display)",
        cursor: "help",
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span>OUTLIER</span>
    </span>
  );
}
