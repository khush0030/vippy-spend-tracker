import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import PDFDocument from "pdfkit";
import { pageCount, splitIntoChunks, planChunks } from "../lib/pdf-pages.js";
import { isPdf } from "../lib/pdf-decrypt.js";

/** A PDF with `n` numbered pages, built rather than committed as a fixture. */
function makePdf(n) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    for (let i = 1; i <= n; i++) {
      doc.addPage();
      doc.fontSize(40).text(`Page ${i}`, 100, 100);
    }
    doc.end();
  });
}

describe("planChunks", () => {
  test("defaults to slices small enough for the densest pages", async () => {
    const { PAGES_PER_CHUNK } = await import("../lib/pdf-pages.js");
    assert.ok(PAGES_PER_CHUNK <= 3, "a bigger slice has overrun the output ceiling before");
  });

  test("splits a statement into ranges of the given size", () => {
    assert.deepEqual(planChunks(13, 4), [
      { from: 1, to: 4 },
      { from: 5, to: 8 },
      { from: 9, to: 12 },
      { from: 13, to: 13 },
    ]);
  });

  test("a statement smaller than one chunk stays whole", () => {
    assert.deepEqual(planChunks(3, 4), [{ from: 1, to: 3 }]);
  });

  test("an exact multiple leaves no empty tail", () => {
    assert.deepEqual(planChunks(8, 4), [
      { from: 1, to: 4 },
      { from: 5, to: 8 },
    ]);
  });

  test("nonsense page counts yield nothing to read", () => {
    assert.deepEqual(planChunks(0, 4), []);
    assert.deepEqual(planChunks(-2, 4), []);
  });

  test("a chunk size below one would loop forever, so it is clamped", () => {
    assert.deepEqual(planChunks(2, 0), [{ from: 1, to: 1 }, { from: 2, to: 2 }]);
  });
});

describe("pageCount", () => {
  let pdf;
  before(async () => {
    pdf = await makePdf(7);
  });

  test("counts the pages of a real PDF", async () => {
    assert.equal(await pageCount(pdf), 7);
  });

  test("refuses something that is not a PDF", async () => {
    await assert.rejects(() => pageCount(Buffer.from("nope")), /not a pdf/i);
  });
});

describe("splitIntoChunks", () => {
  let pdf;
  before(async () => {
    pdf = await makePdf(9);
  });

  test("every chunk is a valid PDF holding its own pages", async () => {
    const chunks = await splitIntoChunks(pdf, 4);

    assert.equal(chunks.length, 3);
    assert.deepEqual(
      chunks.map((c) => [c.from, c.to]),
      [
        [1, 4],
        [5, 8],
        [9, 9],
      ]
    );

    for (const chunk of chunks) {
      assert.equal(isPdf(chunk.pdf), true);
      assert.equal(await pageCount(chunk.pdf), chunk.to - chunk.from + 1);
    }
  });

  test("a short statement comes back as a single chunk of the original", async () => {
    const short = await makePdf(2);
    const chunks = await splitIntoChunks(short, 4);

    assert.equal(chunks.length, 1);
    assert.deepEqual([chunks[0].from, chunks[0].to], [1, 2]);
    assert.equal(await pageCount(chunks[0].pdf), 2);
  });

  test("chunks carry the page numbers a human would cite", async () => {
    const chunks = await splitIntoChunks(pdf, 3);
    assert.deepEqual(
      chunks.map((c) => `${c.from}-${c.to}`),
      ["1-3", "4-6", "7-9"]
    );
  });
});
