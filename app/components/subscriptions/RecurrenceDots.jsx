"use client";

import { useMemo, useState } from "react";
import { CYCLE_COLORS } from "./aggregations";
import { fmtINR } from "../overview/aggregations";

const ORDER = ["monthly", "quarterly", "annual", "irregular", "one-time"];

export default function RecurrenceDots({ subs, isMobile }) {
  const grouped = useMemo(() => {
    const g = Object.fromEntries(ORDER.map((k) => [k, []]));
    for (const s of subs) {
      const k = ORDER.includes(s.cycle) ? s.cycle : "one-time";
      g[k].push(s);
    }
    for (const k of ORDER) g[k].sort((a, b) => b.monthlyEst - a.monthlyEst);
    return g;
  }, [subs]);

  const [hover, setHover] = useState(null);
  const maxAmt = useMemo(() => Math.max(...subs.map((s) => s.monthlyEst), 0), [subs]);

  return (
    <div className="chart-card" style={{ position: "relative", padding: isMobile ? 14 : 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 16 }}>
        {ORDER.map((cycle) => {
          const list = grouped[cycle];
          if (!list.length) return null;
          return (
            <div key={cycle} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 60,
                  fontSize: 10,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  fontWeight: 700,
                  color: CYCLE_COLORS[cycle],
                  fontFamily: "var(--font-display)",
                  flexShrink: 0,
                }}
              >
                {cycle}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1 }}>
                {list.map((s, i) => {
                  const size = maxAmt > 0 ? 8 + (s.monthlyEst / maxAmt) * (isMobile ? 14 : 18) : 10;
                  return (
                    <div
                      key={`${s.merchant}-${i}`}
                      onMouseEnter={() => setHover(s)}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        width: size,
                        height: size,
                        borderRadius: "50%",
                        background: `color-mix(in srgb, ${CYCLE_COLORS[cycle]} 65%, transparent)`,
                        border: `1.5px solid ${CYCLE_COLORS[cycle]}`,
                        cursor: "pointer",
                        transition: "transform 0.15s",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
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
            {hover.cycle} · {fmtINR(hover.monthlyEst)}/mo
          </div>
        </div>
      )}
    </div>
  );
}
