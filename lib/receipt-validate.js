/**
 * Deterministic checks over whatever a model returned.
 *
 * This layer exists because a model has an off day and code does not. Every
 * field a model produces is re-derived, range-checked or checksum-verified
 * here before it is allowed near a submission. Pure — no imports, no I/O.
 */

const GST_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Valid Indian GST state codes (01 Jammu & Kashmir … 38 Ladakh, plus 97 OIDAR).
const GST_STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")),
  "97",
  "99",
]);

// Length of the numeric/alphanumeric part after the two-letter country prefix.
const EU_VAT_RULES = {
  AT: /^U\d{8}$/,
  BE: /^\d{10}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^([A-Z0-9]{8,9})$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  GB: /^(\d{9}|\d{12}|(GD|HA)\d{3})$/,
};

// Countries that write dates month-first. Everywhere we care about is day-first.
const MONTH_FIRST = new Set(["US", "PH"]);

/**
 * Parse an amount written in any of the formats a receipt might use.
 *
 * The dangerous case is `1.234,56` versus `1,234.56` — reading one as the
 * other is a 1000x error that would sail through every other check. The rule:
 * whichever separator appears last is the decimal separator, unless what
 * follows it isn't a 1–2 digit fraction.
 */
export function parseAmount(input) {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  // Currency codes must be stripped before whitespace, otherwise "EUR 48,50"
  // collapses to "EUR48,50" and the word boundary no longer matches.
  let s = String(input)
    .replace(/(?:INR|EUR|USD|GBP|CHF|SEK|NOK|DKK|CZK|PLN|Rs)\.?/gi, "")
    .replace(/[\u20B9$\u20AC\u00A3\u00A5]/g, "")
    .replace(/[\s\u00A0\u202F]/g, "")
    .trim();

  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-]/g, "");
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later one is the decimal separator.
    const decimalSep = lastComma > lastDot ? "," : ".";
    const groupSep = decimalSep === "," ? "." : ",";
    s = s.split(groupSep).join("").replace(decimalSep, ".");
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const idx = lastComma !== -1 ? lastComma : lastDot;
    const tail = s.slice(idx + 1);
    const occurrences = s.split(sep).length - 1;

    // "3,400" / "1,42,380" are grouped thousands; "48,50" is a decimal.
    if (occurrences > 1 || tail.length === 3) {
      s = s.split(sep).join("");
    } else {
      s = s.replace(sep, ".");
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// Month names as receipts actually print them. A named month is unambiguous —
// it settles day-vs-month order without consulting the country — so it is worth
// carrying the languages this card gets used in. Czech and Polish decline the
// month, hence both nominative and genitive forms.
const MONTH_NAMES = {
  1: "jan january januar janvier enero gennaio januari janeiro leden ledna styczen stycznia",
  2: "feb february februar fevrier febrero febbraio februari fevereiro unor unora luty lutego",
  3: "mar march marz maerz mars marzo maart marco brezen brezna marzec marca",
  4: "apr april avril abril aprile duben dubna kwiecien kwietnia",
  5: "may mai mayo maggio mei maio kveten kvetna maj maja",
  6: "jun june juni juin junio giugno junho cerven cervna czerwiec czerwca",
  7: "jul july juli juillet julio luglio julho cervenec cervence lipiec lipca",
  8: "aug august aout agosto augustus srpen srpna sierpien sierpnia",
  9: "sep sept september septembre septiembre settembre setembro zari wrzesien wrzesnia",
  10: "oct okt october oktober octobre octubre ottobre outubro rijen rijna pazdziernik pazdziernika",
  11: "nov november novembre noviembre novembro listopad listopadu listopada",
  12: "dec dez december dezember decembre diciembre dicembre dezembro prosinec prosince grudzien grudnia",
};

const MONTH_BY_NAME = new Map();
for (const [num, names] of Object.entries(MONTH_NAMES)) {
  for (const name of names.split(" ")) MONTH_BY_NAME.set(name, Number(num));
}

/** Lowercase, strip accents and anything that is not a letter. */
function foldWord(word) {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * A month name resolves the whole date: whatever is left is a day and a year,
 * told apart by magnitude. "Sept" must match "september" without "cerven"
 * matching "cervenec", so an exact hit wins and a prefix is only accepted when
 * exactly one month can extend it.
 */
function parseNamedDate(s) {
  const tokens = String(s).split(/[\s,./\-]+/).filter(Boolean);

  let month = null;
  const before = [];
  const after = [];

  for (const token of tokens) {
    const word = foldWord(token);
    if (word) {
      if (month !== null) return null; // two month names is not a date
      const exact = MONTH_BY_NAME.get(word);
      if (exact) {
        month = exact;
        continue;
      }
      if (word.length < 3) return null;
      const hits = new Set();
      for (const [name, num] of MONTH_BY_NAME) if (name.startsWith(word)) hits.add(num);
      if (hits.size !== 1) return null;
      month = [...hits][0];
      continue;
    }
    const digits = token.replace(/[^0-9]/g, "");
    if (digits) (month === null ? before : after).push(Number(digits));
  }

  if (month === null) return null;

  // Position decides, which is what makes "17-Aug-26" readable at all: a number
  // ahead of the month is the day, so whatever follows must be the year.
  let day;
  let year;
  if (before.length === 1 && after.length === 1) [day, year] = [before[0], after[0]];
  else if (before.length === 0 && after.length === 2) [day, year] = after;
  else return null;

  if (year < 100) year += 2000;
  if (day > 31) return null;
  return validDate(year, month, day);
}

/** Normalise any plausible receipt date to ISO. Returns null rather than guessing. */
export function parseDate(input, country = null) {
  if (!input) return null;
  const s = String(input).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validDate(+iso[1], +iso[2], +iso[3]);

  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!m) return parseNamedDate(s);

  let [, a, b, y] = m;
  a = +a;
  b = +b;
  let year = +y;
  if (year < 100) year += 2000;

  // Day > 12 settles it regardless of locale.
  if (a > 12 && b <= 12) return validDate(year, b, a);
  if (b > 12 && a <= 12) return validDate(year, a, b);
  if (a > 12 && b > 12) return null;

  // Ambiguous: fall back to the country's convention, day-first by default.
  return MONTH_FIRST.has(String(country || "").toUpperCase())
    ? validDate(year, a, b)
    : validDate(year, b, a);
}

function validDate(y, month, day) {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

export function isValidGstin(input) {
  const g = String(input || "").replace(/\s/g, "").toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(g)) return false;
  if (!GST_STATE_CODES.has(g.slice(0, 2))) return false;

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GST_CHARSET.indexOf(g[i]);
    if (value < 0) return false;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARSET[(36 - (sum % 36)) % 36] === g[14];
}

export function isValidEuVat(input) {
  const v = String(input || "").replace(/[\s.\-]/g, "").toUpperCase();
  if (v.length < 4) return false;
  const rule = EU_VAT_RULES[v.slice(0, 2)];
  return rule ? rule.test(v.slice(2)) : false;
}

const MAX_AGE_DAYS = 120;

/**
 * Run every check over one model's extraction.
 *
 * Returns the cleaned value, a list of issues, a confidence penalty, and
 * whether the result is usable at all. Nothing is silently corrected: a field
 * that fails its check is nulled and reported, never quietly rewritten.
 */
export function validateExtraction(raw, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const issues = [];
  const value = { ...raw };

  value.total = parseAmount(raw.total);
  value.subtotal = parseAmount(raw.subtotal);
  value.tax_total = parseAmount(raw.tax_total);
  value.date = parseDate(raw.date, raw.country);
  value.currency = String(raw.currency || "INR").toUpperCase().slice(0, 3);

  if (value.total == null || !(value.total > 0)) {
    issues.push({ field: "total", severity: "fatal", message: "No usable total" });
  }
  if (!value.date) {
    issues.push({ field: "date", severity: "fatal", message: "No usable date" });
  }

  // Arithmetic: subtotal + tax should reproduce the total.
  if (value.total != null && value.subtotal != null && value.tax_total != null) {
    if (Math.abs(value.subtotal + value.tax_total - value.total) > 1) {
      issues.push({
        field: "total",
        severity: "warn",
        message: "subtotal + tax does not equal total",
      });
    }
  }

  if (value.date) {
    const days = Math.round(
      (Date.parse(today + "T00:00:00Z") - Date.parse(value.date + "T00:00:00Z")) / 86400000
    );
    if (days < 0) {
      issues.push({ field: "date", severity: "warn", message: "Date is in the future" });
    } else if (days > MAX_AGE_DAYS) {
      issues.push({ field: "date", severity: "warn", message: `Date is ${days} days old` });
    }
  }

  // Tax identity: verify, and null it out if it fails. A hallucinated GSTIN in
  // a filing is far more expensive than a missing one.
  if (raw.gstin) {
    if (isValidGstin(raw.gstin)) {
      value.gstin = String(raw.gstin).replace(/\s/g, "").toUpperCase();
      value.tax_id = value.gstin;
      value.tax_id_type = "GSTIN";
    } else {
      value.gstin = null;
      issues.push({ field: "gstin", severity: "warn", message: "GSTIN failed checksum" });
    }
  }

  if (raw.tax_id && !value.tax_id) {
    if (isValidGstin(raw.tax_id)) {
      value.tax_id = String(raw.tax_id).replace(/\s/g, "").toUpperCase();
      value.tax_id_type = "GSTIN";
    } else if (isValidEuVat(raw.tax_id)) {
      value.tax_id = String(raw.tax_id).replace(/[\s.\-]/g, "").toUpperCase();
      value.tax_id_type = "EU_VAT";
    } else {
      value.tax_id = null;
      issues.push({ field: "tax_id", severity: "warn", message: "Tax ID failed validation" });
    }
  }

  const fatal = issues.some((i) => i.severity === "fatal");
  const warnCount = issues.filter((i) => i.severity === "warn").length;

  return {
    value,
    issues,
    usable: !fatal,
    confidencePenalty: Math.min(0.4, warnCount * 0.2),
  };
}

function normalizeName(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Do two independent readings of the same receipt agree?
 *
 * Only the fields that would corrupt a submission are compared. Merchant
 * naming is allowed to differ — one model saying "Indian Oil" and another
 * "INDIAN OIL CORPORATION" is not a disagreement worth paying Opus to settle.
 */
export function fieldsAgree(a, b) {
  const conflicts = [];
  if (!a || !b) return { agree: false, conflicts: ["missing"] };

  const ta = parseAmount(a.total);
  const tb = parseAmount(b.total);
  if (ta == null || tb == null || Math.abs(ta - tb) > 0.01) conflicts.push("total");

  if (parseDate(a.date, a.country) !== parseDate(b.date, b.country)) conflicts.push("date");

  const ca = String(a.currency || "INR").toUpperCase();
  const cb = String(b.currency || "INR").toUpperCase();
  if (ca !== cb) conflicts.push("currency");

  const na = normalizeName(a.merchant);
  const nb = normalizeName(b.merchant);
  if (na && nb && !na.includes(nb) && !nb.includes(na)) {
    // Names differ entirely — worth noting, but not on its own a conflict
    // that needs adjudicating, since the statement descriptor decides anyway.
    conflicts.push("merchant_soft");
  }

  const hard = conflicts.filter((c) => c !== "merchant_soft");
  return { agree: hard.length === 0, conflicts: hard, soft: conflicts.includes("merchant_soft") };
}
