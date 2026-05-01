"use client";

export default function Sparkline({ data, color = "#7C3AED", width = 80, height = 24, strokeWidth = 1.5 }) {
  if (!data || data.length === 0) {
    return <div style={{ width, height }} />;
  }
  const values = data.map((d) => (typeof d === "number" ? d : d.amount || 0));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = values[values.length - 1];
  const lastX = (values.length - 1) * stepX;
  const lastY = height - ((last - min) / range) * (height - 2) - 1;

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.8}
      />
      <circle cx={lastX} cy={lastY} r={2} fill={color} />
    </svg>
  );
}
