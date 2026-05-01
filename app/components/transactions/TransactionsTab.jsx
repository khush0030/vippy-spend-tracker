"use client";

import { useMemo, useState } from "react";
import {
  normalizeMerchant,
  colorOf,
  labelOf,
  fmtINR,
  CATEGORY_LABELS,
  priorWindow,
  delta,
  summarize,
  anomalies,
} from "../overview/aggregations";
import DeltaBadge from "../shared/DeltaBadge";
import AnomalyBadge from "../shared/AnomalyBadge";

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
  fontFamily: "var(--font-display)",
};

const formatDateHeader = (iso) => {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  const dow = d.toLocaleDateString("en-IN", { weekday: "long" });
  if (diff === 0) return `Today · ${dow}`;
  if (diff === 1) return `Yesterday · ${dow}`;
  return `${dow}, ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined })}`;
};

const fmtTime = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  const suf = hr >= 12 ? "PM" : "AM";
  return `${hr % 12 || 12}:${m} ${suf}`;
};

export default function TransactionsTab({ transactions, allTransactions, onSelect, isMobile, startDate, endDate }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const allTxns = allTransactions || transactions;

  const categories = useMemo(() => {
    const cs = new Set();
    for (const t of transactions) cs.add(t.category);
    return [...cs];
  }, [transactions]);

  const stats = useMemo(() => summarize(transactions), [transactions]);
  const prior = useMemo(() => priorWindow(allTxns, startDate, endDate), [allTxns, startDate, endDate]);
  const priorStats = useMemo(() => summarize(prior.prior), [prior.prior]);
  const hasPrior = prior.prior.length > 0;
  const spendDelta = hasPrior ? delta(stats.totalSpend, priorStats.totalSpend) : null;
  const refundDelta = hasPrior ? delta(stats.totalRefunds, priorStats.totalRefunds) : null;
  const netDelta = hasPrior ? delta(stats.netSpend, priorStats.netSpend) : null;

  const anomMap = useMemo(() => {
    const list = anomalies(allTxns, { sigma: 2, limit: 50 });
    return new Map(list.map((a) => [a.txn.id, a]));
  }, [allTxns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = transactions.filter((t) => {
      if (filter !== "all" && t.category !== filter) return false;
      if (q && !`${t.merchant} ${normalizeMerchant(t.merchant)}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortBy === "amount-desc") list = [...list].sort((a, b) => b.amount - a.amount);
    else if (sortBy === "amount-asc") list = [...list].sort((a, b) => a.amount - b.amount);
    else if (sortBy === "oldest") list = [...list].reverse();
    return list;
  }, [transactions, filter, search, sortBy]);

  const totals = useMemo(() => {
    let spend = 0,
      refunds = 0;
    for (const t of filtered) {
      if (t.isRefund) refunds += t.amount;
      else spend += t.amount;
    }
    return { spend, refunds, net: spend - refunds, count: filtered.length };
  }, [filtered]);

  const grouped = useMemo(() => {
    if (sortBy !== "newest" && sortBy !== "oldest") return null;
    const groups = new Map();
    for (const t of filtered) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    return [...groups.entries()];
  }, [filtered, sortBy]);

  // Build month-to-date running totals for each date in the visible list, using allTxns (purchases only)
  const mtdByDate = useMemo(() => {
    if (!grouped) return new Map();
    const dates = new Set(grouped.map(([d]) => d));
    const out = new Map();
    for (const date of dates) {
      const monthPrefix = date.slice(0, 7);
      const sum = (allTxns || [])
        .filter((t) => !t.isRefund && t.date.startsWith(monthPrefix) && t.date <= date)
        .reduce((s, t) => s + t.amount, 0);
      out.set(date, sum);
    }
    return out;
  }, [grouped, allTxns]);

  return (
    <div>
      {/* Search + Sort */}
      <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: isMobile ? "1 1 100%" : "1 1 320px", maxWidth: isMobile ? "100%" : 380 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search merchant"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 14px 12px 38px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              fontSize: 14,
              background: "var(--bg-card)",
              color: "var(--text)",
              fontFamily: "var(--font-body)",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "var(--brand)";
              e.target.style.boxShadow = "0 0 0 3px var(--brand-subtle)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "var(--border)";
              e.target.style.boxShadow = "none";
            }}
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
            color: "var(--text)",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "var(--font-body)",
            cursor: "pointer",
          }}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="amount-desc">Amount: high to low</option>
          <option value="amount-asc">Amount: low to high</option>
        </select>
      </div>

      {/* Category Pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 22, overflowX: "auto", paddingBottom: 4, flexWrap: isMobile ? "nowrap" : "wrap" }}>
        {[{ key: "all", label: "All categories" }, ...categories.map((c) => ({ key: c, label: labelOf(c) }))].map((cat) => {
          const active = filter === cat.key;
          const color = cat.key === "all" ? "var(--brand)" : colorOf(cat.key);
          return (
            <button
              key={cat.key}
              onClick={() => setFilter(cat.key)}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: active ? color : "var(--border)",
                background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : "transparent",
                color: active ? color : "var(--text-secondary)",
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
                flexShrink: 0,
                fontFamily: "var(--font-display)",
                letterSpacing: "0.02em",
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Totals bar */}
      <div
        style={{
          display: "flex",
          gap: isMobile ? 16 : 32,
          padding: "18px 22px",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <TotalCell label="Showing" value={totals.count} />
        <TotalCell label="Spend" value={fmtINR(totals.spend)} delta={spendDelta} invert />
        <TotalCell label="Refunds" value={fmtINR(totals.refunds)} valueColor="var(--success)" delta={refundDelta} />
        <TotalCell label="Net" value={fmtINR(totals.net)} valueColor="var(--brand)" delta={netDelta} invert push />
      </div>

      {/* List */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 64 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>No transactions match</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Try different search or filter.</div>
          </div>
        ) : grouped ? (
          grouped.map(([date, list], gi) => {
            const dayTotal = list.filter((t) => !t.isRefund).reduce((s, t) => s + t.amount, 0);
            const mtd = mtdByDate.get(date) || 0;
            return (
              <div key={date} style={{ borderTop: gi > 0 ? "1px solid var(--border)" : "none" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    padding: isMobile ? "14px 16px 8px" : "18px 22px 10px",
                    background: "var(--bg-card-2)",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ ...sectionLabelStyle, fontSize: 10 }}>{formatDateHeader(date)}</span>
                  <span style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
                    <span style={{ ...numStyle, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{fmtINR(dayTotal)} day</span>
                    <span style={{ ...numStyle, fontSize: 11, color: "var(--text-muted)", opacity: 0.75 }}>{fmtINR(mtd)} MTD</span>
                  </span>
                </div>
                {list.map((t, i) => (
                  <Row key={t.id} t={t} isMobile={isMobile} onSelect={onSelect} divider={i > 0} anom={anomMap.get(t.id)} />
                ))}
              </div>
            );
          })
        ) : (
          filtered.map((t, i) => <Row key={t.id} t={t} isMobile={isMobile} onSelect={onSelect} divider={i > 0} anom={anomMap.get(t.id)} />)
        )}
      </div>
    </div>
  );
}

function TotalCell({ label, value, valueColor, delta: d, invert, push }) {
  return (
    <div style={{ marginLeft: push ? "auto" : 0 }}>
      <div style={{ ...sectionLabelStyle, marginBottom: 6, fontSize: 10 }}>{label}</div>
      <div style={{ ...numStyle, fontSize: 22, fontWeight: 700, color: valueColor || "var(--text)" }}>{value}</div>
      {d && (
        <div style={{ marginTop: 4 }}>
          <DeltaBadge delta={d} invert={invert} compact />
        </div>
      )}
    </div>
  );
}

function Row({ t, isMobile, onSelect, divider, anom }) {
  const cat = t.category;
  const merchantName = normalizeMerchant(t.merchant);
  return (
    <button
      onClick={() => onSelect(t)}
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "10px 1fr auto" : "10px 1fr 120px auto",
        gap: isMobile ? 12 : 16,
        alignItems: "center",
        padding: isMobile ? "14px 16px" : "16px 22px",
        background: "transparent",
        border: "none",
        borderTop: divider ? "1px solid var(--border)" : "none",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "background 0.12s",
        fontFamily: "inherit",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = "var(--bg-card-2)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(cat), display: "inline-block" }} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: "var(--font-display)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{merchantName}</span>
          {anom && <AnomalyBadge baseline={anom.baseline} sigma={anom.sigma} compact />}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
          <span>{labelOf(cat)}</span>
          {t.txnTime && <span style={{ color: "var(--text-muted)", opacity: 0.7 }}>·</span>}
          {t.txnTime && <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTime(t.txnTime)}</span>}
          {t.isRefund && (
            <span
              style={{
                color: "var(--success)",
                fontWeight: 700,
                fontSize: 9,
                letterSpacing: "0.08em",
                padding: "2px 7px",
                borderRadius: 4,
                background: "var(--success-bg)",
                fontFamily: "var(--font-display)",
              }}
            >
              REFUND
            </span>
          )}
        </div>
      </div>
      {!isMobile && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.04em", textAlign: "right" }}>
          {CATEGORY_LABELS[cat] || "Other"}
        </div>
      )}
      <div
        style={{
          ...numStyle,
          fontSize: 16,
          fontWeight: 700,
          color: t.isRefund ? "var(--success)" : "var(--text)",
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {t.isRefund ? "+" : ""}
        {fmtINR(t.amount)}
      </div>
    </button>
  );
}
