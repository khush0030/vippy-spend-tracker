/**
 * Receipt → transaction matching.
 *
 * Deliberately conservative: a wrong auto-match is worse than no match, so the
 * engine only decides alone when the evidence is overwhelming and always
 * leaves an undo. Everything here is pure — no I/O, no imports — so it can be
 * tested directly and reasoned about without a database.
 *
 * Two profiles:
 *   domestic — the bank amount equals the bill amount, so amount dominates.
 *   foreign  — the bank amount is the bill converted at Visa's rate plus
 *              HDFC's markup and GST on it, so amount is only an estimate and
 *              merchant/country carry more of the decision.
 */

const DOMESTIC = { amount: 40, date: 25, merchant: 20, cardLast4: 10, time: 5, country: 0 };
const FOREIGN = { amount: 30, date: 20, merchant: 25, cardLast4: 10, time: 5, country: 10 };

const ALREADY_RECEIPTED_PENALTY = 30;

// Domestic: the bill and the charge should agree. Anything beyond 5% (or ₹20
// on small tickets) is a different transaction, not a rounding difference.
const DOMESTIC_AMOUNT_TOLERANCE_PCT = 0.05;
const DOMESTIC_AMOUNT_TOLERANCE_ABS = 20;

// Foreign charges post 1–3 business days after the swipe, and never before it.
const FOREIGN_DATE_WINDOW = { min: -1, max: 5 };
const DOMESTIC_DATE_WINDOW = { min: -7, max: 7 };

// Visa/Mastercard wholesale sits a little off mid-market, then HDFC adds a
// markup and 18% GST on that markup. Default 3.5% + GST ≈ 4.13%, plus ~1%
// network spread, so the plausible band tops out around 6%.
const DEFAULT_MARKUP_PCT = 3.5;
const DEFAULT_GST_PCT = 18;
const NETWORK_SPREAD_PCT = 1.0;

// How far outside the modelled band a posting can fall before we give up.
const FOREIGN_BAND_SLACK_PCT = 0.015;

export function normalizeMerchant(m) {
  return String(m ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function trigrams(s) {
  const padded = `  ${s} `;
  const out = new Set();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/**
 * 0..1 similarity. Exact normalised match wins outright; containment is strong
 * (bank descriptors bolt on branch names and city codes); otherwise Dice
 * coefficient over trigrams, which degrades gracefully on typos and truncation.
 */
export function merchantSimilarity(a, b) {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    // Floor at 0.8 — containment is meaningful even when lengths differ a lot.
    return 0.8 + 0.15 * ratio;
  }

  const ta = trigrams(na);
  const tb = trigrams(nb);
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

function toUTCDate(d) {
  if (d instanceof Date) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, day || 1);
}

/** Signed whole-day difference: positive when `a` is later than `b`. */
export function dayDiff(a, b) {
  return Math.round((toUTCDate(a) - toUTCDate(b)) / 86400000);
}

/**
 * The INR range a foreign charge could plausibly post at.
 * Low end is the raw conversion; high end adds network spread + markup + GST.
 */
export function expectedInrBand({
  amount,
  fxRate,
  markupPct = DEFAULT_MARKUP_PCT,
  gstPct = DEFAULT_GST_PCT,
}) {
  const base = Number(amount) * Number(fxRate);
  const markupWithGst = markupPct * (1 + gstPct / 100);
  const maxUpliftPct = markupWithGst + NETWORK_SPREAD_PCT;
  return { low: base, high: base * (1 + maxUpliftPct / 100), base };
}

function scoreAmountDomestic(receiptAmount, txnAmount) {
  const r = Number(receiptAmount);
  const t = Number(txnAmount);
  if (!(r > 0) || !(t > 0)) return { points: 0, disqualified: true, reason: "missing amount" };

  const diff = Math.abs(r - t);
  const pct = diff / t;

  if (pct > DOMESTIC_AMOUNT_TOLERANCE_PCT && diff > DOMESTIC_AMOUNT_TOLERANCE_ABS) {
    return { points: 0, disqualified: true, reason: "amount out of range" };
  }
  if (diff < 0.01) return { points: 40 };
  if (pct <= 0.005) return { points: 32 };
  if (pct <= 0.02 || diff <= 5) return { points: 22 };
  return { points: 10 };
}

function scoreAmountForeign(receipt, txnAmount) {
  const t = Number(txnAmount);

  // Dynamic currency conversion: the terminal already charged in INR and the
  // slip printed it, so an exact match is available and no modelling is needed.
  if (receipt.dcc_amount_inr != null) {
    const diff = Math.abs(Number(receipt.dcc_amount_inr) - t);
    if (diff < 0.01) return { points: 30 };
    if (diff / t <= 0.02) return { points: 22 };
    return { points: 0, disqualified: true, reason: "DCC amount mismatch" };
  }

  const fxRate = receipt.fx_rate;
  if (!(Number(fxRate) > 0)) {
    return { points: 0, disqualified: true, reason: "no fx rate available for this date" };
  }

  const band = expectedInrBand({
    amount: receipt.amount,
    fxRate,
    markupPct: receipt.markup_pct ?? DEFAULT_MARKUP_PCT,
    gstPct: receipt.gst_pct ?? DEFAULT_GST_PCT,
  });

  if (t >= band.low && t <= band.high) return { points: 30 };

  const slackLow = band.low * (1 - FOREIGN_BAND_SLACK_PCT);
  const slackHigh = band.high * (1 + FOREIGN_BAND_SLACK_PCT);
  if (t >= slackLow && t <= slackHigh) return { points: 18 };

  return { points: 0, disqualified: true, reason: "outside plausible fx + markup band" };
}

function scoreDate(receiptDate, txnDate, foreign) {
  if (!receiptDate || !txnDate) {
    return { points: 0, disqualified: true, reason: "missing date" };
  }
  // Positive = the bank posted it after the receipt was written.
  const delta = dayDiff(txnDate, receiptDate);
  const window = foreign ? FOREIGN_DATE_WINDOW : DOMESTIC_DATE_WINDOW;

  if (delta < window.min || delta > window.max) {
    return { points: 0, disqualified: true, reason: "date outside window" };
  }

  const max = foreign ? 20 : 25;
  const abs = Math.abs(delta);
  if (abs === 0) return { points: max };
  if (abs === 1) return { points: Math.round(max * 0.76) };
  if (abs <= 3) return { points: Math.round(max * 0.44) };
  return { points: Math.round(max * 0.16) };
}

function scoreTime(receiptTime, txnTime) {
  if (!receiptTime || !txnTime) return 0;
  const toMin = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const a = toMin(receiptTime);
  const b = toMin(txnTime);
  if (a == null || b == null) return 0;
  return Math.abs(a - b) <= 30 ? 5 : 0;
}

function isForeign(receipt) {
  return Boolean(receipt.currency) && receipt.currency !== "INR";
}

/**
 * Score one receipt against one candidate transaction.
 * Returns { score, breakdown, weights, disqualified, reason }.
 */
export function scoreCandidate(receipt, txn, opts = {}) {
  const foreign = isForeign(receipt);
  const weights = foreign ? FOREIGN : DOMESTIC;

  const amount = foreign
    ? scoreAmountForeign(receipt, txn.amount)
    : scoreAmountDomestic(receipt.amount, txn.amount);

  const date = scoreDate(receipt.receipt_date, txn.date, foreign);

  const failed = [amount, date].find((r) => r.disqualified);
  if (failed) {
    return {
      score: 0,
      disqualified: true,
      reason: failed.reason,
      breakdown: { amount: 0, date: 0, merchant: 0, cardLast4: 0, time: 0, country: 0 },
      weights,
    };
  }

  const sim = Math.max(
    merchantSimilarity(receipt.merchant, txn.merchant),
    merchantSimilarity(receipt.merchant_raw, txn.merchant)
  );
  const merchant = Math.round(sim * weights.merchant);

  const expectedTail = opts.cardLast4 ?? null;
  const cardLast4 =
    expectedTail && receipt.card_last4 && String(receipt.card_last4) === String(expectedTail)
      ? weights.cardLast4
      : 0;

  // Country only carries weight for foreign receipts, where the bank descriptor
  // usually names the city or carries a country code.
  let country = 0;
  if (foreign && receipt.country) {
    const descriptor = normalizeMerchant(txn.merchant);
    const cityHit = receipt.city && descriptor.includes(normalizeMerchant(receipt.city));
    const codeHit = descriptor.includes(normalizeMerchant(receipt.country));
    country = cityHit || codeHit ? weights.country : Math.round(weights.country * 0.5);
  }

  const time = scoreTime(receipt.receipt_time, txn.txn_time);

  const breakdown = {
    amount: amount.points,
    date: date.points,
    merchant,
    cardLast4,
    time,
    country,
  };

  let score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (txn.receipt_status === "attached") score -= ALREADY_RECEIPTED_PENALTY;

  return { score, breakdown, weights, disqualified: false, reason: null, foreign };
}

const AUTO_MIN = 75;
const AUTO_MIN_FOREIGN = 80;
const AUTO_GAP = 15;
const ASK_MIN = 45;
const MAX_OPTIONS = 3;

/**
 * Turn scored candidates into one of three actions.
 *
 * auto  — overwhelming and unambiguous; link it, with an undo in chat.
 * ask   — plausible; show the top few as buttons and let the human decide.
 * defer — nothing credible; park it and retry after the next sync, which is
 *         the normal case when the receipt arrives before the bank alert.
 */
export function decide(candidates, opts = {}) {
  const ranked = (candidates || [])
    .filter((c) => c && !c.disqualified)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return { action: "defer", best: null, candidates: [] };
  }

  const best = ranked[0];
  const runnerUp = ranked[1];
  const gap = runnerUp ? best.score - runnerUp.score : Infinity;
  const autoMin = opts.foreign ? AUTO_MIN_FOREIGN : AUTO_MIN;

  if (best.score >= autoMin && gap >= AUTO_GAP) {
    return { action: "auto", best, candidates: ranked.slice(0, MAX_OPTIONS), gap };
  }
  if (best.score >= ASK_MIN) {
    return { action: "ask", best, candidates: ranked.slice(0, MAX_OPTIONS), gap };
  }
  return { action: "defer", best: null, candidates: [] };
}
