#!/usr/bin/env node
/* Generate a monthly report PDF against real Supabase data and write to disk.
 * Usage: set -a && source .env.local && set +a && node scripts/test-pdf-report.js
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const PDFDocument = require("pdfkit");

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
const INR = (n) => "Rs." + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function quickchartUrl(config, width = 720, height = 400) {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&backgroundColor=white&width=${width}&height=${height}&format=png`;
}

async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`chart fetch failed ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function aggregate(transactions) {
  let total = 0, refundTotal = 0, txCount = 0;
  const byCategory = {}, byDay = {}, byMerchant = {};
  for (const t of transactions) {
    const amt = Number(t.amount) || 0;
    if (t.is_refund) { refundTotal += amt; continue; }
    total += amt;
    txCount += 1;
    byCategory[t.category] = (byCategory[t.category] || 0) + amt;
    byDay[t.date] = (byDay[t.date] || 0) + amt;
    byMerchant[t.merchant] = (byMerchant[t.merchant] || 0) + amt;
  }
  const topMerchants = Object.entries(byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { total, refundTotal, txCount, net: total - refundTotal, byCategory, byDay, topMerchants };
}

function drawSectionHeader(doc, text) {
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text(text);
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.5).strokeColor("#e5e7eb").stroke();
  doc.moveDown(0.5);
}

function drawTable(doc, headers, rows, colWidths) {
  const startX = doc.page.margins.left;
  const rowHeight = 18;
  let x = startX;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#6b7280");
  headers.forEach((h, i) => {
    const align = i === headers.length - 1 ? "right" : "left";
    doc.text(h.toUpperCase(), x + 4, doc.y, { width: colWidths[i] - 8, align });
    x += colWidths[i];
  });
  doc.y += 2;
  doc.moveTo(startX, doc.y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y).lineWidth(0.5).strokeColor("#d1d5db").stroke();
  doc.y += 4;
  doc.font("Helvetica").fontSize(9).fillColor("#1f2937");
  for (const row of rows) {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const yStart = doc.y;
    let cx = startX;
    row.forEach((cell, i) => {
      const align = i === row.length - 1 ? "right" : "left";
      doc.text(String(cell), cx + 4, yStart, { width: colWidths[i] - 8, align, lineBreak: false, ellipsis: true });
      cx += colWidths[i];
    });
    doc.y = yStart + rowHeight - 4;
    doc.moveTo(startX, doc.y + 2).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y + 2).lineWidth(0.25).strokeColor("#f3f4f6").stroke();
    doc.y += 4;
  }
}

async function buildPdf({ user, periodLabel, transactions, stats }) {
  const doughnutEntries = Object.entries(stats.byCategory).filter(([, v]) => v > 0);
  const days = Object.keys(stats.byDay).sort();

  const [doughnutBuf, barBuf] = await Promise.all([
    fetchImageBuffer(quickchartUrl({
      type: "doughnut",
      data: {
        labels: doughnutEntries.map(([k]) => CATEGORY_META[k]?.label || k),
        datasets: [{
          data: doughnutEntries.map(([, v]) => Number(v.toFixed(2))),
          backgroundColor: doughnutEntries.map(([k]) => CATEGORY_META[k]?.color || "#888"),
        }],
      },
      options: {
        plugins: { legend: { position: "right" }, title: { display: true, text: "Spend by category" } },
      },
    })),
    fetchImageBuffer(quickchartUrl({
      type: "bar",
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [{ label: "Daily spend", data: days.map((d) => Number(stats.byDay[d].toFixed(2))), backgroundColor: "#1e40af" }],
      },
      options: { plugins: { legend: { display: false }, title: { display: true, text: "Daily spend" } }, scales: { y: { beginAtZero: true } } },
    }, 720, 340)),
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fillColor("#6b7280").fontSize(10).text("VIPPY SPEND TRACKER", { align: "center" });
    doc.moveDown(0.3);
    doc.fillColor("#111827").fontSize(22).font("Helvetica-Bold").text(`${periodLabel} Spending Report`, { align: "center" });
    doc.moveDown(0.2);
    doc.fillColor("#6b7280").fontSize(11).font("Helvetica").text(user.name || user.email, { align: "center" });
    doc.moveDown(0.1);
    doc.fontSize(9).fillColor("#9ca3af").text("HDFC Corporate Card · Vippy Industries", { align: "center" });
    doc.moveDown(1);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / 4 - 8;
    const kpis = [
      { label: "TOTAL SPENT", value: INR(stats.total) },
      { label: "REFUNDS", value: INR(stats.refundTotal) },
      { label: "NET SPEND", value: INR(stats.net) },
      { label: "TRANSACTIONS", value: String(stats.txCount) },
    ];
    const kpiY = doc.y;
    kpis.forEach((k, i) => {
      const x = doc.page.margins.left + i * (colWidth + 8);
      doc.roundedRect(x, kpiY, colWidth, 62, 6).fillAndStroke("#f9fafb", "#e5e7eb");
      doc.fillColor("#6b7280").font("Helvetica").fontSize(8).text(k.label, x + 12, kpiY + 10, { width: colWidth - 24 });
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(16).text(k.value, x + 12, kpiY + 26, { width: colWidth - 24 });
    });
    doc.y = kpiY + 76;
    doc.x = doc.page.margins.left;

    doc.moveDown(0.5);
    doc.image(doughnutBuf, { fit: [pageWidth, 220], align: "center" });
    doc.moveDown(0.5);
    doc.image(barBuf, { fit: [pageWidth, 200], align: "center" });
    doc.moveDown(1);

    drawSectionHeader(doc, "Category Breakdown");
    const catRows = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
      const meta = CATEGORY_META[cat] || { label: cat };
      return [meta.label, INR(amt), `${((amt / stats.total) * 100).toFixed(1)}%`];
    });
    drawTable(doc, ["Category", "Amount", "Share"], catRows, [pageWidth * 0.5, pageWidth * 0.3, pageWidth * 0.2]);

    doc.moveDown(1);
    drawSectionHeader(doc, "Top Merchants");
    drawTable(doc, ["Merchant", "Amount"], stats.topMerchants.map(([n, a]) => [n, INR(a)]), [pageWidth * 0.7, pageWidth * 0.3]);

    doc.addPage();
    drawSectionHeader(doc, "All Transactions");
    const txRows = transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => [
      t.date,
      t.merchant || "—",
      CATEGORY_META[t.category]?.label || t.category || "—",
      `${t.is_refund ? "-" : ""}${INR(t.amount)}`,
    ]);
    drawTable(doc, ["Date", "Merchant", "Category", "Amount"], txRows, [pageWidth * 0.14, pageWidth * 0.46, pageWidth * 0.2, pageWidth * 0.2]);

    doc.end();
  });
}

async function main() {
  const USER_ID = "115105472683255155618";
  const { data: user } = await supabase.from("users").select("id, email, name").eq("id", USER_ID).single();

  // Use last 45 days so the PDF has plenty of data even in mid-month
  const since = new Date(Date.now() - 45 * 86400 * 1000).toISOString().split("T")[0];
  const { data: transactions } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", USER_ID)
    .gte("date", since)
    .order("date", { ascending: true });

  console.log(`Building PDF with ${transactions.length} transactions since ${since}`);
  const stats = aggregate(transactions);
  const pdf = await buildPdf({ user, periodLabel: "Test", transactions, stats });

  const out = path.join(__dirname, "..", "test-report.pdf");
  fs.writeFileSync(out, pdf);
  console.log(`\u2713 Wrote ${pdf.length} bytes to ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
