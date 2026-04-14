"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, LineElement, PointElement, LineController, Filler } from "chart.js";
import { Doughnut, Bar, Line } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, LineElement, PointElement, LineController, Filler);

const CATEGORIES = {
  amazon: { label: "Amazon", color: "#7C3AED", icon: "\uD83D\uDED2" },
  fuel: { label: "Fuel", color: "#10B981", icon: "\u26FD" },
  dining: { label: "Dining", color: "#F59E0B", icon: "\uD83C\uDF7D\uFE0F" },
  swiggy: { label: "Swiggy", color: "#FC8019", icon: "\uD83D\uDEF5" },
  utilities: { label: "Utilities", color: "#EF4444", icon: "\uD83D\uDCA1" },
  subscriptions: { label: "Subscriptions", color: "#0EA5E9", icon: "\uD83D\uDCF1" },
  office: { label: "Office", color: "#607D8B", icon: "\uD83C\uDFE2" },
  travel: { label: "Travel", color: "#0EA5E9", icon: "\u2708\uFE0F" },
  other: { label: "Other", color: "#64748B", icon: "\uD83D\uDCE6" },
};

const fmt = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  const day = DAYS_SHORT[dt.getDay()];
  const rest = dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${day}, ${rest}`;
};
const fmtTime = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  const suffix = hr >= 12 ? "PM" : "AM";
  const h12 = hr % 12 || 12;
  return `${h12}:${m} ${suffix}`;
};

// ── Hooks ──
function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => { const c = () => setM(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);
  return m;
}

function useTheme() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    const saved = localStorage.getItem("vippy-theme");
    const preferred = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(preferred);
    document.documentElement.setAttribute("data-theme", preferred);
  }, []);
  const toggle = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("vippy-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }, [theme]);

  const chartColors = useMemo(() => ({
    text: theme === "dark" ? "#94A3B8" : "#374151",
    textLight: theme === "dark" ? "#64748B" : "#6B7280",
    grid: theme === "dark" ? "rgba(255,255,255,0.06)" : "#E2E8F0",
  }), [theme]);

  return { theme, toggle, chartColors };
}

// ── 3D Tilt Hook ──
function useTilt(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = `perspective(600px) rotateX(${-y * 8}deg) rotateY(${x * 8}deg)`;
    };
    const handleLeave = () => { el.style.transform = "perspective(600px) rotateX(0) rotateY(0)"; };
    el.addEventListener("mousemove", handleMove);
    el.addEventListener("mouseleave", handleLeave);
    return () => { el.removeEventListener("mousemove", handleMove); el.removeEventListener("mouseleave", handleLeave); };
  }, [ref]);
}

// ── Count-up animation ──
function useCountUp(target, duration = 800) {
  const [val, setVal] = useState(0);
  const prevTarget = useRef(0);
  useEffect(() => {
    if (typeof target !== "number" || isNaN(target)) { setVal(target); return; }
    const start = prevTarget.current;
    prevTarget.current = target;
    const diff = target - start;
    if (diff === 0) return;
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(start + diff * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [target, duration]);
  return val;
}

// ── Toast System ──
function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.type === "success" ? "\u2713" : t.type === "error" ? "\u2717" : "\u2139"}</span>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Sidebar ──
function Sidebar({ activeTab, onTabChange, gmailStatus, onSync, syncing, missingReceipts, session, theme, onToggleTheme }) {
  const tabs = [
    { key: "overview", label: "Overview", icon: "\uD83D\uDCCA" },
    { key: "transactions", label: "Transactions", icon: "\uD83D\uDCB3" },
    { key: "receipts", label: "Receipts", icon: "\uD83D\uDCC4" },
    { key: "subscriptions", label: "Subscriptions", icon: "\uD83D\uDD04" },
    { key: "reports", label: "Reports", icon: "\uD83D\uDCC8" },
    { key: "settings", label: "Settings", icon: "\u2699\uFE0F" },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Image src="/vippy-logo.webp" alt="Vippy" width={36} height={36} priority style={{ borderRadius: 8, objectFit: "contain" }} />
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: -0.5 }}>Vippy Spend</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: 0.3 }}>HDFC Corporate &middot; Vippy Industries</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`sidebar-nav-item ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => onTabChange(tab.key)}
            aria-current={activeTab === tab.key ? "page" : undefined}
          >
            <span className="sidebar-nav-icon">{tab.icon}</span>
            {tab.label}
            {tab.key === "receipts" && missingReceipts > 0 && (
              <span className="sidebar-badge">{missingReceipts}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {gmailStatus && (
          <div className="sidebar-sync-status">
            <span className="sidebar-sync-dot" style={{ background: gmailStatus.connected ? "var(--success)" : "var(--danger)" }} />
            <span>{gmailStatus.connected ? "Gmail synced" : "Disconnected"}</span>
          </div>
        )}
        <button onClick={onSync} disabled={syncing} style={{
          width: "100%", padding: "8px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border)",
          background: syncing ? "var(--bg-card-2)" : "var(--bg-card)", color: syncing ? "var(--text-muted)" : "var(--text)",
          fontSize: 12, fontWeight: 500, marginBottom: 10, transition: "all 0.15s",
        }}>
          {syncing ? "Syncing..." : "Sync Now"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: "50%", background: "var(--brand)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600,
          }}>
            {session?.user?.name?.[0]?.toUpperCase() || "?"}
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", flex: 1 }}>{session?.user?.name?.split(" ")[0] || "User"}</span>
          <button onClick={onToggleTheme} style={{ background: "none", border: "none", fontSize: 16, padding: 4, color: "var(--text-muted)" }} aria-label="Toggle theme">
            {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── Mobile Bottom Tab Bar ──
function MobileTabBar({ activeTab, onTabChange, missingReceipts }) {
  const tabs = [
    { key: "overview", label: "Overview", icon: "\uD83D\uDCCA" },
    { key: "transactions", label: "Txns", icon: "\uD83D\uDCB3" },
    { key: "receipts", label: "Receipts", icon: "\uD83D\uDCC4" },
    { key: "subscriptions", label: "Subs", icon: "\uD83D\uDD04" },
    { key: "settings", label: "Settings", icon: "\u2699\uFE0F" },
  ];

  return (
    <div className="mobile-tab-bar">
      <div className="mobile-tab-bar-inner">
        {tabs.map((tab) => (
          <button key={tab.key} className={`mobile-tab-item ${activeTab === tab.key ? "active" : ""}`} onClick={() => onTabChange(tab.key)}>
            <span className="mobile-tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.key === "receipts" && missingReceipts > 0 && (
              <span style={{ position: "absolute", top: 2, right: 4, width: 6, height: 6, borderRadius: "50%", background: "var(--danger)" }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Transaction Detail Modal ──
function TransactionModal({ transaction: t, onClose, onUpdateNotes }) {
  const [userNotes, setUserNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const modalRef = useRef(null);

  useEffect(() => { if (t) setUserNotes(t.userNotes || ""); }, [t]);
  useEffect(() => { if (t) modalRef.current?.focus(); }, [t]);
  if (!t) return null;
  const cat = CATEGORIES[t.category] || CATEGORIES.other;

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
    <div onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
      animation: "fadeIn 0.15s ease",
    }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{
        background: "var(--bg-card)", borderRadius: "var(--radius-lg)", padding: "28px 24px",
        maxWidth: 460, width: "100%", position: "relative", boxShadow: "var(--shadow-lg)",
        maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border)",
        animation: "slideUp 0.25s ease", outline: "none",
      }}>
        <button onClick={onClose} aria-label="Close" style={{
          position: "absolute", top: 14, right: 14, border: "none",
          background: "var(--bg-card-2)", width: 28, height: 28, borderRadius: 6,
          fontSize: 16, color: "var(--text-muted)", display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>&times;</button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: cat.color + "22",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>{cat.icon}</div>
          <div>
            <div id="modal-title" style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, color: "var(--text)", letterSpacing: -0.3 }}>{t.merchant}</div>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: cat.color + "22", color: cat.color }}>{cat.label}</span>
          </div>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 800, marginBottom: 24, color: t.isRefund ? "var(--success)" : "var(--text)", fontVariantNumeric: "tabular-nums", letterSpacing: -1 }}>
          {t.isRefund ? "+" : ""}{fmt(t.amount)}
          {t.isRefund && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--success)", background: "var(--success-bg)", padding: "2px 8px", borderRadius: 4, marginLeft: 8, verticalAlign: "middle" }}>REFUND</span>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <ModalRow label="Date" value={fmtDate(t.date)} />
          <ModalRow label="Time" value={t.txnTime ? fmtTime(t.txnTime) : "Not available"} />
          {t.itemDescription && <ModalRow label="Item" value={t.itemDescription} />}
          <ModalRow label="Receipt" value={t.hasReceipt ? "\u2713 Attached" : "\u25CB Missing"} />
          {t.rawEmail && <ModalRow label="Source" value={t.rawEmail} />}
        </div>

        {t.notes && (
          <div style={{ padding: "12px 14px", background: "var(--brand-subtle)", borderRadius: "var(--radius)", border: "1px solid var(--border)", marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "var(--brand)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 4 }}>{"\u2728"} AI Insight</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{t.notes}</div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <label htmlFor="user-notes" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, display: "block" }}>Your Notes</label>
          <textarea id="user-notes" value={userNotes} onChange={(e) => setUserNotes(e.target.value)}
            placeholder="Add a note..."
            style={{
              width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)",
              fontSize: 13, resize: "vertical", minHeight: 60, lineHeight: 1.5,
              background: "var(--bg-card)", color: "var(--text)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <button onClick={handleSaveNotes} disabled={saving} style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: saving ? "var(--bg-card-2)" : "var(--brand)", color: "#fff",
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

function ModalRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

// ── Period Selector (Pill Style) ──
function PeriodSelector({ startDate, endDate, onStartChange, onEndChange, onPreset, isMobile, activePreset }) {
  const inputStyle = {
    padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6,
    fontSize: 13, background: "var(--bg-card)", color: "var(--text)",
    flex: isMobile ? "1 1 auto" : "0 0 auto",
  };
  return (
    <div className="period-selector">
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Period</span>
      <input type="date" value={startDate} onChange={(e) => onStartChange(e.target.value)} style={inputStyle} />
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>\u2013</span>
      <input type="date" value={endDate} onChange={(e) => onEndChange(e.target.value)} style={inputStyle} />
      <div style={{ display: "flex", gap: 4 }}>
        {[{ l: "7D", d: 7 }, { l: "30D", d: 30 }, { l: "90D", d: 90 }, { l: "1Y", d: 365 }, { l: "All", d: 0 }].map((p) => (
          <button key={p.l} onClick={() => onPreset(p.d)} className={`period-pill ${activePreset === p.d ? "active" : ""}`}>
            {p.l}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Stat Card with 3D Tilt ──
function StatCard({ title, value, sub, accent, isMobile }) {
  const ref = useRef(null);
  useTilt(ref);
  const numVal = typeof value === "number" ? value : null;
  const animated = useCountUp(numVal, 800);
  const displayVal = numVal !== null ? (typeof fmt === "function" && sub?.includes("refund") ? value : animated) : value;

  return (
    <div ref={ref} className="stat-card" style={{
      borderLeft: accent ? `3px solid ${accent}` : undefined,
    }}>
      <div className="stat-card-title">{title}</div>
      <div className="stat-card-value">{typeof displayVal === "number" ? displayVal : value}</div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  );
}

// ── Insights Panel (Bento Grid) ──
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
  const topCatPct = ((topCat[1] / total) * 100).toFixed(1);

  const items = [
    { icon: topCatInfo.icon, title: "Top Category", val: topCatInfo.label, sub: `${fmt(topCat[1])} \u00B7 ${topCatPct}%`, col: topCatInfo.color },
    { icon: "\uD83D\uDCCA", title: "Avg Transaction", val: fmt(avg), sub: `${purchases.length} purchases`, col: "#0EA5E9" },
    { icon: "\uD83D\uDD25", title: "Highest Spend", val: fmt(highest.amount), sub: highest.merchant, col: "#EF4444" },
    { icon: "\uD83D\uDD04", title: "Most Frequent", val: topMerch[0], sub: `${topMerch[1]} times`, col: "#F59E0B" },
    { icon: "\uD83D\uDCC5", title: "Daily Average", val: fmt(total / (days || 1)), sub: `${days} active days`, col: "#10B981" },
    { icon: "\uD83C\uDFF7\uFE0F", title: "Categories", val: Object.keys(catTotals).length, sub: "spending types", col: "#7C3AED" },
  ];

  return (
    <div className="chart-card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontFamily: "var(--font-display)" }}>Spending Insights</h3>
      <div className="bento-grid">
        {items.map((it) => (
          <div key={it.title} className="bento-tile">
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 15 }}>{it.icon}</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700 }}>{it.title}</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: it.col, letterSpacing: -0.3 }}>{it.val}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{it.sub}</div>
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

  const [hoveredCat, setHoveredCat] = useState(null);

  const donutData = {
    labels: cats.map(([c]) => CATEGORIES[c]?.label || c),
    datasets: [{
      data: cats.map(([, v]) => v),
      backgroundColor: cats.map(([c]) => CATEGORIES[c]?.color || "#64748B"),
      borderWidth: 3,
      borderColor: "var(--bg-card)",
      hoverBorderWidth: 4,
    }],
  };

  // Daily trend — aggregated to monthly by default
  const [trendView, setTrendView] = useState("monthly");
  const byDay = {};
  for (const t of purchases) byDay[t.date] = (byDay[t.date] || 0) + t.amount;
  const daysSorted = Object.keys(byDay).sort();

  const aggregatedData = useMemo(() => {
    if (trendView === "daily") {
      return {
        labels: daysSorted.map((d) => { const dt = new Date(d + "T00:00:00"); return `${dt.getDate()} ${dt.toLocaleString("en-IN", { month: "short" })}`; }),
        data: daysSorted.map((d) => byDay[d]),
      };
    } else if (trendView === "weekly") {
      const weeks = {};
      for (const d of daysSorted) {
        const dt = new Date(d + "T00:00:00");
        const ws = new Date(dt); ws.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
        const wk = ws.toISOString().slice(0, 10);
        weeks[wk] = (weeks[wk] || 0) + byDay[d];
      }
      const wks = Object.keys(weeks).sort();
      return {
        labels: wks.map(w => { const dt = new Date(w + "T00:00:00"); return `${dt.getDate()} ${dt.toLocaleString("en-IN", { month: "short" })}`; }),
        data: wks.map(w => weeks[w]),
      };
    } else {
      const months = {};
      for (const d of daysSorted) {
        const mo = d.slice(0, 7);
        months[mo] = (months[mo] || 0) + byDay[d];
      }
      const mos = Object.keys(months).sort();
      return {
        labels: mos.map(m => { const [y, mo] = m.split("-"); const dt = new Date(Number(y), Number(mo) - 1); return dt.toLocaleString("en-IN", { month: "short", year: "2-digit" }); }),
        data: mos.map(m => months[m]),
      };
    }
  }, [trendView, daysSorted, byDay]);

  // Day-of-week
  const dowTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const t of purchases) { const d = new Date(t.date + "T00:00:00").getDay(); dowTotals[d] += t.amount; }
  const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dowReordered = [1, 2, 3, 4, 5, 6, 0].map(i => dowTotals[i]);
  const dowAvg = dowReordered.reduce((a, b) => a + b, 0) / 7;
  const dowMax = Math.max(...dowReordered);
  const dowMaxDay = DOW_LABELS[dowReordered.indexOf(dowMax)];
  const dowColors = [1, 2, 3, 4, 5, 6, 0].map(i => (i === 0 || i === 6) ? "#7C3AED" : "#0EA5E9");

  // Time-of-day
  const timeBuckets = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
  let hasTimeData = false;
  for (const t of purchases) {
    if (!t.txnTime) continue;
    hasTimeData = true;
    const hr = parseInt(t.txnTime.split(":")[0], 10);
    if (hr >= 6 && hr < 12) timeBuckets.Morning += t.amount;
    else if (hr >= 12 && hr < 17) timeBuckets.Afternoon += t.amount;
    else if (hr >= 17 && hr < 21) timeBuckets.Evening += t.amount;
    else timeBuckets.Night += t.amount;
  }
  const timeTotal = Object.values(timeBuckets).reduce((a, b) => a + b, 0);
  const timeColors = ["#F59E0B", "#EF4444", "#7C3AED", "#0EA5E9"];
  const timeIcons = ["\uD83C\uDF05", "\u2600\uFE0F", "\uD83C\uDF06", "\uD83C\uDF19"];
  const dominantTime = Object.entries(timeBuckets).sort((a, b) => b[1] - a[1])[0];

  // Top merchants
  const merchAgg = {};
  for (const t of purchases) {
    if (!merchAgg[t.merchant]) merchAgg[t.merchant] = { total: 0, count: 0 };
    merchAgg[t.merchant].total += t.amount;
    merchAgg[t.merchant].count++;
  }
  const topMerchants = Object.entries(merchAgg)
    .map(([name, d]) => ({ name, total: d.total, count: d.count, avg: d.total / d.count }))
    .sort((a, b) => b.total - a.total).slice(0, 5);

  // Category trends (weekly)
  const weekCatData = {};
  for (const t of purchases) {
    const dt = new Date(t.date + "T00:00:00");
    const ws = new Date(dt); ws.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const wk = ws.toISOString().slice(0, 10);
    if (!weekCatData[wk]) weekCatData[wk] = {};
    weekCatData[wk][t.category] = (weekCatData[wk][t.category] || 0) + t.amount;
  }
  const weekKeys = Object.keys(weekCatData).sort();
  const activeCats = [...new Set(purchases.map(t => t.category))];

  // Spending distribution with averages
  const distRanges = [
    { label: "\u20B90\u2013500", min: 0, max: 500 },
    { label: "\u20B9500\u20131K", min: 500, max: 1000 },
    { label: "\u20B91K\u20132K", min: 1000, max: 2000 },
    { label: "\u20B92K\u20135K", min: 2000, max: 5000 },
    { label: "\u20B95K+", min: 5000, max: Infinity },
  ];
  const distData = distRanges.map(() => ({ count: 0, total: 0 }));
  for (const t of purchases) {
    const idx = distRanges.findIndex(r => t.amount >= r.min && t.amount < r.max);
    if (idx >= 0) { distData[idx].count++; distData[idx].total += t.amount; }
  }
  const distColors = ["#10B981", "#0EA5E9", "#7C3AED", "#F59E0B", "#EF4444"];

  // Weekend vs weekday
  let wkdayTotal = 0, wkendTotal = 0;
  const wkdayDays = new Set(), wkendDays = new Set();
  for (const t of purchases) {
    const d = new Date(t.date + "T00:00:00").getDay();
    if (d === 0 || d === 6) { wkendTotal += t.amount; wkendDays.add(t.date); }
    else { wkdayTotal += t.amount; wkdayDays.add(t.date); }
  }
  const avgWeekday = wkdayDays.size ? wkdayTotal / wkdayDays.size : 0;
  const avgWeekend = wkendDays.size ? wkendTotal / wkendDays.size : 0;
  const weekendMultiple = avgWeekday > 0 ? (avgWeekend / avgWeekday).toFixed(1) : 0;

  const tc = chartColors.text || "#374151";
  const tcl = chartColors.textLight || "#6B7280";
  const chartFont = { size: 12, weight: "600" };

  return (
    <div>
      {/* Hero Stat Row */}
      <div style={{ display: "flex", gap: isMobile ? 10 : 14, flexWrap: "wrap", marginBottom: 24 }}>
        <StatCard isMobile={isMobile} title="Net Spend" value={fmt(total)} sub="After refunds" accent="#7C3AED" />
        <StatCard isMobile={isMobile} title="Purchases" value={purchases.length} sub={`${refunds.length} refunds`} accent="#10B981" />
        <StatCard isMobile={isMobile} title="Refunds" value={fmt(totalR)} sub={`${refunds.length} returns`} accent="#F59E0B" />
        <StatCard isMobile={isMobile} title="Receipts" value={`${rcpt}/${transactions.length}`} sub={`${Math.round(rcpt/transactions.length*100)}% attached`} accent="#0EA5E9" />
      </div>

      <InsightsPanel transactions={transactions} isMobile={isMobile} />

      {/* Category Split — Single Interactive Donut */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 24, marginBottom: 24 }}>
        <div className="chart-card">
          <h3 style={{ fontFamily: "var(--font-display)" }}>Category Split</h3>
          <div style={{ maxWidth: isMobile ? 240 : 300, margin: "0 auto", position: "relative" }}>
            <Doughnut data={donutData} options={{
              cutout: "68%",
              plugins: {
                legend: { position: "bottom", labels: { boxWidth: 12, padding: 12, color: tc, font: chartFont, usePointStyle: true } },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const val = ctx.raw;
                      const pct = ((val / cats.reduce((s, [, v]) => s + v, 0)) * 100).toFixed(1);
                      return ` ${fmt(val)} \u00B7 ${pct}%`;
                    },
                  },
                  backgroundColor: "rgba(15,22,42,0.95)",
                  titleFont: { weight: "bold" },
                  padding: 12,
                  cornerRadius: 8,
                },
              },
              onHover: (_, els) => {
                if (els.length > 0) setHoveredCat(cats[els[0].index]);
                else setHoveredCat(null);
              },
            }} />
            <div style={{
              position: "absolute", top: "42%", left: "50%", transform: "translate(-50%, -50%)",
              textAlign: "center", pointerEvents: "none",
            }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
                {hoveredCat ? (CATEGORIES[hoveredCat[0]]?.label || hoveredCat[0]) : "Total"}
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--text)", letterSpacing: -0.5 }}>
                {hoveredCat ? fmt(hoveredCat[1]) : fmt(cats.reduce((s, [, v]) => s + v, 0))}
              </div>
            </div>
          </div>
        </div>

        {/* Spending Velocity Card (replaces redundant bar chart) */}
        <div className="chart-card" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h3 style={{ fontFamily: "var(--font-display)" }}>Spending Velocity</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "var(--bg-card-2)", borderRadius: "var(--radius-md)" }}>
              <span style={{ fontSize: 24 }}>{"\uD83D\uDCC5"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>Weekday Avg / Day</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "#0EA5E9", fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>{fmt(avgWeekday)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{wkdayDays.size} active days</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "var(--bg-card-2)", borderRadius: "var(--radius-md)" }}>
              <span style={{ fontSize: 24 }}>{"\uD83D\uDDD3\uFE0F"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>Weekend Avg / Day</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "#7C3AED", fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>{fmt(avgWeekend)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{wkendDays.size} active days</div>
              </div>
            </div>
            {avgWeekday > 0 && (
              <div style={{ padding: "12px 16px", background: "var(--brand-subtle)", borderRadius: "var(--radius)", fontSize: 13, color: "var(--brand)", fontWeight: 600, textAlign: "center" }}>
                You spend {weekendMultiple}x more on weekends
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Daily Spend with Toggle */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ fontFamily: "var(--font-display)", margin: 0 }}>Spend Trend</h3>
          <div style={{ display: "flex", gap: 2 }}>
            {["daily", "weekly", "monthly"].map((v) => (
              <button key={v} onClick={() => setTrendView(v)} style={{
                padding: "4px 12px", borderRadius: 999, border: "1px solid",
                borderColor: trendView === v ? "var(--brand)" : "var(--border)",
                background: trendView === v ? "var(--brand)" : "transparent",
                color: trendView === v ? "#fff" : "var(--text-muted)",
                fontSize: 11, fontWeight: 600, textTransform: "capitalize",
              }}>{v}</button>
            ))}
          </div>
        </div>
        <Bar data={{
          labels: aggregatedData.labels,
          datasets: [{ data: aggregatedData.data, backgroundColor: "#7C3AED", borderRadius: 6, hoverBackgroundColor: "#6D28D9" }],
        }} options={{
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}` },
              backgroundColor: "rgba(15,22,42,0.95)", padding: 12, cornerRadius: 8,
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: tcl, font: chartFont, maxRotation: 45, minRotation: 30 } },
            y: { grid: { color: chartColors.grid }, ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN"), color: tcl, font: chartFont } },
          },
        }} />
      </div>

      {/* Spending Patterns */}
      {purchases.length > 0 && (
        <>
          <div style={{ marginTop: 12, marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: "var(--text)", letterSpacing: -0.4 }}>Spending Patterns</h2>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>

          {/* Day-of-Week + Top Merchants */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 24, marginBottom: 24 }}>
            <div className="chart-card">
              <h3 style={{ fontFamily: "var(--font-display)" }}>Spend by Day</h3>
              <Bar data={{
                labels: DOW_LABELS,
                datasets: [{
                  data: dowReordered,
                  backgroundColor: dowColors.map(c => c + "CC"),
                  hoverBackgroundColor: dowColors,
                  borderRadius: 6,
                }],
              }} options={{
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}` }, backgroundColor: "rgba(15,22,42,0.95)", padding: 12, cornerRadius: 8 },
                  annotation: undefined,
                },
                scales: {
                  x: { grid: { display: false }, ticks: { color: tc, font: chartFont } },
                  y: { grid: { color: chartColors.grid }, ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN"), color: tcl, font: chartFont } },
                },
              }} />
              <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--bg-card-2)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--text-secondary)" }}>
                {dowMaxDay} is your biggest spending day
              </div>
            </div>

            {/* Top Merchants */}
            {topMerchants.length > 0 && (
              <div className="chart-card">
                <h3 style={{ fontFamily: "var(--font-display)" }}>Top Merchants</h3>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 0.5fr 1fr", padding: "8px 0", fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid var(--border)" }}>
                  <span>Merchant</span><span style={{ textAlign: "right" }}>Total</span><span style={{ textAlign: "right" }}>Txns</span><span style={{ textAlign: "right" }}>Avg</span>
                </div>
                {topMerchants.map((m, i) => (
                  <div key={m.name} style={{
                    display: "grid", gridTemplateColumns: "2fr 1fr 0.5fr 1fr",
                    padding: "10px 0", fontSize: 13, alignItems: "center",
                    borderBottom: i < topMerchants.length - 1 ? "1px solid var(--border)" : "none",
                    background: m.count === 1 && m.total > 10000 ? "var(--brand-subtle)" : "transparent",
                    borderRadius: m.count === 1 && m.total > 10000 ? "var(--radius)" : 0,
                    padding: m.count === 1 && m.total > 10000 ? "10px 8px" : "10px 0",
                  }}>
                    <span style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                      {m.name}
                      {m.count === 1 && m.total > 10000 && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--warning-bg)", color: "var(--warning)", fontWeight: 700 }}>OUTLIER</span>}
                    </span>
                    <span style={{ textAlign: "right", fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt(m.total)}</span>
                    <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>{m.count}</span>
                    <span style={{ textAlign: "right", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{fmt(m.avg)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Category Trends — Stacked Area */}
          {weekKeys.length >= 2 && (
            <div className="chart-card" style={{ marginBottom: 24 }}>
              <h3 style={{ fontFamily: "var(--font-display)" }}>Category Trends</h3>
              <Line data={{
                labels: weekKeys.map(wk => { const dt = new Date(wk + "T00:00:00"); return `${dt.getDate()} ${dt.toLocaleString("en-IN", { month: "short" })}`; }),
                datasets: activeCats.map(cat => ({
                  label: CATEGORIES[cat]?.label || cat,
                  data: weekKeys.map(wk => weekCatData[wk][cat] || 0),
                  borderColor: CATEGORIES[cat]?.color || "#64748B",
                  backgroundColor: (CATEGORIES[cat]?.color || "#64748B") + "30",
                  tension: 0.4, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
                  fill: true,
                })),
              }} options={{
                responsive: true,
                interaction: { mode: "index", intersect: false },
                plugins: {
                  legend: { position: "bottom", labels: { boxWidth: 12, padding: 12, color: tc, font: chartFont, usePointStyle: true } },
                  tooltip: {
                    callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` },
                    backgroundColor: "rgba(15,22,42,0.95)", padding: 12, cornerRadius: 8,
                  },
                },
                scales: {
                  x: { grid: { display: false }, ticks: { color: tcl, font: chartFont, maxRotation: 45, minRotation: 30 } },
                  y: {
                    stacked: true,
                    grid: { color: chartColors.grid },
                    ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN"), color: tcl, font: chartFont },
                  },
                },
              }} />
            </div>
          )}

          {/* Spending Distribution + Time-of-Day */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : (hasTimeData ? "1fr 1fr" : "1fr"), gap: isMobile ? 16 : 24, marginBottom: 24 }}>
            <div className="chart-card">
              <h3 style={{ fontFamily: "var(--font-display)" }}>Spending Distribution</h3>
              <Bar data={{
                labels: distRanges.map(r => r.label),
                datasets: [{ data: distData.map(d => d.count), backgroundColor: distColors, borderRadius: 6 }],
              }} options={{
                indexAxis: "y",
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => {
                        const d = distData[ctx.dataIndex];
                        const avg = d.count > 0 ? fmt(d.total / d.count) : "\u20B90";
                        return ` ${d.count} txns \u00B7 avg ${avg}`;
                      },
                    },
                    backgroundColor: "rgba(15,22,42,0.95)", padding: 12, cornerRadius: 8,
                  },
                },
                scales: {
                  x: { grid: { display: false }, ticks: { color: tcl, font: chartFont, stepSize: 1 } },
                  y: { grid: { display: false }, ticks: { color: tc, font: chartFont } },
                },
              }} />
            </div>
            {hasTimeData && (
              <div className="chart-card">
                <h3 style={{ fontFamily: "var(--font-display)" }}>When Do You Shop?</h3>
                <Bar data={{
                  labels: Object.keys(timeBuckets).map((k, i) => `${timeIcons[i]} ${k}`),
                  datasets: [{
                    data: Object.values(timeBuckets),
                    backgroundColor: Object.keys(timeBuckets).map((k, i) => k === dominantTime[0] ? timeColors[i] : timeColors[i] + "66"),
                    borderRadius: 6,
                  }],
                }} options={{
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => {
                          const pct = timeTotal > 0 ? ((ctx.raw / timeTotal) * 100).toFixed(0) : 0;
                          return ` ${fmt(ctx.raw)} \u00B7 ${pct}%`;
                        },
                      },
                      backgroundColor: "rgba(15,22,42,0.95)", padding: 12, cornerRadius: 8,
                    },
                  },
                  scales: {
                    x: { grid: { display: false }, ticks: { color: tc, font: chartFont } },
                    y: { grid: { color: chartColors.grid }, ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN"), color: tcl, font: chartFont } },
                  },
                }} />
                <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--bg-card-2)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--text-secondary)" }}>
                  {dominantTime[0]} accounts for {timeTotal > 0 ? ((dominantTime[1] / timeTotal) * 100).toFixed(0) : 0}% of spend
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Transactions Tab ──
function TransactionsTab({ transactions, onToggleReceipt, onSelect, isMobile }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  let filtered = transactions.filter((t) => {
    if (filter !== "all" && t.category !== filter) return false;
    if (search && !t.merchant.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (sortBy === "oldest") filtered = [...filtered].reverse();
  else if (sortBy === "amount-desc") filtered = [...filtered].sort((a, b) => b.amount - a.amount);
  else if (sortBy === "amount-asc") filtered = [...filtered].sort((a, b) => a.amount - b.amount);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: isMobile ? "1 1 100%" : "0 0 240px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" placeholder="Search merchant..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "8px 12px 8px 32px", border: "1px solid var(--border)", borderRadius: "var(--radius)",
              fontSize: 13, background: "var(--bg-card)", color: "var(--text)",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
            onFocus={(e) => { e.target.style.borderColor = "var(--brand)"; e.target.style.boxShadow = "0 0 0 3px var(--brand-subtle)"; }}
            onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
          />
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{
          padding: "8px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)",
          background: "var(--bg-card)", color: "var(--text)", fontSize: 12,
        }}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="amount-desc">Amount \u2193</option>
          <option value="amount-asc">Amount \u2191</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{filtered.length} transactions</span>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
        {[{ key: "all", label: "All", icon: null, color: null }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ key: k, label: v.label, icon: v.icon, color: v.color }))].map((cat) => (
          <button key={cat.key} onClick={() => setFilter(cat.key)} style={{
            padding: "6px 14px", borderRadius: 999, border: "1px solid",
            borderColor: filter === cat.key ? (cat.color || "var(--brand)") : "var(--border)",
            background: filter === cat.key ? ((cat.color || "var(--brand)") + "18") : "transparent",
            color: filter === cat.key ? (cat.color || "var(--brand)") : "var(--text-secondary)",
            fontSize: 11, fontWeight: filter === cat.key ? 600 : 500, whiteSpace: "nowrap",
            transition: "all 0.15s ease", flexShrink: 0,
          }}>
            {cat.icon && <span style={{ marginRight: 4 }}>{cat.icon}</span>}
            {cat.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {filtered.map((t) => {
          const cat = CATEGORIES[t.category] || CATEGORIES.other;
          const amtClass = t.amount >= 10000 ? "txn-amount-large" : t.amount >= 1000 ? "txn-amount-medium" : "txn-amount-small";
          return (
            <div key={t.id} onClick={() => onSelect(t)} className="txn-row" style={{ borderLeftColor: "transparent" }}
              onMouseOver={(e) => { e.currentTarget.style.borderLeftColor = cat.color; }}
              onMouseOut={(e) => { e.currentTarget.style.borderLeftColor = "transparent"; }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: cat.color + "22",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0,
              }}>{cat.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: -0.2 }}>{t.merchant}</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>{fmtDate(t.date)}</span>
                  {t.txnTime && <span style={{ color: "var(--text-muted)" }}>{fmtTime(t.txnTime)}</span>}
                  {t.isRefund && <span style={{ color: "var(--success)", fontWeight: 700, fontSize: 9, letterSpacing: 0.5, padding: "1px 6px", borderRadius: 999, background: "var(--success-bg)" }}>REFUND</span>}
                </div>
              </div>
              <div className={amtClass} style={{
                fontSize: 14, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", letterSpacing: -0.3,
                color: t.isRefund ? "var(--success)" : undefined,
                fontFamily: "var(--font-display)",
              }}>{t.isRefund ? "+" : ""}{fmt(t.amount)}</div>
              <button onClick={(e) => { e.stopPropagation(); onToggleReceipt(t.id); }}
                title={t.hasReceipt ? "Receipt attached" : "Mark receipt attached"}
                aria-label={t.hasReceipt ? "Receipt attached" : "Receipt missing"}
                style={{
                  width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)",
                  background: t.hasReceipt ? "var(--success)" : "var(--bg-card)",
                  color: t.hasReceipt ? "#fff" : "var(--text-muted)",
                  fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  transition: "all 0.15s",
                }}
              >{t.hasReceipt ? "\u2713" : "\u25CB"}</button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
            <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3, animation: "gentleBounce 2.5s ease-in-out infinite" }}>{"\uD83D\uDD0D"}</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>No transactions found</div>
            <div style={{ fontSize: 12 }}>Try different search or filter.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Receipts Tab ──
function ReceiptsTab({ transactions, onToggleReceipt, isMobile }) {
  const missing = transactions.filter((t) => !t.hasReceipt && !t.isRefund);
  const attached = transactions.filter((t) => t.hasReceipt);
  const total = transactions.filter(t => !t.isRefund).length;
  const pct = total > 0 ? Math.round((attached.length / total) * 100) : 0;

  return (
    <div>
      {/* Progress Header */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontFamily: "var(--font-display)", margin: 0 }}>Receipt Coverage</h3>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{pct}%</span>
        </div>
        <div className="receipt-progress-bar">
          <div className="receipt-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
          <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>{missing.length} Missing</span>
          <span style={{ fontSize: 13, color: "var(--success)", fontWeight: 600 }}>{attached.length} Attached</span>
        </div>
      </div>

      {missing.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--danger)" }}>Missing Receipts</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 24 }}>
            {missing.sort((a, b) => b.amount - a.amount).map((t) => {
              const tier = t.amount >= 10000 ? "receipt-row-high" : t.amount >= 1000 ? "receipt-row-medium" : "receipt-row-low";
              return (
                <div key={t.id} className={tier} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                  background: "var(--bg-card)", borderRadius: "var(--radius)",
                  transition: "background 0.15s",
                }}
                  onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseOut={(e) => e.currentTarget.style.background = "var(--bg-card)"}
                >
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{t.merchant}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{fmtDate(t.date)}</span>
                  </div>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt(t.amount)}</span>
                  <button onClick={() => onToggleReceipt(t.id)} style={{
                    padding: "7px 14px", borderRadius: 6, border: "1px solid var(--brand)",
                    background: "transparent", color: "var(--brand)", fontSize: 11, fontWeight: 600,
                    transition: "all 0.15s",
                  }}
                    onMouseOver={(e) => { e.currentTarget.style.background = "var(--brand)"; e.currentTarget.style.color = "#fff"; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--brand)"; }}
                  >Attach</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {attached.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--success)" }}>Attached ({attached.length})</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {attached.map((t) => (
              <div key={t.id} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "9px 14px",
                background: "var(--bg-card)", borderRadius: "var(--radius)",
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500, fontSize: 13, color: "var(--text)" }}>{t.merchant}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{fmtDate(t.date)}</span>
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
          transition: "all 0.15s",
        }}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "var(--bg-card)"; }}
        >{"\uD83D\uDCC4"} Export CSV</button>
      </div>

      <div className="chart-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 18, margin: 0 }}>Expense Report</h3>
          <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-card-2)", padding: "4px 12px", borderRadius: 20 }}>{period}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
          {[
            { l: "GROSS SPEND", v: fmt(totalSpend) },
            { l: "REFUNDS", v: fmt(totalRefunds), c: "var(--success)" },
            { l: "NET SPEND", v: fmt(totalSpend - totalRefunds) },
            { l: "MISSING RECEIPTS", v: missingReceipts.length, c: missingReceipts.length > 0 ? "var(--danger)" : undefined },
          ].map((it) => (
            <div key={it.l} style={{ padding: 14, background: "var(--bg-card-2)", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>{it.l}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: it.c || "var(--text)", letterSpacing: -0.3 }}>{it.v}</div>
            </div>
          ))}
        </div>

        <h4 style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--text)", letterSpacing: -0.2 }}>Category Breakdown</h4>
        <div style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 14px", background: "var(--bg-card-2)", fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            <span>Category</span><span style={{ textAlign: "right" }}>Amount</span><span style={{ textAlign: "right" }}>%</span><span style={{ textAlign: "right" }}>Count</span>
          </div>
          {catsSorted.map(([cat, total]) => {
            const info = CATEGORIES[cat] || CATEGORIES.other;
            const count = purchases.filter((t) => t.category === cat).length;
            return (
              <div key={cat} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 13, alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: info.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 500, color: "var(--text)" }}>{info.label}</span>
                </span>
                <span style={{ textAlign: "right", fontWeight: 600, color: "var(--text)" }}>{fmt(total)}</span>
                <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>{totalSpend > 0 ? ((total / totalSpend) * 100).toFixed(1) : 0}%</span>
                <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>{count}</span>
              </div>
            );
          })}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "8px 14px", borderTop: "2px solid var(--border-strong)", fontSize: 13, fontWeight: 700, background: "var(--bg-card-2)", color: "var(--text)" }}>
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
                    <span style={{ color: "var(--text-muted)" }}>{fmtDate(t.date)}</span>
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

// ── Subscriptions Tab ──
function SubscriptionsTab({ transactions, allTransactions, isMobile, chartColors = {} }) {
  const subs = (allTransactions || transactions).filter(t => t.category === "subscriptions" && !t.isRefund);

  const byMerchant = {};
  for (const t of subs) {
    if (!byMerchant[t.merchant]) byMerchant[t.merchant] = [];
    byMerchant[t.merchant].push(t);
  }

  const subsList = Object.entries(byMerchant).map(([merchant, txns]) => {
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
    const total = txns.reduce((s, t) => s + t.amount, 0);
    const avg = total / txns.length;
    const lastDate = sorted[sorted.length - 1].date;
    const firstDate = sorted[0].date;
    const daySpan = (new Date(lastDate) - new Date(firstDate)) / (1000 * 60 * 60 * 24);
    const freq = txns.length > 1 ? Math.round(daySpan / (txns.length - 1)) : 0;

    let cycle = "One-time";
    if (freq >= 25 && freq <= 35) cycle = "Monthly";
    else if (freq >= 80 && freq <= 100) cycle = "Quarterly";
    else if (freq >= 350 && freq <= 380) cycle = "Annual";
    else if (freq > 0 && txns.length >= 2) cycle = `~${freq} days`;

    let nextDate = null;
    if (freq > 0 && txns.length >= 2) {
      const last = new Date(lastDate + "T00:00:00");
      last.setDate(last.getDate() + freq);
      nextDate = last.toISOString().split("T")[0];
    }

    const monthlyEst = freq > 0 ? (avg / freq) * 30 : avg;
    return { merchant, count: txns.length, avg, total, freq, cycle, lastDate, firstDate, nextDate, monthlyEst };
  }).sort((a, b) => b.total - a.total);

  const totalMonthly = subsList.reduce((s, sub) => s + sub.monthlyEst, 0);
  const totalYearly = totalMonthly * 12;

  const tc = chartColors.text || "#374151";

  const getStatus = (sub) => {
    if (!sub.nextDate) return "unknown";
    const expected = new Date(sub.nextDate + "T00:00:00");
    const overdueDays = (new Date() - expected) / (1000 * 60 * 60 * 24);
    if (overdueDays > 15) return "possibly cancelled";
    return "active";
  };

  const getCycleBadge = (cycle) => {
    if (cycle === "Monthly") return "sub-badge sub-badge-monthly";
    if (cycle === "Annual" || cycle === "Yearly") return "sub-badge sub-badge-yearly";
    if (cycle === "One-time") return "sub-badge sub-badge-onetime";
    return "sub-badge sub-badge-unknown";
  };

  const getStatusBadge = (status) => {
    if (status === "active") return "sub-badge sub-badge-monthly";
    if (status === "possibly cancelled") return "sub-badge sub-badge-cancelled";
    return "sub-badge sub-badge-unknown";
  };

  // Group into confirmed recurring vs possibly one-time
  const recurring = subsList.filter(s => s.cycle === "Monthly" || s.cycle === "Annual" || s.cycle === "Quarterly" || (s.freq > 0 && s.count >= 2));
  const oneTime = subsList.filter(s => !recurring.includes(s));

  if (subs.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: isMobile ? "60px 16px" : "80px 20px" }}>
        <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.3, animation: "gentleBounce 2.5s ease-in-out infinite" }}>{"\uD83D\uDCF1"}</div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, marginBottom: 8, color: "var(--text)", letterSpacing: -0.3 }}>No subscriptions detected</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Subscription transactions will appear here once synced.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: isMobile ? 10 : 14, flexWrap: "wrap", marginBottom: 24 }}>
        <StatCard isMobile={isMobile} title="Active Subscriptions" value={subsList.length} sub="Detected" accent="#7C3AED" />
        <StatCard isMobile={isMobile} title="Est. Monthly" value={fmt(totalMonthly)} sub="Recurring" accent="#0EA5E9" />
        <div className="stat-card" style={{ borderLeft: "3px solid #EF4444", boxShadow: "var(--shadow), var(--shadow-glow)" }}>
          <div className="stat-card-title">Est. Yearly</div>
          <div className="stat-card-value">{fmt(totalYearly)}</div>
          <div className="stat-card-sub">Projected annual</div>
        </div>
        <StatCard isMobile={isMobile} title="Total Spent" value={fmt(subsList.reduce((s, sub) => s + sub.total, 0))} sub="All time" accent="#10B981" />
      </div>

      {/* Confirmed Recurring */}
      {recurring.length > 0 && (
        <div className="chart-card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontFamily: "var(--font-display)" }}>Confirmed Recurring</h3>
          {recurring.map((sub, i) => {
            const status = getStatus(sub);
            return (
              <div key={sub.merchant} style={{
                display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 0.8fr 1fr 1fr",
                padding: "14px 0", alignItems: "center", gap: isMobile ? 6 : 0,
                borderBottom: i < recurring.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", letterSpacing: -0.2 }}>{sub.merchant}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <span className={getCycleBadge(sub.cycle)}>{sub.cycle.toUpperCase()}</span>
                    <span className={getStatusBadge(status)}>{status === "active" ? "ACTIVE" : status === "possibly cancelled" ? "POSSIBLY CANCELLED" : "UNKNOWN"}</span>
                  </div>
                </div>
                {!isMobile && (
                  <>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{fmt(sub.avg)}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>per charge</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>{sub.count}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>payments</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{fmt(sub.total)}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>total</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{sub.nextDate ? fmtDate(sub.nextDate) : "\u2014"}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>next expected</div>
                    </div>
                  </>
                )}
                {isMobile && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--text-secondary)" }}>{fmt(sub.avg)}/charge \u00B7 {sub.count} payments</span>
                    <span style={{ fontWeight: 700, color: "var(--text)" }}>{fmt(sub.total)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Possibly One-Time */}
      {oneTime.length > 0 && (
        <div className="chart-card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontFamily: "var(--font-display)" }}>Possibly One-Time</h3>
          {oneTime.map((sub, i) => (
            <div key={sub.merchant} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 0",
              borderBottom: i < oneTime.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{sub.merchant}</div>
                <span className="sub-badge sub-badge-onetime">{sub.cycle.toUpperCase()}</span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--text)" }}>{fmt(sub.total)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Monthly cost donut */}
      {subsList.length > 1 && (
        <div className="chart-card">
          <h3 style={{ fontFamily: "var(--font-display)" }}>Monthly Cost Breakdown</h3>
          <div style={{ maxWidth: isMobile ? 220 : 280, margin: "0 auto" }}>
            <Doughnut data={{
              labels: subsList.map(s => s.merchant),
              datasets: [{
                data: subsList.map(s => Math.round(s.monthlyEst)),
                backgroundColor: ["#7C3AED", "#0EA5E9", "#EF4444", "#F59E0B", "#10B981", "#64748B", "#607D8B", "#795548"].slice(0, subsList.length),
                borderWidth: 3, borderColor: "var(--bg-card)",
              }],
            }} options={{
              cutout: "68%",
              plugins: {
                legend: { position: "bottom", labels: { boxWidth: 12, padding: 12, color: tc, font: { size: 12, weight: "600" }, usePointStyle: true } },
                tooltip: {
                  callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}/mo` },
                  backgroundColor: "rgba(15,22,42,0.95)", padding: 12, cornerRadius: 8,
                },
              },
            }} />
          </div>
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>
              {fmt(totalMonthly)}<span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}> /mo</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings Tab ──
function SettingsTab({ session, isMobile }) {
  const [avatarUrl, setAvatarUrl] = useState(session?.user?.image || null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const fileInputRef = useRef(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState({ text: "", type: "" });

  const handleAvatarUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg("");
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/avatar", { method: "POST", body: formData });
      const data = await res.json();
      if (data.avatar_url) {
        setAvatarUrl(data.avatar_url);
        setUploadMsg("Avatar updated!");
      } else {
        setUploadMsg(data.error || "Upload failed");
      }
    } catch {
      setUploadMsg("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => setUploadMsg(""), 3000);
    }
  }, []);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPwMsg({ text: "", type: "" });

    if (newPassword.length < 8) {
      setPwMsg({ text: "Password must be at least 8 characters", type: "error" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ text: "Passwords do not match", type: "error" });
      return;
    }

    setPwSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPwMsg({ text: "Password changed successfully", type: "success" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPwMsg({ text: data.error || "Failed to change password", type: "error" });
      }
    } catch {
      setPwMsg({ text: "Failed to change password", type: "error" });
    }
    setPwSaving(false);
  };

  const user = session?.user;
  const inputStyle = {
    width: "100%", padding: "10px 12px", borderRadius: "var(--radius)",
    border: "1px solid var(--border)", background: "var(--bg-card)",
    color: "var(--text)", fontSize: 14,
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Avatar Section */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontFamily: "var(--font-display)" }}>Profile</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }}>
          <div style={{ position: "relative" }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--border)" }} referrerPolicy="no-referrer" />
            ) : (
              <div style={{
                width: 72, height: 72, borderRadius: "50%", background: "var(--brand)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700,
                border: "3px solid var(--border)",
              }}>
                {user?.name?.[0]?.toUpperCase() || "?"}
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                position: "absolute", bottom: -2, right: -2, width: 28, height: 28,
                borderRadius: "50%", background: "var(--brand)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, border: "2px solid var(--bg-card)", cursor: "pointer",
              }}
              aria-label="Change avatar"
            >
              {uploading ? "..." : "\u270F\uFE0F"}
            </button>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{user?.name || "User"}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{user?.email}</div>
            {uploadMsg && (
              <div style={{ fontSize: 12, marginTop: 4, color: uploadMsg.includes("fail") ? "var(--danger)" : "var(--success)", fontWeight: 500 }}>
                {uploadMsg}
              </div>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={handleAvatarUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            padding: "8px 18px", borderRadius: "var(--radius)", border: "1px solid var(--border)",
            background: "var(--bg-card)", color: "var(--text)", fontSize: 13, fontWeight: 500,
            transition: "all 0.15s", opacity: uploading ? 0.6 : 1,
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "var(--bg-card)"; }}
        >
          {uploading ? "Uploading..." : "Change Avatar"}
        </button>
      </div>

      {/* Password Section */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontFamily: "var(--font-display)" }}>Change Password</h3>
        <form onSubmit={handlePasswordChange} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              style={inputStyle}
              autoComplete="current-password"
              onFocus={(e) => { e.target.style.borderColor = "var(--brand)"; e.target.style.boxShadow = "0 0 0 3px var(--brand-subtle)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Min 8 characters"
              style={inputStyle}
              autoComplete="new-password"
              onFocus={(e) => { e.target.style.borderColor = "var(--brand)"; e.target.style.boxShadow = "0 0 0 3px var(--brand-subtle)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              style={inputStyle}
              autoComplete="new-password"
              onFocus={(e) => { e.target.style.borderColor = "var(--brand)"; e.target.style.boxShadow = "0 0 0 3px var(--brand-subtle)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
            />
          </div>
          {pwMsg.text && (
            <div style={{ fontSize: 12, fontWeight: 500, color: pwMsg.type === "error" ? "var(--danger)" : "var(--success)" }}>
              {pwMsg.type === "error" ? "\u2717 " : "\u2713 "}{pwMsg.text}
            </div>
          )}
          <button type="submit" disabled={pwSaving} style={{
            padding: "10px 20px", borderRadius: "var(--radius)", border: "none",
            background: pwSaving ? "var(--bg-card-2)" : "var(--brand)", color: "#fff",
            fontSize: 14, fontWeight: 600, alignSelf: "flex-start",
            opacity: pwSaving ? 0.7 : 1, transition: "all 0.15s",
          }}>
            {pwSaving ? "Saving..." : "Update Password"}
          </button>
        </form>
      </div>

      {/* Sign Out */}
      <div className="chart-card">
        <h3 style={{ fontFamily: "var(--font-display)" }}>Account</h3>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{
            padding: "10px 20px", borderRadius: "var(--radius)", border: "1px solid var(--danger)",
            background: "transparent", color: "var(--danger)", fontSize: 14, fontWeight: 600,
            transition: "all 0.15s",
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--danger)"; e.currentTarget.style.color = "#fff"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--danger)"; }}
        >
          Sign Out
        </button>
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
  const [gmailStatus, setGmailStatus] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [activePreset, setActivePreset] = useState(null);
  const [toasts, setToasts] = useState([]);
  const isMobile = useIsMobile();

  const addToast = useCallback((message, type = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);

  const transactions = useMemo(() => allTransactions.filter((t) => {
    if (t.amount < 10) return false;
    if (startDate && t.date < startDate) return false;
    if (endDate && t.date > endDate) return false;
    return true;
  }), [allTransactions, startDate, endDate]);

  const missingReceipts = useMemo(() => transactions.filter(t => !t.hasReceipt && !t.isRefund).length, [transactions]);

  const handlePreset = useCallback((d) => {
    setActivePreset(d);
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
    } catch {
      setMessage("Could not load transactions.");
    }
  }, []);

  const backfillRan = useRef(false);
  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/transactions/claim", { method: "POST" })
        .then(() => loadTransactions()).catch(() => loadTransactions());
      fetch("/api/gmail/status")
        .then((r) => r.json())
        .then(setGmailStatus)
        .catch(() => setGmailStatus({ connected: false, reason: "fetch_failed", detail: "Could not reach status endpoint" }));
    }
  }, [status, loadTransactions]);

  useEffect(() => {
    if (backfillRan.current || allTransactions.length === 0) return;
    const missingTime = allTransactions.some(t => !t.txnTime);
    if (!missingTime) return;
    backfillRan.current = true;
    fetch("/api/transactions/backfill-time", { method: "POST" })
      .then(r => r.json())
      .then(d => { if (d.updated > 0) loadTransactions(); })
      .catch(() => {});
  }, [allTransactions, loadTransactions]);

  const pollRef = useRef(null);
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setMessage("Syncing...");
    addToast("Sync started...", "info");
    fetch("/api/sync", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error && !d.error.includes("already")) {
          setMessage("Sync failed.");
          addToast("Sync failed", "error");
        } else {
          setMessage(d.message || "Done!");
          addToast("Sync complete!", "success");
          loadTransactions();
        }
        setSyncing(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      })
      .catch(() => { setMessage("Sync failed."); addToast("Sync failed", "error"); setSyncing(false); });
    pollRef.current = setInterval(() => loadTransactions(), 60000);
    setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, 5 * 60 * 1000);
  }, [loadTransactions, addToast]);

  const handleToggleReceipt = useCallback((id) => {
    setAllTransactions((prev) => {
      const up = prev.map((t) => t.id === id ? { ...t, hasReceipt: !t.hasReceipt } : t);
      const tgt = up.find((t) => t.id === id);
      fetch("/api/transactions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, hasReceipt: tgt.hasReceipt }) });
      addToast(tgt.hasReceipt ? "Receipt attached" : "Receipt removed", "success");
      return up;
    });
  }, [addToast]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-page)" }}>
        <div style={{ color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTopColor: "var(--brand)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          <span style={{ fontSize: 13 }}>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Sidebar — desktop only */}
      {!isMobile && (
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          gmailStatus={gmailStatus}
          onSync={handleSync}
          syncing={syncing}
          missingReceipts={missingReceipts}
          session={session}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}

      {/* Mobile Header */}
      {isMobile && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Image src="/vippy-logo.webp" alt="Vippy" width={28} height={28} priority style={{ borderRadius: 6, objectFit: "contain" }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: -0.5 }}>Vippy</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={handleSync} disabled={syncing} style={{
              padding: "6px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)",
              background: "var(--bg-card)", color: "var(--text)", fontSize: 11, fontWeight: 500,
            }}>{syncing ? "..." : "Sync"}</button>
            <button onClick={toggleTheme} style={{ background: "none", border: "none", fontSize: 16, color: "var(--text-muted)" }}>
              {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main id="main-content" className="main-with-sidebar" style={isMobile ? { marginLeft: 0, padding: "16px 14px 80px" } : {}}>
        {/* Page Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? 22 : 28, fontWeight: 800, color: "var(--text)", letterSpacing: -0.8 }}>
            {activeTab === "overview" ? "Overview" : activeTab === "transactions" ? "Transactions" : activeTab === "receipts" ? "Receipts" : activeTab === "subscriptions" ? "Subscriptions" : activeTab === "settings" ? "Settings" : "Reports"}
          </h1>
          {message && (
            <span style={{ fontSize: 11, color: message.includes("fail") ? "var(--danger)" : "var(--success)", fontWeight: 500 }}>
              {message}
            </span>
          )}
        </div>

        {allTransactions.length === 0 && !syncing && !message ? (
          <div style={{ textAlign: "center", padding: isMobile ? "60px 16px" : "80px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.3, animation: "gentleBounce 2.5s ease-in-out infinite" }}>{"\uD83D\uDCCA"}</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, marginBottom: 10, color: "var(--text)", letterSpacing: -0.3 }}>No transactions yet</h2>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>Click Sync to fetch your expenses.</p>
            <button onClick={handleSync} style={{
              padding: "10px 24px", borderRadius: "var(--radius)", border: "none",
              background: "var(--brand)", color: "#fff", fontSize: 14, fontWeight: 600,
            }}>Sync Gmail</button>
          </div>
        ) : (
          <>
            {syncing && (
              <div style={{
                padding: "9px 14px", background: "var(--bg-card-2)", border: "1px solid var(--border)",
                borderRadius: "var(--radius)", marginBottom: 14, fontSize: 12, color: "var(--text-secondary)",
              }}>Sync in progress...</div>
            )}

            <PeriodSelector startDate={startDate} endDate={endDate}
              onStartChange={(v) => { setStartDate(v); setActivePreset(null); }}
              onEndChange={(v) => { setEndDate(v); setActivePreset(null); }}
              onPreset={handlePreset} isMobile={isMobile} activePreset={activePreset} />

            {transactions.length === 0 && allTransactions.length > 0 ? (
              <div style={{ textAlign: "center", padding: 48 }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3, animation: "gentleBounce 2.5s ease-in-out infinite" }}>{"\uD83D\uDCC5"}</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>No transactions in this range</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Try adjusting the date period.</div>
              </div>
            ) : (
              <div key={activeTab} role="tabpanel" style={{ animation: "slideUp 0.2s ease" }}>
                {activeTab === "overview" && <OverviewTab transactions={transactions} isMobile={isMobile} chartColors={chartColors} />}
                {activeTab === "transactions" && <TransactionsTab transactions={transactions} onToggleReceipt={handleToggleReceipt} onSelect={setSelectedTxn} isMobile={isMobile} />}
                {activeTab === "receipts" && <ReceiptsTab transactions={transactions} onToggleReceipt={handleToggleReceipt} isMobile={isMobile} />}
                {activeTab === "subscriptions" && <SubscriptionsTab transactions={transactions} allTransactions={allTransactions} isMobile={isMobile} chartColors={chartColors} />}
                {activeTab === "reports" && <ReportsTab transactions={transactions} startDate={startDate} endDate={endDate} isMobile={isMobile} />}
                {activeTab === "settings" && <SettingsTab session={session} isMobile={isMobile} />}
              </div>
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      {isMobile && <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} missingReceipts={missingReceipts} />}

      <TransactionModal transaction={selectedTxn} onClose={() => setSelectedTxn(null)}
        onUpdateNotes={(id, notes) => setAllTransactions((p) => p.map((t) => t.id === id ? { ...t, userNotes: notes } : t))} />

      <ToastContainer toasts={toasts} />
    </>
  );
}
