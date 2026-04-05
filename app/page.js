"use client";

import { useState, useCallback, useEffect } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const CATEGORIES = {
  amazon: { label: "Amazon", color: "#FF9900" },
  fuel: { label: "Fuel", color: "#4CAF50" },
  dining: { label: "Dining", color: "#E91E63" },
  swiggy: { label: "Swiggy", color: "#FC8019" },
  utilities: { label: "Utilities", color: "#2196F3" },
  subscriptions: { label: "Subscriptions", color: "#9C27B0" },
  office: { label: "Office", color: "#607D8B" },
  travel: { label: "Travel", color: "#00BCD4" },
  other: { label: "Other", color: "#795548" },
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── Metric Card ──
function MetricCard({ title, value, subtitle }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12,
      padding: "24px 28px", flex: "1 1 200px", minWidth: 180,
    }}>
      <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

// ── Overview Tab ──
function OverviewTab({ transactions }) {
  const categoryTotals = {};
  for (const t of transactions) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
  }

  const cats = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const totalSpend = transactions.reduce((s, t) => s + t.amount, 0);
  const withReceipt = transactions.filter((t) => t.hasReceipt).length;

  const donutData = {
    labels: cats.map(([c]) => CATEGORIES[c]?.label || c),
    datasets: [{
      data: cats.map(([, v]) => v),
      backgroundColor: cats.map(([c]) => CATEGORIES[c]?.color || "#795548"),
      borderWidth: 0,
    }],
  };

  const barData = {
    labels: cats.map(([c]) => CATEGORIES[c]?.label || c),
    datasets: [{
      label: "Spend (INR)",
      data: cats.map(([, v]) => v),
      backgroundColor: cats.map(([c]) => CATEGORIES[c]?.color || "#795548"),
      borderRadius: 6,
    }],
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
        <MetricCard title="Total Spend" value={formatCurrency(totalSpend)} subtitle="Last 30 days" />
        <MetricCard title="Transactions" value={transactions.length} subtitle="Synced from Gmail" />
        <MetricCard title="Receipts" value={`${withReceipt}/${transactions.length}`} subtitle="Attached" />
        <MetricCard title="Categories" value={cats.length} subtitle="Detected" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
        <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Category Split</h3>
          <div style={{ maxWidth: 280, margin: "0 auto" }}>
            <Doughnut data={donutData} options={{
              cutout: "65%",
              plugins: { legend: { position: "bottom", labels: { boxWidth: 12, padding: 12, font: { size: 12 } } } },
            }} />
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Category Breakdown</h3>
          <Bar data={barData} options={{
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN") } },
              y: { grid: { display: false } },
            },
          }} />
        </div>
      </div>
    </div>
  );
}

// ── Transactions Tab ──
function TransactionsTab({ transactions, onToggleReceipt }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = transactions.filter((t) => {
    if (filter !== "all" && t.category !== filter) return false;
    if (search && !t.merchant.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search merchant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "10px 16px", border: "1px solid #ddd", borderRadius: 8,
            fontSize: 14, outline: "none", width: 240,
          }}
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: "10px 16px", border: "1px solid #ddd", borderRadius: 8,
            fontSize: 14, outline: "none", background: "#fff",
          }}
        >
          <option value="all">All Categories</option>
          {Object.entries(CATEGORIES).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: "#888" }}>{filtered.length} transactions</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((t) => (
          <div key={t.id} style={{
            display: "flex", alignItems: "center", gap: 16, padding: "16px 20px",
            background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10,
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              background: CATEGORIES[t.category]?.color || "#795548", flexShrink: 0,
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{t.merchant}</div>
              <div style={{ fontSize: 12, color: "#888" }}>{formatDate(t.date)}</div>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20,
              background: CATEGORIES[t.category]?.color + "18",
              color: CATEGORIES[t.category]?.color || "#795548",
            }}>
              {CATEGORIES[t.category]?.label || t.category}
            </span>
            <div style={{ fontWeight: 700, fontSize: 16, minWidth: 100, textAlign: "right" }}>
              {formatCurrency(t.amount)}
            </div>
            <button
              onClick={() => onToggleReceipt(t.id)}
              title={t.hasReceipt ? "Receipt attached" : "No receipt"}
              style={{
                width: 32, height: 32, borderRadius: 8, border: "1px solid #ddd",
                background: t.hasReceipt ? "#4CAF50" : "#fff", color: t.hasReceipt ? "#fff" : "#ccc",
                fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {t.hasReceipt ? "\u2713" : "\u25CB"}
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#aaa" }}>No transactions found</div>
        )}
      </div>
    </div>
  );
}

// ── Receipts Tab ──
function ReceiptsTab({ transactions, onToggleReceipt }) {
  const missing = transactions.filter((t) => !t.hasReceipt);
  const attached = transactions.filter((t) => t.hasReceipt);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <MetricCard title="Missing Receipts" value={missing.length} subtitle="Action needed" />
        <MetricCard title="Attached Receipts" value={attached.length} subtitle="All good" />
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#E91E63" }}>
        Missing Receipts ({missing.length})
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
        {missing.map((t) => (
          <div key={t.id} style={{
            display: "flex", alignItems: "center", gap: 16, padding: "14px 20px",
            background: "#FFF5F5", border: "1px solid #FFE0E0", borderRadius: 10,
          }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{t.merchant}</span>
              <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>{formatDate(t.date)}</span>
            </div>
            <span style={{ fontWeight: 700 }}>{formatCurrency(t.amount)}</span>
            <button
              onClick={() => onToggleReceipt(t.id)}
              style={{
                padding: "6px 14px", borderRadius: 8, border: "1px solid #4CAF50",
                background: "#fff", color: "#4CAF50", fontSize: 12, fontWeight: 600,
              }}
            >
              Mark as Attached
            </button>
          </div>
        ))}
        {missing.length === 0 && (
          <div style={{ textAlign: "center", padding: 24, color: "#4CAF50" }}>All receipts attached!</div>
        )}
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#4CAF50" }}>
        Attached Receipts ({attached.length})
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {attached.map((t) => (
          <div key={t.id} style={{
            display: "flex", alignItems: "center", gap: 16, padding: "14px 20px",
            background: "#F5FFF5", border: "1px solid #E0FFE0", borderRadius: 10,
          }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{t.merchant}</span>
              <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>{formatDate(t.date)}</span>
            </div>
            <span style={{ fontWeight: 700 }}>{formatCurrency(t.amount)}</span>
            <span style={{ fontSize: 12, color: "#4CAF50", fontWeight: 600 }}>{"\u2713"} Receipt</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Map Supabase snake_case rows to camelCase
function mapRows(rows) {
  return rows.map((r) => ({
    id: r.id,
    merchant: r.merchant,
    amount: r.amount,
    date: r.date,
    category: r.category,
    hasReceipt: r.has_receipt,
    itemDescription: r.item_description,
    rawEmail: r.raw_email,
  }));
}

// ── Main Page ──
export default function Home() {
  const [transactions, setTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);

  // Check if Google is connected (refresh token exists on server)
  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setConnected(data.connected);
    } catch {
      setConnected(false);
    }
  }, []);

  // Load transactions from Supabase and check connection on mount
  const loadTransactions = useCallback(async () => {
    try {
      const res = await fetch("/api/transactions");
      const data = await res.json();
      if (data.transactions?.length) {
        setTransactions(mapRows(data.transactions));
      }
    } catch {
      // silently fail on initial load
    }
  }, []);

  useEffect(() => {
    checkConnection();
    loadTransactions();
  }, [checkConnection, loadTransactions]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setMessage("Error: " + data.error);
      } else {
        setTransactions(mapRows(data.transactions || []));
        setMessage(data.message);
      }
    } catch (err) {
      setMessage("Sync failed: " + err.message);
    } finally {
      setSyncing(false);
    }
  }, []);

  const handleToggleReceipt = useCallback((id) => {
    setTransactions((prev) => {
      const updated = prev.map((t) =>
        t.id === id ? { ...t, hasReceipt: !t.hasReceipt } : t
      );
      const target = updated.find((t) => t.id === id);
      // Persist to Supabase
      fetch("/api/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, hasReceipt: target.hasReceipt }),
      });
      return updated;
    });
  }, []);

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "transactions", label: "Transactions" },
    { key: "receipts", label: "Receipts" },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Vippy Spend Tracker</h1>
          <p style={{ fontSize: 13, color: "#888", marginTop: 2 }}>HDFC Corporate Card &middot; Vippy Industries</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {message && (
            <span style={{ fontSize: 12, color: message.startsWith("Error") ? "#E91E63" : "#4CAF50" }}>
              {message}
            </span>
          )}
          {connected ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#4CAF50", fontWeight: 600 }}>{"\u2713"} Gmail Connected</span>
              <button
                onClick={handleSync}
                disabled={syncing}
                style={{
                  padding: "10px 20px", borderRadius: 8, border: "none",
                  background: syncing ? "#ccc" : "#1a1a1a", color: "#fff",
                  fontSize: 14, fontWeight: 600,
                }}
              >
                {syncing ? "Syncing..." : "Sync Gmail"}
              </button>
            </div>
          ) : (
            <a
              href="/api/auth/google"
              style={{
                padding: "10px 20px", borderRadius: 8, border: "none",
                background: "#4285F4", color: "#fff", display: "inline-flex",
                alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Connect Google Account
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e8e8e8", marginBottom: 28 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 24px", border: "none", background: "none",
              fontSize: 14, fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? "#1a1a1a" : "#888",
              borderBottom: activeTab === tab.key ? "2px solid #1a1a1a" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {transactions.length === 0 && !syncing ? (
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>&#128202;</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No transactions yet</h2>
          {connected ? (
            <>
              <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>
                Click &quot;Sync Gmail&quot; to fetch your HDFC transaction alerts and Amazon orders.
              </p>
              <button
                onClick={handleSync}
                style={{
                  padding: "12px 28px", borderRadius: 8, border: "none",
                  background: "#1a1a1a", color: "#fff", fontSize: 14, fontWeight: 600,
                }}
              >
                Sync Gmail
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>
                Connect your Google account to start fetching HDFC transaction alerts and Amazon orders.
              </p>
              <a
                href="/api/auth/google"
                style={{
                  padding: "12px 28px", borderRadius: 8, border: "none",
                  background: "#4285F4", color: "#fff", fontSize: 14, fontWeight: 600,
                  display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#fff" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#fff" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#fff" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#fff" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                Connect Google Account
              </a>
            </>
          )}
        </div>
      ) : (
        <>
          {activeTab === "overview" && <OverviewTab transactions={transactions} />}
          {activeTab === "transactions" && <TransactionsTab transactions={transactions} onToggleReceipt={handleToggleReceipt} />}
          {activeTab === "receipts" && <ReceiptsTab transactions={transactions} onToggleReceipt={handleToggleReceipt} />}
        </>
      )}
    </div>
  );
}
