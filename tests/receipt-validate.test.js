import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount,
  parseDate,
  isValidGstin,
  isValidEuVat,
  validateExtraction,
  fieldsAgree,
} from "../lib/receipt-validate.js";

describe("parseAmount — international number formats", () => {
  test("plain numbers pass through", () => {
    assert.equal(parseAmount("3400"), 3400);
    assert.equal(parseAmount("3400.50"), 3400.5);
    assert.equal(parseAmount(3400.5), 3400.5);
  });

  test("Anglo grouping: 1,234.56", () => {
    assert.equal(parseAmount("1,234.56"), 1234.56);
    assert.equal(parseAmount("12,345,678.90"), 12345678.9);
  });

  test("European grouping: 1.234,56", () => {
    assert.equal(parseAmount("1.234,56"), 1234.56);
    assert.equal(parseAmount("12.345.678,90"), 12345678.9);
  });

  test("French/Czech spacing: 1 234,56", () => {
    assert.equal(parseAmount("1 234,56"), 1234.56);
    assert.equal(parseAmount("1 234,56"), 1234.56); // non-breaking space
  });

  test("Indian lakh grouping: 1,42,380.00", () => {
    assert.equal(parseAmount("1,42,380.00"), 142380);
  });

  test("strips currency symbols and codes", () => {
    assert.equal(parseAmount("₹3,400.00"), 3400);
    assert.equal(parseAmount("Rs. 3400"), 3400);
    assert.equal(parseAmount("EUR 48,50"), 48.5);
    assert.equal(parseAmount("€48,50"), 48.5);
  });

  test("a lone comma with two trailing digits is a decimal, not a thousands mark", () => {
    assert.equal(parseAmount("48,50"), 48.5);
  });

  test("a lone comma with three trailing digits is a thousands mark", () => {
    assert.equal(parseAmount("3,400"), 3400);
  });

  test("returns null rather than guessing on junk", () => {
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount(null), null);
    assert.equal(parseAmount("N/A"), null);
  });
});

describe("parseDate", () => {
  test("passes through ISO", () => {
    assert.equal(parseDate("2026-08-12"), "2026-08-12");
  });

  test("DD/MM/YYYY is the default reading", () => {
    assert.equal(parseDate("12/08/2026"), "2026-08-12");
  });

  test("unambiguous when the day exceeds 12", () => {
    assert.equal(parseDate("25/08/2026"), "2026-08-25");
    assert.equal(parseDate("08/25/2026"), "2026-08-25");
  });

  test("US format only when the country says so", () => {
    assert.equal(parseDate("08/12/2026", "US"), "2026-08-12");
    assert.equal(parseDate("08/12/2026", "PT"), "2026-12-08");
  });

  test("handles dotted and dashed European styles", () => {
    assert.equal(parseDate("12.08.2026"), "2026-08-12");
    assert.equal(parseDate("12-08-2026"), "2026-08-12");
  });

  test("two-digit years resolve to this century", () => {
    assert.equal(parseDate("12/08/26"), "2026-08-12");
  });

  test("reads month names, which is how a great many receipts print", () => {
    assert.equal(parseDate("17-Aug-2026"), "2026-08-17");
    assert.equal(parseDate("17 Aug 2026"), "2026-08-17");
    assert.equal(parseDate("17 AUGUST 2026"), "2026-08-17");
    assert.equal(parseDate("17.Sept.2026"), "2026-09-17");
  });

  test("reads a month name printed before the day", () => {
    assert.equal(parseDate("Aug 17, 2026"), "2026-08-17");
    assert.equal(parseDate("August 17 2026"), "2026-08-17");
  });

  test("reads the European languages the trip receipts arrive in", () => {
    assert.equal(parseDate("17 août 2026"), "2026-08-17");      // fr
    assert.equal(parseDate("17. Aug. 2026"), "2026-08-17");     // de
    assert.equal(parseDate("17 ago 2026"), "2026-08-17");       // es/it
    assert.equal(parseDate("17 aug 2026"), "2026-08-17");       // nl
    assert.equal(parseDate("17. srpna 2026"), "2026-08-17");    // cs
  });

  test("a month name settles the order regardless of the country", () => {
    assert.equal(parseDate("Aug 17, 2026", "US"), "2026-08-17");
    assert.equal(parseDate("17 Aug 2026", "US"), "2026-08-17");
  });

  test("two-digit years work with month names too", () => {
    assert.equal(parseDate("17-Aug-26"), "2026-08-17");
  });

  test("rejects a month name it does not know", () => {
    assert.equal(parseDate("17 Smarch 2026"), null);
  });

  test("returns null on nonsense rather than inventing a date", () => {
    assert.equal(parseDate("not a date"), null);
    assert.equal(parseDate("99/99/2026"), null);
    assert.equal(parseDate(null), null);
  });
});

describe("isValidGstin", () => {
  test("accepts real GSTINs", () => {
    assert.equal(isValidGstin("27AAPFU0939F1ZV"), true);
    assert.equal(isValidGstin("24AAACC1206D1ZM"), true);
  });

  test("rejects a wrong checksum digit", () => {
    assert.equal(isValidGstin("27AAPFU0939F1ZX"), false);
  });

  test("rejects malformed input", () => {
    assert.equal(isValidGstin("27AAPFU0939F1Z"), false); // too short
    assert.equal(isValidGstin("99AAPFU0939F1ZV"), false); // bad state code
    assert.equal(isValidGstin(""), false);
    assert.equal(isValidGstin(null), false);
  });

  test("tolerates spacing and lowercase", () => {
    assert.equal(isValidGstin(" 27aapfu0939f1zv "), true);
  });
});

describe("isValidEuVat", () => {
  test("accepts well-formed numbers per country", () => {
    assert.equal(isValidEuVat("PT501442600"), true);
    assert.equal(isValidEuVat("DE123456789"), true);
    assert.equal(isValidEuVat("FRAB123456789"), true);
    assert.equal(isValidEuVat("IT12345678901"), true);
  });

  test("rejects the wrong length for the country", () => {
    assert.equal(isValidEuVat("PT12345"), false);
    assert.equal(isValidEuVat("DE12345678901234"), false);
  });

  test("rejects unknown country prefixes", () => {
    assert.equal(isValidEuVat("ZZ123456789"), false);
    assert.equal(isValidEuVat(""), false);
  });

  test("tolerates spacing and lowercase", () => {
    assert.equal(isValidEuVat("pt 501 442 600"), true);
  });
});

describe("validateExtraction", () => {
  const base = () => ({
    total: 3400,
    subtotal: 2881.36,
    tax_total: 518.64,
    currency: "INR",
    date: "2026-08-12",
    gstin: "27AAPFU0939F1ZV",
  });

  test("a clean receipt passes with no penalty", () => {
    const r = validateExtraction(base(), { today: "2026-08-15" });
    assert.equal(r.issues.length, 0);
    assert.equal(r.confidencePenalty, 0);
  });

  test("arithmetic that does not tie out is flagged", () => {
    const r = validateExtraction({ ...base(), tax_total: 900 }, { today: "2026-08-15" });
    assert.ok(r.issues.some((i) => i.field === "total"));
    assert.ok(r.confidencePenalty > 0);
  });

  test("tolerates rounding within a rupee", () => {
    const r = validateExtraction({ ...base(), subtotal: 2881.86 }, { today: "2026-08-15" });
    assert.equal(r.issues.length, 0);
  });

  test("an invalid GSTIN is nulled rather than passed through", () => {
    const r = validateExtraction({ ...base(), gstin: "27AAPFU0939F1ZX" }, { today: "2026-08-15" });
    assert.equal(r.value.gstin, null);
    assert.ok(r.issues.some((i) => i.field === "gstin"));
  });

  test("a future date is flagged", () => {
    const r = validateExtraction({ ...base(), date: "2026-09-01" }, { today: "2026-08-15" });
    assert.ok(r.issues.some((i) => i.field === "date"));
  });

  test("a very old date is flagged for confirmation", () => {
    const r = validateExtraction({ ...base(), date: "2026-01-01" }, { today: "2026-08-15" });
    assert.ok(r.issues.some((i) => i.field === "date"));
  });

  test("a missing total is fatal, not merely a penalty", () => {
    const r = validateExtraction({ ...base(), total: null }, { today: "2026-08-15" });
    assert.equal(r.usable, false);
  });

  test("normalises messy strings into numbers and ISO dates", () => {
    const r = validateExtraction(
      { total: "1.234,56", currency: "EUR", date: "12/08/2026", country: "PT" },
      { today: "2026-08-15" }
    );
    assert.equal(r.value.total, 1234.56);
    assert.equal(r.value.date, "2026-08-12");
  });

  test("a non-INR currency without a rate is still usable, just flagged foreign", () => {
    const r = validateExtraction(
      { total: 48.5, currency: "EUR", date: "2026-08-12" },
      { today: "2026-08-15" }
    );
    assert.equal(r.usable, true);
    assert.equal(r.value.currency, "EUR");
  });
});

describe("fieldsAgree — model consensus", () => {
  const a = { total: 3400, date: "2026-08-12", merchant: "Indian Oil", currency: "INR" };

  test("identical readings agree", () => {
    assert.equal(fieldsAgree(a, { ...a }).agree, true);
  });

  test("a merchant spelled differently still agrees", () => {
    const r = fieldsAgree(a, { ...a, merchant: "INDIAN OIL CORPORATION" });
    assert.equal(r.agree, true);
  });

  test("a different total does not agree", () => {
    const r = fieldsAgree(a, { ...a, total: 8400 });
    assert.equal(r.agree, false);
    assert.ok(r.conflicts.includes("total"));
  });

  test("sub-rupee differences on the total are tolerated", () => {
    assert.equal(fieldsAgree(a, { ...a, total: 3400.004 }).agree, true);
  });

  test("a different date does not agree", () => {
    const r = fieldsAgree(a, { ...a, date: "2026-08-13" });
    assert.equal(r.agree, false);
    assert.ok(r.conflicts.includes("date"));
  });

  test("a different currency does not agree", () => {
    const r = fieldsAgree(a, { ...a, currency: "EUR" });
    assert.equal(r.agree, false);
  });

  test("a null on one side is a conflict, not agreement", () => {
    const r = fieldsAgree(a, { ...a, total: null });
    assert.equal(r.agree, false);
  });
});
