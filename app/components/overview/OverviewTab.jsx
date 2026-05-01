"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Filler,
} from "chart.js";
import { Doughnut, Bar, Line } from "react-chartjs-2";
import {
  summarize,
  byCategory,
  byDay,
  byDow,
  byTimeBucket,
  topMerchants,
  colorOf,
  labelOf,
  fmtINR,
  fmtINRcompact,
} from "./aggregations";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler);
  registered = true;
}

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

function Section({ label, children, right }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <h2 style={sectionLabelStyle}>{label}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function MiniStat({ label, value, sub, accent }) {
  return (
    <div
      style={{
        padding: "16px 18px",
        background: "var(--bg-card-2)",
        borderRadius: 12,
        position: "relative",
      }}
    >
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
      <div style={{ ...numStyle, fontSize: 20, fontWeight: 700, color: "var(--text)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
      {accent && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 18,
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

function Highlight({ label, primary, secondary, accent }) {
  return (
    <div
      style={{
        padding: "20px 22px",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        borderLeft: `3px solid ${accent || "var(--brand)"}`,
      }}
    >
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
      <div style={{ ...numStyle, fontSize: 22, fontWeight: 700, color: "var(--text)", lineHeight: 1.15 }}>{primary}</div>
      {secondary && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {secondary}
        </div>
      )}
    </div>
  );
}

export default function OverviewTab({ transactions, isMobile, chartColors = {} }) {
  registerOnce();

  const stats = useMemo(() => summarize(transactions), [transactions]);
  const cats = useMemo(() => byCategory(transactions), [transactions]);
  const daily = useMemo(() => byDay(transactions), [transactions]);
  const dow = useMemo(() => byDow(transactions), [transactions]);
  const time = useMemo(() => byTimeBucket(transactions), [transactions]);
  const merchants = useMemo(() => topMerchants(transactions, 8), [transactions]);

  if (stats.txnCount === 0) {
    return (
      <div style={{ textAlign: "center", padding: 80, color: "var(--text-muted)", fontSize: 13 }}>
        No purchases in this period.
      </div>
    );
  }

  const topCat = cats[0];
  const biggestDay = daily.reduce((m, d) => (d.amount > (m?.amount || 0) ? d : m), null);
  const biggestTxn = stats.purchases.reduce((m, t) => (t.amount > (m?.amount || 0) ? t : m), null);
  const busiestDow = [...dow].sort((a, b) => b.amount - a.amount)[0];
  const peakTime = [...time].sort((a, b) => b.amount - a.amount)[0];
  const tc = chartColors.text || "var(--text-muted)";
  const tcl = chartColors.textLight || "var(--text-muted)";
  const grid = chartColors.grid || "rgba(148,163,184,0.12)";

  const lineData = {
    labels: daily.map((d) => d.date),
    datasets: [
      {
        data: daily.map((d) => d.amount),
        borderColor: "#7C3AED",
        backgroundColor: "rgba(124,58,237,0.08)",
        borderWidth: 2,
        fill: true,
        tension: 0.32,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: "#7C3AED",
      },
    ],
  };

  const lineOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15,22,42,0.95)",
        padding: 12,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          title: (items) => new Date(items[0].label + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
          label: (ctx) => fmtINR(ctx.parsed.y),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: tcl,
          font: { size: 10 },
          maxRotation: 0,
          autoSkipPadding: 24,
          callback: function (val) {
            const d = new Date(this.getLabelForValue(val) + "T00:00:00");
            return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
          },
        },
      },
      y: {
        grid: { color: grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: tcl,
          font: { size: 10 },
          callback: (v) => fmtINRcompact(v),
          maxTicksLimit: 5,
        },
      },
    },
  };

  const doughnutData = {
    labels: cats.map((c) => labelOf(c.category)),
    datasets: [
      {
        data: cats.map((c) => c.amount),
        backgroundColor: cats.map((c) => colorOf(c.category)),
        borderColor: "var(--bg-card)",
        borderWidth: 2,
        spacing: 1,
      },
    ],
  };

  const doughnutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "70%",
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15,22,42,0.95)",
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) => `${ctx.label}: ${fmtINR(ctx.parsed)}`,
        },
      },
    },
  };

  const barData = (rows, key = "amount") => ({
    labels: rows.map((r) => r.label),
    datasets: [
      {
        data: rows.map((r) => r[key]),
        backgroundColor: "rgba(124,58,237,0.85)",
        borderRadius: 4,
        barThickness: isMobile ? 18 : 22,
      },
    ],
  });

  const barOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15,22,42,0.95)",
        padding: 10,
        cornerRadius: 6,
        displayColors: false,
        callbacks: {
          label: (ctx) => fmtINR(ctx.parsed.y),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: tc, font: { size: 11 } },
      },
      y: {
        grid: { color: grid, drawTicks: false },
        border: { display: false },
        ticks: { color: tcl, font: { size: 10 }, callback: (v) => fmtINRcompact(v), maxTicksLimit: 4 },
      },
    },
  };

  const maxMerchant = merchants[0]?.total || 0;

  return (
    <div>
      {/* Bold Hero */}
      <section style={{ marginBottom: 36 }}>
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: isMobile ? 26 : "36px 40px",
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 5fr) minmax(0, 4fr)",
            gap: isMobile ? 28 : 40,
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: 14,
                fontFamily: "var(--font-display)",
              }}
            >
              Net Spend
            </div>
            <div
              style={{
                ...numStyle,
                fontSize: isMobile ? 44 : 64,
                fontWeight: 800,
                color: "var(--text)",
                lineHeight: 1,
                letterSpacing: "-0.04em",
              }}
            >
              {fmtINR(stats.netSpend)}
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 18, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)", fontFamily: "var(--font-display)" }}>
                <strong style={{ color: "var(--text)", fontWeight: 700 }}>{stats.txnCount}</strong> purchases
              </span>
              <span style={{ fontSize: 13, color: "var(--text-secondary)", fontFamily: "var(--font-display)" }}>
                <strong style={{ color: "var(--text)", fontWeight: 700 }}>{stats.activeDays}</strong> active days
              </span>
              {stats.refundCount > 0 && (
                <span style={{ fontSize: 13, color: "var(--success)", fontFamily: "var(--font-display)" }}>
                  +{fmtINR(stats.totalRefunds)} refunded
                </span>
              )}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
            }}
          >
            <MiniStat label="Daily Avg" value={fmtINR(stats.dailyAverage)} accent="#10B981" />
            <MiniStat label="Avg Txn" value={fmtINR(stats.avgTransaction)} accent="#0EA5E9" />
            <MiniStat
              label="Top Category"
              value={topCat ? labelOf(topCat.category) : "—"}
              sub={topCat ? `${topCat.pct.toFixed(0)}%` : ""}
              accent={topCat ? colorOf(topCat.category) : "#7C3AED"}
            />
            <MiniStat
              label="Peak Time"
              value={peakTime?.label || "—"}
              sub={peakTime ? `${peakTime.pct.toFixed(0)}%` : ""}
              accent="#F59E0B"
            />
          </div>
        </div>
      </section>

      {/* Highlights row */}
      <Section label="Highlights">
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12 }}>
          <Highlight
            label="Biggest single charge"
            primary={biggestTxn ? fmtINR(biggestTxn.amount) : "—"}
            secondary={biggestTxn ? biggestTxn.merchant : ""}
            accent={biggestTxn ? colorOf(biggestTxn.category) : "#7C3AED"}
          />
          <Highlight
            label="Heaviest day"
            primary={biggestDay ? fmtINR(biggestDay.amount) : "—"}
            secondary={
              biggestDay
                ? new Date(biggestDay.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })
                : ""
            }
            accent="#EF4444"
          />
          <Highlight
            label="Busiest weekday"
            primary={busiestDow ? busiestDow.label : "—"}
            secondary={busiestDow ? `${fmtINR(busiestDow.amount)} · ${busiestDow.count} txns` : ""}
            accent="#0EA5E9"
          />
        </div>
      </Section>

      {/* Trend */}
      <Section label="Spend over time">
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 22,
            height: isMobile ? 220 : 280,
          }}
        >
          <Line data={lineData} options={lineOpts} />
        </div>
      </Section>

      {/* Categories + day-of-week */}
      <Section label="Breakdown">
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 5fr) minmax(0, 7fr)", gap: 16 }}>
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              By Category
            </div>
            <div style={{ height: isMobile ? 160 : 180 }}>
              <Doughnut data={doughnutData} options={doughnutOpts} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {cats.slice(0, 6).map((c) => (
                <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(c.category), flexShrink: 0 }} />
                  <span style={{ color: "var(--text)", fontWeight: 500, flex: 1 }}>{labelOf(c.category)}</span>
                  <span style={{ ...numStyle, color: "var(--text)", fontWeight: 600 }}>{fmtINR(c.amount)}</span>
                  <span style={{ ...numStyle, color: "var(--text-muted)", fontSize: 12, width: 36, textAlign: "right" }}>
                    {c.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              By Day of Week
            </div>
            <div style={{ height: isMobile ? 200 : 240 }}>
              <Bar data={barData(dow)} options={barOpts} />
            </div>
          </div>
        </div>
      </Section>

      {/* Time of day */}
      <Section label="By Time of Day">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          {time.map((t) => (
            <div
              key={t.key}
              style={{
                padding: "20px 22px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                {t.label}
              </div>
              <div style={{ ...numStyle, fontSize: 22, fontWeight: 700, color: "var(--text)", lineHeight: 1.1 }}>
                {fmtINR(t.amount)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                {t.range} · {t.pct.toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Top merchants */}
      <Section label="Top Merchants">
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
                gridTemplateColumns: isMobile ? "auto 1fr auto" : "auto 1fr 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderBottom: i < merchants.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <span
                style={{
                  ...numStyle,
                  fontSize: 12,
                  color: "var(--text-muted)",
                  width: 22,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: colorOf(m.category), flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.merchant}
                </span>
              </span>
              {!isMobile && (
                <div style={{ position: "relative", height: 6, background: "var(--bg-card-2)", borderRadius: 3, overflow: "hidden" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: maxMerchant > 0 ? `${(m.total / maxMerchant) * 100}%` : 0,
                      background: colorOf(m.category),
                      opacity: 0.7,
                      borderRadius: 3,
                    }}
                  />
                </div>
              )}
              <span style={{ ...numStyle, fontSize: 14, fontWeight: 600, color: "var(--text)", textAlign: "right" }}>
                {fmtINR(m.total)}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
