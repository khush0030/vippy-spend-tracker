"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import OverviewTab from "./components/overview/OverviewTab";
import SubscriptionsTab from "./components/subscriptions/SubscriptionsTab";
import TransactionsTab from "./components/transactions/TransactionsTab";
import ReportsTab from "./components/reports/ReportsTab";
import ReceiptsTab from "./components/receipts/ReceiptsTab";
import SettingsTab from "./components/settings/SettingsTab";
import Icon from "./components/ui/Icon";
import { Banner, Button, Chip, Empty, MerchantAvatar, Segmented, Sheet } from "./components/ui/kit";
import { colorOf, labelOf, fmtINR, normalizeMerchant } from "./components/overview/aggregations";
import { chartPalette } from "./components/ui/chart-theme";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return `${DAYS_SHORT[dt.getDay()]}, ${dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
};
const fmtTime = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
};

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const c = () => setM(window.innerWidth < 768);
    c();
    window.addEventListener("resize", c);
    return () => window.removeEventListener("resize", c);
  }, []);
  return m;
}

function useTheme() {
  const [theme, setTheme] = useState("light");
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
  return { theme, toggle };
}

// Tabs that answer to the statement cycle rather than the date picker, so they
// render whether or not the chosen period happens to contain transactions.
const CYCLE_SCOPED_TABS = new Set(["receipts", "settings"]);

const TABS = [
  { key: "overview", label: "Overview", short: "Home", icon: "home" },
  { key: "transactions", label: "Transactions", short: "Txns", icon: "list" },
  { key: "receipts", label: "Receipts", short: "Receipts", icon: "receipt" },
  { key: "subscriptions", label: "Subscriptions", short: "Subs", icon: "repeat" },
  { key: "reports", label: "Reports", short: "Reports", icon: "chart" },
  { key: "settings", label: "Settings", short: "Settings", icon: "gear" },
];
const MOBILE_TABS = ["overview", "transactions", "receipts", "reports"];
const TAB_BY_KEY = Object.fromEntries(TABS.map((t) => [t.key, t]));

const PRESETS = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
  { value: 365, label: "1Y" },
  { value: 0, label: "All" },
];

function relTime(iso) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function SyncStatus({ gmailStatus, syncing }) {
  if (syncing) return <span className="sync-status"><span className="dot busy" />Syncing Gmail…</span>;
  if (!gmailStatus) return <span className="sync-status"><span className="dot busy" />Checking Gmail…</span>;
  if (!gmailStatus.connected) return <span className="sync-status"><span className="dot bad" />Gmail disconnected</span>;
  const when = relTime(gmailStatus.lastSyncedAt);
  return (
    <span className="sync-status" title={gmailStatus.email}>
      <span className="dot" />
      Gmail synced{when ? ` · ${when}` : ""}
    </span>
  );
}

function UserAvatar({ session }) {
  const img = session?.user?.image;
  return (
    <span className="avatar">
      {img ? <img src={img} alt="" referrerPolicy="no-referrer" /> : session?.user?.name?.[0]?.toUpperCase() || "?"}
    </span>
  );
}

function Sidebar({ activeTab, onTabChange, gmailStatus, onSync, syncing, session, theme, onToggleTheme, counts }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Image src="/vippy-logo.webp" alt="" width={32} height={32} priority />
        <div>
          <b>Vippy Spend</b>
          <small>HDFC Corporate card</small>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`nav-item${activeTab === tab.key ? " active" : ""}`}
            onClick={() => onTabChange(tab.key)}
            aria-current={activeTab === tab.key ? "page" : undefined}
          >
            <Icon name={tab.icon} size={18} />
            {tab.label}
            {counts[tab.key] > 0 && <span className="nav-count" aria-label={`${counts[tab.key]} need attention`}>{counts[tab.key]}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <SyncStatus gmailStatus={gmailStatus} syncing={syncing} />
        <Button icon="sync" onClick={onSync} disabled={syncing} block>
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
        <div className="user-chip">
          <UserAvatar session={session} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {session?.user?.name?.split(" ")[0] || "You"}
          </span>
          <Button variant="ghost" size="sm" icon={theme === "dark" ? "sun" : "moon"} onClick={onToggleTheme} aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"} />
        </div>
      </div>
    </aside>
  );
}

function MobileTabBar({ activeTab, onTabChange, onMore, counts }) {
  const moreActive = !MOBILE_TABS.includes(activeTab);
  return (
    <nav className="tabbar" aria-label="Main navigation">
      {MOBILE_TABS.map((key) => {
        const tab = TAB_BY_KEY[key];
        return (
          <button key={key} className={`tab-item${activeTab === key ? " active" : ""}`} onClick={() => onTabChange(key)} aria-current={activeTab === key ? "page" : undefined}>
            <Icon name={tab.icon} size={21} />
            {tab.short}
            {counts[key] > 0 && <span className="nav-count">{counts[key]}</span>}
          </button>
        );
      })}
      <button className={`tab-item${moreActive ? " active" : ""}`} onClick={onMore}>
        <Icon name="more" size={21} />
        More
      </button>
    </nav>
  );
}

function MoreSheet({ open, onClose, onTabChange, theme, onToggleTheme, session, gmailStatus, syncing }) {
  return (
    <Sheet open={open} onClose={onClose} title={session?.user?.name || "More"} subtitle={session?.user?.email} leading={<UserAvatar session={session} />} labelledBy="more-title">
      <div className="card flush">
        {["subscriptions", "settings"].map((key) => (
          <button key={key} className="list-row" onClick={() => { onTabChange(key); onClose(); }}>
            <Icon name={TAB_BY_KEY[key].icon} />
            <span className="grow title">{TAB_BY_KEY[key].label}</span>
            <Icon name="chevronRight" size={16} className="muted" />
          </button>
        ))}
        <button className="list-row" onClick={onToggleTheme}>
          <Icon name={theme === "dark" ? "sun" : "moon"} />
          <span className="grow title">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
        </button>
      </div>
      <SyncStatus gmailStatus={gmailStatus} syncing={syncing} />
      <Button variant="danger" icon="logout" block onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</Button>
    </Sheet>
  );
}

function TransactionSheet({ transaction: t, onClose, onUpdateNotes, onRenameMerchant, matchCount }) {
  const [userNotes, setUserNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameStatus, setRenameStatus] = useState("");

  useEffect(() => {
    if (!t) return;
    setUserNotes(t.userNotes || "");
    setEditingName(false);
    setDraftName(t.merchant || "");
    setRenameStatus("");
    setSaveStatus("");
  }, [t]);

  const close = useCallback(() => onClose(), [onClose]);
  if (!t) return null;
  const color = colorOf(t.category);

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
      setRenameStatus(`Renamed ${data.updated} transaction${data.updated === 1 ? "" : "s"}`);
      setEditingName(false);
    } catch (err) {
      setRenameStatus(err.message || "Rename failed");
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
      if (!res.ok) throw new Error();
      onUpdateNotes(t.id, userNotes);
      setSaveStatus("Note saved");
    } catch {
      setSaveStatus("Could not save the note — try again");
    }
    setSaving(false);
  };

  return (
    <Sheet
      open
      onClose={close}
      title={normalizeMerchant(t.merchant)}
      subtitle={`${labelOf(t.category)} · ${fmtDate(t.date)}`}
      leading={<MerchantAvatar name={normalizeMerchant(t.merchant)} color={color} />}
      labelledBy="txn-title"
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="num" style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.03em", color: t.isRefund ? "var(--success)" : "var(--text)" }}>
          {t.isRefund ? "+" : ""}{fmtINR(t.amount)}
        </span>
        {t.isRefund && <Chip tone="ok">Refund</Chip>}
      </div>

      <dl className="kv-list">
        <div><dt>Date</dt><dd>{fmtDate(t.date)}</dd></div>
        <div><dt>Time</dt><dd className="num">{t.txnTime ? fmtTime(t.txnTime) : "Not in the bank alert"}</dd></div>
        <div><dt>Category</dt><dd><Chip>{labelOf(t.category)}</Chip></dd></div>
        {t.itemDescription && <div><dt>Item</dt><dd>{t.itemDescription}</dd></div>}
        <div>
          <dt>Merchant as billed</dt>
          <dd>
            {editingName ? (
              <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <input
                  className="input"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") { e.stopPropagation(); setEditingName(false); }
                  }}
                  maxLength={80}
                  disabled={renaming}
                  style={{ height: 32, maxWidth: 220 }}
                  aria-label="New merchant name"
                />
                <Button size="sm" variant="primary" onClick={handleRename} disabled={renaming}>{renaming ? "…" : "Save"}</Button>
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {t.merchant}
                <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditingName(true)} title={matchCount > 1 ? `Renames all ${matchCount} transactions at this merchant` : "Rename merchant"}>
                  {matchCount > 1 ? `Rename all ${matchCount}` : "Rename"}
                </Button>
              </span>
            )}
          </dd>
        </div>
      </dl>
      {renameStatus && <div className="small" style={{ color: renameStatus.startsWith("Renamed") ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{renameStatus}</div>}

      {t.notes && (
        <div style={{ padding: 12, borderRadius: "var(--radius-md)", background: "var(--brand-subtle)" }}>
          <div className="label" style={{ color: "var(--brand-strong-text)", display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <Icon name="sparkle" size={13} /> What this looks like
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" }}>{t.notes}</div>
        </div>
      )}

      <label className="field" htmlFor="user-notes">
        <span>Your note</span>
        <textarea id="user-notes" className="input" rows={3} value={userNotes} onChange={(e) => setUserNotes(e.target.value)} placeholder="Client, project, or why this was spent" />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button variant="primary" onClick={handleSaveNotes} disabled={saving}>{saving ? "Saving…" : "Save note"}</Button>
        {saveStatus && <span className="small" style={{ fontWeight: 600, color: saveStatus === "Note saved" ? "var(--success)" : "var(--danger)" }}>{saveStatus}</span>}
      </div>

      {t.rawEmail && (
        <details>
          <summary className="small muted" style={{ cursor: "pointer", fontWeight: 600 }}>Original bank alert</summary>
          <pre className="num" style={{ marginTop: 8, fontSize: 11.5, whiteSpace: "pre-wrap", color: "var(--text-secondary)", background: "var(--bg-card-2)", padding: 10, borderRadius: 8 }}>{t.rawEmail}</pre>
        </details>
      )}
    </Sheet>
  );
}

function PeriodSelector({ startDate, endDate, onStartChange, onEndChange, onPreset, activePreset, isMobile }) {
  const [custom, setCustom] = useState(false);
  const options = [...PRESETS, { value: "custom", label: "Custom" }];
  const value = custom || (activePreset === null && (startDate || endDate)) ? "custom" : activePreset;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
      <Segmented
        label="Period"
        options={options}
        value={value}
        onChange={(v) => {
          if (v === "custom") { setCustom(true); return; }
          setCustom(false);
          onPreset(v);
        }}
      />
      {value === "custom" && (
        <span style={{ display: "flex", gap: 6, alignItems: "center", flex: isMobile ? "1 1 100%" : "none" }}>
          <input type="date" className="input num" aria-label="Start date" value={startDate} onChange={(e) => onStartChange(e.target.value)} style={{ height: 34, width: isMobile ? "100%" : 150, fontSize: 13 }} />
          <span className="muted">–</span>
          <input type="date" className="input num" aria-label="End date" value={endDate} onChange={(e) => onEndChange(e.target.value)} style={{ height: 34, width: isMobile ? "100%" : 150, fontSize: 13 }} />
        </span>
      )}
    </div>
  );
}

function mapRows(rows) {
  return rows.map((r) => ({
    id: r.id, merchant: r.merchant, amount: r.amount, date: r.date,
    category: r.category, itemDescription: r.item_description,
    isRefund: r.is_refund || false, notes: r.notes || null, txnTime: r.txn_time || null,
    userNotes: r.user_notes || "", rawEmail: r.raw_email,
  }));
}

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();
  const chartColors = useMemo(() => chartPalette(theme), [theme]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [gmailStatus, setGmailStatus] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [activePreset, setActivePreset] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [receiptSummary, setReceiptSummary] = useState(null);
  const isMobile = useIsMobile();

  const addToast = useCallback((text, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message: text, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);

  const changeTab = useCallback((key) => {
    setActiveTab(key);
    window.scrollTo({ top: 0 });
  }, []);

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
      setMessage("Could not load transactions. Check your connection and reload.");
    }
    setLoaded(true);
  }, []);

  const loadReceiptSummary = useCallback(() => {
    fetch("/api/receipts")
      .then((r) => r.json())
      .then((d) => setReceiptSummary(d?.cycle ? d : null))
      .catch(() => {});
  }, []);

  const backfillRan = useRef(false);
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/transactions/claim", { method: "POST" })
      .then(() => loadTransactions()).catch(() => loadTransactions());
    fetch("/api/gmail/status")
      .then((r) => r.json())
      .then(setGmailStatus)
      .catch(() => setGmailStatus({ connected: false, reason: "fetch_failed", detail: "Could not reach the status endpoint" }));
    loadReceiptSummary();
  }, [status, loadTransactions, loadReceiptSummary]);

  useEffect(() => {
    if (backfillRan.current || allTransactions.length === 0) return;
    if (!allTransactions.some((t) => !t.txnTime)) return;
    backfillRan.current = true;
    fetch("/api/transactions/backfill-time", { method: "POST" })
      .then((r) => r.json())
      .then((d) => { if (d.updated > 0) loadTransactions(); })
      .catch(() => {});
  }, [allTransactions, loadTransactions]);

  const pollRef = useRef(null);
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setMessage("");
    addToast("Syncing Gmail…", "info");
    fetch("/api/sync", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error && !d.error.includes("already")) {
          setMessage("Sync failed. Try again, or check Settings → Gmail connection.");
          addToast("Sync failed", "error");
        } else {
          addToast(d.message || "Sync complete", "success");
          loadTransactions();
          loadReceiptSummary();
        }
        setSyncing(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      })
      .catch(() => { setMessage("Sync failed. Try again, or check Settings → Gmail connection."); addToast("Sync failed", "error"); setSyncing(false); });
    pollRef.current = setInterval(() => loadTransactions(), 60000);
    setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, 5 * 60 * 1000);
  }, [loadTransactions, loadReceiptSummary, addToast]);

  const counts = { receipts: receiptSummary?.coverage?.missing || 0 };
  const closeTxn = useCallback(() => setSelectedTxn(null), []);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg-page)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--text-muted)" }}>
          <div className="spinner" />
          <span className="small">Loading your card…</span>
        </div>
      </div>
    );
  }

  const showPeriod = !CYCLE_SCOPED_TABS.has(activeTab) && allTransactions.length > 0;
  const tab = TAB_BY_KEY[activeTab];

  return (
    <>
      {!isMobile && (
        <Sidebar
          activeTab={activeTab}
          onTabChange={changeTab}
          gmailStatus={gmailStatus}
          onSync={handleSync}
          syncing={syncing}
          session={session}
          theme={theme}
          onToggleTheme={toggleTheme}
          counts={counts}
        />
      )}

      {isMobile && (
        <header className="m-top">
          <Image src="/vippy-logo.webp" alt="" width={28} height={28} priority />
          <h1>{tab.label}</h1>
          <Button icon="sync" onClick={handleSync} disabled={syncing} aria-label={syncing ? "Syncing" : "Sync Gmail"} className={syncing ? "is-syncing" : ""} />
        </header>
      )}

      <main id="main-content" className="main">
        <div className="main-inner">
          {!isMobile && (
            <div className="page-head">
              <h1>{tab.label}</h1>
              {showPeriod && (
                <PeriodSelector startDate={startDate} endDate={endDate}
                  onStartChange={(v) => { setStartDate(v); setActivePreset(null); }}
                  onEndChange={(v) => { setEndDate(v); setActivePreset(null); }}
                  onPreset={handlePreset} activePreset={activePreset} />
              )}
            </div>
          )}
          {isMobile && showPeriod && (
            <PeriodSelector startDate={startDate} endDate={endDate} isMobile
              onStartChange={(v) => { setStartDate(v); setActivePreset(null); }}
              onEndChange={(v) => { setEndDate(v); setActivePreset(null); }}
              onPreset={handlePreset} activePreset={activePreset} />
          )}

          {gmailStatus && !gmailStatus.connected && (
            <Banner tone="bad" title="Gmail is disconnected — new charges won't sync">
              {gmailStatus.detail || gmailStatus.reason}. Sign out and sign in with Google again to refresh access.
            </Banner>
          )}
          {message && <Banner tone="bad" title={message} />}

          {CYCLE_SCOPED_TABS.has(activeTab) ? (
            <div key={activeTab} role="tabpanel" style={{ animation: "slideUp 0.18s ease" }}>
              {activeTab === "receipts" && <ReceiptsTab isMobile={isMobile} onChanged={loadReceiptSummary} />}
              {activeTab === "settings" && <SettingsTab session={session} isMobile={isMobile} />}
            </div>
          ) : !loaded ? (
            <div className="stack">
              <div className="skeleton" style={{ height: 180 }} />
              <div className="grid grid-2"><div className="skeleton" style={{ height: 220 }} /><div className="skeleton" style={{ height: 220 }} /></div>
            </div>
          ) : allTransactions.length === 0 ? (
            <div className="card">
              <Empty icon="mail" title="No transactions yet" action={<Button variant="primary" icon="sync" onClick={handleSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync Gmail"}</Button>}>
                Vippy reads HDFC card alerts from your Gmail. Run a sync to pull in your charges.
              </Empty>
            </div>
          ) : transactions.length === 0 ? (
            <div className="card">
              <Empty icon="calendar" title="Nothing in this period" action={<Button onClick={() => handlePreset(0)}>Show all time</Button>}>
                No charges fall between these dates. Pick a wider period.
              </Empty>
            </div>
          ) : (
            <div key={activeTab} role="tabpanel" style={{ animation: "slideUp 0.18s ease" }}>
              {activeTab === "overview" && (
                <OverviewTab transactions={transactions} allTransactions={allTransactions} startDate={startDate} endDate={endDate}
                  isMobile={isMobile} chartColors={chartColors} onSelect={setSelectedTxn} receiptSummary={receiptSummary}
                  onOpenReceipts={() => changeTab("receipts")} onOpenTab={changeTab} />
              )}
              {activeTab === "transactions" && <TransactionsTab transactions={transactions} allTransactions={allTransactions} startDate={startDate} endDate={endDate} onSelect={setSelectedTxn} isMobile={isMobile} chartColors={chartColors} />}
              {activeTab === "subscriptions" && <SubscriptionsTab transactions={transactions} allTransactions={allTransactions} isMobile={isMobile} chartColors={chartColors} />}
              {activeTab === "reports" && <ReportsTab transactions={transactions} allTransactions={allTransactions} startDate={startDate} endDate={endDate} isMobile={isMobile} chartColors={chartColors} />}
            </div>
          )}
        </div>
      </main>

      {isMobile && <MobileTabBar activeTab={activeTab} onTabChange={changeTab} onMore={() => setMoreOpen(true)} counts={counts} />}
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} onTabChange={changeTab} theme={theme} onToggleTheme={toggleTheme} session={session} gmailStatus={gmailStatus} syncing={syncing} />

      <TransactionSheet transaction={selectedTxn} onClose={closeTxn}
        onUpdateNotes={(id, notes) => setAllTransactions((p) => p.map((t) => (t.id === id ? { ...t, userNotes: notes } : t)))}
        onRenameMerchant={(from, to) => {
          setAllTransactions((p) => p.map((t) => (t.merchant === from ? { ...t, merchant: to } : t)));
          setSelectedTxn((s) => (s && s.merchant === from ? { ...s, merchant: to } : s));
        }}
        matchCount={selectedTxn ? allTransactions.filter((t) => t.merchant === selectedTxn.merchant).length : 0} />

      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}><span className="dot" />{t.message}</div>
        ))}
      </div>
    </>
  );
}
