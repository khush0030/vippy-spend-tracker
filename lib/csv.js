/**
 * RFC 4180 CSV writing. Pure — no imports, no I/O.
 *
 * Written by hand rather than pulled from a package because the escaping rules
 * are small, the failure mode (a stray quote silently shifting every column)
 * is expensive, and this way it is tested against the cases that actually
 * occur on receipts: commas in merchant names, quotes, newlines, and accented
 * European characters.
 */

/** Excel only reads UTF-8 correctly if the file starts with a byte-order mark. */
export const UTF8_BOM = "﻿";

export function escapeCell(value) {
  if (value == null) return "";
  const s = String(value);
  if (s === "") return "";

  // Quote when the value contains a delimiter, a quote, a newline, or has
  // leading/trailing spaces that a reader would otherwise trim.
  if (/[",\r\n]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows, columns, { bom = true, eol = "\r\n" } = {}) {
  const header = columns.map((c) => escapeCell(c.header ?? c.key)).join(",");

  const body = (rows || []).map((row) =>
    columns
      .map((c) => escapeCell(typeof c.value === "function" ? c.value(row) : row[c.key]))
      .join(",")
  );

  return (bom ? UTF8_BOM : "") + [header, ...body].join(eol) + eol;
}

/** Numbers go in unformatted so a spreadsheet reads them as numbers. */
export function num(value, dp = 2) {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(dp) : "";
}
