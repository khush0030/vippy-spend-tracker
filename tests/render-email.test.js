// tests/render-email.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAttachment, htmlToText, renderEmailToPdf } from "../lib/render-email.js";

const pdf = (over = {}) => ({
  filename: "invoice.pdf", contentType: "application/pdf",
  size: 1000, content: Buffer.from("%PDF-1.4 fake"), ...over,
});

const message = (over = {}) => ({
  messageId: "m1", date: "2026-08-12", from: "Uber Receipts <noreply@uber.com>",
  subject: "Your Wednesday morning trip", text: "Total €33.90", html: "", attachments: [], ...over,
});

test("a PDF attachment is preferred over the body", () => {
  const got = pickAttachment(message({ attachments: [pdf()] }));
  assert.equal(got.filename, "invoice.pdf");
});

test("non-PDF attachments are ignored", () => {
  // Tracking pixels and logos arrive as attachments on almost every receipt.
  const logo = { filename: "logo.png", contentType: "image/png", size: 900, content: Buffer.alloc(9) };
  assert.equal(pickAttachment(message({ attachments: [logo] })), null);
});

test("an attachment too large to email onward is left behind", () => {
  const huge = pdf({ size: 11 * 1024 * 1024, content: Buffer.alloc(11 * 1024 * 1024) });
  assert.equal(pickAttachment(message({ attachments: [huge] })), null);
});

test("the largest PDF wins when there are several", () => {
  // Terms and conditions ride along with the actual invoice; the invoice is bigger.
  const terms = pdf({ filename: "terms.pdf", size: 2000, content: Buffer.alloc(2000) });
  const invoice = pdf({ filename: "invoice.pdf", size: 50000, content: Buffer.alloc(50000) });
  assert.equal(pickAttachment(message({ attachments: [terms, invoice] })).filename, "invoice.pdf");
});

test("html becomes readable text", () => {
  const html = "<style>p{color:red}</style><p>Total <b>&euro;33.90</b></p><script>x()</script>";
  const text = htmlToText(html);
  assert.match(text, /Total €33\.90/);
  assert.doesNotMatch(text, /color:red/);
  assert.doesNotMatch(text, /x\(\)/);
});

test("block elements become line breaks rather than running together", () => {
  const text = htmlToText("<div>Line one</div><div>Line two</div>");
  assert.match(text, /Line one\s*\n\s*Line two/);
});

test("common entities are decoded", () => {
  assert.equal(htmlToText("a&nbsp;b &amp; c &lt;d&gt; &#39;e&#39;").replace(/\s+/g, " ").trim(), "a b & c <d> 'e'");
});

test("a message with a PDF renders as that PDF untouched", async () => {
  const attached = pdf({ content: Buffer.from("%PDF-1.4 the real invoice") });
  const out = await renderEmailToPdf(message({ attachments: [attached] }));
  assert.equal(out.kind, "attachment");
  assert.deepEqual(out.buffer, attached.content);
  assert.equal(out.filename, "invoice.pdf");
});

test("a message without one is typeset into a valid PDF", async () => {
  const out = await renderEmailToPdf(message({ html: "<p>Total &euro;33.90</p>" }));
  assert.equal(out.kind, "typeset");
  assert.equal(out.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.ok(out.buffer.length > 500);
  assert.match(out.filename, /\.pdf$/);
});

test("a body with no text at all still produces a document", async () => {
  // An empty page headed with its provenance beats no evidence.
  const out = await renderEmailToPdf(message({ text: "", html: "" }));
  assert.equal(out.kind, "typeset");
  assert.equal(out.buffer.subarray(0, 5).toString(), "%PDF-");
});
