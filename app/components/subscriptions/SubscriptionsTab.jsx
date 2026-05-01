"use client";

import { useMemo } from "react";
import { buildSubscriptions } from "./aggregations";
import SubsTreemap from "./SubsTreemap";
import RenewalStrip from "./RenewalStrip";
import RecurrenceDots from "./RecurrenceDots";

export default function SubscriptionsTab({ transactions, allTransactions, isMobile }) {
  const subs = useMemo(() => buildSubscriptions(allTransactions || transactions), [allTransactions, transactions]);

  if (subs.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 64, color: "var(--text-muted)", fontSize: 13 }}>
        No subscriptions detected yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SubsTreemap subs={subs} isMobile={isMobile} />
      <RenewalStrip subs={subs} isMobile={isMobile} />
      <RecurrenceDots subs={subs} isMobile={isMobile} />
    </div>
  );
}
