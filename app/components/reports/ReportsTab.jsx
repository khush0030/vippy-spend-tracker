"use client";

import { useMemo } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from "chart.js";
import { Bar } from "react-chartjs-2";
import {
  byCategory,
  topMerchants,
  summarize,
  colorOf,
  labelOf,
  fmtINR,
  fmtINRcompact,
  priorWindow,
  delta,
  recurringVsDiscretionary,
  topMovers,
  spendHistogram,
  refundRecoveryByCategory,
} from "../overview/aggregations";
import DeltaBadge from "../shared/DeltaBadge";
import { BarRow, Button, Card, Kpi, MerchantAvatar } from "../ui/kit";
import { axes, chartPalette, tooltip } from "../ui/chart-theme";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);
  registered = true;
}

const fmtPeriod = (s, e) => {
  if (!s && !e) return "All time";
  const o = { day: "numeric", month: "short", year: "numeric" };
  const sd = s ? new Date(s + "T00:00:00").toLocaleDateString("en-IN", o) : "Earliest";
  const ed = e ? new Date(e + "T00:00:00").toLocaleDateString("en-IN", o) : "Today";
  return `${sd} – ${ed}`;
};

export default function ReportsTab({ transactions, allTransactions, startDate, endDate, isMobile, chartColors }) {
  registerOnce();
  const p = chartColors || chartPalette("light");
  const stats = useMemo(() => summarize(transactions), [transactions]);
  const cats = useMemo(() => byCategory(transactions), [transactions]);
  const merchants = useMemo(() => topMerchants(transactions, 10), [transactions]);
  const recurring = useMemo(() => recurringVsDiscretionary(transactions), [transactions]);
  const histogram = useMemo(() => spendHistogram(transactions), [transactions]);
  const refunds = useMemo(() => refundRecoveryByCategory(transactions), [transactions]);

  const prior = useMemo(() => priorWindow(allTransactions || [], startDate, endDate), [allTransactions, startDate, endDate]);
  const priorStats = useMemo(() => summarize(prior.prior), [prior.prior]);
  const priorCats = useMemo(() => byCategory(prior.prior), [prior.prior]);
  const movers = useMemo(() => topMovers(transactions, prior.prior, 3), [transactions, prior.prior]);

  const hasPrior = prior.prior.length > 0;
  const netDelta = hasPrior ? delta(stats.netSpend, priorStats.netSpend) : null;
  const txnDelta = hasPrior ? delta(stats.txnCount, priorStats.txnCount) : null;
  const refundDelta = hasPrior ? delta(stats.totalRefunds, priorStats.totalRefunds) : null;
  const avgDelta = hasPrior ? delta(stats.avgTransaction, priorStats.avgTransaction) : null;

  const download = (format) => {
    const q = new URLSearchParams({ format });
    if (startDate) q.set("start", startDate);
    if (endDate) q.set("end", endDate);
    window.open(`/api/reports?${q.toString()}`, "_blank");
  };

  const histData = {
    labels: histogram.map((h) => h.label),
    datasets: [{ data: histogram.map((h) => h.count), backgroundColor: p.accent, borderRadius: 4, barPercentage: 0.7 }],
  };
  const histOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: tooltip(p, (ctx) => `${ctx.parsed.y} charges · ${fmtINRcompact(histogram[ctx.dataIndex].sum)}`),
    },
    scales: axes(p, { yCompact: false }),
  };

  const maxMerchant = merchants[0]?.total || 1;

  return (
    <div className="stack report">
      <Card padLg>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ marginRight: "auto" }}>
            <div className="label">Period report</div>
            <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 2 }}>{fmtPeriod(startDate, endDate)}</div>
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" icon="file" onClick={() => window.print()}>Save as PDF</Button>
            <Button icon="download" onClick={() => download("csv")}>CSV</Button>
            <Button icon="download" onClick={() => download("json")}>JSON</Button>
          </div>
        </div>
        <div className="grid grid-4" style={{ gap: 16 }}>
          <Kpi label="Net spend" value={fmtINR(stats.netSpend)}>{netDelta && <DeltaBadge delta={netDelta} invert compact />}</Kpi>
          <Kpi label="Charges" value={stats.txnCount}>{txnDelta && <DeltaBadge delta={txnDelta} invert compact />}</Kpi>
          <Kpi label="Refunds" value={fmtINR(stats.totalRefunds)} sub={`${stats.refundCount} returns`}>{refundDelta && <DeltaBadge delta={refundDelta} compact />}</Kpi>
          <Kpi label="Avg charge" value={fmtINR(stats.avgTransaction)}>{avgDelta && <DeltaBadge delta={avgDelta} invert compact />}</Kpi>
        </div>
      </Card>

      {recurring.total > 0 && (
        <Card title="Recurring vs one-off">
          <div style={{ display: "flex", height: 12, borderRadius: 99, overflow: "hidden", background: "var(--bg-card-2)" }}>
            <div style={{ width: `${recurring.recurringPct}%`, background: "var(--info)" }} title={`Recurring · ${fmtINR(recurring.recurring)}`} />
            <div style={{ width: `${recurring.discretionaryPct}%`, background: p.accent }} title={`One-off · ${fmtINR(recurring.discretionary)}`} />
          </div>
          <div style={{ display: "flex", gap: 28, marginTop: 12, flexWrap: "wrap" }}>
            <Legend color="var(--info)" label="Recurring" value={fmtINR(recurring.recurring)} pct={recurring.recurringPct} />
            <Legend color={p.accent} label="One-off" value={fmtINR(recurring.discretionary)} pct={recurring.discretionaryPct} />
          </div>
        </Card>
      )}

      {hasPrior && (movers.increases.length > 0 || movers.decreases.length > 0) && (
        <div className="grid grid-2">
          <MoverCard title="Biggest increases" items={movers.increases} tone="var(--danger)" />
          <MoverCard title="Biggest decreases" items={movers.decreases} tone="var(--success)" />
        </div>
      )}

      <Card title="By category" flush>
        {isMobile ? (
          <div style={{ padding: "4px 16px 12px" }}>
            {cats.map((c) => (
              <BarRow key={c.category} label={labelOf(c.category)} value={fmtINR(c.amount)} pct={c.pct} color={colorOf(c.category)} />
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 10, fontWeight: 700 }}>
              <span>Total</span><span className="num">{fmtINR(stats.totalSpend)}</span>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Category</th><th style={{ width: "28%" }}>Share</th><th className="r">Spend</th><th className="r">Charges</th><th className="r">Avg</th>{hasPrior && <th className="r">vs prior</th>}
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => {
                  const pc = priorCats.find((x) => x.category === c.category);
                  const d = pc ? delta(c.amount, pc.amount) : null;
                  return (
                    <tr key={c.category}>
                      <td><span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(c.category) }} />{labelOf(c.category)}</span></td>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="bar-track" style={{ flex: 1 }}><span className="bar-fill" style={{ display: "block", width: `${c.pct}%`, background: colorOf(c.category) }} /></span>
                          <span className="num small muted" style={{ width: 40, textAlign: "right" }}>{c.pct.toFixed(1)}%</span>
                        </span>
                      </td>
                      <td className="r num">{fmtINR(c.amount)}</td>
                      <td className="r num muted">{c.count}</td>
                      <td className="r num muted">{fmtINR(c.amount / c.count)}</td>
                      {hasPrior && <td className="r">{d ? <DeltaBadge delta={d} invert compact /> : <span className="small muted">new</span>}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td><td /><td className="r num">{fmtINR(stats.totalSpend)}</td><td className="r num">{stats.txnCount}</td><td className="r num">{fmtINR(stats.avgTransaction)}</td>{hasPrior && <td className="r">{netDelta && <DeltaBadge delta={netDelta} invert compact />}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-2">
        <Card title="Charge sizes" hint="how many charges fall in each band">
          <div className="chart-box" style={{ height: 200 }}>
            <Bar data={histData} options={histOpts} />
          </div>
        </Card>

        <Card title="Top merchants" flush>
          <div>
            {merchants.map((m) => (
              <div key={m.merchant} className="list-row" style={{ padding: "8px 16px" }}>
                <MerchantAvatar name={m.merchant} color={colorOf(m.category)} />
                <span className="grow">
                  <div className="title">{m.merchant}</div>
                  <div className="bar-track" style={{ height: 5, marginTop: 5 }}><div className="bar-fill" style={{ width: `${(m.total / maxMerchant) * 100}%`, background: colorOf(m.category) }} /></div>
                </span>
                <span className="amt" style={{ minWidth: 80 }}>{fmtINR(m.total)}<div className="meta" style={{ textAlign: "right" }}>{m.count} charges</div></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {refunds.length > 0 && (
        <Card title="Refunds recovered" flush>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Category</th>{!isMobile && <th className="r">Spent</th>}<th className="r">Refunded</th><th className="r">Rate</th></tr></thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.category}>
                    <td><span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(r.category) }} />{labelOf(r.category)}</span></td>
                    {!isMobile && <td className="r num muted">{fmtINR(r.spend)}</td>}
                    <td className="r num" style={{ color: "var(--success)" }}>{fmtINR(r.refund)}</td>
                    <td className="r num">{r.rate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Legend({ color, label, value, pct }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, marginTop: 4 }} />
      <div>
        <div className="small muted">{label} · {pct.toFixed(0)}%</div>
        <div className="num" style={{ fontSize: 16, fontWeight: 500 }}>{value}</div>
      </div>
    </div>
  );
}

function MoverCard({ title, items, tone }) {
  return (
    <Card title={title}>
      {items.length === 0 ? (
        <p className="small muted">No notable changes.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((m) => (
            <div key={m.category} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(m.category), flex: "none" }} />
              <span style={{ flex: 1, fontWeight: 600 }}>{labelOf(m.category)}</span>
              <span className="num small muted hide-mobile">{fmtINR(m.prevAmount)} → {fmtINR(m.currAmount)}</span>
              <span className="num" style={{ color: tone, minWidth: 72, textAlign: "right" }}>{m.deltaAbs > 0 ? "+" : "−"}{fmtINR(Math.abs(m.deltaAbs))}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
