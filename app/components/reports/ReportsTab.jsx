"use client";

import { useMemo } from "react";
import {
  byCategory,
  topMerchants,
  summarize,
  colorOf,
  labelOf,
  fmtINR,
} from "../overview/aggregations";

const numStyle = {
  fontFamily: "var(--font-display)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

const sectionLabelStyle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 14,
  fontFamily: "var(--font-display)",
};

const fmtPeriod = (s, e) => {
  if (!s && !e) return "All time";
  const o = { day: "numeric", month: "short", year: "numeric" };
  const sd = s ? new Date(s + "T00:00:00").toLocaleDateString("en-IN", o) : "Earliest";
  const ed = e ? new Date(e + "T00:00:00").toLocaleDateString("en-IN", o) : "Today";
  return `${sd} → ${ed}`;
};

export default function ReportsTab({ transactions, startDate, endDate, isMobile }) {
  const stats = useMemo(() => summarize(transactions), [transactions]);
  const cats = useMemo(() => byCategory(transactions), [transactions]);
  const merchants = useMemo(() => topMerchants(transactions, 10), [transactions]);

  const downloadCSV = () => {
    const p = new URLSearchParams();
    p.set("format", "csv");
    if (startDate) p.set("start", startDate);
    if (endDate) p.set("end", endDate);
    window.open(`/api/reports?${p.toString()}`, "_blank");
  };

  const downloadJSON = () => {
    const p = new URLSearchParams();
    p.set("format", "json");
    if (startDate) p.set("start", startDate);
    if (endDate) p.set("end", endDate);
    window.open(`/api/reports?${p.toString()}`, "_blank");
  };

  return (
    <div>
      {/* Period hero */}
      <section style={{ marginBottom: 36 }}>
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: isMobile ? 26 : "32px 36px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 12,
              fontFamily: "var(--font-display)",
            }}
          >
            Period Report
          </div>
          <div
            style={{
              fontSize: isMobile ? 18 : 22,
              fontWeight: 700,
              color: "var(--text)",
              fontFamily: "var(--font-display)",
              letterSpacing: "-0.02em",
              marginBottom: 22,
            }}
          >
            {fmtPeriod(startDate, endDate)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 18 }}>
            <Stat label="Net Spend" value={fmtINR(stats.netSpend)} accent="#7C3AED" />
            <Stat label="Transactions" value={stats.txnCount} accent="#0EA5E9" />
            <Stat label="Refunds" value={fmtINR(stats.totalRefunds)} accent="#10B981" sub={`${stats.refundCount} returns`} />
            <Stat label="Avg Transaction" value={fmtINR(stats.avgTransaction)} accent="#F59E0B" />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 28, flexWrap: "wrap" }}>
            <ExportButton onClick={downloadCSV} label="Export CSV" primary />
            <ExportButton onClick={downloadJSON} label="Export JSON" />
          </div>
        </div>
      </section>

      {/* Category breakdown */}
      <section style={{ marginBottom: 36 }}>
        <h2 style={sectionLabelStyle}>Category Breakdown</h2>
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {!isMobile && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr",
                gap: 12,
                padding: "12px 22px",
                background: "var(--bg-card-2)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                fontFamily: "var(--font-display)",
              }}
            >
              <span>Category</span>
              <span style={{ textAlign: "right" }}>Spend</span>
              <span style={{ textAlign: "right" }}>Share</span>
              <span style={{ textAlign: "right" }}>Txns</span>
              <span style={{ textAlign: "right" }}>Avg</span>
            </div>
          )}
          {cats.map((c, i) => (
            <div
              key={c.category}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr auto" : "1.6fr 1fr 1fr 1fr 1fr",
                gap: 12,
                padding: isMobile ? "14px 16px" : "16px 22px",
                borderTop: i > 0 ? "1px solid var(--border)" : "none",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(c.category), flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-display)" }}>
                  {labelOf(c.category)}
                </span>
                {isMobile && (
                  <span style={{ ...numStyle, fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
                    {c.pct.toFixed(0)}%
                  </span>
                )}
              </div>
              <div style={{ ...numStyle, fontSize: 15, fontWeight: 700, color: "var(--text)", textAlign: "right" }}>
                {fmtINR(c.amount)}
              </div>
              {!isMobile && (
                <>
                  <div style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>{c.pct.toFixed(1)}%</div>
                  <div style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>{c.count}</div>
                  <div style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>
                    {fmtINR(c.amount / c.count)}
                  </div>
                </>
              )}
            </div>
          ))}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr auto" : "1.6fr 1fr 1fr 1fr 1fr",
              gap: 12,
              padding: isMobile ? "14px 16px" : "16px 22px",
              borderTop: "2px solid var(--border-strong)",
              background: "var(--bg-card-2)",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-display)" }}>Total</div>
            <div style={{ ...numStyle, fontSize: 15, fontWeight: 800, color: "var(--text)", textAlign: "right" }}>
              {fmtINR(stats.totalSpend)}
            </div>
            {!isMobile && (
              <>
                <div style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>100%</div>
                <div style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>{stats.txnCount}</div>
                <div style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>{fmtINR(stats.avgTransaction)}</div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Top merchants */}
      <section>
        <h2 style={sectionLabelStyle}>Top Merchants</h2>
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 8,
          }}
        >
          {merchants.map((m, i) => (
            <div
              key={m.merchant}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: 14,
                padding: "14px 18px",
                borderBottom: i < merchants.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <span style={{ ...numStyle, fontSize: 12, color: "var(--text-muted)", width: 24 }}>{String(i + 1).padStart(2, "0")}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: colorOf(m.category), flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {m.merchant}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {m.count} txns</span>
              </div>
              <span style={{ ...numStyle, fontSize: 14, fontWeight: 700, color: "var(--text)", textAlign: "right" }}>
                {fmtINR(m.total)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 8,
          fontFamily: "var(--font-display)",
        }}
      >
        {label}
      </div>
      <div style={{ ...numStyle, fontSize: 24, fontWeight: 700, color: "var(--text)", lineHeight: 1.05 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
      {accent && (
        <div
          style={{
            width: 24,
            height: 2,
            background: accent,
            borderRadius: 1,
            marginTop: 10,
          }}
        />
      )}
    </div>
  );
}

function ExportButton({ onClick, label, primary }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "12px 20px",
        borderRadius: 10,
        border: primary ? "none" : "1px solid var(--border)",
        background: primary ? "var(--brand)" : "var(--bg-card)",
        color: primary ? "#fff" : "var(--text)",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "0.02em",
        fontFamily: "var(--font-display)",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
      onMouseOver={(e) => {
        if (primary) e.currentTarget.style.background = "var(--brand-hover)";
        else e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseOut={(e) => {
        if (primary) e.currentTarget.style.background = "var(--brand)";
        else e.currentTarget.style.background = "var(--bg-card)";
      }}
    >
      {label}
    </button>
  );
}
