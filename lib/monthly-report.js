import { Resend } from "resend";
import { getSupabase } from "@/lib/supabase";
import { buildMonthlyReportPdf, aggregate as pdfAggregate } from "@/lib/report-pdf";

const CATEGORY_META = {
  amazon: { label: "Amazon", color: "#FF9900" },
  fuel: { label: "Fuel", color: "#4CAF50" },
  dining: { label: "Dining", color: "#E91E63" },
  swiggy: { label: "Swiggy", color: "#FC8019" },
  utilities: { label: "Utilities", color: "#2196F3" },
  subscriptions: { label: "Subscriptions", color: "#9C27B0" },
  office: { label: "Office", color: "#607D8B" },
  travel: { label: "Travel", color: "#00BCD4" },
  other: { label: "Other", color: "#795548" },
};

const INR = (n) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function quickchartUrl(config) {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&backgroundColor=white&width=600&height=340`;
}

function buildDoughnutUrl(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => v > 0);
  return quickchartUrl({
    type: "doughnut",
    data: {
      labels: entries.map(([k]) => CATEGORY_META[k]?.label || k),
      datasets: [
        {
          data: entries.map(([, v]) => Number(v.toFixed(2))),
          backgroundColor: entries.map(([k]) => CATEGORY_META[k]?.color || "#888"),
        },
      ],
    },
    options: {
      plugins: {
        legend: { position: "right" },
        title: { display: true, text: "Spend by category" },
      },
    },
  });
}

function buildDailyBarUrl(byDay) {
  const days = Object.keys(byDay).sort();
  return quickchartUrl({
    type: "bar",
    data: {
      labels: days.map((d) => d.slice(5)),
      datasets: [
        {
          label: "Daily spend (₹)",
          data: days.map((d) => Number(byDay[d].toFixed(2))),
          backgroundColor: "#1e40af",
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Daily spend" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

function aggregate(transactions) {
  let total = 0;
  let refundTotal = 0;
  let txCount = 0;
  let refundCount = 0;
  const byCategory = {};
  const byDay = {};
  const byMerchant = {};

  for (const t of transactions) {
    const amt = Number(t.amount) || 0;
    if (t.is_refund) {
      refundTotal += amt;
      refundCount += 1;
    } else {
      total += amt;
      txCount += 1;
      byCategory[t.category] = (byCategory[t.category] || 0) + amt;
      byDay[t.date] = (byDay[t.date] || 0) + amt;
      byMerchant[t.merchant] = (byMerchant[t.merchant] || 0) + amt;
    }
  }

  const topMerchants = Object.entries(byMerchant)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    total,
    refundTotal,
    txCount,
    refundCount,
    net: total - refundTotal,
    byCategory,
    byDay,
    topMerchants,
  };
}

function renderHtml({ user, periodLabel, transactions, stats, doughnutUrl, barUrl }) {
  const catRows = Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => {
      const meta = CATEGORY_META[cat] || { label: cat, color: "#888" };
      const pct = ((amt / stats.total) * 100).toFixed(1);
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${meta.color};margin-right:8px;"></span>${meta.label}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${INR(amt)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#888;">${pct}%</td>
      </tr>`;
    })
    .join("");

  const merchantRows = stats.topMerchants
    .map(
      ([name, amt]) =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">${name}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">${INR(amt)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
    <div style="background:white;border-radius:12px;padding:28px;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:12px;color:#6b7280;letter-spacing:1px;text-transform:uppercase;">Vippy Spend Tracker</div>
        <h1 style="margin:6px 0 4px;font-size:22px;color:#111827;">${periodLabel} spending report</h1>
        <div style="font-size:13px;color:#6b7280;">${user.name || user.email}</div>
      </div>

      <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;background:#f9fafb;border-radius:10px;padding:16px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Total spent</div>
          <div style="font-size:24px;font-weight:700;color:#111827;margin-top:4px;">${INR(stats.total)}</div>
        </div>
        <div style="flex:1;min-width:140px;background:#f9fafb;border-radius:10px;padding:16px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Refunds</div>
          <div style="font-size:24px;font-weight:700;color:#065f46;margin-top:4px;">${INR(stats.refundTotal)}</div>
        </div>
        <div style="flex:1;min-width:140px;background:#f9fafb;border-radius:10px;padding:16px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Net</div>
          <div style="font-size:24px;font-weight:700;color:#111827;margin-top:4px;">${INR(stats.net)}</div>
        </div>
        <div style="flex:1;min-width:140px;background:#f9fafb;border-radius:10px;padding:16px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Transactions</div>
          <div style="font-size:24px;font-weight:700;color:#111827;margin-top:4px;">${stats.txCount}</div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <img src="${doughnutUrl}" alt="Spend by category" style="width:100%;max-width:600px;border-radius:8px;" />
      </div>

      <div style="margin-bottom:24px;">
        <img src="${barUrl}" alt="Daily spend" style="width:100%;max-width:600px;border-radius:8px;" />
      </div>

      <h2 style="font-size:14px;color:#111827;margin:24px 0 8px;">Category breakdown</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">
            <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Category</th>
            <th style="text-align:right;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Amount</th>
            <th style="text-align:right;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Share</th>
          </tr>
        </thead>
        <tbody>${catRows}</tbody>
      </table>

      <h2 style="font-size:14px;color:#111827;margin:24px 0 8px;">Top merchants</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tbody>${merchantRows}</tbody>
      </table>

      <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;">
        Generated by Vippy Spend Tracker · HDFC Corporate Card · Vippy Industries<br/>
        Sent on the 4th of every month when your credit card statement is available.
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Compute the "previous full calendar month" window in IST.
 * If called on 2026-04-04, returns 2026-03-01 → 2026-03-31.
 */
function previousMonthWindow(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth();
  const firstOfThis = new Date(Date.UTC(year, month, 1));
  const lastOfPrev = new Date(firstOfThis.getTime() - 86400000);
  const firstOfPrev = new Date(Date.UTC(lastOfPrev.getUTCFullYear(), lastOfPrev.getUTCMonth(), 1));
  const start = firstOfPrev.toISOString().split("T")[0];
  const end = lastOfPrev.toISOString().split("T")[0];
  const label = firstOfPrev.toLocaleString("en-IN", { month: "long", year: "numeric" });
  return { start, end, label };
}

export async function sendMonthlyReportForUser({ userId }) {
  const supabase = getSupabase();

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, email, name")
    .eq("id", userId)
    .single();

  if (userError || !user) throw new Error("User not found");
  if (!user.email) throw new Error("User has no email");

  const { start, end, label } = previousMonthWindow();

  const { data: transactions, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (txError) throw new Error(txError.message);

  if (!transactions || transactions.length === 0) {
    console.log(`[monthly-report] no transactions for ${user.email} in ${label}`);
    return { sent: false, reason: "no_transactions", period: label };
  }

  const stats = aggregate(transactions);
  const doughnutUrl = buildDoughnutUrl(stats.byCategory);
  const barUrl = buildDailyBarUrl(stats.byDay);
  const html = renderHtml({ user, periodLabel: label, transactions, stats, doughnutUrl, barUrl });

  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const pdfBuffer = await buildMonthlyReportPdf({
    user,
    periodLabel: label,
    periodStart: start,
    periodEnd: end,
    transactions,
    stats,
  });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.REPORT_FROM_EMAIL || "Vippy Tracker <onboarding@resend.dev>";

  const filename = `vippy-spend-report-${label.toLowerCase().replace(/\s+/g, "-")}.pdf`;

  const { data, error: sendError } = await resend.emails.send({
    from,
    to: user.email,
    subject: `${label} spending report — ${INR(stats.total)} across ${stats.txCount} transactions`,
    html,
    attachments: [
      {
        filename,
        content: pdfBuffer,
      },
    ],
  });

  if (sendError) throw new Error(sendError.message || "Failed to send email");

  return {
    sent: true,
    period: label,
    total: stats.total,
    txCount: stats.txCount,
    messageId: data?.id,
  };
}
