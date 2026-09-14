"use client";

import { fmtINR } from "../overview/aggregations";

export default function AnomalyBadge({ baseline, sigma }) {
  return (
    <span className="chip warn" title={`${sigma.toFixed(1)}σ above the usual ${fmtINR(baseline)}`} style={{ fontSize: 10, padding: "1px 6px" }}>
      Unusual
    </span>
  );
}
