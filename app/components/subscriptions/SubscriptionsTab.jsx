"use client";

import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { buildSubscriptions, CYCLE_COLORS, upcoming30Days, priceHikes, monthlyRamp } from "./aggregations";
import { fmtINR, fmtINRcompact, summarize, recurringVsDiscretionary } from "../overview/aggregations";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);
  registered = true;
}

const numStyle = {
  fontFamily: "var(--font-display)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

function KPI({ label, value, sub, accent }) {
  return (
    <div
      style={{
        flex: "1 1 200px",
        padding: "22px 24px",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        position: "relative",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div style={{ ...numStyle, fontSize: 30, fontWeight: 700, color: "var(--text)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{sub}</div>}
      {accent && (
        <div
          style={{
            position: "absolute",
            top: 22,
            right: 24,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: accent,
          }}
        />
      )}
    </div>
  );
}

function CycleBadge({ cycle }) {
  const color = CYCLE_COLORS[cycle] || CYCLE_COLORS["one-time"];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 4,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "var(--font-display)",
      }}
    >
      {cycle}
    </span>
  );
}

const fmtRelativeDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "today";
  if (diff > 0 && diff < 31) return `in ${diff}d`;
  if (diff < 0 && diff > -31) return `${-diff}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const fmtShortDate = (iso) => {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export default function SubscriptionsTab({ transactions, allTransactions, isMobile, chartColors = {} }) {
  registerOnce();
  const allTxns = allTransactions || transactions;
  const subs = useMemo(() => buildSubscriptions(allTxns), [allTxns]);
  const upcoming = useMemo(() => upcoming30Days(subs), [subs]);
  const hikes = useMemo(() => priceHikes(allTxns), [allTxns]);
  const ramp = useMemo(() => monthlyRamp(allTxns, 12), [allTxns]);
  const recur = useMemo(() => recurringVsDiscretionary(transactions), [transactions]);
  const periodStats = useMemo(() => summarize(transactions), [transactions]);
  const [sortBy, setSortBy] = useState("monthlyEst");

  if (subs.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 80, color: "var(--text-muted)", fontSize: 13 }}>
        No subscriptions detected yet.
      </div>
    );
  }

  const recurring = subs.filter((s) => s.cycle === "monthly" || s.cycle === "annual" || s.cycle === "quarterly");
  const monthlyTotal = recurring.reduce((s, x) => s + x.monthlyEst, 0);
  const yearlyTotal = monthlyTotal * 12;
  const upcomingTotal = upcoming.reduce((s, u) => s + u.amount, 0);
  const lockedPct = periodStats.totalSpend > 0 ? (recur.recurring / periodStats.totalSpend) * 100 : 0;
  const hikeMap = Object.fromEntries(hikes.map((h) => [h.merchant, h]));

  const sorted = [...subs].sort((a, b) => {
    if (sortBy === "merchant") return a.merchant.localeCompare(b.merchant);
    if (sortBy === "lastDate") return (b.lastDate || "").localeCompare(a.lastDate || "");
    if (sortBy === "nextDate") {
      if (!a.nextDate) return 1;
      if (!b.nextDate) return -1;
      return a.nextDate.localeCompare(b.nextDate);
    }
    return b.monthlyEst - a.monthlyEst;
  });

  const sortBtn = (key, label) => (
    <button
      onClick={() => setSortBy(key)}
      style={{
        padding: "6px 10px",
        background: sortBy === key ? "var(--brand-subtle)" : "transparent",
        color: sortBy === key ? "var(--brand)" : "var(--text-muted)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        cursor: "pointer",
        fontFamily: "var(--font-display)",
      }}
    >
      {label}
    </button>
  );

  const tcl = chartColors.textLight || "var(--text-muted)";
  const grid = chartColors.grid || "rgba(148,163,184,0.12)";
  const rampData = {
    labels: ramp.map((r) => {
      const d = new Date(r.month + "-01T00:00:00");
      return d.toLocaleDateString("en-IN", { month: "short" });
    }),
    datasets: [
      {
        data: ramp.map((r) => r.monthlyRecurring),
        borderColor: "#0EA5E9",
        backgroundColor: "rgba(14,165,233,0.1)",
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ],
  };
  const rampOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15,22,42,0.95)",
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        callbacks: { label: (ctx) => fmtINR(ctx.parsed.y) },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: tcl, font: { size: 10 } } },
      y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: tcl, font: { size: 10 }, callback: (v) => fmtINRcompact(v), maxTicksLimit: 4 } },
    },
  };

  return (
    <div>
      <section style={{ marginBottom: 36 }}>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            marginBottom: 14,
            fontFamily: "var(--font-display)",
          }}
        >
          Snapshot
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <KPI label="Active Subscriptions" value={recurring.length} sub={`${subs.length} merchants total`} accent="#7C3AED" />
          <KPI label="Monthly Recurring" value={fmtINR(monthlyTotal)} sub="Estimated" accent="#0EA5E9" />
          <KPI
            label="Locked-in Share"
            value={`${lockedPct.toFixed(0)}%`}
            sub={`${fmtINR(recur.recurring)} of period spend`}
            accent="#F59E0B"
          />
          <KPI label="Yearly Projected" value={fmtINR(yearlyTotal)} sub="Monthly × 12" accent="#EF4444" />
        </div>
      </section>

      {/* Cash flow next 30 days */}
      {upcoming.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <h2
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                fontFamily: "var(--font-display)",
              }}
            >
              Next 30 days · {fmtINR(upcomingTotal)} due
            </h2>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{upcoming.length} renewal{upcoming.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {upcoming.map((u, i) => (
              <div
                key={`${u.merchant}-${u.nextDate}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr auto auto" : "1fr 1fr 100px 110px",
                  gap: 14,
                  padding: "14px 18px",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{u.merchant}</span>
                {!isMobile && <CycleBadge cycle={u.cycle} />}
                <span style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>
                  {u.daysAway === 0 ? "today" : `${u.daysAway}d`}
                </span>
                <span style={{ ...numStyle, fontSize: 14, fontWeight: 700, color: "var(--text)", textAlign: "right" }}>
                  {fmtINR(u.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Cost ramp */}
      {ramp.some((r) => r.monthlyRecurring > 0) && (
        <section style={{ marginBottom: 36 }}>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 14,
              fontFamily: "var(--font-display)",
            }}
          >
            Subscription cost ramp · 12 months
          </h2>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 22, height: isMobile ? 180 : 220 }}>
            <Line data={rampData} options={rampOpts} />
          </div>
        </section>
      )}

      {/* Price hikes */}
      {hikes.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 14,
              fontFamily: "var(--font-display)",
            }}
          >
            Price changes detected
          </h2>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {hikes.map((h, i) => (
              <div
                key={h.merchant}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr auto" : "1fr 1fr 1fr 90px",
                  gap: 14,
                  padding: "14px 18px",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{h.merchant}</span>
                {!isMobile && (
                  <span style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>
                    {fmtINR(h.priorAvg)} → {fmtINR(h.recentAvg)}
                  </span>
                )}
                {!isMobile && (
                  <span style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>
                    {fmtShortDate(h.latest)}
                  </span>
                )}
                <span
                  style={{
                    ...numStyle,
                    fontSize: 13,
                    fontWeight: 700,
                    color: h.deltaPct > 0 ? "var(--danger, #EF4444)" : "var(--success, #10B981)",
                    textAlign: "right",
                  }}
                >
                  {h.deltaPct > 0 ? "+" : ""}
                  {h.deltaPct.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Full list */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontFamily: "var(--font-display)",
            }}
          >
            All Subscriptions
          </h2>
          <div style={{ display: "flex", gap: 6 }}>
            {sortBtn("monthlyEst", "Monthly cost")}
            {sortBtn("merchant", "Name")}
            {sortBtn("nextDate", "Next renewal")}
          </div>
        </div>

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
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 70px",
                gap: 12,
                padding: "12px 18px",
                background: "var(--bg-card-2)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                fontFamily: "var(--font-display)",
              }}
            >
              <span>Merchant</span>
              <span>Cycle</span>
              <span style={{ textAlign: "right" }}>Monthly</span>
              <span style={{ textAlign: "right" }}>Last charge</span>
              <span style={{ textAlign: "right" }}>Next renewal</span>
              <span style={{ textAlign: "right" }}>Trend</span>
            </div>
          )}
          {sorted.map((s, i) => {
            const trend = hikeMap[s.merchant];
            return (
              <div
                key={s.merchant}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1fr 1fr 1fr 1fr 70px",
                  gap: 12,
                  padding: isMobile ? "14px 16px" : "16px 18px",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.merchant}
                  </div>
                  {isMobile && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <CycleBadge cycle={s.cycle} />
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        Last {fmtRelativeDate(s.lastDate)} · Next {fmtRelativeDate(s.nextDate)}
                      </span>
                      {trend && (
                        <span style={{ ...numStyle, fontSize: 10, fontWeight: 700, color: trend.deltaPct > 0 ? "var(--danger, #EF4444)" : "var(--success, #10B981)" }}>
                          {trend.deltaPct > 0 ? "↑" : "↓"}
                          {Math.abs(trend.deltaPct).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {!isMobile && <CycleBadge cycle={s.cycle} />}
                <div style={{ ...numStyle, fontSize: 14, fontWeight: 600, color: "var(--text)", textAlign: "right" }}>
                  {fmtINR(s.monthlyEst)}
                </div>
                {!isMobile && (
                  <div style={{ ...numStyle, fontSize: 13, color: "var(--text-muted)", textAlign: "right" }}>
                    {fmtRelativeDate(s.lastDate)}
                  </div>
                )}
                {!isMobile && (
                  <div style={{ ...numStyle, fontSize: 13, color: s.nextDate ? "var(--text)" : "var(--text-muted)", textAlign: "right" }}>
                    {fmtRelativeDate(s.nextDate)}
                  </div>
                )}
                {!isMobile && (
                  <div style={{ textAlign: "right" }}>
                    {trend ? (
                      <span
                        style={{
                          ...numStyle,
                          fontSize: 11,
                          fontWeight: 700,
                          color: trend.deltaPct > 0 ? "var(--danger, #EF4444)" : "var(--success, #10B981)",
                        }}
                      >
                        {trend.deltaPct > 0 ? "↑" : "↓"}
                        {Math.abs(trend.deltaPct).toFixed(0)}%
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>flat</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
