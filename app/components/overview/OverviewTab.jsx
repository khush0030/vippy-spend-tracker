"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Filler,
} from "chart.js";
import { Doughnut, Bar, Line } from "react-chartjs-2";
import {
  summarize,
  byCategory,
  byDay,
  byDow,
  topMerchants,
  colorOf,
  labelOf,
  fmtINR,
  fmtINRcompact,
  priorWindow,
  delta,
  projectMonthEnd,
  dowHourMatrix,
  anomalies,
  merchantTrend,
  cumulativeByDay,
  normalizeMerchant,
} from "./aggregations";
import DeltaBadge from "../shared/DeltaBadge";
import HeatmapDOWHour from "../shared/HeatmapDOWHour";
import Sparkline from "../shared/Sparkline";
import AnomalyBadge from "../shared/AnomalyBadge";
import { Banner, BarRow, Button, Card, Chip, Kpi, MerchantAvatar } from "../ui/kit";
import { axes, chartPalette, tooltip } from "../ui/chart-theme";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler);
  registered = true;
}

const fmtShort = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function OverviewTab({
  transactions,
  allTransactions,
  startDate,
  endDate,
  isMobile,
  chartColors,
  onSelect,
  receiptSummary,
  onOpenReceipts,
  onOpenTab,
}) {
  registerOnce();
  const p = chartColors || chartPalette("light");

  const stats = useMemo(() => summarize(transactions), [transactions]);
  const cats = useMemo(() => byCategory(transactions), [transactions]);
  const daily = useMemo(() => byDay(transactions), [transactions]);
  const dow = useMemo(() => byDow(transactions), [transactions]);
  const merchants = useMemo(() => topMerchants(transactions, 6), [transactions]);
  const heat = useMemo(() => dowHourMatrix(transactions), [transactions]);
  const anomList = useMemo(() => anomalies(transactions, { sigma: 2, limit: 4 }), [transactions]);
  const recent = useMemo(() => [...transactions].sort((a, b) => (b.date + (b.txnTime || "")).localeCompare(a.date + (a.txnTime || ""))).slice(0, isMobile ? 4 : 6), [transactions, isMobile]);

  const prior = useMemo(() => priorWindow(allTransactions || [], startDate, endDate), [allTransactions, startDate, endDate]);
  const priorStats = useMemo(() => summarize(prior.prior), [prior.prior]);
  const priorCats = useMemo(() => byCategory(prior.prior), [prior.prior]);
  const projection = useMemo(() => projectMonthEnd(allTransactions || transactions, new Date()), [allTransactions, transactions]);

  const sparks = useMemo(() => {
    const map = {};
    for (const m of merchants) map[m.merchant] = merchantTrend(allTransactions || transactions, m.merchant, 6);
    return map;
  }, [merchants, allTransactions, transactions]);

  const burndown = useMemo(() => {
    if (!startDate || !endDate) return null;
    return {
      curr: cumulativeByDay(transactions, startDate, endDate),
      priorCum: cumulativeByDay(prior.prior, prior.priorStart, prior.priorEnd),
    };
  }, [transactions, prior, startDate, endDate]);

  if (stats.txnCount === 0) return null;

  const hasPrior = prior.prior.length > 0;
  const netDelta = hasPrior ? delta(stats.netSpend, priorStats.netSpend) : null;
  const dailyDelta = hasPrior ? delta(stats.dailyAverage, priorStats.dailyAverage) : null;
  const avgTxnDelta = hasPrior ? delta(stats.avgTransaction, priorStats.avgTransaction) : null;
  const missing = receiptSummary?.coverage?.missing || 0;

  const lineData = burndown
    ? {
        labels: burndown.curr.map((d) => fmtShort(d.date)),
        datasets: [
          { label: "This period", data: burndown.curr.map((d) => d.cumulative), borderColor: p.accent, backgroundColor: p.accentFill, borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
          ...(hasPrior ? [{ label: "Previous period", data: burndown.priorCum.map((d) => d.cumulative), borderColor: p.prior, borderWidth: 1.5, borderDash: [4, 4], fill: false, tension: 0.3, pointRadius: 0 }] : []),
        ],
      }
    : {
        labels: daily.map((d) => fmtShort(d.date)),
        datasets: [{ label: "Spend", data: daily.map((d) => d.amount), borderColor: p.accent, backgroundColor: p.accentFill, borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 }],
      };
  const lineOpts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip: tooltip(p, (ctx) => `${ctx.dataset.label}: ${fmtINR(ctx.parsed.y)}`) },
    scales: axes(p),
  };

  const doughnutData = {
    labels: cats.map((c) => labelOf(c.category)),
    datasets: [{ data: cats.map((c) => c.amount), backgroundColor: cats.map((c) => colorOf(c.category)), borderColor: p.surface, borderWidth: 2 }],
  };
  const doughnutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "72%",
    plugins: { legend: { display: false }, tooltip: tooltip(p, (ctx) => `${fmtINR(ctx.parsed)} · ${cats[ctx.dataIndex].pct.toFixed(0)}%`) },
  };

  const maxDow = Math.max(...dow.map((r) => r.amount), 1);
  const dowData = {
    labels: dow.map((r) => r.label),
    datasets: [{ data: dow.map((r) => r.amount), backgroundColor: dow.map((r) => (r.amount === maxDow ? p.accent : p.accentFill)), borderRadius: 4, barPercentage: 0.7 }],
  };
  const dowOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tooltip(p) }, scales: axes(p) };

  const maxCat = cats[0]?.amount || 1;
  const topCat = cats[0];

  return (
    <div className="stack">
      {missing > 0 && (
        <Banner
          title={`${missing} charge${missing === 1 ? "" : "s"} still need a receipt`}
          action={<Button variant="primary" onClick={onOpenReceipts}>Review</Button>}
        >
          {receiptSummary?.coverage?.coveragePct ?? 0}% of this cycle is covered · cycle ends {receiptSummary?.cycle?.end ? fmtShort(receiptSummary.cycle.end) : "soon"}
        </Banner>
      )}

      <div className="grid grid-main">
        <div className="stack">
          {/* Hero: the one number, then the pace behind it */}
          <Card padLg>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 32px", alignItems: "flex-end" }}>
              <div className="kpi">
                <span className="label">Net spend</span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span className="v lg num">{fmtINR(stats.netSpend)}</span>
                  {netDelta && <DeltaBadge delta={netDelta} invert />}
                </span>
                <span className="s">
                  {stats.txnCount} purchases · {stats.activeDays} active days
                  {stats.refundCount > 0 && <span style={{ color: "var(--success)" }}> · {fmtINR(stats.totalRefunds)} refunded</span>}
                </span>
              </div>
              <div className="kpi-row" style={{ marginLeft: isMobile ? 0 : "auto" }}>
                <Kpi label="Daily avg" value={fmtINR(stats.dailyAverage)}>{dailyDelta && <DeltaBadge delta={dailyDelta} invert compact />}</Kpi>
                <Kpi label="Avg charge" value={fmtINR(stats.avgTransaction)}>{avgTxnDelta && <DeltaBadge delta={avgTxnDelta} invert compact />}</Kpi>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", margin: "18px 0 8px", flexWrap: "wrap" }}>
              <span className="label">{burndown ? "Cumulative pace" : "Daily spend"}</span>
              {burndown && hasPrior && (
                <span className="small muted" style={{ display: "flex", gap: 12 }}>
                  <span><span style={{ display: "inline-block", width: 14, height: 2, background: p.accent, verticalAlign: "middle", marginRight: 6 }} />This period</span>
                  <span><span style={{ display: "inline-block", width: 14, borderTop: `2px dashed ${p.prior}`, verticalAlign: "middle", marginRight: 6 }} />Previous</span>
                </span>
              )}
            </div>
            <div className="chart-box" style={{ height: isMobile ? 170 : 220 }}>
              <Line data={lineData} options={lineOpts} />
            </div>
          </Card>

          <Card title="Where it went" action={<button className="link" onClick={() => onOpenTab("reports")}>Full report</button>}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "160px minmax(0, 1fr)", gap: 20, alignItems: "center" }}>
              <div className="chart-box" style={{ height: 160, maxWidth: 160, margin: isMobile ? "0 auto" : 0 }}>
                <Doughnut data={doughnutData} options={doughnutOpts} />
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none" }}>
                  <div>
                    <div className="label" style={{ fontSize: 10 }}>Top</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{topCat ? labelOf(topCat.category) : "—"}</div>
                    <div className="num small muted">{topCat ? `${topCat.pct.toFixed(0)}%` : ""}</div>
                  </div>
                </div>
              </div>
              <div>
                {cats.slice(0, 6).map((c) => {
                  const pc = priorCats.find((x) => x.category === c.category);
                  const drift = hasPrior && pc ? c.pct - pc.pct : null;
                  return (
                    <BarRow
                      key={c.category}
                      label={labelOf(c.category)}
                      value={fmtINR(c.amount)}
                      pct={(c.amount / maxCat) * 100}
                      color={colorOf(c.category)}
                      right={drift !== null && Math.abs(drift) >= 1 ? (
                        <span style={{ marginLeft: 8, fontSize: 11, color: drift > 0 ? "var(--danger)" : "var(--success)" }}>{drift > 0 ? "▲" : "▼"}{Math.abs(drift).toFixed(0)}pp</span>
                      ) : null}
                    />
                  );
                })}
              </div>
            </div>
          </Card>

          <div className="grid grid-2">
            <Card title="By weekday">
              <div className="chart-box" style={{ height: 170 }}>
                <Bar data={dowData} options={dowOpts} />
              </div>
            </Card>
            <Card title="When you spend" hint="day × time">
              {heat.max > 0 ? (
                <HeatmapDOWHour matrix={heat.matrix} max={heat.max} accent={p.accent} isMobile={isMobile} />
              ) : (
                <p className="small muted" style={{ padding: "24px 0", textAlign: "center" }}>Times appear once a full sync backfills them.</p>
              )}
            </Card>
          </div>
        </div>

        <div className="stack">
          <Card title="Recent" flush action={<button className="link" onClick={() => onOpenTab("transactions")}>View all</button>}>
            <div>
              {recent.map((t) => (
                <button key={t.id} className="list-row" onClick={() => onSelect?.(t)}>
                  <MerchantAvatar name={normalizeMerchant(t.merchant)} color={colorOf(t.category)} />
                  <span className="grow">
                    <div className="title">{normalizeMerchant(t.merchant)}</div>
                    <div className="meta">{labelOf(t.category)} · {fmtShort(t.date)}</div>
                  </span>
                  <span className="amt" style={t.isRefund ? { color: "var(--success)" } : undefined}>{t.isRefund ? "+" : ""}{fmtINR(t.amount)}</span>
                </button>
              ))}
            </div>
          </Card>

          {projection && <ProjectionCard projection={projection} />}

          {anomList.length > 0 && (
            <Card title="Unusual charges" hint="well above that merchant's norm" flush>
              <div>
                {anomList.map((a) => (
                  <button key={a.txn.id} className="list-row" onClick={() => onSelect?.(a.txn)}>
                    <span className="grow">
                      <div className="title" style={{ display: "flex", gap: 6, alignItems: "center" }}>{normalizeMerchant(a.txn.merchant)} <AnomalyBadge baseline={a.baseline} sigma={a.sigma} compact /></div>
                      <div className="meta">{fmtShort(a.txn.date)} · usually {fmtINR(a.baseline)}</div>
                    </span>
                    <span className="amt">{fmtINR(a.txn.amount)}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <Card title="Top merchants" flush>
            <div>
              {merchants.map((m) => (
                <div key={m.merchant} className="list-row">
                  <MerchantAvatar name={m.merchant} color={colorOf(m.category)} />
                  <span className="grow">
                    <div className="title">{m.merchant}</div>
                    <div className="meta">{m.count} charge{m.count === 1 ? "" : "s"}</div>
                  </span>
                  <Sparkline data={sparks[m.merchant] || []} color={colorOf(m.category)} width={56} height={20} />
                  <span className="amt" style={{ minWidth: 76 }}>{fmtINR(m.total)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ProjectionCard({ projection }) {
  const pace = projection.paceVsLastMonth;
  const tone = pace === null ? null : pace > 5 ? "bad" : pace < -5 ? "ok" : null;
  const pctOfMonth = projection.projected > 0 ? Math.min(100, (projection.mtdSpend / projection.projected) * 100) : 0;
  return (
    <Card title="This month" hint={`${projection.daysRemaining} days left`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <Kpi label="Projected month-end" value={fmtINR(projection.projected)} sub={`${fmtINR(projection.mtdSpend)} spent so far`} />
        {pace !== null && <Chip tone={tone}>{pace > 0 ? "▲" : "▼"} {Math.abs(pace).toFixed(0)}% vs last month</Chip>}
      </div>
      <div className="bar-track" style={{ marginTop: 12 }}>
        <div className="bar-fill" style={{ width: `${pctOfMonth}%` }} />
      </div>
    </Card>
  );
}
