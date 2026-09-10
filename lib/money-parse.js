/**
 * Pull currency amounts out of arbitrary text. Pure — no imports, no I/O.
 *
 * This exists because the harvester matches an email to a statement line by
 * amount and nothing else. A misread separator is therefore not a cosmetic
 * bug: it is a receipt silently failing to reach the accounts department, or
 * worse, reaching it attached to the wrong charge.
 *
 * The hard part is that €1.234,56 and $1,234.56 are the same number written
 * by two conventions that use each other's separators, and both appear in the
 * same statement. The resolution is positional rather than locale-based:
 * whichever separator comes last is the decimal one, and a separator followed
 * by exactly three digits is grouping. Anything that fits neither shape is
 * rejected rather than guessed at.
 */

// Longest alternatives first: "US$" must beat "$", "CHF" must not be eaten by
// a shorter code. Kc is the ASCII spelling of Kč that some receipts use.
const CURRENCY = "US\\$|EUR|GBP|INR|USD|CHF|CZK|THB|Rs\\.?|K[čc]|€|£|₹|\\$";

// A run of digits interleaved with separators, consumed to its maximal
// extent. Grouping accepts space, non-breaking space, narrow no-break space,
// comma, dot and the Swiss apostrophe. This deliberately does not try to
// distinguish grouping from decimal separators inside the regex: the brief's
// original two-alternative version (a capped `\d{1,3}` leading run followed
// by exactly-3-digit groups, or else a bare `\d+`) let JS's alternation pick
// whichever branch matched *first*, not longest — so "1150.46" matched only
// "115" because the first alternative is satisfied by three digits and a
// regex never backtracks into a later alternative once an earlier one
// succeeds. Capturing the whole digit-and-separator run here and pushing all
// grouping-vs-decimal judgement into parseNumber (a plain function with no
// backtracking) means an invalid shape is rejected outright rather than
// silently reduced to a shorter, spuriously "valid" prefix.
const NUMBER = "\\d+(?:[.,'\u2019\u00a0\u202f ]\\d+)*";

const PRE = new RegExp(`(${CURRENCY})\\s*(${NUMBER})`, "gi");
const POST = new RegExp(`(${NUMBER})\\s*(${CURRENCY})`, "gi");

const CODES = {
  "€": "EUR", "£": "GBP", "₹": "INR", "$": "USD", "US$": "USD",
  EUR: "EUR", GBP: "GBP", INR: "INR", USD: "USD", CHF: "CHF",
  CZK: "CZK", THB: "THB", KČ: "CZK", KC: "CZK", RS: "INR", "RS.": "INR",
};

function normaliseCurrency(token) {
  const key = String(token).trim().toUpperCase();
  return CODES[key] || null;
}

/**
 * Turn the digits of a matched number into a Number, or null to reject it.
 *
 * Returns null rather than a best guess, because a wrong amount matches a
 * wrong statement line, and no match at all is the safer failure.
 */
function parseNumber(raw) {
  // Anything that is unambiguously grouping goes first.
  const cleaned = String(raw).replace(/[\u2019'\u00a0\u202f ]/g, "");

  const decimalAt = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  if (decimalAt === -1) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  const tail = cleaned.slice(decimalAt + 1);

  // Three digits after the last separator means it was never a decimal point.
  if (tail.length === 3) {
    const n = Number(cleaned.replace(/[.,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  if (tail.length === 1 || tail.length === 2) {
    const whole = cleaned.slice(0, decimalAt).replace(/[.,]/g, "");
    const n = Number(`${whole || "0"}.${tail}`);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function collect(text, regex, currencyGroup, numberGroup) {
  const out = [];
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const currency = normaliseCurrency(m[currencyGroup]);
    const value = parseNumber(m[numberGroup]);
    if (currency && value !== null) {
      out.push({ value, currency, raw: m[0].trim(), start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

export function extractAmounts(text) {
  if (!text) return [];
  const body = String(text);

  const pre = collect(body, PRE, 1, 2);
  const post = collect(body, POST, 2, 1);

  // A currency written on both sides — "€33.90 EUR" — produces one hit from
  // each pass over overlapping spans. Prefer the leading form and drop any
  // trailing-form hit whose number sits inside a span already claimed.
  const merged = [...pre];
  for (const hit of post) {
    const overlaps = pre.some((p) => hit.start < p.end && p.start < hit.end);
    if (!overlaps) merged.push(hit);
  }

  return merged
    .sort((a, b) => a.start - b.start)
    .map(({ value, currency, raw }) => ({ value, currency, raw }));
}
