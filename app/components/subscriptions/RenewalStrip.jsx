"use client";

import { useMemo, useState } from "react";
import { CYCLE_COLORS } from "./aggregations";
import { fmtINR } from "../overview/aggregations";

export default function RenewalStrip({ subs, isMobile, days = 30 }) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const renewals = useMemo(() => {
    const out = [];
    for (const s of subs) {
      if (!s.nextDate) continue;
      const nd = new Date(s.nextDate + "T00:00:00");
      const diff = Math.round((nd - today) / 86400000);
      if (diff < 0 || diff > days) continue;
      out.push({ ...s, dayOffset: diff });
    }
    return out.sort((a, b) => a.dayOffset - b.dayOffset);
  }, [subs, today, days]);

  const [hover, setHover] = useState(null);

  const padX = 18;
  const padY = 18;
  const w = 600;
  const h = isMobile ? 110 : 140;
  const stepX = (w - padX * 2) / days;

  const maxAmt = useMemo(() => renewals.reduce((m, r) => Math.max(m, r.avg), 0), [renewals]);
  const radiusOf = (amt) => (maxAmt > 0 ? 4 + (amt / maxAmt) * (isMobile ? 12 : 18) : 6);

  return (
    <div className="chart-card" style={{ position: "relative" }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Upcoming renewals next 30 days">
        <line x1={padX} x2={w - padX} y1={h - padY} y2={h - padY} stroke="var(--border)" strokeWidth={1} />
        {[0, 7, 14, 21, 28].map((d) => (
          <g key={d}>
            <line
              x1={padX + d * stepX}
              x2={padX + d * stepX}
              y1={h - padY}
              y2={h - padY + 4}
              stroke="var(--text-muted)"
              strokeWidth={1}
            />
            <text
              x={padX + d * stepX}
              y={h - 4}
              fontSize={9}
              fill="var(--text-muted)"
              textAnchor="middle"
              fontFamily="var(--font-display)"
            >
              {d === 0 ? "now" : `+${d}d`}
            </text>
          </g>
        ))}
        {renewals.map((r, i) => {
          const cx = padX + r.dayOffset * stepX;
          const cy = h - padY - radiusOf(r.avg) - 4;
          return (
            <circle
              key={`${r.merchant}-${i}`}
              cx={cx}
              cy={cy}
              r={radiusOf(r.avg)}
              fill={`color-mix(in srgb, ${CYCLE_COLORS[r.cycle] || CYCLE_COLORS["one-time"]} 65%, transparent)`}
              stroke={CYCLE_COLORS[r.cycle] || CYCLE_COLORS["one-time"]}
              strokeWidth={1.5}
              onMouseEnter={() => setHover(r)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer", transition: "all 0.15s" }}
            />
          );
        })}
        {renewals.length === 0 && (
          <text x={w / 2} y={h / 2} fontSize={11} fill="var(--text-muted)" textAnchor="middle">
            No renewals in the next {days} days
          </text>
        )}
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
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 700 }}>{hover.merchant}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
            {hover.cycle} · {fmtINR(hover.avg)} · in {hover.dayOffset === 0 ? "today" : `${hover.dayOffset}d`}
          </div>
        </div>
      )}
    </div>
  );
}
