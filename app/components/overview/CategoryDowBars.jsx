"use client";

import { useMemo } from "react";
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip } from "chart.js";
import { Bar } from "react-chartjs-2";
import { byCategoryDow, colorOf, labelOf, fmtINR, DOW_FULL } from "./aggregations";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);
  registered = true;
}

export default function CategoryDowBars({ transactions, chartColors = {}, isMobile }) {
  registerOnce();
  const { categories, grid } = useMemo(() => byCategoryDow(transactions), [transactions]);

  const data = useMemo(
    () => ({
      labels: categories.map(labelOf),
      datasets: DOW_FULL.map((d, i) => ({
        label: d,
        data: categories.map((c) => grid[c][i]),
        backgroundColor: categories.map((c) => `color-mix(in srgb, ${colorOf(c)} ${30 + i * 10}%, transparent)`),
        borderRadius: 2,
        stack: "spend",
        barPercentage: 0.8,
      })),
    }),
    [categories, grid]
  );

  const options = useMemo(
    () => ({
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => labelOf(categories[items[0].dataIndex]),
            label: (ctx) => `${ctx.dataset.label} · ${fmtINR(ctx.parsed.x || 0)}`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { display: false },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          stacked: true,
          ticks: {
            color: chartColors.text || "#94A3B8",
            font: { size: 11, family: "var(--font-display)", weight: 600 },
          },
          grid: { display: false },
          border: { display: false },
        },
      },
    }),
    [chartColors, categories]
  );

  return (
    <div className="chart-card" style={{ height: isMobile ? 200 : 260 }}>
      <Bar data={data} options={options} />
    </div>
  );
}
