"use client";

import { useMemo, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from "chart.js";
import { Bar } from "react-chartjs-2";
import {
  normalizeMerchant,
  colorOf,
  labelOf,
  fmtINR,
  priorWindow,
  delta,
  summarize,
  anomalies,
  byDay,
} from "../overview/aggregations";
import DeltaBadge from "../shared/DeltaBadge";
import AnomalyBadge from "../shared/AnomalyBadge";
import Icon from "../ui/Icon";
import { Card, Chip, Empty, Kpi, MerchantAvatar } from "../ui/kit";
import { chartPalette, tooltip } from "../ui/chart-theme";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);
  registered = true;
}

const formatDateHeader = (iso) => {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  const dow = d.toLocaleDateString("en-IN", { weekday: "short" });
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return `${dow}, ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined })}`;
};

const fmtTime = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
};

const PAGE = 60;

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount-desc", label: "Largest first" },
  { value: "amount-asc", label: "Smallest first" },
];

export default function TransactionsTab({ transactions, allTransactions, onSelect, isMobile, startDate, endDate, chartColors }) {
  registerOnce();
  const p = chartColors || chartPalette("light");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [limit, setLimit] = useState(PAGE);

  const allTxns = allTransactions || transactions;

  const categories = useMemo(() => {
    const counts = new Map();
    for (const t of transactions) counts.set(t.category, (counts.get(t.category) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ key: c, count: n }));
  }, [transactions]);

  const stats = useMemo(() => summarize(transactions), [transactions]);
  const prior = useMemo(() => priorWindow(allTxns, startDate, endDate), [allTxns, startDate, endDate]);
  const priorStats = useMemo(() => summarize(prior.prior), [prior.prior]);
  const hasPrior = prior.prior.length > 0;
  const spendDelta = hasPrior ? delta(stats.totalSpend, priorStats.totalSpend) : null;
  const netDelta = hasPrior ? delta(stats.netSpend, priorStats.netSpend) : null;

  const anomMap = useMemo(() => new Map(anomalies(allTxns, { sigma: 2, limit: 50 }).map((a) => [a.txn.id, a])), [allTxns]);

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

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  const totals = useMemo(() => {
    let spend = 0, refunds = 0;
    for (const t of filtered) {
      if (t.isRefund) refunds += t.amount;
      else spend += t.amount;
    }
    return { spend, refunds, net: spend - refunds, count: filtered.length };
  }, [filtered]);

  const daily = useMemo(() => byDay(filtered), [filtered]);

  const grouped = useMemo(() => {
    if (sortBy !== "newest" && sortBy !== "oldest") return null;
    const groups = new Map();
    for (const t of visible) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    return [...groups.entries()];
  }, [visible, sortBy]);

  const dailyData = {
    labels: daily.map((d) => new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })),
    datasets: [{ data: daily.map((d) => d.amount), backgroundColor: p.accent, borderRadius: 2, barPercentage: 0.8, categoryPercentage: 0.9 }],
  };
  const dailyOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: tooltip(p) },
    scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
  };

  const filtering = filter !== "all" || search.trim();

  return (
    <div className="stack">
      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", alignItems: "flex-start" }}>
          <Kpi label={filtering ? "Matching" : "Charges"} value={totals.count} />
          <Kpi label="Spend" value={fmtINR(totals.spend)}>{!filtering && spendDelta && <DeltaBadge delta={spendDelta} invert compact />}</Kpi>
          <Kpi label="Refunds" value={fmtINR(totals.refunds)} tone={totals.refunds ? "var(--success)" : undefined} />
          <Kpi label="Net" value={fmtINR(totals.net)}>{!filtering && netDelta && <DeltaBadge delta={netDelta} invert compact />}</Kpi>
        </div>
        {daily.length > 1 && (
          <div className="chart-box" style={{ height: 56, marginTop: 14 }} aria-label="Daily spend for the charges shown">
            <Bar data={dailyData} options={dailyOpts} />
          </div>
        )}
      </Card>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ position: "relative", flex: isMobile ? "1 1 100%" : "0 1 340px" }}>
          <Icon name="search" size={16} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input id="txn-search" type="search" className="input" placeholder="Search merchants" aria-label="Search merchants" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }} style={{ paddingLeft: 34 }} />
        </label>
        <select id="txn-sort" className="input" aria-label="Sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: "auto", flex: isMobile ? "0 0 auto" : "none", cursor: "pointer" }}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="scroll-x" style={{ flex: "1 1 0", minWidth: 0 }}>
          {[{ key: "all", count: transactions.length }, ...categories].map((c) => {
            const active = filter === c.key;
            return (
              <button
                key={c.key}
                onClick={() => { setFilter(active && c.key !== "all" ? "all" : c.key); setLimit(PAGE); }}
                aria-pressed={active}
                className="chip"
                style={{
                  border: "1px solid",
                  borderColor: active ? "var(--brand)" : "var(--border)",
                  background: active ? "var(--brand-subtle)" : "var(--bg-card)",
                  color: active ? "var(--brand-strong-text)" : "var(--text-secondary)",
                  padding: "6px 10px",
                  fontSize: 12,
                  flex: "none",
                }}
              >
                {c.key !== "all" && <span style={{ width: 7, height: 7, borderRadius: 2, background: colorOf(c.key) }} />}
                {c.key === "all" ? "All" : labelOf(c.key)}
                <span className="num muted" style={{ fontSize: 11 }}>{c.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <Empty icon="search" title="No charges match">Try another merchant name or clear the category filter.</Empty>
        ) : grouped ? (
          grouped.map(([date, list]) => {
            const dayTotal = list.filter((t) => !t.isRefund).reduce((s, t) => s + t.amount, 0);
            return (
              <div key={date}>
                <div className="list-group-head">
                  <span>{formatDateHeader(date)}</span>
                  <span className="num">{fmtINR(dayTotal)}</span>
                </div>
                {list.map((t) => <Row key={t.id} t={t} isMobile={isMobile} onSelect={onSelect} anom={anomMap.get(t.id)} />)}
              </div>
            );
          })
        ) : (
          visible.map((t) => <Row key={t.id} t={t} isMobile={isMobile} onSelect={onSelect} anom={anomMap.get(t.id)} showDate />)
        )}
        {filtered.length > visible.length && (
          <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "center", alignItems: "center", gap: 12 }}>
            <span className="small muted">Showing {visible.length} of {filtered.length}</span>
            <button className="btn sm" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - visible.length)} more</button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ t, isMobile, onSelect, anom, showDate }) {
  const name = normalizeMerchant(t.merchant);
  const when = [showDate && new Date(t.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }), t.txnTime && fmtTime(t.txnTime)].filter(Boolean).join(" · ");
  return (
    <button className="list-row" onClick={() => onSelect(t)} style={{ borderTop: "1px solid var(--border)" }}>
      <MerchantAvatar name={name} color={colorOf(t.category)} />
      <span className="grow">
        <div className="title" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
          {anom && <AnomalyBadge baseline={anom.baseline} sigma={anom.sigma} />}
          {t.isRefund && <Chip tone="ok">Refund</Chip>}
        </div>
        <div className="meta">{labelOf(t.category)}{when ? ` · ${when}` : ""}</div>
      </span>
      {!isMobile && t.userNotes && <span className="small muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.userNotes}</span>}
      <span className="amt" style={{ fontSize: 14, color: t.isRefund ? "var(--success)" : undefined }}>
        {t.isRefund ? "+" : ""}{fmtINR(t.amount)}
      </span>
    </button>
  );
}
