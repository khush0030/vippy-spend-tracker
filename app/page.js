"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const CATEGORIES = {
  amazon: { label: "Amazon", color: "#FF9900", icon: "🛒" },
  fuel: { label: "Fuel", color: "#4CAF50", icon: "⛽" },
  dining: { label: "Dining", color: "#E91E63", icon: "🍽️" },
  swiggy: { label: "Swiggy", color: "#FC8019", icon: "🛵" },
  utilities: { label: "Utilities", color: "#2196F3", icon: "💡" },
  subscriptions: { label: "Subscriptions", color: "#9C27B0", icon: "📱" },
  office: { label: "Office", color: "#607D8B", icon: "🏢" },
  travel: { label: "Travel", color: "#00BCD4", icon: "✈️" },
  other: { label: "Other", color: "#795548", icon: "📦" },
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return mobile;
}

// ── Transaction Detail Modal ──
function TransactionModal({ transaction: t, onClose, onUpdateNotes }) {
  const [userNotes, setUserNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (t) setUserNotes(t.userNotes || "");
  }, [t]);

  if (!t) return null;
  const cat = CATEGORIES[t.category] || CATEGORIES.other;

  const handleSaveNotes = async () => {
    setSaving(true);
    await fetch("/api/transactions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, userNotes }),
    });
    onUpdateNotes(t.id, userNotes);
    setSaving(false);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 16, padding: "32px 28px",
          maxWidth: 480, width: "100%", position: "relative",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 16, right: 16, border: "none",
            background: "none", fontSize: 20, cursor: "pointer", color: "#999",
          }}
        >&times;</button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: cat.color + "18",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
          }}>{cat.icon}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{t.merchant}</div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
              background: cat.color + "18", color: cat.color,
            }}>{cat.label}</span>
          </div>
        </div>

        <div style={{
          fontSize: 32, fontWeight: 800, marginBottom: 20,
          color: t.isRefund ? "#4CAF50" : "#1a1a1a",
        }}>
          {t.isRefund ? "+" : ""}{formatCurrency(t.amount)}
          {t.isRefund && (
            <span style={{
              fontSize: 12, fontWeight: 600, color: "#4CAF50", background: "#E8F5E9",
              padding: "2px 8px", borderRadius: 4, marginLeft: 8, verticalAlign: "middle",
            }}>REFUND</span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <DetailRow label="Date" value={formatDate(t.date)} />
          {t.txnTime && <DetailRow label="Time" value={t.txnTime} />}
          {t.itemDescription && <DetailRow label="Item" value={t.itemDescription} />}
          {t.notes && (
            <div style={{
              padding: "12px 16px", background: "#f8f9ff", borderRadius: 10,
              border: "1px solid #e8ecf4",
            }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>AI Insight</div>
              <div style={{ fontSize: 14, color: "#444", lineHeight: 1.5 }}>{t.notes}</div>
            </div>
          )}
          <DetailRow label="Receipt" value={t.hasReceipt ? "Attached" : "Missing"} />
          {t.rawEmail && <DetailRow label="Email Subject" value={t.rawEmail} />}

          {/* User Notes */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>Your Notes</div>
            <textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="Add a note about this transaction..."
              style={{
                width: "100%", padding: "10px 14px", border: "1px solid #ddd",
                borderRadius: 8, fontSize: 13, outline: "none", resize: "vertical",
                minHeight: 70, fontFamily: "inherit", lineHeight: 1.5,
              }}
            />
            <button
              onClick={handleSaveNotes}
              disabled={saving}
              style={{
                marginTop: 8, padding: "8px 18px", borderRadius: 6, border: "none",
                background: saving ? "#eee" : "#1a1a1a", color: saving ? "#999" : "#fff",
                fontSize: 12, fontWeight: 600,
              }}
            >{saving ? "Saving..." : "Save Note"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
      <span style={{ fontSize: 13, color: "#888" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", maxWidth: "65%" }}>{value}</span>
    </div>
  );
}

// ── Date Range Picker ──
function DateRangePicker({ startDate, endDate, onStartChange, onEndChange, onPreset, isMobile }) {
  return (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
      marginBottom: 20, padding: "12px 16px",
      background: "#f9f9f9", borderRadius: 10, border: "1px solid #eee",
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>Period:</span>
      <input type="date" value={startDate} onChange={(e) => onStartChange(e.target.value)}
        style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, outline: "none", flex: isMobile ? "1 1 auto" : "0 0 auto" }} />
      <span style={{ fontSize: 13, color: "#999" }}>to</span>
      <input type="date" value={endDate} onChange={(e) => onEndChange(e.target.value)}
        style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, outline: "none", flex: isMobile ? "1 1 auto" : "0 0 auto" }} />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {[{ label: "7D", days: 7 }, { label: "30D", days: 30 }, { label: "90D", days: 90 }, { label: "1Y", days: 365 }, { label: "All", days: 0 }].map((p) => (
          <button key={p.label} onClick={() => onPreset(p.days)} style={{
            padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd",
            background: "#fff", fontSize: 12, fontWeight: 500, color: "#555",
          }}>{p.label}</button>
        ))}
      </div>
    </div>
  );
}

// ── Metric Card ──
function MetricCard({ title, value, subtitle, accent, isMobile }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12,
      padding: isMobile ? "16px 18px" : "20px 24px",
      flex: isMobile ? "1 1 calc(50% - 8px)" : "1 1 180px", minWidth: isMobile ? 0 : 160,
      borderTop: accent ? `3px solid ${accent}` : "none",
    }}>
      <div style={{ fontSize: isMobile ? 11 : 12, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</div>
      <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 700 }}>{value}</div>
      {subtitle && <div style={{ fontSize: isMobile ? 10 : 11, color: "#aaa", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

// ── Spending Insights Panel ──
function InsightsPanel({ transactions, isMobile }) {
  const purchases = transactions.filter((t) => !t.isRefund);
  if (purchases.length === 0) return null;

  // Top category
  const categoryTotals = {};
  for (const t of purchases) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
  }
  const topCat = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
  const topCatInfo = CATEGORIES[topCat[0]] || CATEGORIES.other;

  // Avg per transaction
  const avgAmount = purchases.reduce((s, t) => s + t.amount, 0) / purchases.length;

  // Highest single transaction
  const highest = purchases.reduce((max, t) => t.amount > max.amount ? t : max, purchases[0]);

  // Most frequent merchant
  const merchantCounts = {};
  for (const t of purchases) {
    merchantCounts[t.merchant] = (merchantCounts[t.merchant] || 0) + 1;
  }
  const topMerchant = Object.entries(merchantCounts).sort((a, b) => b[1] - a[1])[0];

  // Daily average
  const dates = [...new Set(purchases.map((t) => t.date))];
  const dailyAvg = purchases.reduce((s, t) => s + t.amount, 0) / (dates.length || 1);

  return (
    <div style={{
      background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12,
      padding: isMobile ? 16 : 24, marginBottom: isMobile ? 16 : 24,
    }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Spending Insights</h3>
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
        gap: 12,
      }}>
        <InsightCard
          icon={topCatInfo.icon}
          title="Top Category"
          value={topCatInfo.label}
          detail={formatCurrency(topCat[1])}
          color={topCatInfo.color}
        />
        <InsightCard
          icon="📊"
          title="Avg Transaction"
          value={formatCurrency(avgAmount)}
          detail={`across ${purchases.length} purchases`}
          color="#2196F3"
        />
        <InsightCard
          icon="🔥"
          title="Highest Spend"
          value={formatCurrency(highest.amount)}
          detail={highest.merchant}
          color="#E91E63"
        />
        <InsightCard
          icon="🔄"
          title="Most Frequent"
          value={topMerchant[0]}
          detail={`${topMerchant[1]} transactions`}
          color="#FF9900"
        />
        <InsightCard
          icon="📅"
          title="Daily Average"
          value={formatCurrency(dailyAvg)}
          detail={`over ${dates.length} active days`}
          color="#4CAF50"
        />
        <InsightCard
          icon="🏷️"
          title="Categories Used"
          value={Object.keys(categoryTotals).length}
          detail="spending categories"
          color="#9C27B0"
        />
      </div>
    </div>
  );
}

function InsightCard({ icon, title, value, detail, color }) {
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 10, background: "#fafafa",
      border: "1px solid #f0f0f0",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || "#1a1a1a" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{detail}</div>
    </div>
  );
}

// ── Overview Tab ──
function OverviewTab({ transactions, isMobile }) {
  const purchases = transactions.filter((t) => !t.isRefund);
  const refunds = transactions.filter((t) => t.isRefund);
  const totalRefunds = refunds.reduce((s, t) => s + t.amount, 0);

  const categoryTotals = {};
  for (const t of purchases) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
  }
  for (const t of refunds) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) - t.amount;
  }

  const cats = Object.entries(categoryTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const totalSpend = purchases.reduce((s, t) => s + t.amount, 0) - totalRefunds;
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
      <div style={{ display: "flex", gap: isMobile ? 8 : 12, flexWrap: "wrap", marginBottom: isMobile ? 16 : 24 }}>
        <MetricCard isMobile={isMobile} title="Net Spend" value={formatCurrency(totalSpend)} subtitle="After refunds" accent="#1a1a1a" />
        <MetricCard isMobile={isMobile} title="Purchases" value={purchases.length} subtitle={`${refunds.length} refunds`} accent="#2196F3" />
        <MetricCard isMobile={isMobile} title="Refunds" value={formatCurrency(totalRefunds)} subtitle={`${refunds.length} returns`} accent="#4CAF50" />
        <MetricCard isMobile={isMobile} title="Receipts" value={`${withReceipt}/${transactions.length}`} subtitle="Attached" accent="#FF9900" />
      </div>

      <InsightsPanel transactions={transactions} isMobile={isMobile} />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 24 }}>
        <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12, padding: isMobile ? 16 : 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Category Split</h3>
          <div style={{ maxWidth: isMobile ? 220 : 260, margin: "0 auto" }}>
            <Doughnut data={donutData} options={{
              cutout: "65%",
              plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 8, font: { size: isMobile ? 10 : 12 } } } },
            }} />
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12, padding: isMobile ? 16 : 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Category Breakdown</h3>
          <Bar data={barData} options={{
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, ticks: { callback: (v) => "\u20B9" + v.toLocaleString("en-IN"), font: { size: isMobile ? 10 : 12 } } },
              y: { grid: { display: false }, ticks: { font: { size: isMobile ? 10 : 12 } } },
            },
          }} />
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

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Search merchant..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "10px 14px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, outline: "none", width: isMobile ? "100%" : 240 }} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ padding: "10px 14px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, outline: "none", background: "#fff", flex: isMobile ? 1 : "0 0 auto" }}>
          <option value="all">All Categories</option>
          {Object.entries(CATEGORIES).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: "#888" }}>{filtered.length} transactions</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map((t) => {
          const cat = CATEGORIES[t.category] || CATEGORIES.other;
          return (
            <div key={t.id}
              onClick={() => onSelect(t)}
              style={{
                display: "flex", alignItems: "center", gap: isMobile ? 10 : 14,
                padding: isMobile ? "12px 14px" : "14px 18px",
                background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10,
                cursor: "pointer", transition: "border-color 0.15s",
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = "#ccc"}
              onMouseOut={(e) => e.currentTarget.style.borderColor = "#e8e8e8"}
            >
              <div style={{
                width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: 10,
                background: cat.color + "14", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: isMobile ? 16 : 18, flexShrink: 0,
              }}>{cat.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: isMobile ? 13 : 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.merchant}</div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>
                  {formatDate(t.date)}
                  {t.txnTime ? ` \u00B7 ${t.txnTime}` : ""}
                  {t.isRefund && <span style={{ color: "#4CAF50", fontWeight: 600, marginLeft: 6 }}>REFUND</span>}
                </div>
                {t.notes && <div style={{ fontSize: 11, color: "#bbb", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.notes}</div>}
              </div>
              <div style={{
                fontWeight: 700, fontSize: isMobile ? 14 : 15,
                color: t.isRefund ? "#4CAF50" : "#1a1a1a", whiteSpace: "nowrap",
              }}>
                {t.isRefund ? "+" : ""}{formatCurrency(t.amount)}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleReceipt(t.id); }}
                title={t.hasReceipt ? "Receipt attached" : "No receipt"}
                style={{
                  width: 28, height: 28, borderRadius: 6, border: "1px solid #ddd",
                  background: t.hasReceipt ? "#4CAF50" : "#fff", color: t.hasReceipt ? "#fff" : "#ddd",
                  fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}
              >{t.hasReceipt ? "\u2713" : "\u25CB"}</button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#aaa" }}>No transactions found</div>
        )}
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
      <div style={{ display: "flex", gap: isMobile ? 8 : 12, marginBottom: 24 }}>
        <MetricCard isMobile={isMobile} title="Missing" value={missing.length} subtitle="Action needed" accent="#E91E63" />
        <MetricCard isMobile={isMobile} title="Attached" value={attached.length} subtitle="All good" accent="#4CAF50" />
      </div>

      {missing.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#E91E63" }}>Missing Receipts</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 28 }}>
            {missing.map((t) => (
              <div key={t.id} style={{
                display: "flex", alignItems: "center", gap: isMobile ? 8 : 14,
                padding: isMobile ? "10px 12px" : "12px 18px",
                background: "#FFF5F5", border: "1px solid #FFE0E0", borderRadius: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{t.merchant}</span>
                  <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>{formatDate(t.date)}</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{formatCurrency(t.amount)}</span>
                <button onClick={() => onToggleReceipt(t.id)} style={{
                  padding: "5px 10px", borderRadius: 6, border: "1px solid #4CAF50",
                  background: "#fff", color: "#4CAF50", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                }}>Attach</button>
              </div>
            ))}
          </div>
        </>
      )}

      {attached.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#4CAF50" }}>Attached ({attached.length})</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {attached.map((t) => (
              <div key={t.id} style={{
                display: "flex", alignItems: "center", gap: isMobile ? 8 : 14,
                padding: isMobile ? "10px 12px" : "12px 18px",
                background: "#F5FFF5", border: "1px solid #E0FFE0", borderRadius: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{t.merchant}</span>
                  <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>{formatDate(t.date)}</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{formatCurrency(t.amount)}</span>
                <span style={{ fontSize: 11, color: "#4CAF50", fontWeight: 600 }}>{"\u2713"}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {missing.length === 0 && attached.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#aaa" }}>No transactions yet</div>
      )}
    </div>
  );
}

// ── Reports Tab ──
function ReportsTab({ transactions, startDate, endDate, isMobile }) {
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);

  const purchases = transactions.filter((t) => !t.isRefund);
  const refunds = transactions.filter((t) => t.isRefund);
  const totalSpend = purchases.reduce((s, t) => s + t.amount, 0);
  const totalRefunds = refunds.reduce((s, t) => s + t.amount, 0);
  const missingReceipts = transactions.filter((t) => !t.hasReceipt && !t.isRefund);

  const categoryTotals = {};
  for (const t of purchases) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
  }
  const catsSorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

  const downloadCSV = () => {
    const params = new URLSearchParams();
    params.set("format", "csv");
    if (startDate) params.set("start", startDate);
    if (endDate) params.set("end", endDate);
    window.open(`/api/reports?${params.toString()}`, "_blank");
  };

  const generateSummary = async () => {
    setGenerating(true);
    try {
      const params = new URLSearchParams();
      params.set("format", "json");
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      const res = await fetch(`/api/reports?${params.toString()}`);
      const data = await res.json();
      setReport(data.report);
    } catch {
      setReport(null);
    }
    setGenerating(false);
  };

  const periodLabel = startDate && endDate
    ? `${formatDate(startDate)} - ${formatDate(endDate)}`
    : "All time";

  return (
    <div>
      {/* Export actions */}
      <div style={{
        display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap",
      }}>
        <button onClick={downloadCSV} style={{
          padding: "10px 20px", borderRadius: 8, border: "1px solid #1a1a1a",
          background: "#fff", color: "#1a1a1a", fontSize: 13, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 16 }}>&#128196;</span> Download CSV
        </button>
        <button onClick={generateSummary} disabled={generating} style={{
          padding: "10px 20px", borderRadius: 8, border: "none",
          background: generating ? "#eee" : "#1a1a1a", color: generating ? "#999" : "#fff",
          fontSize: 13, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 16 }}>&#128202;</span> {generating ? "Generating..." : "Generate Report"}
        </button>
      </div>

      {/* Summary Report Card */}
      <div style={{
        background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12,
        padding: isMobile ? 18 : 28, marginBottom: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Expense Report</h3>
          <span style={{ fontSize: 12, color: "#888", background: "#f5f5f5", padding: "4px 12px", borderRadius: 20 }}>{periodLabel}</span>
        </div>

        {/* Summary grid */}
        <div style={{
          display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr",
          gap: 12, marginBottom: 24,
        }}>
          <div style={{ padding: 14, background: "#f9f9f9", borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>GROSS SPEND</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(totalSpend)}</div>
          </div>
          <div style={{ padding: 14, background: "#f9f9f9", borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>REFUNDS</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#4CAF50" }}>{formatCurrency(totalRefunds)}</div>
          </div>
          <div style={{ padding: 14, background: "#f9f9f9", borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>NET SPEND</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{formatCurrency(totalSpend - totalRefunds)}</div>
          </div>
          <div style={{ padding: 14, background: missingReceipts.length > 0 ? "#FFF5F5" : "#f9f9f9", borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>MISSING RECEIPTS</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: missingReceipts.length > 0 ? "#E91E63" : "#1a1a1a" }}>{missingReceipts.length}</div>
          </div>
        </div>

        {/* Category breakdown table */}
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Category Breakdown</h4>
        <div style={{ borderRadius: 10, border: "1px solid #f0f0f0", overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr",
            padding: "10px 16px", background: "#f9f9f9",
            fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase",
          }}>
            <span>Category</span>
            <span style={{ textAlign: "right" }}>Amount</span>
            <span style={{ textAlign: "right" }}>% of Total</span>
            <span style={{ textAlign: "right" }}>Count</span>
          </div>
          {catsSorted.map(([cat, total]) => {
            const info = CATEGORIES[cat] || CATEGORIES.other;
            const count = purchases.filter((t) => t.category === cat).length;
            const pct = totalSpend > 0 ? ((total / totalSpend) * 100).toFixed(1) : 0;
            return (
              <div key={cat} style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr",
                padding: "10px 16px", borderTop: "1px solid #f0f0f0",
                fontSize: 13, alignItems: "center",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{info.icon}</span>
                  <span style={{ fontWeight: 500 }}>{info.label}</span>
                </span>
                <span style={{ textAlign: "right", fontWeight: 600 }}>{formatCurrency(total)}</span>
                <span style={{ textAlign: "right", color: "#888" }}>{pct}%</span>
                <span style={{ textAlign: "right", color: "#888" }}>{count}</span>
              </div>
            );
          })}
          <div style={{
            display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr",
            padding: "10px 16px", borderTop: "2px solid #e8e8e8",
            fontSize: 13, fontWeight: 700, background: "#f9f9f9",
          }}>
            <span>Total</span>
            <span style={{ textAlign: "right" }}>{formatCurrency(totalSpend)}</span>
            <span style={{ textAlign: "right" }}>100%</span>
            <span style={{ textAlign: "right" }}>{purchases.length}</span>
          </div>
        </div>

        {/* Missing receipts list */}
        {missingReceipts.length > 0 && (
          <>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginTop: 24, marginBottom: 12, color: "#E91E63" }}>
              Missing Receipts ({missingReceipts.length})
            </h4>
            <div style={{ borderRadius: 10, border: "1px solid #FFE0E0", overflow: "hidden" }}>
              {missingReceipts.map((t, i) => (
                <div key={t.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 16px", borderTop: i > 0 ? "1px solid #FFE0E0" : "none",
                  background: "#FFF5F5", fontSize: 13,
                }}>
                  <span>{t.merchant}</span>
                  <span style={{ display: "flex", gap: 16 }}>
                    <span style={{ color: "#888" }}>{formatDate(t.date)}</span>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(t.amount)}</span>
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
    id: r.id,
    merchant: r.merchant,
    amount: r.amount,
    date: r.date,
    category: r.category,
    hasReceipt: r.has_receipt,
    itemDescription: r.item_description,
    isRefund: r.is_refund || false,
    notes: r.notes || null,
    txnTime: r.txn_time || null,
    userNotes: r.user_notes || "",
    rawEmail: r.raw_email,
  }));
}

// ── Main Page ──
export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [allTransactions, setAllTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedTxn, setSelectedTxn] = useState(null);
  const isMobile = useIsMobile();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const transactions = useMemo(() => {
    return allTransactions.filter((t) => {
      if (t.amount < 10) return false;
      if (startDate && t.date < startDate) return false;
      if (endDate && t.date > endDate) return false;
      return true;
    });
  }, [allTransactions, startDate, endDate]);

  const handlePreset = useCallback((days) => {
    if (days === 0) { setStartDate(""); setEndDate(""); }
    else {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const res = await fetch("/api/transactions");
      const data = await res.json();
      if (data.transactions?.length) setAllTransactions(mapRows(data.transactions));
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      // Claim any orphaned transactions (from before auth was added)
      fetch("/api/transactions/claim", { method: "POST" })
        .then(() => loadTransactions())
        .catch(() => loadTransactions());
    }
  }, [status, loadTransactions]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setMessage("Syncing... transactions appear as they're processed.");

    fetch("/api/sync", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.error && !data.error.includes("already in progress")) {
          setMessage("Error: " + data.error);
        } else {
          setMessage(data.message || "Sync complete!");
          loadTransactions();
        }
        setSyncing(false);
      })
      .catch((err) => { setMessage("Sync failed: " + err.message); setSyncing(false); });

    const poll = setInterval(() => loadTransactions(), 30000);
    setTimeout(() => clearInterval(poll), 40 * 60 * 1000);
  }, [loadTransactions]);

  const handleToggleReceipt = useCallback((id) => {
    setAllTransactions((prev) => {
      const updated = prev.map((t) => t.id === id ? { ...t, hasReceipt: !t.hasReceipt } : t);
      const target = updated.find((t) => t.id === id);
      fetch("/api/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, hasReceipt: target.hasReceipt }),
      });
      return updated;
    });
  }, []);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#888" }}>Loading...</div>
      </div>
    );
  }

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "transactions", label: "Transactions" },
    { key: "receipts", label: "Receipts" },
    { key: "reports", label: "Reports" },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: isMobile ? "16px 12px" : "28px 24px" }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: isMobile ? 16 : 24, flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 20 : 22, fontWeight: 700, letterSpacing: -0.5 }}>Vippy Spend Tracker</h1>
          <p style={{ fontSize: 11, color: "#999", marginTop: 2 }}>HDFC Corporate Card &middot; Vippy Industries</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {message && (
            <span style={{ fontSize: 11, color: message.startsWith("Error") ? "#E91E63" : "#4CAF50", maxWidth: 180 }}>
              {message}
            </span>
          )}
          <button onClick={handleSync} disabled={syncing} style={{
            padding: isMobile ? "8px 14px" : "8px 18px", borderRadius: 8, border: "none",
            background: syncing ? "#eee" : "#1a1a1a", color: syncing ? "#999" : "#fff",
            fontSize: 13, fontWeight: 600,
          }}>{syncing ? "Syncing..." : "Sync Gmail"}</button>
          {/* User avatar & menu */}
          <div style={{ position: "relative" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
              borderRadius: 8, border: "1px solid #e8e8e8", cursor: "pointer",
              background: "#fff",
            }} onClick={() => {
              if (confirm("Sign out?")) signOut({ callbackUrl: "/login" });
            }}>
              {session?.user?.image ? (
                <img src={session.user.image} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} referrerPolicy="no-referrer" />
              ) : (
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#e8e8e8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
                  {session?.user?.name?.[0] || "?"}
                </div>
              )}
              <span style={{ fontSize: 12, fontWeight: 500, color: "#555" }}>{isMobile ? "" : (session?.user?.name?.split(" ")[0] || "User")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 0, borderBottom: "1px solid #e8e8e8",
        marginBottom: isMobile ? 16 : 20, overflowX: "auto",
      }}>
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: isMobile ? "8px 16px" : "10px 24px", border: "none", background: "none",
            fontSize: isMobile ? 13 : 14, fontWeight: activeTab === tab.key ? 600 : 400,
            color: activeTab === tab.key ? "#1a1a1a" : "#999",
            borderBottom: activeTab === tab.key ? "2px solid #1a1a1a" : "2px solid transparent",
            marginBottom: -1, whiteSpace: "nowrap",
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      {allTransactions.length === 0 && !syncing && !message ? (
        <div style={{ textAlign: "center", padding: isMobile ? "60px 16px" : "80px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>&#128202;</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No transactions yet</h2>
          <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>
            Click &quot;Sync Gmail&quot; to fetch your HDFC transaction alerts and Amazon orders.
          </p>
          <button onClick={handleSync} style={{
            padding: "12px 28px", borderRadius: 8, border: "none",
            background: "#1a1a1a", color: "#fff", fontSize: 14, fontWeight: 600,
          }}>Sync Gmail</button>
        </div>
      ) : (
        <>
          {syncing && (
            <div style={{
              padding: "10px 16px", background: "#FFF8E1", border: "1px solid #FFE082",
              borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#F57F17",
            }}>Sync in progress — new transactions appear every 30 seconds...</div>
          )}

          <DateRangePicker startDate={startDate} endDate={endDate}
            onStartChange={setStartDate} onEndChange={setEndDate}
            onPreset={handlePreset} isMobile={isMobile} />

          {transactions.length === 0 && allTransactions.length > 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#aaa" }}>No transactions in this date range.</div>
          ) : (
            <>
              {activeTab === "overview" && <OverviewTab transactions={transactions} isMobile={isMobile} />}
              {activeTab === "transactions" && <TransactionsTab transactions={transactions} onToggleReceipt={handleToggleReceipt} onSelect={setSelectedTxn} isMobile={isMobile} />}
              {activeTab === "receipts" && <ReceiptsTab transactions={transactions} onToggleReceipt={handleToggleReceipt} isMobile={isMobile} />}
              {activeTab === "reports" && <ReportsTab transactions={transactions} startDate={startDate} endDate={endDate} isMobile={isMobile} />}
            </>
          )}
        </>
      )}

      {/* Transaction Detail Modal */}
      <TransactionModal
        transaction={selectedTxn}
        onClose={() => setSelectedTxn(null)}
        onUpdateNotes={(id, notes) => {
          setAllTransactions((prev) =>
            prev.map((t) => t.id === id ? { ...t, userNotes: notes } : t)
          );
        }}
      />
    </div>
  );
}
