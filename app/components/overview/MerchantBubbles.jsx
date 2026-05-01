"use client";

import { useMemo } from "react";
import { Chart as ChartJS, PointElement, LinearScale, Tooltip } from "chart.js";
import { Bubble } from "react-chartjs-2";
import { byMerchant, colorOf, labelOf, fmtINR } from "./aggregations";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(PointElement, LinearScale, Tooltip);
  registered = true;
}

export default function MerchantBubbles({ transactions, chartColors = {}, isMobile }) {
  registerOnce();
  const merchants = useMemo(() => byMerchant(transactions, 25), [transactions]);

  const maxTotal = useMemo(() => merchants.reduce((m, e) => Math.max(m, e.total), 0), [merchants]);

  const data = useMemo(
    () => ({
      datasets: [
        {
          data: merchants.map((m) => ({
            x: m.avgHour,
            y: m.count,
            r: maxTotal > 0 ? 4 + Math.sqrt(m.total / maxTotal) * (isMobile ? 18 : 26) : 4,
            _m: m,
          })),
          backgroundColor: merchants.map((m) => `color-mix(in srgb, ${colorOf(m.category)} 60%, transparent)`),
          borderColor: merchants.map((m) => colorOf(m.category)),
          borderWidth: 1.5,
        },
      ],
    }),
    [merchants, maxTotal, isMobile]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].raw._m.merchant,
            label: (ctx) => {
              const m = ctx.raw._m;
              const hr = Math.floor(m.avgHour);
              return [
                `${labelOf(m.category)}`,
                `${fmtINR(m.total)} · ${m.count} txns`,
                `~${String(hr).padStart(2, "0")}:${String(Math.round((m.avgHour - hr) * 60)).padStart(2, "0")}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          min: 0,
          max: 24,
          ticks: {
            stepSize: 6,
            color: chartColors.textLight || "#64748B",
            font: { size: 10 },
            callback: (v) => (v % 6 === 0 ? `${v}h` : ""),
          },
          grid: { color: chartColors.grid || "rgba(255,255,255,0.04)" },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { display: false },
          grid: { display: false },
          border: { display: false },
        },
      },
    }),
    [chartColors]
  );

  return (
    <div className="chart-card" style={{ height: isMobile ? 220 : 260 }}>
      <Bubble data={data} options={options} />
    </div>
  );
}
