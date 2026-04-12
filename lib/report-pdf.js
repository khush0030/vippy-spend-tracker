import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

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

const INR = (n) =>
  "Rs." + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const INR_SHORT = (n) => {
  const num = Number(n) || 0;
  if (num >= 100000) return `Rs.${(num / 100000).toFixed(1)}L`;
  if (num >= 1000) return `Rs.${(num / 1000).toFixed(1)}k`;
  return `Rs.${num.toFixed(0)}`;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateShort(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00Z");
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function formatDateLong(isoDate) {
  if (!isoDate) return "";
  return new Date(isoDate + "T00:00:00Z").toLocaleDateString("en-IN", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function quickchartUrl(config, width, height) {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&backgroundColor=white&width=${width}&height=${height}&format=png&devicePixelRatio=2`;
}

async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`chart fetch failed ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function loadLogoBuffer() {
  try {
    const p = path.join(process.cwd(), "public", "vippy-logo.png");
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

// ---- CHART BUILDERS ----

function buildDoughnut(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return quickchartUrl(
    {
      type: "doughnut",
      data: {
        labels: entries.map(([k]) => CATEGORY_META[k]?.label || k),
        datasets: [
          {
            data: entries.map(([, v]) => Number(v.toFixed(2))),
            backgroundColor: entries.map(([k]) => CATEGORY_META[k]?.color || "#888"),
            borderWidth: 3,
            borderColor: "#ffffff",
          },
        ],
      },
      options: {
        layout: { padding: 20 },
        plugins: {
          legend: {
            position: "right",
            labels: {
              font: { size: 18, weight: "bold" },
              color: "#111827",
              padding: 14,
            },
          },
          title: {
            display: true,
            text: "SPEND BY CATEGORY",
            font: { size: 22, weight: "bold" },
            color: "#111827",
            padding: { bottom: 20 },
          },
          datalabels: {
            color: "#ffffff",
            font: { size: 16, weight: "bold" },
            formatter: (v) => {
              const pct = ((v / total) * 100).toFixed(0);
              return pct >= 5 ? `${pct}%` : "";
            },
          },
        },
      },
    },
    1200,
    600
  );
}

function buildDailyBar(byDay) {
  const days = Object.keys(byDay).sort();
  return quickchartUrl(
    {
      type: "bar",
      data: {
        labels: days.map((d) => {
          const dt = new Date(d + "T00:00:00Z");
          return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
        }),
        datasets: [
          {
            label: "Daily spend",
            data: days.map((d) => Number(byDay[d].toFixed(0))),
            backgroundColor: "#1e40af",
            borderRadius: 6,
          },
        ],
      },
      options: {
        layout: { padding: 20 },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "DAILY SPEND",
            font: { size: 22, weight: "bold" },
            color: "#111827",
            padding: { bottom: 20 },
          },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#111827",
            font: { size: 14, weight: "bold" },
            formatter: (v) => (v > 0 ? INR_SHORT(v) : ""),
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 16, weight: "bold" },
              color: "#374151",
              callback: (v) => INR_SHORT(v),
            },
            grid: { color: "#e5e7eb" },
          },
          x: {
            ticks: { font: { size: 14, weight: "bold" }, color: "#374151" },
            grid: { display: false },
          },
        },
      },
    },
    1200,
    540
  );
}

function buildMerchantBar(topMerchants) {
  const labels = topMerchants.map(([n]) => (n.length > 24 ? n.slice(0, 22) + "…" : n));
  const values = topMerchants.map(([, v]) => Number(v.toFixed(0)));
  return quickchartUrl(
    {
      type: "horizontalBar",
      data: {
        labels,
        datasets: [
          {
            label: "Amount",
            data: values,
            backgroundColor: "#0f766e",
            borderRadius: 6,
          },
        ],
      },
      options: {
        layout: { padding: { left: 20, right: 100, top: 20, bottom: 20 } },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "TOP MERCHANTS",
            font: { size: 22, weight: "bold" },
            color: "#111827",
            padding: { bottom: 20 },
          },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#111827",
            font: { size: 15, weight: "bold" },
            formatter: (v) => INR_SHORT(v),
          },
        },
        scales: {
          xAxes: [
            {
              ticks: {
                beginAtZero: true,
                fontSize: 14,
                fontStyle: "bold",
                fontColor: "#374151",
                callback: (v) => INR_SHORT(v),
              },
              gridLines: { color: "#e5e7eb" },
            },
          ],
          yAxes: [
            {
              ticks: {
                fontSize: 15,
                fontStyle: "bold",
                fontColor: "#111827",
              },
              gridLines: { display: false },
            },
          ],
        },
      },
    },
    1200,
    560
  );
}

function buildCumulativeLine(byDay) {
  const days = Object.keys(byDay).sort();
  let running = 0;
  const cum = days.map((d) => {
    running += byDay[d];
    return Number(running.toFixed(0));
  });
  return quickchartUrl(
    {
      type: "line",
      data: {
        labels: days.map((d) => {
          const dt = new Date(d + "T00:00:00Z");
          return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
        }),
        datasets: [
          {
            label: "Cumulative spend",
            data: cum,
            borderColor: "#b91c1c",
            backgroundColor: "rgba(185,28,28,0.1)",
            borderWidth: 4,
            fill: true,
            pointRadius: 5,
            pointBackgroundColor: "#b91c1c",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2,
            tension: 0.25,
          },
        ],
      },
      options: {
        layout: { padding: 20 },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "CUMULATIVE SPEND OVER PERIOD",
            font: { size: 22, weight: "bold" },
            color: "#111827",
            padding: { bottom: 20 },
          },
          datalabels: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 16, weight: "bold" },
              color: "#374151",
              callback: (v) => INR_SHORT(v),
            },
            grid: { color: "#e5e7eb" },
          },
          x: {
            ticks: { font: { size: 14, weight: "bold" }, color: "#374151" },
            grid: { display: false },
          },
        },
      },
    },
    1200,
    500
  );
}

// ---- AGGREGATION ----

export function aggregate(transactions) {
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

  const biggest = [...transactions]
    .filter((t) => !t.is_refund)
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0];

  const daysWithSpend = Object.keys(byDay).length;
  const avgPerDay = daysWithSpend > 0 ? total / daysWithSpend : 0;

  return {
    total,
    refundTotal,
    txCount,
    refundCount,
    net: total - refundTotal,
    byCategory,
    byDay,
    topMerchants,
    biggest,
    avgPerDay,
    daysWithSpend,
  };
}

// ---- PDF BUILDER ----

export async function buildMonthlyReportPdf({
  user,
  periodLabel,
  periodStart,
  periodEnd,
  transactions,
  stats,
}) {
  const [doughnutBuf, barBuf, merchantBuf, cumBuf] = await Promise.all([
    fetchImageBuffer(buildDoughnut(stats.byCategory)),
    fetchImageBuffer(buildDailyBar(stats.byDay)),
    fetchImageBuffer(buildMerchantBar(stats.topMerchants)),
    fetchImageBuffer(buildCumulativeLine(stats.byDay)),
  ]);
  const logoBuf = loadLogoBuffer();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 44 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageLeft = doc.page.margins.left;

    // ---- Header ----
    const headerY = doc.y;
    if (logoBuf) {
      try {
        doc.image(logoBuf, pageLeft, headerY, { width: 54, height: 54 });
      } catch {}
    }
    const textX = pageLeft + (logoBuf ? 68 : 0);
    doc
      .fillColor("#6b7280")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("VIPPY SPEND TRACKER", textX, headerY + 4, { characterSpacing: 1.4 });
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("Monthly Spending Report", textX, headerY + 18);
    doc
      .fillColor("#6b7280")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("HDFC Corporate Card  ·  Vippy Industries", textX, headerY + 44);

    doc.y = headerY + 68;
    doc.x = pageLeft;

    doc
      .moveTo(pageLeft, doc.y)
      .lineTo(pageLeft + pageWidth, doc.y)
      .lineWidth(1.8)
      .strokeColor("#111827")
      .stroke();
    doc.moveDown(0.5);

    // ---- Period banner ----
    const periodText =
      periodStart && periodEnd
        ? `${formatDateLong(periodStart)}  —  ${formatDateLong(periodEnd)}`
        : periodLabel;

    const bannerY = doc.y;
    const bannerH = 56;
    doc.roundedRect(pageLeft, bannerY, pageWidth, bannerH, 8).fill("#111827");
    doc
      .fillColor("#9ca3af")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("REPORTING PERIOD", pageLeft + 18, bannerY + 10, { characterSpacing: 1.6 });
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(15)
      .text(periodText, pageLeft + 18, bannerY + 24);

    const rightW = 200;
    const rightX = pageLeft + pageWidth - rightW - 18;
    doc
      .fillColor("#9ca3af")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("ACCOUNT", rightX, bannerY + 10, {
        width: rightW,
        align: "right",
        characterSpacing: 1.6,
      });
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(user.name || user.email, rightX, bannerY + 24, {
        width: rightW,
        align: "right",
      });

    doc.y = bannerY + bannerH + 14;
    doc.x = pageLeft;

    // ---- KPI row ----
    const kpis = [
      { label: "TOTAL SPENT", value: INR(stats.total) },
      { label: "REFUNDS", value: INR(stats.refundTotal), valueColor: "#065f46" },
      { label: "NET SPEND", value: INR(stats.net) },
      { label: "TRANSACTIONS", value: String(stats.txCount) },
    ];
    const colWidth = pageWidth / 4 - 8;
    const kpiY = doc.y;
    kpis.forEach((k, i) => {
      const x = pageLeft + i * (colWidth + 8);
      doc.roundedRect(x, kpiY, colWidth, 76, 8).lineWidth(1.2).fillAndStroke("#f9fafb", "#d1d5db");
      doc
        .fillColor("#6b7280")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(k.label, x + 14, kpiY + 13, {
          width: colWidth - 28,
          characterSpacing: 1.3,
        });
      doc
        .fillColor(k.valueColor || "#111827")
        .font("Helvetica-Bold")
        .fontSize(19)
        .text(k.value, x + 14, kpiY + 30, { width: colWidth - 28 });
    });
    doc.y = kpiY + 90;
    doc.x = pageLeft;

    // Secondary KPI row (avg per day + biggest txn)
    const kpis2 = [
      {
        label: "AVG / DAY",
        value: INR(stats.avgPerDay),
        sub: `${stats.daysWithSpend} active days`,
      },
      {
        label: "BIGGEST TXN",
        value: stats.biggest ? INR(stats.biggest.amount) : "—",
        sub: stats.biggest ? stats.biggest.merchant : "",
      },
    ];
    const col2Width = pageWidth / 2 - 4;
    const kpi2Y = doc.y;
    kpis2.forEach((k, i) => {
      const x = pageLeft + i * (col2Width + 8);
      doc.roundedRect(x, kpi2Y, col2Width, 62, 8).lineWidth(1.2).fillAndStroke("#f9fafb", "#d1d5db");
      doc
        .fillColor("#6b7280")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(k.label, x + 14, kpi2Y + 10, {
          width: col2Width - 28,
          characterSpacing: 1.3,
        });
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(17)
        .text(k.value, x + 14, kpi2Y + 24, { width: col2Width - 28 });
      if (k.sub) {
        doc
          .fillColor("#6b7280")
          .font("Helvetica-Bold")
          .fontSize(9)
          .text(k.sub, x + 14, kpi2Y + 45, {
            width: col2Width - 28,
            lineBreak: false,
            ellipsis: true,
          });
      }
    });
    doc.y = kpi2Y + 76;
    doc.x = pageLeft;

    // ---- Doughnut chart (page 1) ----
    try {
      doc.image(doughnutBuf, { fit: [pageWidth, 280], align: "center" });
    } catch (err) {
      doc.fillColor("#ef4444").fontSize(10).text(`Chart render failed: ${err.message}`);
    }

    // ---- Page 2: daily bar + cumulative ----
    doc.addPage();
    try {
      doc.image(barBuf, { fit: [pageWidth, 300], align: "center" });
    } catch (err) {
      doc.fillColor("#ef4444").fontSize(10).text(err.message);
    }
    doc.moveDown(0.8);
    try {
      doc.image(cumBuf, { fit: [pageWidth, 280], align: "center" });
    } catch (err) {
      doc.fillColor("#ef4444").fontSize(10).text(err.message);
    }

    // ---- Page 3: merchants bar + category table + merchants table ----
    doc.addPage();
    try {
      doc.image(merchantBuf, { fit: [pageWidth, 320], align: "center" });
    } catch (err) {
      doc.fillColor("#ef4444").fontSize(10).text(err.message);
    }
    doc.moveDown(0.8);

    drawSectionHeader(doc, "CATEGORY BREAKDOWN");
    const catRows = Object.entries(stats.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => {
        const meta = CATEGORY_META[cat] || { label: cat };
        const pct = stats.total > 0 ? ((amt / stats.total) * 100).toFixed(1) : "0";
        return [meta.label, INR(amt), `${pct}%`];
      });
    drawTable(
      doc,
      ["Category", "Amount", "Share"],
      catRows,
      [pageWidth * 0.5, pageWidth * 0.3, pageWidth * 0.2]
    );

    // ---- Transaction detail pages ----
    doc.addPage();
    drawSectionHeader(doc, "TRANSACTION DETAIL");
    doc
      .fillColor("#6b7280")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`${transactions.length} entries  ·  ${periodText}`);
    doc.moveDown(0.5);

    const txRows = transactions
      .slice()
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.txn_time || "") > (a.txn_time || "") ? 1 : -1;
      })
      .map((t) => {
        const datePart = formatDateShort(t.date);
        const timePart = t.txn_time ? `  ${t.txn_time}` : "";
        return [
          `${datePart}${timePart}`,
          t.merchant || "—",
          CATEGORY_META[t.category]?.label || t.category || "—",
          `${t.is_refund ? "-" : ""}${INR(t.amount)}`,
        ];
      });
    drawTable(
      doc,
      ["Date", "Merchant", "Category", "Amount"],
      txRows,
      [pageWidth * 0.26, pageWidth * 0.36, pageWidth * 0.18, pageWidth * 0.2]
    );

    // ---- Footer ----
    doc.moveDown(1.5);
    doc
      .fillColor("#9ca3af")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(
        "Generated automatically by Vippy Spend Tracker on the 4th of each month when the HDFC credit card statement is available.",
        { align: "center" }
      );

    doc.end();
  });
}

function drawSectionHeader(doc, text) {
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(text, { align: "left", characterSpacing: 0.8 });
  const y = doc.y + 3;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(1.5)
    .strokeColor("#111827")
    .stroke();
  doc.moveDown(0.6);
}

function drawTable(doc, headers, rows, colWidths) {
  const startX = doc.page.margins.left;
  const rowHeight = 22;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);

  const headerY = doc.y;
  doc.rect(startX, headerY - 2, tableWidth, 20).fill("#111827");

  let x = startX;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  headers.forEach((h, i) => {
    const align = i === headers.length - 1 ? "right" : "left";
    doc.text(h.toUpperCase(), x + 8, headerY + 4, {
      width: colWidths[i] - 16,
      align,
      characterSpacing: 1.0,
    });
    x += colWidths[i];
  });
  doc.y = headerY + 22;

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#1f2937");
  let alt = false;
  for (const row of rows) {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const yStart = doc.y;
    if (alt) {
      doc.rect(startX, yStart - 2, tableWidth, rowHeight).fill("#f9fafb");
    }
    alt = !alt;

    doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(10);
    let cx = startX;
    row.forEach((cell, i) => {
      const align = i === row.length - 1 ? "right" : "left";
      doc.text(String(cell), cx + 8, yStart + 4, {
        width: colWidths[i] - 16,
        align,
        lineBreak: false,
        ellipsis: true,
      });
      cx += colWidths[i];
    });
    doc.y = yStart + rowHeight;
  }

  doc
    .moveTo(startX, doc.y)
    .lineTo(startX + tableWidth, doc.y)
    .lineWidth(1)
    .strokeColor("#d1d5db")
    .stroke();
  doc.moveDown(0.5);
}
