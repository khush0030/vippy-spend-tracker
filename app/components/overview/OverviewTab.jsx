"use client";

import CalendarHeatmap from "./CalendarHeatmap";
import HourDowMatrix from "./HourDowMatrix";
import CategoryTreemap from "./CategoryTreemap";
import CategoryDowBars from "./CategoryDowBars";
import MerchantBubbles from "./MerchantBubbles";
import { byCategory, colorOf, labelOf, purchasesOnly } from "./aggregations";

export default function OverviewTab({ transactions, isMobile, chartColors = {} }) {
  if (purchasesOnly(transactions).length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 64, color: "var(--text-muted)", fontSize: 13 }}>
        No purchases in this period.
      </div>
    );
  }

  const cats = byCategory(transactions);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CalendarHeatmap transactions={transactions} isMobile={isMobile} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 7fr) minmax(0, 5fr)",
          gap: 16,
        }}
      >
        <HourDowMatrix transactions={transactions} chartColors={chartColors} isMobile={isMobile} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 4px" }}>
            {cats.slice(0, 9).map((c) => (
              <span
                key={c.category}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-display)",
                  letterSpacing: 0.3,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 2,
                    background: colorOf(c.category),
                    display: "inline-block",
                  }}
                />
                {labelOf(c.category)}
              </span>
            ))}
          </div>
          <CategoryTreemap transactions={transactions} isMobile={isMobile} />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 7fr) minmax(0, 5fr)",
          gap: 16,
        }}
      >
        <CategoryDowBars transactions={transactions} chartColors={chartColors} isMobile={isMobile} />
        <MerchantBubbles transactions={transactions} chartColors={chartColors} isMobile={isMobile} />
      </div>
    </div>
  );
}
