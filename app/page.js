"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, LineElement, PointElement, LineController, Filler } from "chart.js";
import { Doughnut, Bar, Line } from "react-chartjs-2";
import OverviewTab from "./components/overview/OverviewTab";
import SubscriptionsTab from "./components/subscriptions/SubscriptionsTab";
import TransactionsTab from "./components/transactions/TransactionsTab";
import ReportsTab from "./components/reports/ReportsTab";
import SettingsTab from "./components/settings/SettingsTab";

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
function Sidebar({ activeTab, onTabChange, gmailStatus, onSync, syncing, session, theme, onToggleTheme }) {
  const tabs = [
    { key: "overview", label: "Overview", icon: "\uD83D\uDCCA" },
    { key: "transactions", label: "Transactions", icon: "\uD83D\uDCB3" },
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
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {gmailStatus && (
          <div className="sidebar-sync-status" title={gmailStatus.connected ? `${gmailStatus.email} (${gmailStatus.totalMessages?.toLocaleString() ?? "?"} messages)` : `${gmailStatus.reason}: ${gmailStatus.detail}`}>
            <span className="sidebar-sync-dot" style={{ background: gmailStatus.connected ? "var(--success)" : "var(--danger)" }} />
            <span>{gmailStatus.connected ? "Gmail synced" : "Gmail disconnected"}</span>
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
function MobileTabBar({ activeTab, onTabChange }) {
  const tabs = [
    { key: "overview", label: "Overview", icon: "\uD83D\uDCCA" },
    { key: "transactions", label: "Txns", icon: "\uD83D\uDCB3" },
    { key: "subscriptions", label: "Subs", icon: "\uD83D\uDD04" },
    { key: "reports", label: "Reports", icon: "\uD83D\uDCC8" },
    { key: "settings", label: "Settings", icon: "\u2699\uFE0F" },
  ];

  return (
    <div className="mobile-tab-bar">
      <div className="mobile-tab-bar-inner">
        {tabs.map((tab) => (
          <button key={tab.key} className={`mobile-tab-item ${activeTab === tab.key ? "active" : ""}`} onClick={() => onTabChange(tab.key)}>
            <span className="mobile-tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Transaction Detail Modal ──
function TransactionModal({ transaction: t, onClose, onUpdateNotes, onRenameMerchant, matchCount }) {
  const [userNotes, setUserNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameStatus, setRenameStatus] = useState("");
  const modalRef = useRef(null);

  useEffect(() => { if (t) setUserNotes(t.userNotes || ""); }, [t]);
  useEffect(() => { if (t) { setEditingName(false); setDraftName(t.merchant || ""); setRenameStatus(""); } }, [t]);
  useEffect(() => { if (t) modalRef.current?.focus(); }, [t]);
  if (!t) return null;
  const cat = CATEGORIES[t.category] || CATEGORIES.other;

  const handleRename = async () => {
    const next = draftName.trim();
    if (!next || next === t.merchant) { setEditingName(false); return; }
    setRenaming(true);
    setRenameStatus("");
    try {
      const res = await fetch("/api/transactions/rename", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: t.merchant, to: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rename failed");
      onRenameMerchant(t.merchant, next);
      setRenameStatus(`Renamed ${data.updated} txn${data.updated === 1 ? "" : "s"}`);
      setEditingName(false);
      setTimeout(() => setRenameStatus(""), 2500);
    } catch (err) {
      setRenameStatus(err.message || "Error");
    }
    setRenaming(false);
  };

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
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingName ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") { setEditingName(false); setDraftName(t.merchant || ""); }
                  }}
                  maxLength={80}
                  disabled={renaming}
                  style={{
                    flex: 1, padding: "4px 8px", fontSize: 16, fontWeight: 700,
                    border: "1px solid var(--brand)", borderRadius: 6,
                    background: "var(--bg-card)", color: "var(--text)",
                    fontFamily: "var(--font-display)", letterSpacing: -0.3,
                  }}
                />
                <button onClick={handleRename} disabled={renaming} style={{
                  padding: "4px 10px", borderRadius: 6, border: "none",
                  background: "var(--brand)", color: "#fff", fontSize: 11, fontWeight: 600,
                }}>{renaming ? "..." : "Save"}</button>
                <button onClick={() => { setEditingName(false); setDraftName(t.merchant || ""); }} disabled={renaming} style={{
                  padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)",
                  background: "var(--bg-card-2)", color: "var(--text-muted)", fontSize: 11,
                }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div id="modal-title" style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, color: "var(--text)", letterSpacing: -0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.merchant}</div>
                <button
                  onClick={() => { setEditingName(true); setDraftName(t.merchant || ""); }}
                  title={matchCount > 1 ? `Rename all ${matchCount} transactions at this merchant` : "Rename merchant"}
                  aria-label="Rename merchant"
                  style={{
                    padding: "2px 6px", borderRadius: 5, border: "1px solid var(--border)",
                    background: "var(--bg-card-2)", color: "var(--text-muted)",
                    fontSize: 11, fontWeight: 500, cursor: "pointer", lineHeight: 1,
                  }}
                >{"✎"} Rename{matchCount > 1 ? ` (${matchCount})` : ""}</button>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: cat.color + "22", color: cat.color }}>{cat.label}</span>
              {renameStatus && (
                <span style={{ fontSize: 11, color: renameStatus.startsWith("Renamed") ? "var(--success)" : "var(--danger)" }}>{renameStatus}</span>
              )}
            </div>
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
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{"\u2013"}</span>
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
// ── Map Supabase rows ──
function mapRows(rows) {
  return rows.map((r) => ({
    id: r.id, merchant: r.merchant, amount: r.amount, date: r.date,
    category: r.category, itemDescription: r.item_description,
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
            {activeTab === "overview" ? "Overview" : activeTab === "transactions" ? "Transactions" : activeTab === "subscriptions" ? "Subscriptions" : activeTab === "settings" ? "Settings" : "Reports"}
          </h1>
          {message && (
            <span style={{ fontSize: 11, color: message.includes("fail") ? "var(--danger)" : "var(--success)", fontWeight: 500 }}>
              {message}
            </span>
          )}
        </div>

        {/* Gmail disconnected banner \u2014 root cause of sync failures */}
        {gmailStatus && !gmailStatus.connected && (
          <div style={{
            padding: "14px 18px", background: "var(--danger-bg)", borderRadius: "var(--radius-lg)",
            border: "1px solid var(--danger)", marginBottom: 24,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>{"\u26A0\uFE0F"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>Gmail sync is disconnected</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                <strong>Reason:</strong> {gmailStatus.reason} \u2014 {gmailStatus.detail}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Transactions will not sync until reconnected. Sign out and sign in with Google again to refresh the token.
              </div>
            </div>
          </div>
        )}

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
                {activeTab === "overview" && <OverviewTab transactions={transactions} allTransactions={allTransactions} startDate={startDate} endDate={endDate} isMobile={isMobile} chartColors={chartColors} onSelect={setSelectedTxn} />}
                {activeTab === "transactions" && <TransactionsTab transactions={transactions} allTransactions={allTransactions} startDate={startDate} endDate={endDate} onSelect={setSelectedTxn} isMobile={isMobile} />}
                {activeTab === "subscriptions" && <SubscriptionsTab transactions={transactions} allTransactions={allTransactions} isMobile={isMobile} chartColors={chartColors} />}
                {activeTab === "reports" && <ReportsTab transactions={transactions} allTransactions={allTransactions} startDate={startDate} endDate={endDate} isMobile={isMobile} />}
                {activeTab === "settings" && <SettingsTab session={session} isMobile={isMobile} />}
              </div>
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      {isMobile && <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} />}

      <TransactionModal transaction={selectedTxn} onClose={() => setSelectedTxn(null)}
        onUpdateNotes={(id, notes) => setAllTransactions((p) => p.map((t) => t.id === id ? { ...t, userNotes: notes } : t))}
        onRenameMerchant={(from, to) => {
          setAllTransactions((p) => p.map((t) => t.merchant === from ? { ...t, merchant: to } : t));
          setSelectedTxn((s) => s && s.merchant === from ? { ...s, merchant: to } : s);
        }}
        matchCount={selectedTxn ? allTransactions.filter((t) => t.merchant === selectedTxn.merchant).length : 0} />

      <ToastContainer toasts={toasts} />
    </>
  );
}
