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
// The company that issues the bill, and the brand the card statement shows.
// Only names that mean one brand and nothing else: Pine Labs, say, prints on
// card slips at every kind of shop.
const LEGAL_NAMES = [
  [/swinsta|instamart|bundltechnolog/, "swiggy"],
  [/blinkcommerce|grofers/, "blinkit"],
  [/clicktechretail|appario|cloudtail/, "amazon"],
];

function brandOf(normalized) {
  for (const [pattern, brand] of LEGAL_NAMES) if (pattern.test(normalized)) return brand;
  return normalized;
}

export function merchantSimilarity(a, b) {
  const na = brandOf(normalizeMerchant(a));
  const nb = brandOf(normalizeMerchant(b));
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

// Google invoices every product as Google (Ireland, or India Digital); the card
// statement shows the product. The line items name it.
const GOOGLE_PRODUCTS = [
  [/youtube/i, "YouTube"],
  [/google\s*play/i, "Google Play"],
  [/google\s*one/i, "Google One"],
];

/** Every name a bill could appear under on the statement. */
export function billMerchants(receipt) {
  const names = [receipt?.merchant, receipt?.merchant_raw].filter(Boolean);
  if (!names.some((n) => normalizeMerchant(n).startsWith("google"))) return names;
  const items = [...(receipt.extracted?.a?.line_items || []), ...(receipt.extracted?.b?.line_items || [])]
    .map((i) => i?.desc || "")
    .join(" ");
  for (const [pattern, product] of GOOGLE_PRODUCTS) if (pattern.test(items)) names.push(product);
  return names;
}

const bestSimilarity = (receipt, txnMerchant) =>
  Math.max(0, ...billMerchants(receipt).map((n) => merchantSimilarity(n, txnMerchant)));

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

  const sim = bestSimilarity(receipt, txn.merchant);
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

const SPLIT_MAX_PARTS = 4;
const SPLIT_MAX_POOL = 12;
const SPLIT_TOLERANCE = 1;

/**
 * Receipts that together make up one charge — one order billed as several
 * invoices (Amazon ships each seller's items on its own bill). Only same-day
 * domestic receipts whose amounts sum to the charge within a rupee, and only
 * when exactly one combination does: two ways to reach the total is a guess.
 * Returns the receipts, or null.
 */
export function findSplit(receipts, txn) {
  const target = Number(txn?.amount);
  if (!(target > 0) || !txn.date) return null;

  const pool = (receipts || [])
    .filter((r) => (!r.currency || r.currency === "INR") && Number(r.amount) > 0 && Number(r.amount) < target && r.receipt_date)
    .filter((r) => {
      const d = dayDiff(txn.date, r.receipt_date);
      return d >= DOMESTIC_DATE_WINDOW.min && d <= DOMESTIC_DATE_WINDOW.max;
    });

  const byDay = {};
  for (const r of pool) (byDay[r.receipt_date] ||= []).push(r);

  let found = null;
  for (const group of Object.values(byDay)) {
    if (group.length < 2 || group.length > SPLIT_MAX_POOL) continue;
    const pick = [];
    const walk = (start, total) => {
      if (pick.length >= 2 && Math.abs(total - target) < SPLIT_TOLERANCE) {
        if (found) throw AMBIGUOUS;
        found = [...pick];
      }
      if (pick.length === SPLIT_MAX_PARTS) return;
      for (let i = start; i < group.length; i++) {
        const next = total + Number(group[i].amount);
        if (next > target + SPLIT_TOLERANCE) continue;
        pick.push(group[i]);
        walk(i + 1, next);
        pick.pop();
      }
    };
    try {
      walk(0, 0);
    } catch (err) {
      if (err === AMBIGUOUS) return null;
      throw err;
    }
  }
  return found;
}

const AMBIGUOUS = Symbol("ambiguous split");

/**
 * Two receipts that are one bill photographed or sent twice. Amount, currency
 * and day must agree and the merchant must read alike; then the same printed
 * time or the same invoice number settles it. Two items of one order share
 * all of that except the invoice number, so neither alone is enough.
 */
export function isSameBill(a, b) {
  if (!a || !b) return false;
  if (Math.abs(Number(a.amount) - Number(b.amount)) >= 0.01) return false;
  if ((a.currency || "INR") !== (b.currency || "INR")) return false;
  if (!a.receipt_date || a.receipt_date !== b.receipt_date) return false;
  if (merchantSimilarity(a.merchant, b.merchant) < 0.5) return false;

  const inv = (x) => String(x.invoice_no || "").trim().toLowerCase();
  if (inv(a) && inv(a) === inv(b)) return true;
  if (inv(a) && inv(b) && !a.receipt_time) return false;
  return Boolean(a.receipt_time) && String(a.receipt_time).slice(0, 5) === String(b.receipt_time || "").slice(0, 5);
}

/**
 * Whether the bills already filed against a charge account for all of it.
 * A foreign bill never sums to the rupee charge, so one is enough.
 */
export function isCovered(txn, bills) {
  const list = bills || [];
  if (!list.length) return false;
  if (list.some((r) => r.currency && r.currency !== "INR")) return true;
  const total = list.reduce((s, r) => s + Number(r.amount || 0), 0);
  return total >= Number(txn.amount) - SPLIT_TOLERANCE;
}

const TIPPED_CATEGORIES = new Set(["dining", "swiggy"]);

/**
 * A restaurant visit often yields two bills: the one brought to the table and
 * the one printed after the tip. Only the larger matches what was charged, so
 * it is the bill to keep. Returns { keep, drop } or null when the rule does not apply.
 */
export function tippedBill(txn, filed, incoming) {
  if (!TIPPED_CATEGORIES.has(txn?.category) || !incoming) return null;
  const twin = (filed || []).find(
    (b) => b.receipt_date && b.receipt_date === incoming.receipt_date && (b.currency || "INR") === (incoming.currency || "INR")
  );
  if (!twin) return null;
  return Number(incoming.amount) > Number(twin.amount) ? { keep: incoming, drop: twin } : { keep: twin, drop: incoming };
}

const SUGGEST_MERCHANT_MIN = 0.6;
const SUGGEST_AMOUNT_MIN = 0.99;

/**
 * Charges a bill the matcher gave up on could still belong to, best first.
 *
 * Looser than scoreCandidate on purpose: this is a list the user picks from,
 * and the bills that land here are mostly misreads — a wrong amount or a wrong
 * year — so the same merchant or the exact amount is enough to be shown.
 */
export function suggestCharges(receipt, txns, { limit = 4 } = {}) {
  const foreign = isForeign(receipt);
  const billInr = foreign ? Number(receipt.amount_inr) || null : Number(receipt.amount) || null;

  return (txns || [])
    .map((txn) => {
      const merchant = bestSimilarity(receipt, txn.merchant);
      const t = Number(txn.amount);
      const amount = billInr && t > 0 ? Math.min(billInr, t) / Math.max(billInr, t) : 0;
      const days = receipt.receipt_date ? Math.abs(dayDiff(receipt.receipt_date, txn.date)) : Infinity;
      const date = Math.max(0, 1 - days / 30);
      const fits = merchant >= SUGGEST_MERCHANT_MIN || (!foreign && amount >= SUGGEST_AMOUNT_MIN);
      return fits ? { txn, raw: merchant * 50 + amount * 30 + date * 20 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, limit)
    .map(({ txn, raw }) => ({ txn, score: Math.round(raw) }));
}
