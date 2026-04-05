"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const CATEGORIES = {
  amazon: { label: "Amazon", color: "#FF9900", icon: "\uD83D\uDED2" },
  fuel: { label: "Fuel", color: "#4CAF50", icon: "\u26FD" },
  dining: { label: "Dining", color: "#E91E63", icon: "\uD83C\uDF7D\uFE0F" },
  swiggy: { label: "Swiggy", color: "#FC8019", icon: "\uD83D\uDEF5" },
  utilities: { label: "Utilities", color: "#2196F3", icon: "\uD83D\uDCA1" },
  subscriptions: { label: "Subscriptions", color: "#9C27B0", icon: "\uD83D\uDCF1" },
  office: { label: "Office", color: "#607D8B", icon: "\uD83C\uDFE2" },
  travel: { label: "Travel", color: "#00BCD4", icon: "\u2708\uFE0F" },
  other: { label: "Other", color: "#795548", icon: "\uD83D\uDCE6" },
};

const fmt = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// ── Hooks ──
function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => { const c = () => setM(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);
  return m;
}

function useTheme() {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const saved = localStorage.getItem("vippy-theme") || "light";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);
  const toggle = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("vippy-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }, [theme]);

  // Resolved colors for Chart.js (can't use CSS vars)
  const chartColors = useMemo(() => ({
    text: theme === "dark" ? "#a0a09c" : "#6b6b68",
    textLight: theme === "dark" ? "#6b6b68" : "#9b9b97",
    grid: theme === "dark" ? "#333333" : "#e3e3e0",
  }), [theme]);

  return { theme, toggle, chartColors };
}

// ── User Menu ──
function UserMenu({ session, theme, onToggleTheme, isMobile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const user = session?.user;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 5px",
        borderRadius: "var(--radius)", border: "1px solid var(--border)",
        background: "var(--bg-card)", cursor: "pointer",
      }}>
        {user?.image ? (
          <img src={user.image} alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} referrerPolicy="no-referrer" />
        ) : (
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600 }}>
            {user?.name?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        {!isMobile && <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{user?.name?.split(" ")[0] || "User"}</span>}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--text-secondary)" style={{ marginLeft: 2 }}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 240,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-hover)",
          zIndex: 100, overflow: "hidden",
        }}>
          {/* Profile section */}
          <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {user?.image ? (
                <img src={user.image} alt="" style={{ width: 40, height: 40, borderRadius: "50%" }} referrerPolicy="no-referrer" />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 600 }}>
                  {user?.name?.[0]?.toUpperCase() || "?"}
                </div>
              )}
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{user?.name || "User"}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{user?.email}</div>
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div style={{ padding: "6px" }}>
            <button onClick={onToggleTheme} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", borderRadius: 6, border: "none",
              background: "transparent", color: "var(--text)", fontSize: 13,
              textAlign: "left",
            }}
              onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontSize: 15 }}>{theme === "light" ? "\uD83C\uDF19" : "\u2600\uFE0F"}</span>
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
            <button onClick={() => signOut({ callbackUrl: "/login" })} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", borderRadius: 6, border: "none",
              background: "transparent", color: "var(--danger)", fontSize: 13,
              textAlign: "left",
            }}
              onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontSize: 15 }}>{"\uD83D\uDEAA"}</span>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Transaction Detail Modal ──
function TransactionModal({ transaction: t, onClose, onUpdateNotes }) {
  const [userNotes, setUserNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (t) setUserNotes(t.userNotes || ""); }, [t]);
  if (!t) return null;
  const cat = CATEGORIES[t.category] || CATEGORIES.other;

  const [saveStatus, setSaveStatus] = useState("");

  const handleSaveNotes = async () => {
    setSaving(true);
    setSaveStatus("");
    try {
      const res = await fetch("/api/transactions", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, userNotes }),
      });
      if (!res.ok) throw new Error("Save failed");
      onUpdateNotes(t.id, userNotes);
      setSaveStatus("Saved");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch {
      setSaveStatus("Error saving");
    }
    setSaving(false);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--bg-card)", borderRadius: "var(--radius-lg)", padding: "28px 24px",
        maxWidth: 460, width: "100%", position: "relative", boxShadow: "var(--shadow-hover)",
        maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border)",
      }}>
        <button onClick={onClose} aria-label="Close" style={{
          position: "absolute", top: 14, right: 14, border: "none",
          background: "var(--bg-tertiary)", width: 28, height: 28, borderRadius: 6,
          fontSize: 16, color: "var(--text-secondary)", display: "flex",
          alignItems: "center", justifyContent: "center", transition: "background 0.15s, color 0.15s",
        }}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
        >&times;</button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: cat.color + "22",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>{cat.icon}</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17, color: "var(--text)" }}>{t.merchant}</div>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: cat.color + "22", color: cat.color }}>{cat.label}</span>
          </div>
        </div>

        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 20, color: t.isRefund ? "var(--success)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {t.isRefund ? "+" : ""}{fmt(t.amount)}
          {t.isRefund && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--success)", background: "var(--success-bg)", padding: "2px 8px", borderRadius: 4, marginLeft: 8, verticalAlign: "middle" }}>REFUND</span>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <Row label="Date" value={fmtDate(t.date)} />
          {t.txnTime && <Row label="Time" value={t.txnTime} />}
          {t.itemDescription && <Row label="Item" value={t.itemDescription} />}
          <Row label="Receipt" value={t.hasReceipt ? "\u2713 Attached" : "\u25CB Missing"} />
          {t.rawEmail && <Row label="Source" value={t.rawEmail} />}
        </div>

        {t.notes && (
          <div style={{ padding: "12px 14px", background: "var(--bg-secondary)", borderRadius: "var(--radius)", border: "1px solid var(--border)", marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>AI Insight</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{t.notes}</div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Your Notes</div>
          <textarea value={userNotes} onChange={(e) => setUserNotes(e.target.value)}
            placeholder="Add a note..."
            style={{
              width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)",
              fontSize: 13, resize: "vertical", minHeight: 60, lineHeight: 1.5,
              background: "var(--bg-card)", color: "var(--text)",
            }}
            onFocus={(e) => e.target.style.borderColor = "var(--accent)"}
            onBlur={(e) => e.target.style.borderColor = "var(--border)"}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <button onClick={handleSaveNotes} disabled={saving} style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: saving ? "var(--bg-tertiary)" : "var(--accent)", color: "#fff",
              fontSize: 12, fontWeight: 600,
            }}>{saving ? "Saving..." : "Save"}</button>
            {saveStatus && (
              <span style={{ fontSize: 11, color: saveStatus === "Saved" ? "var(--success)" : "var(--danger)", fontWeight: 500 }}>
                {saveStatus}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

// ── Date Range ──
function DateRangePicker({ startDate, endDate, onStartChange, onEndChange, onPreset, isMobile }) {
  const inputStyle = {
    padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6,
    fontSize: 13, background: "var(--bg-card)", color: "var(--text)",
    flex: isMobile ? "1 1 auto" : "0 0 auto",
  };
  return (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20,
      padding: "10px 14px", background: "var(--bg-secondary)", borderRadius: "var(--radius)", border: "1px solid var(--border)",
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>Period</span>
      <input type="date" value={startDate} onChange={(e) => onStartChange(e.target.value)} style={inputStyle} />
      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>\u2013</span>
      <input type="date" value={endDate} onChange={(e) => onEndChange(e.target.value)} style={inputStyle} />
      <div style={{ display: "flex", gap: 3 }}>
        {[{ l: "7D", d: 7 }, { l: "30D", d: 30 }, { l: "90D", d: 90 }, { l: "1Y", d: 365 }, { l: "All", d: 0 }].map((p) => (
          <button key={p.l} onClick={() => onPreset(p.d)} style={{
            padding: "4px 10px", borderRadius: 5, border: "1px solid var(--border)",
            background: "var(--bg-card)", fontSize: 11, fontWeight: 500, color: "var(--text-secondary)",
            transition: "background 0.1s, color 0.1s",
          }}
            onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseOut={(e) => { e.currentTarget.style.background = "var(--bg-card)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          >{p.l}</button>
        ))}
      </div>
    </div>
  );
}

// ── Metric Card ──
function Card({ title, value, sub, accent, isMobile }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
      padding: isMobile ? "14px 16px" : "18px 22px", flex: isMobile ? "1 1 calc(50% - 6px)" : "1 1 170px",
      minWidth: isMobile ? 0 : 150, boxShadow: "var(--shadow)",
      borderLeft: accent ? `3px solid ${accent}` : "none",
    }}>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Insights Panel ──
function InsightsPanel({ transactions, isMobile }) {
  const purchases = transactions.filter((t) => !t.isRefund);
  if (purchases.length === 0) return null;

  const catTotals = {};
  const merchCounts = {};
  for (const t of purchases) {
    catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
    merchCounts[t.merchant] = (merchCounts[t.merchant] || 0) + 1;
  }

  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  const topMerch = Object.entries(merchCounts).sort((a, b) => b[1] - a[1])[0];
  const total = purchases.reduce((s, t) => s + t.amount, 0);
  const avg = total / purchases.length;
  const highest = purchases.reduce((m, t) => t.amount > m.amount ? t : m, purchases[0]);
  const days = [...new Set(purchases.map((t) => t.date))].length;
  const topCatInfo = CATEGORIES[topCat[0]] || CATEGORIES.other;

  const items = [
    { icon: topCatInfo.icon, title: "Top Category", val: topCatInfo.label, sub: fmt(topCat[1]), col: topCatInfo.color },
    { icon: "\uD83D\uDCCA", title: "Avg Transaction", val: fmt(avg), sub: `${purchases.length} purchases`, col: "#2196F3" },
    { icon: "\uD83D\uDD25", title: "Highest Spend", val: fmt(highest.amount), sub: highest.merchant, col: "#E91E63" },
    { icon: "\uD83D\uDD04", title: "Most Frequent", val: topMerch[0], sub: `${topMerch[1]} times`, col: "#FF9900" },
    { icon: "\uD83D\uDCC5", title: "Daily Average", val: fmt(total / (days || 1)), sub: `${days} active days`, col: "#4CAF50" },
    { icon: "\uD83C\uDFF7\uFE0F", title: "Categories", val: Object.keys(catTotals).length, sub: "spending types", col: "#9C27B0" },
  ];

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: isMobile ? 16 : 22, marginBottom: 20, boxShadow: "var(--shadow)" }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "var(--text)" }}>Spending Insights</h3>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: 10 }}>
        {items.map((it) => (
          <div key={it.title} style={{ padding: "12px 14px", borderRadius: "var(--radius)", background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 14 }}>{it.icon}</span>
              <span style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>{it.title}</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: it.col }}>{it.val}</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>{it.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Overview Tab ──
function OverviewTab({ transactions, isMobile, chartColors = {} }) {
  const purchases = transactions.filter((t) => !t.isRefund);
  const refunds = transactions.filter((t) => t.isRefund);
  const totalR = refunds.reduce((s, t) => s + t.amount, 0);
  const catTotals = {};
  for (const t of purchases) catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
  for (const t of refunds) catTotals[t.category] = (catTotals[t.category] || 0) - t.amount;
  const cats = Object.entries(catTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = purchases.reduce((s, t) => s + t.amount, 0) - totalR;
  const rcpt = transactions.filter((t) => t.hasReceipt).length;

  const donutData = { labels: cats.map(([c]) => CATEGORIES[c]?.label || c), datasets: [{ data: cats.map(([, v]) => v), backgroundColor: cats.map(([c]) => CATEGORIES[c]?.color || "#795548"), borderWidth: 0 }] };
  const barData = { labels: cats.map(([c]) => CATEGORIES[c]?.label || c), datasets: [{ label: "Spend", data: cats.map(([, v]) => v), backgroundColor: cats.map(([c]) => CATEGORIES[c]?.color || "#795548"), borderRadius: 4 }] };

  const tc = chartColors.text || "#6b6b68";
  const tcl = chartColors.textLight || "#9b9b97";

  return (
    <div>
      <div style={{ display: "flex", gap: isMobile ? 8 : 10, flexWrap: "wrap", marginBottom: 20 }}>
        <Card isMobile={isMobile} title="Net Spend" value={fmt(total)} sub="After refunds" accent="#2eaadc" />
        <Card isMobile={isMobile} title="Purchases" value={purchases.length} sub={`${refunds.length} refunds`} accent="#4CAF50" />
        <Card isMobile={isMobile} title="Refunds" value={fmt(totalR)} sub={`${refunds.length} returns`} accent="#FF9900" />
        <Card isMobile={isMobile} title="Receipts" value={`${rcpt}/${transactions.length}`} sub="Attached" accent="#9C27B0" />
      </div>

      <InsightsPanel transactions={transactions} isMobile={isMobile} />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20 }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: isMobile ? 16 : 22, boxShadow: "var(--shadow)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "var(--text)" }}>Category Split</h3>
          <div style={{ maxWidth: isMobile ? 200 : 240, margin: "0 auto" }}>
            <Doughnut data={donutData} options={{ cutout: "65%", plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 8, color: tc, font: { size: 11 } } } } }} />
          </div>
        </div>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: isMobile ? 16 : 22, boxShadow: "var(--shadow)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "var(--text)" }}>Breakdown</h3>
          <Bar data={barData} options={{ indexAxis: "y", plugins: { legend: { display: false } }, scales: {
            x: { grid: { display: false }, ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN"), color: tcl, font: { size: 11 } } },
            y: { grid: { display: false }, ticks: { color: tc, font: { size: 11 } } },
          } }} />
        </div>
      </div>
    </div>
  );
}

// ── Transactions Tab ──
function TransactionsTab({ transactions, onToggleReceipt, onSelect, isMobile }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = transactions.filter((t) => {
    if (filter !== "all" && t.category !== filter) return false;
    if (search && !t.merchant.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const inputStyle = {
    padding: "8px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)",
    fontSize: 13, background: "var(--bg-card)", color: "var(--text)",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Search merchant..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: isMobile ? "100%" : 220 }}
          onFocus={(e) => e.target.style.borderColor = "var(--accent)"}
          onBlur={(e) => e.target.style.borderColor = "var(--border)"}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ ...inputStyle, flex: isMobile ? 1 : "0 0 auto" }}>
          <option value="all">All Categories</option>
          {Object.entries(CATEGORIES).map(([k, { label }]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{filtered.length} results</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {filtered.map((t) => {
          const cat = CATEGORIES[t.category] || CATEGORIES.other;
          return (
            <div key={t.id} onClick={() => onSelect(t)} style={{
              display: "flex", alignItems: "center", gap: isMobile ? 10 : 12,
              padding: isMobile ? "10px 12px" : "10px 16px",
              background: "var(--bg-card)", borderRadius: "var(--radius)",
              cursor: "pointer", transition: "background 0.1s",
            }}
              onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseOut={(e) => e.currentTarget.style.background = "var(--bg-card)"}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 8, background: cat.color + "22",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
              }}>{cat.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.merchant}</div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>
                  {fmtDate(t.date)}{t.txnTime ? ` \u00B7 ${t.txnTime}` : ""}
                  {t.isRefund && <span style={{ color: "var(--success)", fontWeight: 600, marginLeft: 6 }}>REFUND</span>}
                </div>
                {t.notes && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.notes}</div>}
              </div>
              <div style={{
                fontWeight: 600, fontSize: 14, color: t.isRefund ? "var(--success)" : "var(--text)",
                whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
              }}>{t.isRefund ? "+" : ""}{fmt(t.amount)}</div>
              <button onClick={(e) => { e.stopPropagation(); onToggleReceipt(t.id); }}
                title={t.hasReceipt ? "Receipt attached \u2014 click to remove" : "Mark receipt as attached"}
                aria-label={t.hasReceipt ? "Receipt attached" : "Receipt missing"}
                style={{
                  width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)",
                  background: t.hasReceipt ? "var(--success)" : "var(--bg-card)",
                  color: t.hasReceipt ? "#fff" : "var(--text-tertiary)",
                  fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  transition: "background 0.15s, border-color 0.15s",
                }}
                onMouseOver={(e) => { if (!t.hasReceipt) e.currentTarget.style.borderColor = "var(--success)"; }}
                onMouseOut={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
              >{t.hasReceipt ? "\u2713" : "\u25CB"}</button>
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-tertiary)" }}><div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>{"\uD83D\uDD0D"}</div><div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>No transactions found</div><div style={{ fontSize: 12 }}>Try a different search term or category filter.</div></div>}
      </div>
    </div>
  );
}

// ── Receipts Tab ──
function ReceiptsTab({ transactions, onToggleReceipt, isMobile }) {
  const missing = transactions.filter((t) => !t.hasReceipt && !t.isRefund);
  const attached = transactions.filter((t) => t.hasReceipt);

  return (
    <div>
      <div style={{ display: "flex", gap: isMobile ? 8 : 10, marginBottom: 20 }}>
        <Card isMobile={isMobile} title="Missing" value={missing.length} sub="Action needed" accent="var(--danger)" />
        <Card isMobile={isMobile} title="Attached" value={attached.length} sub="All good" accent="var(--success)" />
      </div>

      {missing.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--danger)" }}>Missing Receipts</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 24 }}>
            {missing.map((t) => (
              <div key={t.id} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "9px 14px",
                background: "var(--bg-card)", borderRadius: "var(--radius)",
              }}
                onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseOut={(e) => e.currentTarget.style.background = "var(--bg-card)"}
              >
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500, fontSize: 13, color: "var(--text)" }}>{t.merchant}</span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 8 }}>{fmtDate(t.date)}</span>
                </div>
                <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{fmt(t.amount)}</span>
                <button onClick={() => onToggleReceipt(t.id)} style={{
                  padding: "4px 10px", borderRadius: 5, border: "1px solid var(--success)",
                  background: "transparent", color: "var(--success)", fontSize: 11, fontWeight: 600,
                }}>Attach</button>
              </div>
            ))}
          </div>
        </>
      )}

      {attached.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--success)" }}>Attached ({attached.length})</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {attached.map((t) => (
              <div key={t.id} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "9px 14px",
                background: "var(--bg-card)", borderRadius: "var(--radius)",
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500, fontSize: 13, color: "var(--text)" }}>{t.merchant}</span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 8 }}>{fmtDate(t.date)}</span>
                </div>
                <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{fmt(t.amount)}</span>
                <span style={{ fontSize: 12, color: "var(--success)" }}>{"\u2713"}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Reports Tab ──
function ReportsTab({ transactions, startDate, endDate, isMobile }) {
  const purchases = transactions.filter((t) => !t.isRefund);
  const refunds = transactions.filter((t) => t.isRefund);
  const totalSpend = purchases.reduce((s, t) => s + t.amount, 0);
  const totalRefunds = refunds.reduce((s, t) => s + t.amount, 0);
  const missingReceipts = transactions.filter((t) => !t.hasReceipt && !t.isRefund);

  const catTotals = {};
  for (const t of purchases) catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
  const catsSorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

  const downloadCSV = () => {
    const p = new URLSearchParams(); p.set("format", "csv");
    if (startDate) p.set("start", startDate); if (endDate) p.set("end", endDate);
    window.open(`/api/reports?${p.toString()}`, "_blank");
  };

  const period = startDate && endDate ? `${fmtDate(startDate)} \u2013 ${fmtDate(endDate)}` : "All time";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button onClick={downloadCSV} style={{
          padding: "8px 16px", borderRadius: "var(--radius)", border: "1px solid var(--border)",
          background: "var(--bg-card)", color: "var(--text)", fontSize: 13, fontWeight: 500,
          display: "flex", alignItems: "center", gap: 6, boxShadow: "var(--shadow)",
        }}>{"\uD83D\uDCC4"} Export CSV</button>
      </div>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: isMobile ? 16 : 24, boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Expense Report</h3>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-secondary)", padding: "4px 12px", borderRadius: 20 }}>{period}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
          {[
            { l: "GROSS SPEND", v: fmt(totalSpend) },
            { l: "REFUNDS", v: fmt(totalRefunds), c: "var(--success)" },
            { l: "NET SPEND", v: fmt(totalSpend - totalRefunds) },
            { l: "MISSING RECEIPTS", v: missingReceipts.length, c: missingReceipts.length > 0 ? "var(--danger)" : undefined },
          ].map((it) => (
            <div key={it.l} style={{ padding: 12, background: "var(--bg-secondary)", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>{it.l}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: it.c || "var(--text)" }}>{it.v}</div>
            </div>
          ))}
        </div>

        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>Category Breakdown</h4>
        <div style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 14px", background: "var(--bg-secondary)", fontSize: 10, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            <span>Category</span><span style={{ textAlign: "right" }}>Amount</span><span style={{ textAlign: "right" }}>%</span><span style={{ textAlign: "right" }}>Count</span>
          </div>
          {catsSorted.map(([cat, total]) => {
            const info = CATEGORIES[cat] || CATEGORIES.other;
            const count = purchases.filter((t) => t.category === cat).length;
            return (
              <div key={cat} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 13, alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 13 }}>{info.icon}</span><span style={{ fontWeight: 500, color: "var(--text)" }}>{info.label}</span></span>
                <span style={{ textAlign: "right", fontWeight: 600, color: "var(--text)" }}>{fmt(total)}</span>
                <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>{totalSpend > 0 ? ((total / totalSpend) * 100).toFixed(1) : 0}%</span>
                <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>{count}</span>
              </div>
            );
          })}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 14px", borderTop: "2px solid var(--border-strong)", fontSize: 13, fontWeight: 700, background: "var(--bg-secondary)", color: "var(--text)" }}>
            <span>Total</span><span style={{ textAlign: "right" }}>{fmt(totalSpend)}</span><span style={{ textAlign: "right" }}>100%</span><span style={{ textAlign: "right" }}>{purchases.length}</span>
          </div>
        </div>

        {missingReceipts.length > 0 && (
          <>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginTop: 20, marginBottom: 8, color: "var(--danger)" }}>Missing Receipts ({missingReceipts.length})</h4>
            <div style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)", overflow: "hidden" }}>
              {missingReceipts.map((t, i) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 14px", borderTop: i > 0 ? "1px solid var(--border)" : "none", fontSize: 13, color: "var(--text)" }}>
                  <span>{t.merchant}</span>
                  <span style={{ display: "flex", gap: 16 }}>
                    <span style={{ color: "var(--text-tertiary)" }}>{fmtDate(t.date)}</span>
                    <span style={{ fontWeight: 600 }}>{fmt(t.amount)}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Map Supabase rows ──
function mapRows(rows) {
  return rows.map((r) => ({
    id: r.id, merchant: r.merchant, amount: r.amount, date: r.date,
    category: r.category, hasReceipt: r.has_receipt, itemDescription: r.item_description,
    isRefund: r.is_refund || false, notes: r.notes || null, txnTime: r.txn_time || null,
    userNotes: r.user_notes || "", rawEmail: r.raw_email,
  }));
}

// ── Main Page ──
export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { theme, toggle: toggleTheme, chartColors } = useTheme();
  const [allTransactions, setAllTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedTxn, setSelectedTxn] = useState(null);
  const isMobile = useIsMobile();

  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);

  const transactions = useMemo(() => allTransactions.filter((t) => {
    if (t.amount < 10) return false;
    if (startDate && t.date < startDate) return false;
    if (endDate && t.date > endDate) return false;
    return true;
  }), [allTransactions, startDate, endDate]);

  const handlePreset = useCallback((d) => {
    if (d === 0) { setStartDate(""); setEndDate(""); }
    else {
      const e = new Date(), s = new Date();
      s.setDate(s.getDate() - d);
      setStartDate(s.toISOString().split("T")[0]);
      setEndDate(e.toISOString().split("T")[0]);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const res = await fetch("/api/transactions");
      const data = await res.json();
      if (data.transactions?.length) setAllTransactions(mapRows(data.transactions));
    } catch { /* */ }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/transactions/claim", { method: "POST" })
        .then(() => loadTransactions()).catch(() => loadTransactions());
    }
  }, [status, loadTransactions]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setMessage("Syncing...");
    fetch("/api/sync", { method: "POST" })
      .then((r) => r.json())
      .then((d) => { if (d.error && !d.error.includes("already")) setMessage("Error: " + d.error); else { setMessage(d.message || "Done!"); loadTransactions(); } setSyncing(false); })
      .catch((e) => { setMessage("Failed: " + e.message); setSyncing(false); });
    const poll = setInterval(() => loadTransactions(), 30000);
    setTimeout(() => clearInterval(poll), 40 * 60 * 1000);
  }, [loadTransactions]);

  const handleToggleReceipt = useCallback((id) => {
    setAllTransactions((prev) => {
      const up = prev.map((t) => t.id === id ? { ...t, hasReceipt: !t.hasReceipt } : t);
      const tgt = up.find((t) => t.id === id);
      fetch("/api/transactions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, hasReceipt: tgt.hasReceipt }) });
      return up;
    });
  }, []);

  if (status === "loading" || status === "unauthenticated") {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}><div style={{ color: "var(--text-tertiary)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}><div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /><span style={{ fontSize: 13 }}>Loading...</span></div></div>;
  }

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "transactions", label: "Transactions" },
    { key: "receipts", label: "Receipts" },
    { key: "reports", label: "Reports" },
  ];

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: isMobile ? "14px 12px" : "24px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isMobile ? 16 : 22, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: "var(--text)", letterSpacing: -0.3 }}>Vippy Spend Tracker</h1>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>HDFC Corporate Card &middot; Vippy Industries</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && <span style={{ fontSize: 11, color: message.startsWith("Error") ? "var(--danger)" : "var(--success)", maxWidth: 160 }}>{message}</span>}
          <button onClick={handleSync} disabled={syncing} style={{
            padding: "7px 16px", borderRadius: "var(--radius)", border: "1px solid var(--border)",
            background: syncing ? "var(--bg-tertiary)" : "var(--bg-card)", color: syncing ? "var(--text-tertiary)" : "var(--text)",
            fontSize: 13, fontWeight: 500, boxShadow: "var(--shadow)", transition: "background 0.15s, box-shadow 0.15s",
            cursor: syncing ? "not-allowed" : "pointer", opacity: syncing ? 0.7 : 1,
          }}
            onMouseOver={(e) => { if (!syncing) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.boxShadow = "var(--shadow-hover)"; } }}
            onMouseOut={(e) => { e.currentTarget.style.background = syncing ? "var(--bg-tertiary)" : "var(--bg-card)"; e.currentTarget.style.boxShadow = "var(--shadow)"; }}
          >{syncing ? "Syncing..." : "Sync Gmail"}</button>
          <UserMenu session={session} theme={theme} onToggleTheme={toggleTheme} isMobile={isMobile} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: isMobile ? 14 : 18, overflowX: "auto" }}>
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: isMobile ? "8px 14px" : "8px 20px", border: "none", background: "none",
            fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
            color: activeTab === tab.key ? "var(--text)" : "var(--text-tertiary)",
            borderBottom: activeTab === tab.key ? "2px solid var(--text)" : "2px solid transparent",
            marginBottom: -1, whiteSpace: "nowrap", transition: "color 0.15s, background 0.15s",
            borderRadius: "4px 4px 0 0",
          }}
            onMouseOver={(e) => { if (activeTab !== tab.key) e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseOut={(e) => { e.currentTarget.style.color = activeTab === tab.key ? "var(--text)" : "var(--text-tertiary)"; e.currentTarget.style.background = "none"; }}
          >{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      {allTransactions.length === 0 && !syncing && !message ? (
        <div style={{ textAlign: "center", padding: isMobile ? "60px 16px" : "80px 20px" }}>
          <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.2 }}>{"\uD83D\uDCCA"}</div>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>No transactions yet</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>Click Sync Gmail to fetch your expenses.</p>
          <button onClick={handleSync} style={{
            padding: "10px 24px", borderRadius: "var(--radius)", border: "none",
            background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600,
          }}>Sync Gmail</button>
        </div>
      ) : (
        <>
          {syncing && (
            <div style={{
              padding: "9px 14px", background: "var(--bg-secondary)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", marginBottom: 14, fontSize: 12, color: "var(--text-secondary)",
            }}>Sync in progress \u2014 transactions appear every 30s...</div>
          )}

          <DateRangePicker startDate={startDate} endDate={endDate}
            onStartChange={setStartDate} onEndChange={setEndDate}
            onPreset={handlePreset} isMobile={isMobile} />

          {transactions.length === 0 && allTransactions.length > 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-tertiary)" }}>No transactions in this date range.</div>
          ) : (
            <>
              {activeTab === "overview" && <OverviewTab transactions={transactions} isMobile={isMobile} chartColors={chartColors} />}
              {activeTab === "transactions" && <TransactionsTab transactions={transactions} onToggleReceipt={handleToggleReceipt} onSelect={setSelectedTxn} isMobile={isMobile} />}
              {activeTab === "receipts" && <ReceiptsTab transactions={transactions} onToggleReceipt={handleToggleReceipt} isMobile={isMobile} />}
              {activeTab === "reports" && <ReportsTab transactions={transactions} startDate={startDate} endDate={endDate} isMobile={isMobile} />}
            </>
          )}
        </>
      )}

      <TransactionModal transaction={selectedTxn} onClose={() => setSelectedTxn(null)}
        onUpdateNotes={(id, notes) => setAllTransactions((p) => p.map((t) => t.id === id ? { ...t, userNotes: notes } : t))} />
    </div>
  );
}
