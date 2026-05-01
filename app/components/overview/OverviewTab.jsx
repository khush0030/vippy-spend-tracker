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
  topMerchants,
  colorOf,
  labelOf,
  fmtINR,
  fmtINRcompact,
  priorWindow,
  delta,
  projectMonthEnd,
  dowHourMatrix,
  anomalies,
  merchantTrend,
  cumulativeByDay,
  normalizeMerchant,
} from "./aggregations";
import DeltaCard from "../shared/DeltaCard";
import DeltaBadge from "../shared/DeltaBadge";
import HeatmapDOWHour from "../shared/HeatmapDOWHour";
import Sparkline from "../shared/Sparkline";
import AnomalyBadge from "../shared/AnomalyBadge";

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

export default function OverviewTab({
  transactions,
  allTransactions,
  startDate,
  endDate,
  isMobile,
  chartColors = {},
  onSelect,
}) {
  registerOnce();

  const stats = useMemo(() => summarize(transactions), [transactions]);
  const cats = useMemo(() => byCategory(transactions), [transactions]);
  const daily = useMemo(() => byDay(transactions), [transactions]);
  const dow = useMemo(() => byDow(transactions), [transactions]);
  const merchants = useMemo(() => topMerchants(transactions, 8), [transactions]);
  const heat = useMemo(() => dowHourMatrix(transactions), [transactions]);
  const anomList = useMemo(() => anomalies(transactions, { sigma: 2, limit: 5 }), [transactions]);

  const prior = useMemo(
    () => priorWindow(allTransactions || [], startDate, endDate),
    [allTransactions, startDate, endDate]
  );
  const priorStats = useMemo(() => summarize(prior.prior), [prior.prior]);
  const priorCats = useMemo(() => byCategory(prior.prior), [prior.prior]);
  const projection = useMemo(
    () => projectMonthEnd(allTransactions || transactions, new Date()),
    [allTransactions, transactions]
  );

  const sparkBuckets = isMobile ? 4 : 6;
  const sparks = useMemo(() => {
    const map = {};
    for (const m of merchants) {
      map[m.merchant] = merchantTrend(allTransactions || transactions, m.merchant, sparkBuckets);
    }
    return map;
  }, [merchants, allTransactions, transactions, sparkBuckets]);

  const hasPrior = prior.prior.length > 0;

  if (stats.txnCount === 0) {
    return (
      <div style={{ textAlign: "center", padding: 80, color: "var(--text-muted)", fontSize: 13 }}>
        No purchases in this period.
      </div>
    );
  }

  const topCat = cats[0];
  const priorTopCat = priorCats[0];
  const tcl = chartColors.textLight || "var(--text-muted)";
  const grid = chartColors.grid || "rgba(148,163,184,0.12)";

  const netDelta = hasPrior ? delta(stats.netSpend, priorStats.netSpend) : null;
  const dailyDelta = hasPrior ? delta(stats.dailyAverage, priorStats.dailyAverage) : null;
  const avgTxnDelta = hasPrior ? delta(stats.avgTransaction, priorStats.avgTransaction) : null;
  const topCatPriorAmount = topCat ? priorCats.find((c) => c.category === topCat.category)?.amount || 0 : 0;
  const topCatDelta = hasPrior && topCat ? delta(topCat.amount, topCatPriorAmount) : null;

  // Burndown: current cumulative vs prior cumulative aligned by day-offset
  const burndown = useMemo(() => {
    if (!startDate || !endDate) return null;
    const curr = cumulativeByDay(transactions, startDate, endDate);
    const priorCum = cumulativeByDay(prior.prior, prior.priorStart, prior.priorEnd);
    return { curr, priorCum };
  }, [transactions, prior, startDate, endDate]);

  const lineData = burndown
    ? {
        labels: burndown.curr.map((d, i) => `Day ${i + 1}`),
        datasets: [
          {
            label: "Current",
            data: burndown.curr.map((d) => d.cumulative),
            borderColor: "#7C3AED",
            backgroundColor: "rgba(124,58,237,0.08)",
            borderWidth: 2.5,
            fill: true,
            tension: 0.32,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          ...(hasPrior
            ? [
                {
                  label: "Prior",
                  data: burndown.priorCum.map((d) => d.cumulative),
                  borderColor: "rgba(148,163,184,0.7)",
                  backgroundColor: "transparent",
                  borderWidth: 1.5,
                  borderDash: [5, 4],
                  fill: false,
                  tension: 0.32,
                  pointRadius: 0,
                },
              ]
            : []),
        ],
      }
    : {
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
          },
        ],
      };

  const lineOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: burndown && hasPrior
        ? { display: true, position: "top", align: "end", labels: { color: tcl, font: { size: 11 }, boxWidth: 10, boxHeight: 10, padding: 12 } }
        : { display: false },
      tooltip: {
        backgroundColor: "rgba(15,22,42,0.95)",
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label || "Spend"}: ${fmtINR(ctx.parsed.y)}`,
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
          label: (ctx) => {
            const cat = cats[ctx.dataIndex];
            const priorCat = priorCats.find((p) => p.category === cat.category);
            const pPct = priorCat?.pct ?? 0;
            const driftPct = cat.pct - pPct;
            const driftLabel = hasPrior
              ? ` (${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(1)}pp vs prior)`
              : "";
            return `${ctx.label}: ${fmtINR(ctx.parsed)} · ${cat.pct.toFixed(0)}%${driftLabel}`;
          },
        },
      },
    },
  };

  const dowBarData = {
    labels: dow.map((r) => r.label),
    datasets: [
      {
        data: dow.map((r) => r.amount),
        backgroundColor: "rgba(124,58,237,0.85)",
        borderRadius: 4,
        barThickness: isMobile ? 18 : 22,
      },
    ],
  };
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
        callbacks: { label: (ctx) => fmtINR(ctx.parsed.y) },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: chartColors.text || "var(--text-muted)", font: { size: 11 } } },
      y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: tcl, font: { size: 10 }, callback: (v) => fmtINRcompact(v), maxTicksLimit: 4 } },
    },
  };

  const maxMerchant = merchants[0]?.total || 0;

  return (
    <div>
      {/* Hero */}
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
            <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
              {netDelta && <DeltaBadge delta={netDelta} invert />}
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <DeltaCard label="Daily Avg" value={fmtINR(stats.dailyAverage)} accent="#10B981" delta={dailyDelta} invert />
            <DeltaCard label="Avg Txn" value={fmtINR(stats.avgTransaction)} accent="#0EA5E9" delta={avgTxnDelta} invert />
            <DeltaCard
              label="Top Category"
              value={topCat ? labelOf(topCat.category) : "—"}
              sub={topCat ? `${topCat.pct.toFixed(0)}% of spend` : ""}
              accent={topCat ? colorOf(topCat.category) : "#7C3AED"}
              delta={topCatDelta}
              invert
            />
            <ProjectionCard projection={projection} />
          </div>
        </div>
      </section>

      {/* Burndown / Trend */}
      <Section
        label={burndown ? "Spend pace" : "Spend over time"}
        right={
          burndown && hasPrior ? (
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-display)" }}>
              {fmtINR(stats.netSpend)} <span style={{ opacity: 0.7 }}>·</span> prior {fmtINR(priorStats.netSpend)}
            </span>
          ) : null
        }
      >
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
              {cats.slice(0, 6).map((c) => {
                const p = priorCats.find((x) => x.category === c.category);
                const driftPct = p ? c.pct - p.pct : null;
                return (
                  <div key={c.category} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(c.category), flexShrink: 0 }} />
                    <span style={{ color: "var(--text)", fontWeight: 500, flex: 1 }}>{labelOf(c.category)}</span>
                    <span style={{ ...numStyle, color: "var(--text)", fontWeight: 600 }}>{fmtINR(c.amount)}</span>
                    <span style={{ ...numStyle, color: "var(--text-muted)", fontSize: 12, width: 36, textAlign: "right" }}>
                      {c.pct.toFixed(0)}%
                    </span>
                    {hasPrior && driftPct !== null && Math.abs(driftPct) >= 1 && (
                      <span
                        style={{
                          ...numStyle,
                          fontSize: 10,
                          fontWeight: 700,
                          width: 44,
                          textAlign: "right",
                          color: driftPct > 0 ? "var(--danger, #EF4444)" : "var(--success, #10B981)",
                        }}
                      >
                        {driftPct > 0 ? "↑" : "↓"}
                        {Math.abs(driftPct).toFixed(1)}pp
                      </span>
                    )}
                  </div>
                );
              })}
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
              <Bar data={dowBarData} options={barOpts} />
            </div>
          </div>
        </div>
      </Section>

      {/* Heatmap */}
      <Section label="When you spend">
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 22,
          }}
        >
          {heat.max > 0 ? (
            <HeatmapDOWHour matrix={heat.matrix} max={heat.max} accent="#7C3AED" isMobile={isMobile} />
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
              Need transaction times for heatmap. Run a full sync to backfill.
            </div>
          )}
        </div>
      </Section>

      {/* Anomalies */}
      {anomList.length > 0 && (
        <Section label="Outlier transactions">
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 8,
            }}
          >
            {anomList.map((a, i) => (
              <button
                key={a.txn.id}
                onClick={() => onSelect && onSelect(a.txn)}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr auto" : "1fr 1fr auto",
                  gap: 12,
                  padding: "14px 16px",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  background: "transparent",
                  border: "none",
                  width: "100%",
                  textAlign: "left",
                  cursor: onSelect ? "pointer" : "default",
                  alignItems: "center",
                  fontFamily: "inherit",
                }}
                onMouseOver={(e) => onSelect && (e.currentTarget.style.background = "var(--bg-card-2)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                    {normalizeMerchant(a.txn.merchant)}{" "}
                    <AnomalyBadge baseline={a.baseline} sigma={a.sigma} compact />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    {new Date(a.txn.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {labelOf(a.txn.category)}
                  </div>
                </div>
                {!isMobile && (
                  <div style={{ ...numStyle, fontSize: 12, color: "var(--text-muted)" }}>
                    Usual {fmtINR(a.baseline)}
                  </div>
                )}
                <div style={{ ...numStyle, fontSize: 16, fontWeight: 700, color: "var(--text)", textAlign: "right" }}>
                  {fmtINR(a.txn.amount)}
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}

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
                gridTemplateColumns: isMobile ? "auto 1fr auto auto" : "auto 1fr 1fr 90px auto",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderBottom: i < merchants.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <span style={{ ...numStyle, fontSize: 12, color: "var(--text-muted)", width: 22 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: colorOf(m.category), flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.merchant}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>· {m.count}</span>
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
              <Sparkline data={sparks[m.merchant] || []} color={colorOf(m.category)} width={isMobile ? 48 : 80} height={22} />
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

function ProjectionCard({ projection }) {
  if (!projection) return null;
  const paceColor =
    projection.paceVsLastMonth === null
      ? "var(--text-muted)"
      : projection.paceVsLastMonth > 5
      ? "var(--danger, #EF4444)"
      : projection.paceVsLastMonth < -5
      ? "var(--success, #10B981)"
      : "var(--text-muted)";
  const paceLabel =
    projection.paceVsLastMonth === null
      ? "no prior month"
      : `${projection.paceVsLastMonth > 0 ? "+" : ""}${projection.paceVsLastMonth.toFixed(0)}% vs last mo pace`;

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
        Month-end projection
      </div>
      <div style={{ ...numStyle, fontSize: 20, fontWeight: 700, color: "var(--text)", lineHeight: 1.1 }}>
        {fmtINR(projection.projected)}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        {fmtINR(projection.mtdSpend)} so far · {projection.daysRemaining}d left
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: paceColor, marginTop: 4, fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}>
        {paceLabel}
      </div>
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 18,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#F59E0B",
        }}
      />
    </div>
  );
}
