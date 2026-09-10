import PDFDocument from "pdfkit";

/**
 * An email becomes a document the accounts department can print and file.
 *
 * Most invoice emails already carry one — OBB, FlixBus, Matrix, Amazon,
 * Swiggy, Zomato, DataForSEO, Anthropic and Shopify all attach a PDF — and
 * that is both free and the strongest evidence available, so it is used
 * verbatim.
 *
 * The rest are typeset: a page headed with sender, subject and date, then the
 * body with its markup stripped. The result is the merchant's own email,
 * printed, which is what a forwarded-and-printed receipt has always been.
 *
 * Headless Chrome would reproduce the branding faithfully and is the intended
 * upgrade. It is deferred rather than rejected: it needs either
 * @sparticuz/chromium-min with the binary served from Blob storage or a Vercel
 * Sandbox, and swapping it in changes renderEmailToPdf and nothing else.
 */

// Comfortably under what a mail gateway will carry once base64 inflates it.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#39;": "'", "&apos;": "'", "&euro;": "€",
  "&pound;": "£", "&#8377;": "₹", "&#160;": " ",
};

export function pickAttachment(message) {
  const pdfs = (message?.attachments || []).filter(
    (a) =>
      /pdf/i.test(a.contentType || "") ||
      /\.pdf$/i.test(a.filename || "")
  );

  const bytesOf = (a) => a.size || a.content?.length || 0;

  const usable = pdfs.filter((a) => bytesOf(a) > 0 && bytesOf(a) <= MAX_ATTACHMENT_BYTES);
  if (!usable.length) return null;

  // Terms and conditions ride along with the invoice on some receipts. The
  // invoice is reliably the larger document.
  return usable.reduce((biggest, a) =>
    bytesOf(a) > bytesOf(biggest) ? a : biggest
  );
}

export function htmlToText(html) {
  if (!html) return "";
  let text = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, all) => line || all[i - 1])
    .join("\n")
    .trim();
}

function safeName(message) {
  const stem = String(message.subject || "email")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "email";
  return `${stem}.pdf`;
}

async function typeset(message) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", resolve));

  const width = doc.page.width - 80;

  doc.font("Helvetica-Bold").fontSize(13).text(message.subject || "(no subject)", { width });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9).fillColor("#444444");
  doc.text(`From: ${message.from || "unknown"}`, { width });
  doc.text(`Date: ${message.date || "unknown"}`, { width });
  doc.moveDown(0.5);

  doc.moveTo(40, doc.y).lineTo(40 + width, doc.y).strokeColor("#999999").stroke();
  doc.moveDown(0.6);

  const body = message.text?.trim() || htmlToText(message.html) || "(this email had no readable body)";
  doc.fillColor("#000000").font("Helvetica").fontSize(9.5).text(body, { width, align: "left" });

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

export async function renderEmailToPdf(message) {
  const attachment = pickAttachment(message);
  if (attachment) {
    return { buffer: attachment.content, kind: "attachment", filename: attachment.filename };
  }
  return { buffer: await typeset(message), kind: "typeset", filename: safeName(message) };
}
