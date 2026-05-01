"use client";

import { useState } from "react";
import { fmtINR } from "../overview/aggregations";

const DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_INDEX = [1, 2, 3, 4, 5, 6, 0];
const HOUR_BINS = [
  { from: 0, to: 3, label: "12a" },
  { from: 3, to: 6, label: "3a" },
  { from: 6, to: 9, label: "6a" },
  { from: 9, to: 12, label: "9a" },
  { from: 12, to: 15, label: "12p" },
  { from: 15, to: 18, label: "3p" },
  { from: 18, to: 21, label: "6p" },
  { from: 21, to: 24, label: "9p" },
];

export default function HeatmapDOWHour({ matrix, max, accent = "#7C3AED", isMobile }) {
  const [hover, setHover] = useState(null);

  const binned = DAY_INDEX.map((d) =>
    HOUR_BINS.map((h) => {
      let amount = 0,
        count = 0;
      for (let hr = h.from; hr < h.to; hr++) {
        amount += matrix[d][hr].amount;
        count += matrix[d][hr].count;
      }
      return { amount, count };
    })
  );

  const localMax = max || Math.max(1, ...binned.flat().map((c) => c.amount));

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${isMobile ? 32 : 40}px repeat(8, 1fr)`,
          gap: 4,
        }}
      >
        <div />
        {HOUR_BINS.map((h) => (
          <div
            key={h.from}
            style={{
              fontSize: 9,
              color: "var(--text-muted)",
              textAlign: "center",
              fontFamily: "var(--font-display)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.04em",
            }}
          >
            {h.label}
          </div>
        ))}
        {DOWS.map((d, rowIdx) => (
          <RowGroup
            key={d}
            label={d}
            cells={binned[rowIdx]}
            localMax={localMax}
            accent={accent}
            onHover={(c, idx) =>
              setHover(c ? { ...c, dow: d, range: HOUR_BINS[idx] } : null)
            }
          />
        ))}
      </div>
      {hover && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "var(--bg-card-2)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--text)",
            fontFamily: "var(--font-display)",
            fontVariantNumeric: "tabular-nums",
            display: "inline-flex",
            gap: 16,
          }}
        >
          <span>
            <strong>{hover.dow}</strong> · {hover.range.label}–{HOUR_BINS[(HOUR_BINS.indexOf(hover.range) + 1) % HOUR_BINS.length].label}
          </span>
          <span style={{ color: accent, fontWeight: 700 }}>{fmtINR(hover.amount)}</span>
          <span style={{ color: "var(--text-muted)" }}>{hover.count} txns</span>
        </div>
      )}
    </div>
  );
}

function RowGroup({ label, cells, localMax, accent, onHover }) {
  return (
    <>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-muted)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          fontFamily: "var(--font-display)",
          alignSelf: "center",
        }}
      >
        {label}
      </div>
      {cells.map((c, idx) => {
        const intensity = c.amount > 0 ? Math.max(0.08, c.amount / localMax) : 0;
        return (
          <div
            key={idx}
            onMouseEnter={() => onHover(c, idx)}
            onMouseLeave={() => onHover(null, idx)}
            style={{
              aspectRatio: "1.1 / 1",
              borderRadius: 4,
              background:
                c.amount > 0
                  ? `color-mix(in srgb, ${accent} ${(intensity * 90).toFixed(1)}%, transparent)`
                  : "var(--bg-card-2)",
              border: "1px solid var(--border)",
              cursor: c.amount > 0 ? "pointer" : "default",
              transition: "transform 0.12s",
            }}
          />
        );
      })}
    </>
  );
}
