import PDFDocument from "pdfkit";

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

function quickchartUrl(config, width = 720, height = 400) {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&backgroundColor=white&width=${width}&height=${height}&format=png`;
}

async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`chart fetch failed ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function buildDoughnut(byCategory) {
  const entries = Object.entries(byCategory).filter(([, v]) => v > 0);
  return quickchartUrl(
    {
      type: "doughnut",
      data: {
        labels: entries.map(([k]) => CATEGORY_META[k]?.label || k),
        datasets: [
          {
            data: entries.map(([, v]) => Number(v.toFixed(2))),
            backgroundColor: entries.map(
              ([k]) => CATEGORY_META[k]?.color || "#888"
            ),
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "right", labels: { font: { size: 12 } } },
          title: { display: true, text: "Spend by category", font: { size: 14 } },
        },
      },
    },
    720,
    400
  );
}

function buildDailyBar(byDay) {
  const days = Object.keys(byDay).sort();
  return quickchartUrl(
    {
      type: "bar",
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [
          {
            label: "Daily spend",
            data: days.map((d) => Number(byDay[d].toFixed(2))),
            backgroundColor: "#1e40af",
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          title: { display: true, text: "Daily spend", font: { size: 14 } },
        },
        scales: { y: { beginAtZero: true } },
      },
    },
    720,
    340
  );
}

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

/**
 * Build a monthly spending PDF report and return it as a Buffer.
 */
export async function buildMonthlyReportPdf({ user, periodLabel, transactions, stats }) {
  const [doughnutBuf, barBuf] = await Promise.all([
    fetchImageBuffer(buildDoughnut(stats.byCategory)),
    fetchImageBuffer(buildDailyBar(stats.byDay)),
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ---- Cover / header ----
    doc.fillColor("#6b7280").fontSize(10).text("VIPPY SPEND TRACKER", { align: "center" });
    doc.moveDown(0.3);
    doc
      .fillColor("#111827")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text(`${periodLabel} Spending Report`, { align: "center" });
    doc.moveDown(0.2);
    doc
      .fillColor("#6b7280")
      .fontSize(11)
      .font("Helvetica")
      .text(user.name || user.email, { align: "center" });
    doc.moveDown(0.1);
    doc
      .fontSize(9)
      .fillColor("#9ca3af")
      .text(`HDFC Corporate Card · Vippy Industries`, { align: "center" });
    doc.moveDown(0.1);
    doc
      .fontSize(9)
      .text(
        `Generated ${new Date().toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Kolkata",
        })} IST`,
        { align: "center" }
      );
    doc.moveDown(1.2);

    // ---- KPI row ----
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / 4 - 8;
    const kpis = [
      { label: "TOTAL SPENT", value: INR(stats.total), color: "#111827" },
      { label: "REFUNDS", value: INR(stats.refundTotal), color: "#065f46" },
      { label: "NET SPEND", value: INR(stats.net), color: "#111827" },
      { label: "TRANSACTIONS", value: String(stats.txCount), color: "#111827" },
    ];
    const kpiY = doc.y;
    kpis.forEach((k, i) => {
      const x = doc.page.margins.left + i * (colWidth + 8);
      doc
        .roundedRect(x, kpiY, colWidth, 62, 6)
        .fillAndStroke("#f9fafb", "#e5e7eb");
      doc
        .fillColor("#6b7280")
        .font("Helvetica")
        .fontSize(8)
        .text(k.label, x + 12, kpiY + 10, { width: colWidth - 24 });
      doc
        .fillColor(k.color)
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(k.value, x + 12, kpiY + 26, { width: colWidth - 24 });
    });
    doc.y = kpiY + 76;
    doc.x = doc.page.margins.left;

    // ---- Doughnut chart ----
    doc.moveDown(0.5);
    try {
      doc.image(doughnutBuf, { fit: [pageWidth, 220], align: "center" });
    } catch (err) {
      doc.fillColor("#ef4444").fontSize(10).text(`Chart render failed: ${err.message}`);
    }
    doc.moveDown(0.5);

    // ---- Bar chart ----
    try {
      doc.image(barBuf, { fit: [pageWidth, 200], align: "center" });
    } catch (err) {
      doc.fillColor("#ef4444").fontSize(10).text(`Chart render failed: ${err.message}`);
    }
    doc.moveDown(1);

    // ---- Category breakdown ----
    drawSectionHeader(doc, "Category Breakdown");
    const catRows = Object.entries(stats.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => {
        const meta = CATEGORY_META[cat] || { label: cat };
        const pct = ((amt / stats.total) * 100).toFixed(1);
        return [meta.label, INR(amt), `${pct}%`];
      });
    drawTable(doc, ["Category", "Amount", "Share"], catRows, [pageWidth * 0.5, pageWidth * 0.3, pageWidth * 0.2]);

    // ---- Top merchants ----
    doc.moveDown(1);
    drawSectionHeader(doc, "Top Merchants");
    const merchantRows = stats.topMerchants.map(([name, amt]) => [name, INR(amt)]);
    drawTable(doc, ["Merchant", "Amount"], merchantRows, [pageWidth * 0.7, pageWidth * 0.3]);

    // ---- Full transaction list (new page) ----
    doc.addPage();
    drawSectionHeader(doc, "All Transactions");
    const txRows = transactions
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((t) => [
        t.date,
        t.merchant || "—",
        CATEGORY_META[t.category]?.label || t.category || "—",
        `${t.is_refund ? "-" : ""}${INR(t.amount)}`,
      ]);
    drawTable(
      doc,
      ["Date", "Merchant", "Category", "Amount"],
      txRows,
      [pageWidth * 0.14, pageWidth * 0.46, pageWidth * 0.2, pageWidth * 0.2]
    );

    // ---- Footer on last page ----
    doc.moveDown(2);
    doc
      .fillColor("#9ca3af")
      .fontSize(8)
      .text(
        "Generated automatically by Vippy Spend Tracker on the 4th of each month when your HDFC credit card statement is available.",
        { align: "center" }
      );

    doc.end();
  });
}

function drawSectionHeader(doc, text) {
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(text, { align: "left" });
  const y = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.5)
    .strokeColor("#e5e7eb")
    .stroke();
  doc.moveDown(0.5);
}

function drawTable(doc, headers, rows, colWidths) {
  const startX = doc.page.margins.left;
  const rowHeight = 18;

  // Headers
  let x = startX;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#6b7280");
  headers.forEach((h, i) => {
    const align = i === headers.length - 1 ? "right" : "left";
    doc.text(h.toUpperCase(), x + 4, doc.y, { width: colWidths[i] - 8, align, continued: false });
    x += colWidths[i];
  });
  doc.y += 2;
  doc
    .moveTo(startX, doc.y)
    .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y)
    .lineWidth(0.5)
    .strokeColor("#d1d5db")
    .stroke();
  doc.y += 4;

  // Rows
  doc.font("Helvetica").fontSize(9).fillColor("#1f2937");
  for (const row of rows) {
    // Page break if needed
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const yStart = doc.y;
    let cx = startX;
    row.forEach((cell, i) => {
      const align = i === row.length - 1 ? "right" : "left";
      doc.text(String(cell), cx + 4, yStart, { width: colWidths[i] - 8, align, lineBreak: false, ellipsis: true });
      cx += colWidths[i];
    });
    doc.y = yStart + rowHeight - 4;
    doc
      .moveTo(startX, doc.y + 2)
      .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y + 2)
      .lineWidth(0.25)
      .strokeColor("#f3f4f6")
      .stroke();
    doc.y += 4;
  }
}
