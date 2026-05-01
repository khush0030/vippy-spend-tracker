"use client";

import { useMemo } from "react";
import { Chart as ChartJS, Tooltip } from "chart.js";
import { TreemapController, TreemapElement } from "chartjs-chart-treemap";
import { Chart } from "react-chartjs-2";
import { byCategory, colorOf, labelOf, fmtINR } from "./aggregations";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(TreemapController, TreemapElement, Tooltip);
  registered = true;
}

export default function CategoryTreemap({ transactions, isMobile }) {
  registerOnce();
  const rows = useMemo(() => byCategory(transactions), [transactions]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  const data = useMemo(
    () => ({
      datasets: [
        {
          tree: rows,
          key: "amount",
          labels: { display: false },
          backgroundColor: (ctx) => {
            const r = ctx.raw?._data;
            return r ? colorOf(r.category) : "transparent";
          },
          borderColor: "var(--bg-card)",
          borderWidth: 2,
          spacing: 1,
        },
      ],
    }),
    [rows]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: () => "",
            label: (ctx) => {
              const r = ctx.raw?._data;
              if (!r) return "";
              const pct = total > 0 ? ((r.amount / total) * 100).toFixed(0) : 0;
              return `${labelOf(r.category)} · ${fmtINR(r.amount)} · ${pct}%`;
            },
          },
        },
      },
    }),
    [total]
  );

  return (
    <div className="chart-card" style={{ height: isMobile ? 220 : 260 }}>
      <Chart type="treemap" data={data} options={options} />
    </div>
  );
}
