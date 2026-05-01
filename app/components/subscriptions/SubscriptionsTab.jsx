"use client";

import { useMemo, useState } from "react";
import { buildSubscriptions, CYCLE_COLORS } from "./aggregations";
import { fmtINR } from "../overview/aggregations";

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

export default function SubscriptionsTab({ transactions, allTransactions, isMobile }) {
  const subs = useMemo(() => buildSubscriptions(allTransactions || transactions), [allTransactions, transactions]);
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
  const allTimeSpend = subs.reduce((s, x) => s + x.total, 0);

  const sorted = useMemo(() => {
    return [...subs].sort((a, b) => {
      if (sortBy === "merchant") return a.merchant.localeCompare(b.merchant);
      if (sortBy === "lastDate") return (b.lastDate || "").localeCompare(a.lastDate || "");
      if (sortBy === "nextDate") {
        if (!a.nextDate) return 1;
        if (!b.nextDate) return -1;
        return a.nextDate.localeCompare(b.nextDate);
      }
      return b.monthlyEst - a.monthlyEst;
    });
  }, [subs, sortBy]);

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

  return (
    <div>
      <section style={{ marginBottom: 40 }}>
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
          <KPI label="Yearly Projected" value={fmtINR(yearlyTotal)} sub="Monthly × 12" accent="#EF4444" />
          <KPI label="All-time Spend" value={fmtINR(allTimeSpend)} sub={`${subs.reduce((s, x) => s + x.count, 0)} charges`} accent="#10B981" />
        </div>
      </section>

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
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
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
            </div>
          )}
          {sorted.map((s, i) => (
            <div
              key={s.merchant}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1fr 1fr 1fr 1fr",
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
                  </div>
                )}
              </div>
              {!isMobile && <CycleBadge cycle={s.cycle} />}
              <div style={{ ...numStyle, fontSize: 14, fontWeight: 600, color: "var(--text)", textAlign: isMobile ? "right" : "right" }}>
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
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
