"use client";

import { useMemo, useState } from "react";
import { normalizeMerchant, colorOf, labelOf, fmtINR, CATEGORY_LABELS } from "../overview/aggregations";

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

export default function TransactionsTab({ transactions, onSelect, isMobile }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const categories = useMemo(() => {
    const cs = new Set();
    for (const t of transactions) cs.add(t.category);
    return [...cs];
  }, [transactions]);

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
        <div>
          <div style={{ ...sectionLabelStyle, marginBottom: 6, fontSize: 10 }}>Showing</div>
          <div style={{ ...numStyle, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{totals.count}</div>
        </div>
        <div>
          <div style={{ ...sectionLabelStyle, marginBottom: 6, fontSize: 10 }}>Spend</div>
          <div style={{ ...numStyle, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{fmtINR(totals.spend)}</div>
        </div>
        <div>
          <div style={{ ...sectionLabelStyle, marginBottom: 6, fontSize: 10 }}>Refunds</div>
          <div style={{ ...numStyle, fontSize: 22, fontWeight: 700, color: "var(--success)" }}>{fmtINR(totals.refunds)}</div>
        </div>
        <div style={{ marginLeft: isMobile ? 0 : "auto" }}>
          <div style={{ ...sectionLabelStyle, marginBottom: 6, fontSize: 10 }}>Net</div>
          <div style={{ ...numStyle, fontSize: 22, fontWeight: 800, color: "var(--brand)" }}>{fmtINR(totals.net)}</div>
        </div>
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
            return (
              <div key={date} style={{ borderTop: gi > 0 ? "1px solid var(--border)" : "none" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    padding: isMobile ? "14px 16px 8px" : "18px 22px 10px",
                    background: "var(--bg-card-2)",
                  }}
                >
                  <span style={{ ...sectionLabelStyle, fontSize: 10 }}>{formatDateHeader(date)}</span>
                  <span style={{ ...numStyle, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{fmtINR(dayTotal)}</span>
                </div>
                {list.map((t, i) => (
                  <Row key={t.id} t={t} isMobile={isMobile} onSelect={onSelect} divider={i > 0} />
                ))}
              </div>
            );
          })
        ) : (
          filtered.map((t, i) => <Row key={t.id} t={t} isMobile={isMobile} onSelect={onSelect} divider={i > 0} />)
        )}
      </div>
    </div>
  );
}

function Row({ t, isMobile, onSelect, divider }) {
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
          }}
        >
          {merchantName}
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
