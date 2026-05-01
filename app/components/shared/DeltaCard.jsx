"use client";

import DeltaBadge from "./DeltaBadge";

const numStyle = {
  fontFamily: "var(--font-display)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

export default function DeltaCard({ label, value, sub, accent, delta, invert = false, large = false }) {
  return (
    <div
      style={{
        padding: large ? "22px 24px" : "16px 18px",
        background: "var(--bg-card-2)",
        borderRadius: 12,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          fontFamily: "var(--font-display)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...numStyle,
          fontSize: large ? 24 : 20,
          fontWeight: 700,
          color: "var(--text)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>}
      {delta && <DeltaBadge delta={delta} invert={invert} />}
      {accent && (
        <div
          style={{
            position: "absolute",
            top: large ? 22 : 16,
            right: large ? 24 : 18,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: accent,
          }}
        />
      )}
    </div>
  );
}
