"use client";

import { useEffect, useMemo, useRef } from "react";
import { Chart as ChartJS, Tooltip, LinearScale, CategoryScale } from "chart.js";
import { MatrixController, MatrixElement } from "chartjs-chart-matrix";
import { Chart } from "react-chartjs-2";
import { byDowHour, fmtINR, DOW_FULL } from "./aggregations";

let registered = false;
function registerOnce() {
  if (registered) return;
  ChartJS.register(MatrixController, MatrixElement, LinearScale, CategoryScale, Tooltip);
  registered = true;
}

export default function HourDowMatrix({ transactions, chartColors = {}, isMobile }) {
  registerOnce();
  const ref = useRef(null);
  const { points, max } = useMemo(() => byDowHour(transactions), [transactions]);

  const data = useMemo(
    () => ({
      datasets: [
        {
          label: "spend",
          data: points,
          backgroundColor: (ctx) => {
            const v = ctx.raw?.v ?? 0;
            if (max <= 0 || v === 0) return "var(--heat-empty)";
            const t = Math.pow(v / max, 0.55);
            return `color-mix(in srgb, var(--brand) ${Math.round(10 + t * 90)}%, var(--heat-empty))`;
          },
          borderWidth: 0,
          width: ({ chart }) => (chart.chartArea?.width || 0) / 24 - 2,
          height: ({ chart }) => (chart.chartArea?.height || 0) / 7 - 2,
        },
      ],
    }),
    [points, max]
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
              const r = ctx.raw;
              return `${DOW_FULL[r.y]} · ${String(r.x).padStart(2, "0")}:00 · ${r.v > 0 ? fmtINR(r.v) : "—"}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: -0.5,
          max: 23.5,
          offset: false,
          ticks: {
            stepSize: 6,
            color: chartColors.textLight || "#64748B",
            font: { size: 10 },
            callback: (v) => (v % 6 === 0 ? `${v}` : ""),
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          type: "linear",
          min: -0.5,
          max: 6.5,
          offset: false,
          reverse: true,
          ticks: {
            stepSize: 1,
            color: chartColors.textLight || "#64748B",
            font: { size: 10, family: "var(--font-display)" },
            callback: (v) => DOW_FULL[v]?.[0] ?? "",
          },
          grid: { display: false },
          border: { display: false },
        },
      },
    }),
    [chartColors]
  );

  return (
    <div className="chart-card" style={{ height: isMobile ? 180 : 220 }}>
      <Chart ref={ref} type="matrix" data={data} options={options} />
    </div>
  );
}
