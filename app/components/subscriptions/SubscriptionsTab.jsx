"use client";

import { useMemo, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from "chart.js";
import { Line } from "react-chartjs-2";
import { buildSubscriptions, CYCLE_COLORS, upcoming30Days, priceHikes, monthlyRamp } from "./aggregations";
import { fmtINR, summarize, recurringVsDiscretionary } from "../overview/aggregations";
import { Card, Chip, Empty, Kpi, MerchantAvatar, Segmented } from "../ui/kit";
import { axes, chartPalette, tooltip } from "../ui/chart-theme";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);
  registered = true;
}

const CYCLE_LABEL = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", irregular: "Irregular", "one-time": "One-time" };

function CycleBadge({ cycle }) {
  const color = CYCLE_COLORS[cycle] || CYCLE_COLORS["one-time"];
  return (
    <span className="chip" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      {CYCLE_LABEL[cycle] || cycle}
    </span>
  );
}

const fmtRelativeDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff > 0 && diff < 31) return `in ${diff} days`;
  if (diff < 0 && diff > -31) return `${-diff} days ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const fmtShortDate = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");

export default function SubscriptionsTab({ transactions, allTransactions, isMobile, chartColors }) {
  registerOnce();
  const p = chartColors || chartPalette("light");
  const allTxns = allTransactions || transactions;
  const subs = useMemo(() => buildSubscriptions(allTxns), [allTxns]);
  const upcoming = useMemo(() => upcoming30Days(subs), [subs]);
  const hikes = useMemo(() => priceHikes(allTxns), [allTxns]);
  const ramp = useMemo(() => monthlyRamp(allTxns, 12), [allTxns]);
  const recur = useMemo(() => recurringVsDiscretionary(transactions), [transactions]);
  const periodStats = useMemo(() => summarize(transactions), [transactions]);
  const [sortBy, setSortBy] = useState("monthlyEst");

  if (subs.length === 0) {
    return (
      <div className="card">
        <Empty icon="repeat" title="No subscriptions detected yet">
          A merchant shows up here once it has charged the card on a regular rhythm at least twice.
        </Empty>
      </div>
    );
  }

  const recurring = subs.filter((s) => ["monthly", "annual", "quarterly"].includes(s.cycle));
  const monthlyTotal = recurring.reduce((s, x) => s + x.monthlyEst, 0);
  const upcomingTotal = upcoming.reduce((s, u) => s + u.amount, 0);
  const lockedPct = periodStats.totalSpend > 0 ? (recur.recurring / periodStats.totalSpend) * 100 : 0;
  const hikeMap = Object.fromEntries(hikes.map((h) => [h.merchant, h]));

  const sorted = [...subs].sort((a, b) => {
    if (sortBy === "merchant") return a.merchant.localeCompare(b.merchant);
    if (sortBy === "nextDate") {
      if (!a.nextDate) return 1;
      if (!b.nextDate) return -1;
      return a.nextDate.localeCompare(b.nextDate);
    }
    return b.monthlyEst - a.monthlyEst;
  });

  const rampData = {
    labels: ramp.map((r) => new Date(r.month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short" })),
    datasets: [{ label: "Recurring", data: ramp.map((r) => r.monthlyRecurring), borderColor: p.accent, backgroundColor: p.accentFill, borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 }],
  };
  const rampOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tooltip(p) }, scales: axes(p) };

  return (
    <div className="stack">
      <Card padLg>
        <div className="grid grid-4" style={{ gap: 16 }}>
          <Kpi label="Active" value={recurring.length} sub={`of ${subs.length} repeat merchants`} />
          <Kpi label="Per month" value={fmtINR(monthlyTotal)} sub="estimated" />
          <Kpi label="Per year" value={fmtINR(monthlyTotal * 12)} sub="at today's rate" />
          <Kpi label="Locked-in share" value={`${lockedPct.toFixed(0)}%`} sub="of spend this period">
            <div className="bar-track" style={{ marginTop: 4 }}><div className="bar-fill" style={{ width: `${Math.min(100, lockedPct)}%` }} /></div>
          </Kpi>
        </div>
      </Card>

      <div className="grid grid-main">
        <Card title="Next 30 days" hint={upcoming.length ? `${fmtINR(upcomingTotal)} due` : "nothing due"}>
          {upcoming.length === 0 ? (
            <p className="small muted">No renewals expected in the next month.</p>
          ) : (
            <>
              <RenewalTimeline items={upcoming} />
              <div style={{ marginTop: 12 }}>
                {upcoming.map((u) => (
                  <div key={`${u.merchant}-${u.nextDate}`} className="list-row" style={{ padding: "9px 0" }}>
                    <MerchantAvatar name={u.merchant} color={CYCLE_COLORS[u.cycle] || CYCLE_COLORS["one-time"]} />
                    <span className="grow">
                      <div className="title">{u.merchant}</div>
                      <div className="meta">{fmtShortDate(u.nextDate)} · {u.daysAway === 0 ? "today" : `in ${u.daysAway} days`}</div>
                    </span>
                    {!isMobile && <CycleBadge cycle={u.cycle} />}
                    <span className="amt">{fmtINR(u.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <div className="stack">
          {ramp.some((r) => r.monthlyRecurring > 0) && (
            <Card title="Recurring cost" hint="last 12 months">
              <div className="chart-box" style={{ height: 170 }}>
                <Line data={rampData} options={rampOpts} />
              </div>
            </Card>
          )}
          {hikes.length > 0 && (
            <Card title="Price changes" flush>
              <div>
                {hikes.map((h) => (
                  <div key={h.merchant} className="list-row">
                    <span className="grow">
                      <div className="title">{h.merchant}</div>
                      <div className="meta num">{fmtINR(h.priorAvg)} → {fmtINR(h.recentAvg)} · {fmtShortDate(h.latest)}</div>
                    </span>
                    <Chip tone={h.deltaPct > 0 ? "bad" : "ok"}>{h.deltaPct > 0 ? "▲" : "▼"} {Math.abs(h.deltaPct).toFixed(0)}%</Chip>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card
        title="All subscriptions"
        flush
        action={<Segmented label="Sort" value={sortBy} onChange={setSortBy} options={[{ value: "monthlyEst", label: "Cost" }, { value: "nextDate", label: "Renewal" }, { value: "merchant", label: "Name" }]} />}
      >
        {isMobile ? (
          <div>
            {sorted.map((s) => {
              const trend = hikeMap[s.merchant];
              return (
                <div key={s.merchant} className="list-row">
                  <span className="grow">
                    <div className="title">{s.merchant}</div>
                    <div className="meta" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                      <CycleBadge cycle={s.cycle} />
                      <span>Next {fmtRelativeDate(s.nextDate)}</span>
                      {trend && <span style={{ color: trend.deltaPct > 0 ? "var(--danger)" : "var(--success)" }}>{trend.deltaPct > 0 ? "▲" : "▼"}{Math.abs(trend.deltaPct).toFixed(0)}%</span>}
                    </div>
                  </span>
                  <span className="amt">{fmtINR(s.monthlyEst)}<div className="meta" style={{ textAlign: "right" }}>/mo</div></span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Merchant</th><th>Cycle</th><th className="r">Per month</th><th className="r">Last charge</th><th className="r">Next renewal</th><th className="r">Trend</th></tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const trend = hikeMap[s.merchant];
                  return (
                    <tr key={s.merchant}>
                      <td style={{ fontWeight: 600 }}>{s.merchant}</td>
                      <td><CycleBadge cycle={s.cycle} /></td>
                      <td className="r num">{fmtINR(s.monthlyEst)}</td>
                      <td className="r muted">{fmtRelativeDate(s.lastDate)}</td>
                      <td className="r" style={{ color: s.nextDate ? "var(--text)" : "var(--text-muted)" }}>{fmtRelativeDate(s.nextDate)}</td>
                      <td className="r num">
                        {trend ? <span style={{ color: trend.deltaPct > 0 ? "var(--danger)" : "var(--success)" }}>{trend.deltaPct > 0 ? "▲" : "▼"} {Math.abs(trend.deltaPct).toFixed(0)}%</span> : <span className="muted">flat</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** A 30-day strip with a mark on each renewal, sized by amount. */
function RenewalTimeline({ items }) {
  const max = Math.max(...items.map((i) => i.amount), 1);
  return (
    <div aria-hidden="true">
      <div style={{ position: "relative", height: 44, margin: "4px 6px 0" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 30, height: 2, background: "var(--border)", borderRadius: 1 }} />
        {[0, 7, 14, 21, 30].map((d) => (
          <span key={d} style={{ position: "absolute", left: `${(d / 30) * 100}%`, top: 26, width: 1, height: 10, background: "var(--border-strong)" }} />
        ))}
        {items.map((u) => {
          const size = 8 + (u.amount / max) * 14;
          return (
            <span
              key={`${u.merchant}-${u.nextDate}`}
              title={`${u.merchant} · ${fmtINR(u.amount)}`}
              style={{
                position: "absolute",
                left: `${(Math.min(30, u.daysAway) / 30) * 100}%`,
                top: 31 - size / 2,
                width: size,
                height: size,
                transform: "translateX(-50%)",
                borderRadius: "50%",
                background: CYCLE_COLORS[u.cycle] || CYCLE_COLORS["one-time"],
                border: "2px solid var(--bg-card)",
              }}
            />
          );
        })}
      </div>
      <div className="num small muted" style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span>Today</span><span>+7d</span><span>+14d</span><span>+21d</span><span>+30d</span>
      </div>
    </div>
  );
}
