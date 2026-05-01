"use client";

import { useMemo, useState } from "react";
import { rolling12Weeks, fmtINR, DOW_SHORT } from "./aggregations";

export default function CalendarHeatmap({ transactions, isMobile }) {
  const { cells, max } = useMemo(() => rolling12Weeks(transactions), [transactions]);
  const [hover, setHover] = useState(null);

  const cell = isMobile ? 12 : 16;
  const gap = 3;
  const padLeft = 18;
  const padTop = 14;
  const weeks = 12;
  const w = padLeft + weeks * (cell + gap);
  const h = padTop + 7 * (cell + gap);

  const intensity = (v) => (max <= 0 ? 0 : Math.pow(v / max, 0.55));

  return (
    <div className="chart-card" style={{ position: "relative" }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Daily spend, last 12 weeks">
        {DOW_SHORT.map((d, i) =>
          i % 2 === 1 ? (
            <text key={i} x={0} y={padTop + i * (cell + gap) + cell * 0.75} fontSize={9} fill="var(--text-muted)" fontFamily="var(--font-display)">
              {d}
            </text>
          ) : null
        )}
        {cells.map((c) => {
          const x = padLeft + c.week * (cell + gap);
          const y = padTop + c.dow * (cell + gap);
          const t = intensity(c.amount);
          const fill = c.amount === 0 ? "var(--heat-empty)" : `color-mix(in srgb, var(--brand) ${Math.round(8 + t * 92)}%, var(--heat-empty))`;
          return (
            <rect
              key={c.date}
              x={x}
              y={y}
              width={cell}
              height={cell}
              rx={3}
              fill={fill}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: c.amount > 0 ? "pointer" : "default", transition: "fill 0.15s" }}
            />
          );
        })}
      </svg>
      {hover && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            padding: "6px 10px",
            background: "var(--bg-card-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--text)",
            pointerEvents: "none",
            fontFamily: "var(--font-display)",
          }}
        >
          {new Date(hover.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {hover.amount > 0 ? fmtINR(hover.amount) : "—"}
        </div>
      )}
    </div>
  );
}
