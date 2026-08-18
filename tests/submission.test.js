import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toCsv, escapeCell, num, UTF8_BOM } from "../lib/csv.js";
import { createZip, crc32 } from "../lib/zip.js";
import {
  slug,
  receiptRef,
  receiptFilename,
  packageName,
  extensionFor,
  planAttachments,
} from "../lib/submission-naming.js";

describe("escapeCell", () => {
  test("leaves plain values alone", () => {
    assert.equal(escapeCell("Indian Oil"), "Indian Oil");
    assert.equal(escapeCell(3400), "3400");
  });

  test("quotes values containing a comma", () => {
    assert.equal(escapeCell("Taj, Santacruz"), '"Taj, Santacruz"');
  });

  test("doubles embedded quotes", () => {
    assert.equal(escapeCell('The "Blue" Room'), '"The ""Blue"" Room"');
  });

  test("quotes values containing newlines", () => {
    assert.equal(escapeCell("line1\nline2"), '"line1\nline2"');
  });

  test("quotes values with significant leading or trailing space", () => {
    assert.equal(escapeCell(" padded "), '" padded "');
  });

  test("renders null and undefined as empty, not as the word null", () => {
    assert.equal(escapeCell(null), "");
    assert.equal(escapeCell(undefined), "");
  });
});

describe("toCsv", () => {
  const columns = [
    { key: "ref", header: "receipt_file" },
    { key: "merchant", header: "merchant" },
    { key: "amount", header: "amount_inr", value: (r) => num(r.amount) },
  ];

  test("writes a header row then the data", () => {
    const csv = toCsv([{ ref: "R-001", merchant: "Amazon", amount: 429 }], columns, { bom: false });
    const lines = csv.trim().split("\r\n");
    assert.equal(lines[0], "receipt_file,merchant,amount_inr");
    assert.equal(lines[1], "R-001,Amazon,429.00");
  });

  test("starts with a BOM so Excel reads UTF-8", () => {
    const csv = toCsv([], columns);
    assert.ok(csv.startsWith(UTF8_BOM));
  });

  test("survives accented European merchant names", () => {
    const csv = toCsv([{ ref: "R-002", merchant: "Cervejaria Ramiro — Lisboa", amount: 48.5 }], columns, {
      bom: false,
    });
    assert.ok(csv.includes("Cervejaria Ramiro — Lisboa"));
  });

  test("a merchant containing a comma cannot shift the columns", () => {
    const csv = toCsv([{ ref: "R-003", merchant: "Taj, Santacruz", amount: 8940 }], columns, {
      bom: false,
    });
    const dataLine = csv.trim().split("\r\n")[1];
    assert.equal(dataLine, 'R-003,"Taj, Santacruz",8940.00');
  });

  test("an empty row set still emits the header", () => {
    const csv = toCsv([], columns, { bom: false });
    assert.equal(csv.trim(), "receipt_file,merchant,amount_inr");
  });
});

describe("num", () => {
  test("formats to two decimals", () => {
    assert.equal(num(3400), "3400.00");
    assert.equal(num("48.5"), "48.50");
  });

  test("blank rather than zero for missing values", () => {
    assert.equal(num(null), "");
    assert.equal(num(""), "");
    assert.equal(num("abc"), "");
  });
});

describe("crc32", () => {
  test("matches the known checksum for a standard string", () => {
    // "123456789" → 0xCBF43926 is the canonical CRC-32 test vector.
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });

  test("empty input is zero", () => {
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });
});

describe("createZip", () => {
  test("produces something starting with the ZIP local header signature", () => {
    const zip = createZip([{ name: "a.txt", data: "hello" }]);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
  });

  test("ends with the end-of-central-directory record", () => {
    const zip = createZip([{ name: "a.txt", data: "hello" }]);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  });

  test("records the right number of entries", () => {
    const zip = createZip([
      { name: "a.txt", data: "one" },
      { name: "b/c.txt", data: "two" },
    ]);
    assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2);
  });

  test("stores file contents verbatim", () => {
    const zip = createZip([{ name: "a.txt", data: "hello" }]);
    assert.ok(zip.includes(Buffer.from("hello")));
  });

  test("handles binary payloads", () => {
    const bin = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const zip = createZip([{ name: "img.jpg", data: bin }]);
    assert.ok(zip.includes(bin));
  });
});

describe("slug", () => {
  test("strips accents rather than mangling them", () => {
    assert.equal(slug("Café Lisboa"), "Cafe-Lisboa");
  });

  test("removes characters Windows forbids in filenames", () => {
    assert.equal(slug('a/b\\c:d*e?f"g<h>i|j'), "a-b-c-d-e-f-g-h-i-j");
  });

  test("collapses runs and trims separators", () => {
    assert.equal(slug("  Indian   Oil  "), "Indian-Oil");
  });

  test("truncates without leaving a trailing separator", () => {
    const s = slug("Cervejaria Ramiro Lisboa Portugal Restaurant", 20);
    assert.ok(s.length <= 20);
    assert.ok(!s.endsWith("-"));
  });

  test("handles empty input", () => {
    assert.equal(slug(null), "");
  });
});

describe("receiptRef", () => {
  test("zero-pads so filenames sort correctly", () => {
    assert.equal(receiptRef(1), "R-001");
    assert.equal(receiptRef(42), "R-042");
    assert.equal(receiptRef(300), "R-300");
  });
});

describe("extensionFor", () => {
  test("maps known mime types", () => {
    assert.equal(extensionFor("image/jpeg"), "jpg");
    assert.equal(extensionFor("application/pdf"), "pdf");
  });

  test("falls back to the original filename's extension", () => {
    assert.equal(extensionFor("application/octet-stream", "invoice.PDF"), "pdf");
  });

  test("refuses to invent an extension from junk", () => {
    assert.equal(extensionFor(null, "no-extension-here"), "bin");
  });
});

describe("receiptFilename", () => {
  const receipt = {
    receipt_date: "2026-08-12",
    merchant: "Indian Oil",
    amount: 3400,
    mime: "image/jpeg",
  };

  test("carries ref, date, merchant and amount", () => {
    assert.equal(receiptFilename(receipt, 6), "R-006_2026-08-12_Indian-Oil_3400.jpg");
  });

  test("is safe for a European merchant", () => {
    const r = { ...receipt, merchant: "Cervejaria Ramiro", amount: 48.5, receipt_date: "2026-06-12" };
    assert.equal(receiptFilename(r, 14), "R-014_2026-06-12_Cervejaria-Ramiro_49.jpg");
  });

  test("keeps vendor PDFs as PDFs", () => {
    const r = { ...receipt, mime: "application/pdf" };
    assert.ok(receiptFilename(r, 1).endsWith(".pdf"));
  });

  test("copes with an undated, unnamed receipt", () => {
    const name = receiptFilename({ mime: "image/png" }, 2);
    assert.equal(name, "R-002_undated_unknown.png");
  });

  test("never contains a character that would break a filesystem", () => {
    const r = { ...receipt, merchant: 'Bad/Name:With*Chars?' };
    assert.doesNotMatch(receiptFilename(r, 1), /[<>:"/\\|?*]/);
  });
});

describe("packageName", () => {
  test("names the card and the period", () => {
    assert.equal(
      packageName({ last4: "4821" }, { cycle_end: "2026-08-17" }),
      "VIP_CorpCard_4821_2026-08.zip"
    );
  });

  test("supports a different extension", () => {
    assert.equal(
      packageName({ last4: "4821" }, { cycle_end: "2026-08-17" }, "csv"),
      "VIP_CorpCard_4821_2026-08.csv"
    );
  });
});

describe("planAttachments", () => {
  const receipts = {
    r1: { id: "r1", receipt_date: "2026-08-10", merchant: "Saravanaa Bhavan", amount: 73.82, mime: "image/jpeg" },
    r2: { id: "r2", receipt_date: "2026-08-10", merchant: "S.B. Rome", amount: 70.3, mime: "image/jpeg" },
    r3: { id: "r3", receipt_date: "2026-08-11", merchant: "Oakberry", amount: 29, mime: "image/jpeg" },
  };
  const txns = [{ id: 307 }, { id: 304 }];

  test("numbers receipts in the order the charges appear", () => {
    const plan = planAttachments(txns, [
      { transaction_id: 304, receipt_id: "r3" },
      { transaction_id: 307, receipt_id: "r1" },
    ], receipts);

    assert.match(plan.namesByTxn.get(307)[0], /^R-001_2026-08-10_Saravanaa-Bhavan_74\./);
    assert.match(plan.namesByTxn.get(304)[0], /^R-002_2026-08-11_Oakberry_29\./);
  });

  test("a charge with two receipts keeps both — neither may be dropped", () => {
    const plan = planAttachments(txns, [
      { transaction_id: 307, receipt_id: "r1" },
      { transaction_id: 307, receipt_id: "r2" },
    ], receipts);

    assert.equal(plan.namesByTxn.get(307).length, 2);
    assert.equal(plan.files.length, 2);
    assert.deepEqual(
      plan.files.map((f) => f.receiptId).sort(),
      ["r1", "r2"]
    );
  });

  test("one receipt covering two charges is stored once and cited by both", () => {
    const plan = planAttachments(txns, [
      { transaction_id: 307, receipt_id: "r1" },
      { transaction_id: 304, receipt_id: "r1" },
    ], receipts);

    assert.equal(plan.files.length, 1);
    assert.equal(plan.namesByTxn.get(307)[0], plan.namesByTxn.get(304)[0]);
  });

  test("a link whose receipt is missing is reported, not silently dropped", () => {
    const plan = planAttachments(txns, [{ transaction_id: 307, receipt_id: "gone" }], receipts);

    assert.equal(plan.files.length, 0);
    assert.deepEqual(plan.missing, ["gone"]);
    assert.equal(plan.namesByTxn.has(307), false);
  });

  test("charges without a receipt simply have none", () => {
    const plan = planAttachments(txns, [], receipts);
    assert.equal(plan.files.length, 0);
    assert.equal(plan.namesByTxn.size, 0);
  });
});
