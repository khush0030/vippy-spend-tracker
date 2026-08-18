/**
 * Validating the card configuration.
 *
 * Pure, because these few numbers decide when every scheduled job fires and
 * where a month's expense claim gets emailed. A submit day before the
 * statement day, or a typo in the accounts address, is not the sort of thing
 * to discover on the 23rd.
 *
 * The statement password is handled separately and deliberately never appears
 * in the value returned here — it takes a different path, through
 * `lib/secret-box.js`.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Accepts a comma / semicolon / newline separated string, or an array. */
export function parseEmailList(input) {
  const parts = Array.isArray(input) ? input : String(input ?? "").split(/[,;\n]/);
  const out = [];
  for (const raw of parts) {
    const value = String(raw ?? "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function intOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function validateCardConfig(input = {}) {
  const errors = [];

  const statementDay = intOr(input.statement_day, 18);
  const submitDay = intOr(input.submit_day, 23);
  const graceDays = intOr(input.grace_days, 5);
  const minAmount = numOr(input.min_receipt_amount, 500);

  if (statementDay < 1 || statementDay > 31) {
    errors.push("Statement day must be between 1 and 31.");
  }
  if (submitDay < 1 || submitDay > 31) {
    errors.push("Submit day must be between 1 and 31.");
  }
  if (submitDay === statementDay) {
    // Both jobs would fire in the same tick, so the package would be built from
    // a reconciliation that had not been chased yet. The gap between the two is
    // the window for collecting whatever the statement says is missing.
    errors.push("Submit day cannot be the same day as the statement day.");
  }
  if (minAmount < 0) {
    errors.push("Receipt threshold cannot be negative — that would waive every charge.");
  }

  const accountsEmail = parseEmailList(input.accounts_email);
  const ccEmail = parseEmailList(input.cc_email);
  for (const address of [...accountsEmail, ...ccEmail]) {
    if (!EMAIL.test(address)) errors.push(`Not a valid email address: ${address}`);
  }

  // A card number pasted in full is trimmed to what we are allowed to keep.
  const digits = String(input.last4 ?? "").replace(/\D/g, "");

  return {
    ok: errors.length === 0,
    errors,
    value: {
      entity_name: String(input.entity_name ?? "").trim() || "VIP Industries Limited",
      label: String(input.label ?? "").trim() || "HDFC Corporate",
      last4: digits ? digits.slice(-4) : null,
      statement_day: statementDay,
      submit_day: submitDay,
      grace_days: graceDays,
      accounts_email: accountsEmail,
      cc_email: ccEmail,
      min_receipt_amount: minAmount,
      forex_markup_pct: numOr(input.forex_markup_pct, 3.5),
      forex_gst_pct: numOr(input.forex_gst_pct, 18),
    },
  };
}
