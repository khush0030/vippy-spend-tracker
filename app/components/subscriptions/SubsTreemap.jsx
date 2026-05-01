"use client";

import { useMemo } from "react";
import { Chart as ChartJS, Tooltip } from "chart.js";
import { TreemapController, TreemapElement } from "chartjs-chart-treemap";
import { Chart } from "react-chartjs-2";
import { CYCLE_COLORS } from "./aggregations";
import { fmtINR } from "../overview/aggregations";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(TreemapController, TreemapElement, Tooltip);
  registered = true;
}

export default function SubsTreemap({ subs, isMobile }) {
  registerOnce();
  const tree = useMemo(() => subs.filter((s) => s.monthlyEst > 0), [subs]);
  const total = useMemo(() => tree.reduce((s, e) => s + e.monthlyEst, 0), [tree]);

  const data = useMemo(
    () => ({
      datasets: [
        {
          tree,
          key: "monthlyEst",
          labels: {
            display: true,
            color: "#fff",
            font: { family: "var(--font-display)", weight: 700, size: 11 },
            formatter: (ctx) => ctx.raw?._data?.merchant || "",
          },
          backgroundColor: (ctx) => {
            const r = ctx.raw?._data;
            return r ? CYCLE_COLORS[r.cycle] || CYCLE_COLORS["one-time"] : "transparent";
          },
          borderColor: "var(--bg-card)",
          borderWidth: 2,
          spacing: 1,
        },
      ],
    }),
    [tree]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].raw?._data?.merchant || "",
            label: (ctx) => {
              const r = ctx.raw?._data;
              if (!r) return "";
              const pct = total > 0 ? ((r.monthlyEst / total) * 100).toFixed(0) : 0;
              return [`${r.cycle} · ${fmtINR(r.monthlyEst)}/mo`, `${pct}% of monthly recurring`];
            },
          },
        },
      },
    }),
    [total]
  );

  return (
    <div className="chart-card" style={{ height: isMobile ? 260 : 340 }}>
      <Chart type="treemap" data={data} options={options} />
    </div>
  );
}
