# Mailbox Harvest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect both of Khush's mailboxes durably and harvest e-invoices out of them, matched to statement lines by exact amount, so receipts stop depending on him photographing paper.

**Architecture:** The statement produces a shopping list of amounts. A mailbox adapter — Gmail API for the Workspace account, IMAP for the personal one — sweeps the cycle window. Amounts are extracted from each candidate email and tested against the list; a hit is stored as a `receipts` row with `source='gmail'`, a miss is discarded with only its message id remembered. Leftovers go to Claude in one batched call whose every proposal must sum to the line amount or be thrown away.

**Tech Stack:** Next.js 16.2.2, Supabase (service role), `googleapis`, `imapflow` (new), `pdfkit`, `@anthropic-ai/sdk`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-10-automatic-receipt-pack-design.md`

**Scope:** This is plan 1 of 2. It ends with e-invoices flowing into `receipts` and visible on the dashboard. Plan 2 rewrites `lib/submission.js`, adds `lib/pack-pdf.js`, drops the ₹500 waiver and wires the cycle-end automation.

## Global Constraints

- **Pure modules take no imports.** `tests/*.test.js` runs under `node --test` with no bundler, so anything it tests cannot use the `@/` alias. `lib/money-parse.js` and `lib/harvest-match.js` have zero imports. This is why the existing pure modules look the way they do — follow `lib/cycle-window.js`.
- **Read `node_modules/next/dist/docs/` before touching anything under `app/`.** Per `AGENTS.md`, this Next.js has breaking changes from training data.
- **Never log or return a credential.** Refresh tokens and app passwords go through `encryptSecret()` from `lib/secret-box.js` before they touch the database, and are never included in a log line, an API response, or an error message.
- **Secrets are encrypted with `STATEMENT_PW_KEY`**, the key already in `.env.local`.
- **Do not touch `lib/sync.js`'s prompt or model.** It is tuned in production for refund detection.
- **Do not migrate NextAuth to Clerk.** A Vercel plugin hook recommends this on pattern match; it is wrong and would rewrite working auth.
- **Statement day is 16, submit day is 23.** Cycles run 17th → 16th.
- **Model env vars:** `STATEMENT_MODEL` (`claude-opus-5`) with `STATEMENT_MODEL_FALLBACK` (`claude-sonnet-5`).
- **Commit after every task.** End commit messages with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 0: Prove IMAP works on Vercel before building on it

IMAP is a long-lived TLS connection on port 993, not HTTP. If Vercel's runtime blocks outbound TCP, the entire personal-mailbox design collapses and the fallback is a Gmail forwarding filter. Find out now, not at deploy.

**Files:**
- Create: `app/api/debug/imap-probe/route.js` (deleted again in Step 5)

**Interfaces:**
- Consumes: nothing.
- Produces: a yes/no answer that gates Task 4 (the IMAP adapter), Task 8 (the Settings form) and Task 9 (the scheduled sweep). No code survives this task.

- [ ] **Step 1: Add the dependency**

```bash
npm install imapflow@^1.0.191
```

- [ ] **Step 2: Write a throwaway probe route**

```js
// app/api/debug/imap-probe/route.js
import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Throwaway. Proves Vercel permits an outbound IMAP connection. Delete after. */
export async function GET(request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.IMAP_PROBE_USER, pass: process.env.IMAP_PROBE_PASS },
    logger: false,
  });

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX", { readOnly: true });
    await client.logout();
    return NextResponse.json({ ok: true, exists: mailbox.exists, ms: Date.now() - started });
  } catch (err) {
    // The message matters: ETIMEDOUT/ECONNREFUSED means the platform blocks it,
    // AUTHENTICATIONFAILED means the platform is fine and the password is wrong.
    return NextResponse.json(
      { ok: false, code: err.code || null, message: err.message, ms: Date.now() - started },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Set the probe credentials and deploy**

Ask Khush for the app password generated from https://myaccount.google.com/apppasswords, then:

`vercel env add` reads the value from the interactive prompt — it is **not** passed as
`NAME=value` on the command line.

```bash
vercel env add IMAP_PROBE_USER production   # paste khushmutha20@gmail.com at the prompt
vercel env add IMAP_PROBE_PASS production   # paste the 16-character app password at the prompt
vercel --prod
```

- [ ] **Step 4: Run the probe**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://vippy-spend-tracker.vercel.app/api/debug/imap-probe | tee /tmp/imap-probe.json
```

Expected on success: `{"ok":true,"exists":<some number>,"ms":<under 5000>}`

**If `ok` is false and `code` is `ETIMEDOUT` or `ECONNREFUSED`: STOP.** Vercel is blocking outbound IMAP. Report this to Khush and do not continue past Task 3 — the personal mailbox must fall back to a Gmail forwarding filter, which changes Tasks 4, 8 and 9 and needs a spec amendment first.

If `code` is `AUTHENTICATIONFAILED`, the platform is fine; the credential is wrong. Get a fresh app password and retry Step 4.

- [ ] **Step 5: Remove the probe and its credentials**

```bash
rm -rf app/api/debug/imap-probe
vercel env rm IMAP_PROBE_USER production
vercel env rm IMAP_PROBE_PASS production
git add -A
git commit -m "$(cat <<'EOF'
Add imapflow

Vercel permits outbound IMAP on 993, verified with a throwaway probe route
that has been removed again. That was the one platform assumption the
personal mailbox design rests on and could not be checked by reading docs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1: `lib/money-parse.js` — pull amounts out of text

The crux of the design and where the bugs will live. European decimal commas, Swiss apostrophes and Czech koruna all have to survive. Pure, no imports.

**Files:**
- Create: `lib/money-parse.js`
- Test: `tests/money-parse.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `extractAmounts(text: string) -> Array<{ value: number, currency: string, raw: string }>` where `currency` is an ISO 4217 code. Used by Tasks 2 and 7.

- [ ] **Step 1: Write the failing test**

```js
// tests/money-parse.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAmounts } from "../lib/money-parse.js";

const one = (text) => {
  const found = extractAmounts(text);
  assert.equal(found.length, 1, `expected exactly one amount in ${JSON.stringify(text)}, got ${JSON.stringify(found)}`);
  return found[0];
};

test("symbol before the number", () => {
  assert.deepEqual({ ...one("Total €33.90") }, { value: 33.9, currency: "EUR", raw: "€33.90" });
  assert.equal(one("Paid ₹10,168.64 today").value, 10168.64);
  assert.equal(one("£30.99").currency, "GBP");
});

test("code before the number", () => {
  assert.equal(one("CHF 34.40").value, 34.4);
  assert.equal(one("CZK 1150.46").value, 1150.46);
  assert.equal(one("INR 5,093.22").value, 5093.22);
  assert.equal(one("USD 15.68").currency, "USD");
});

test("currency after the number", () => {
  assert.equal(one("1 473,50 Kč").value, 1473.5);
  assert.equal(one("1 473,50 Kč").currency, "CZK");
  assert.equal(one("48.46 EUR").value, 48.46);
});

test("European decimal comma", () => {
  // The rightmost separator is the decimal one.
  assert.equal(one("€ 630,91").value, 630.91);
  assert.equal(one("EUR 1.234,56").value, 1234.56);
});

test("Anglo decimal point with comma grouping", () => {
  assert.equal(one("₹10,168.64").value, 10168.64);
  assert.equal(one("$1,234.56").value, 1234.56);
});

test("three digits after a separator is grouping, not decimals", () => {
  // ₹1,234 is one thousand two hundred and thirty four, never 1.234
  assert.equal(one("₹1,234").value, 1234);
  assert.equal(one("EUR 1.234").value, 1234);
});

test("two digits after a separator is decimals", () => {
  assert.equal(one("EUR 12,50").value, 12.5);
  assert.equal(one("$12.50").value, 12.5);
});

test("Swiss apostrophe grouping", () => {
  assert.equal(one("CHF 1'234.56").value, 1234.56);
});

test("non-breaking and narrow spaces group digits", () => {
  assert.equal(one("EUR 1\u00a0234,56").value, 1234.56);
  assert.equal(one("EUR 1\u202f234,56").value, 1234.56);
});

test("Rs and US$ variants normalise", () => {
  assert.equal(one("Rs. 1,694.07").currency, "INR");
  assert.equal(one("Rs 500").currency, "INR");
  assert.equal(one("US$53.22").currency, "USD");
});

test("a bare number with no currency is not an amount", () => {
  assert.deepEqual(extractAmounts("Order 8371693382 confirmed"), []);
  assert.deepEqual(extractAmounts("12 items, 3 boxes"), []);
});

test("adjacent amounts are all found and none swallows the next", () => {
  // A currency token trailing one amount must not be stolen from the next.
  const found = extractAmounts("Subtotal €15.00 EUR 20.00 total");
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.value), [15, 20]);
});

test("a real Uber receipt body", () => {
  const body = "Thanks for riding, Khush Total €33.90 Meter fare €30.40 Booking Fee €3.50 Visa ••••7634 €33.90";
  const values = extractAmounts(body).map((f) => f.value);
  assert.deepEqual(values, [33.9, 30.4, 3.5, 33.9]);
  assert.ok(extractAmounts(body).every((f) => f.currency === "EUR"));
});

test("a real HDFC line and a Czech receipt in one body", () => {
  const found = extractAmounts("Celková splatná částka 579,99 Kč charged as ₹2,645.08");
  assert.deepEqual(found.map((f) => [f.value, f.currency]), [[579.99, "CZK"], [2645.08, "INR"]]);
});

test("four or more digits after a separator is rejected, not guessed", () => {
  assert.deepEqual(extractAmounts("ref €1,23456"), []);
});

test("deduplicates an amount written with both symbol and code", () => {
  // "€33.90 EUR" is one amount, not two.
  assert.equal(extractAmounts("€33.90 EUR").length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/money-parse.test.js`
Expected: FAIL — `Cannot find module '../lib/money-parse.js'`

- [ ] **Step 3: Write the implementation**

```js
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

// A number with optional grouping and an optional 1-2 digit decimal tail.
// Grouping accepts space, non-breaking space, narrow no-break space, comma,
// dot and the Swiss apostrophe. The {3} is load-bearing: it is what makes
// "1,234" grouping and "12,50" decimal without knowing anyone's locale.
const NUMBER = "\\d{1,3}(?:[.,'\u2019\u00a0\u202f ]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/money-parse.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run the whole suite to check nothing regressed**

Run: `npm test`
Expected: PASS — 276 existing tests plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add lib/money-parse.js tests/money-parse.test.js
git commit -m "$(cat <<'EOF'
Read amounts out of text without knowing the locale

The harvester matches an email to a statement line by amount and nothing
else, so a misread separator is a receipt going to the wrong charge rather
than a cosmetic bug. EUR 1.234,56 and $1,234.56 are the same number written
with each other's separators and both appear on the same statement.

Resolved positionally instead: the rightmost separator is the decimal one,
and three digits after a separator is grouping. Shapes that fit neither are
rejected rather than guessed, because no match is a safer failure than a
confident wrong one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `lib/harvest-match.js` — decide which email belongs to which line

Pure decision logic, separated from every mailbox and database concern so it can be tested against the real August statement without a network. Zero imports.

**Files:**
- Create: `lib/harvest-match.js`
- Test: `tests/harvest-match.test.js`

**Interfaces:**
- Consumes: amount objects shaped `{ value, currency }` as produced by `extractAmounts` (Task 1).
- Produces, all used by Task 6 and 7:
  - `targetAmount(line) -> { value, currency } | null`
  - `matchEmailsToLines(lines, candidates) -> { links, ambiguous, unmatchedLines, unmatchedEmails }`
  - `validateProposal(line, parts) -> { ok, sum, target, delta }`

  where a **line** is `{ id, line_no, txn_date, descriptor, amount, currency, amount_orig, direction, type }`,
  a **candidate** is `{ messageId, date, amounts: Array<{value, currency}> }` with `date` an ISO `YYYY-MM-DD`,
  a **link** is `{ lineId, lineNo, messageId, value, currency, dayDelta }`,
  and a **part** is `{ messageId, value, currency }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/harvest-match.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { targetAmount, matchEmailsToLines, validateProposal } from "../lib/harvest-match.js";

const line = (over = {}) => ({
  id: "l1", line_no: 1, txn_date: "2026-08-12", descriptor: "UBER *TRIP",
  amount: 3738.33, currency: "EUR", amount_orig: 33.9,
  direction: "debit", type: "purchase", ...over,
});

const email = (over = {}) => ({
  messageId: "m1", date: "2026-08-12", amounts: [{ value: 33.9, currency: "EUR" }], ...over,
});

test("a foreign line is looked for in its own currency, not rupees", () => {
  assert.deepEqual(targetAmount(line()), { value: 33.9, currency: "EUR" });
});

test("a domestic line is looked for in rupees", () => {
  const t = targetAmount(line({ currency: "INR", amount_orig: null, amount: 1668 }));
  assert.deepEqual(t, { value: 1668, currency: "INR" });
});

test("a foreign line with no origin amount falls back to rupees", () => {
  const t = targetAmount(line({ amount_orig: null }));
  assert.deepEqual(t, { value: 3738.33, currency: "INR" });
});

test("fees, payments and credits are never chased for a receipt", () => {
  assert.equal(targetAmount(line({ type: "fee" })), null);
  assert.equal(targetAmount(line({ type: "payment", direction: "credit" })), null);
  assert.equal(targetAmount(line({ direction: "credit" })), null);
});

test("an exact amount inside the window links", () => {
  const r = matchEmailsToLines([line()], [email()]);
  assert.equal(r.links.length, 1);
  assert.deepEqual(
    { ...r.links[0] },
    { lineId: "l1", lineNo: 1, messageId: "m1", value: 33.9, currency: "EUR", dayDelta: 0 }
  );
  assert.equal(r.unmatchedLines.length, 0);
  assert.equal(r.unmatchedEmails.length, 0);
});

test("the window is asymmetric: a charge posts after the receipt, not long before", () => {
  // -1 through +3 inclusive.
  const days = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-15", "2026-08-16"];
  const got = days.map((d) => matchEmailsToLines([line()], [email({ date: d })]).links.length);
  assert.deepEqual(got, [0, 1, 1, 1, 0]);
});

test("the same amount in a different currency does not link", () => {
  const r = matchEmailsToLines([line()], [email({ amounts: [{ value: 33.9, currency: "CHF" }] })]);
  assert.equal(r.links.length, 0);
  assert.equal(r.unmatchedEmails.length, 1);
});

test("several emails may document one line", () => {
  // Saravanaa Bhavan: the restaurant bill and the card slip are both evidence.
  const r = matchEmailsToLines(
    [line()],
    [email({ messageId: "bill" }), email({ messageId: "slip" })]
  );
  assert.equal(r.links.length, 2);
  assert.deepEqual(r.links.map((l) => l.messageId).sort(), ["bill", "slip"]);
  assert.equal(r.unmatchedLines.length, 0);
});

test("one email against two candidate lines takes the nearer date", () => {
  // Two Bulldog Hotel charges at EUR 7.10 on consecutive days.
  const a = line({ id: "same-day", txn_date: "2026-08-12", amount_orig: 7.1 });
  const b = line({ id: "next-day", line_no: 2, txn_date: "2026-08-13", amount_orig: 7.1 });
  const r = matchEmailsToLines([a, b], [email({ date: "2026-08-12", amounts: [{ value: 7.1, currency: "EUR" }] })]);
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].lineId, "same-day");
  assert.equal(r.ambiguous.length, 0);
  assert.deepEqual(r.unmatchedLines.map((l) => l.id), ["next-day"]);
});

test("a genuine tie is held for a human, never guessed", () => {
  // Equidistant: one day before, one day after.
  const a = line({ id: "before", txn_date: "2026-08-11", amount_orig: 7.1 });
  const b = line({ id: "after", line_no: 2, txn_date: "2026-08-13", amount_orig: 7.1 });
  const r = matchEmailsToLines([a, b], [email({ date: "2026-08-12", amounts: [{ value: 7.1, currency: "EUR" }] })]);
  assert.equal(r.links.length, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].messageId, "m1");
  assert.deepEqual(r.ambiguous[0].lineIds.sort(), ["after", "before"]);
});

test("an email carrying many amounts matches on any one of them", () => {
  const r = matchEmailsToLines([line()], [email({
    amounts: [{ value: 30.4, currency: "EUR" }, { value: 3.5, currency: "EUR" }, { value: 33.9, currency: "EUR" }],
  })]);
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].value, 33.9);
});

test("rounding noise within a hundredth still matches", () => {
  const r = matchEmailsToLines([line()], [email({ amounts: [{ value: 33.900001, currency: "EUR" }] })]);
  assert.equal(r.links.length, 1);
});

test("a proposed split must sum to the line or it is refused", () => {
  const l = line({ currency: "INR", amount_orig: null, amount: 1668 });
  const good = validateProposal(l, [
    { messageId: "a", value: 555, currency: "INR" },
    { messageId: "b", value: 878, currency: "INR" },
    { messageId: "c", value: 235, currency: "INR" },
  ]);
  assert.equal(good.ok, true);
  assert.equal(good.sum, 1668);

  const bad = validateProposal(l, [
    { messageId: "a", value: 555, currency: "INR" },
    { messageId: "b", value: 878, currency: "INR" },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.delta, 235);
});

test("a split in the wrong currency is refused however well it adds up", () => {
  const l = line({ currency: "INR", amount_orig: null, amount: 1668 });
  const r = validateProposal(l, [{ messageId: "a", value: 1668, currency: "EUR" }]);
  assert.equal(r.ok, false);
});

test("tolerance is the larger of one rupee or half a percent", () => {
  const small = line({ currency: "INR", amount_orig: null, amount: 100 });
  assert.equal(validateProposal(small, [{ messageId: "a", value: 100.9, currency: "INR" }]).ok, true);
  assert.equal(validateProposal(small, [{ messageId: "a", value: 102, currency: "INR" }]).ok, false);

  const large = line({ currency: "INR", amount_orig: null, amount: 40000 });
  assert.equal(validateProposal(large, [{ messageId: "a", value: 40150, currency: "INR" }]).ok, true);
  assert.equal(validateProposal(large, [{ messageId: "a", value: 41000, currency: "INR" }]).ok, false);
});

test("an empty proposal is refused rather than treated as zero", () => {
  assert.equal(validateProposal(line(), []).ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/harvest-match.test.js`
Expected: FAIL — `Cannot find module '../lib/harvest-match.js'`

- [ ] **Step 3: Write the implementation**

```js
/**
 * Decide which harvested email documents which statement line. Pure — no
 * imports, no I/O, so it can be tested against the real August statement
 * without a mailbox or a database.
 *
 * The bank's own ledger is the fixed point. A line names an amount, and the
 * question asked of the mailbox is only ever "does anything here mention that
 * amount, around that date". No merchant name is parsed, no sender recognised,
 * so a hostel in Prague and a funicular in Zermatt need no code of their own.
 */

// A charge posts after the merchant issues the receipt, essentially never
// more than a day before it. The window is asymmetric for that reason.
const DAYS_BEFORE = 1;
const DAYS_AFTER = 3;

// Amounts are compared to the hundredth. Anything finer is float noise.
const EPSILON = 0.005;

function toUtc(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(fromIso, toIso) {
  const a = toUtc(fromIso);
  const b = toUtc(toIso);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * What to look for in the mailbox for a given line, or null if the line is
 * not the sort of thing that has a receipt.
 *
 * A foreign charge is looked for in the currency the merchant billed, never
 * in rupees: HDFC's rupee figure includes a markup and GST that appear on no
 * receipt anywhere, so it would never match. The statement carries the origin
 * amount precisely so this is possible.
 */
export function targetAmount(line) {
  if (!line || line.direction !== "debit") return null;
  if (line.type === "fee" || line.type === "payment") return null;

  if (line.currency && line.currency !== "INR" && line.amount_orig != null) {
    return { value: Number(line.amount_orig), currency: line.currency };
  }
  if (line.amount == null) return null;
  return { value: Number(line.amount), currency: "INR" };
}

export function matchEmailsToLines(lines, candidates) {
  const targets = [];
  for (const line of lines || []) {
    const target = targetAmount(line);
    if (target && Number.isFinite(target.value)) targets.push({ line, target });
  }

  const links = [];
  const ambiguous = [];
  const unmatchedEmails = [];
  const linkedLineIds = new Set();

  for (const candidate of candidates || []) {
    const hits = [];

    for (const { line, target } of targets) {
      const delta = daysBetween(line.txn_date, candidate.date);
      if (delta === null || delta < -DAYS_BEFORE || delta > DAYS_AFTER) continue;

      const amount = (candidate.amounts || []).find(
        (a) => a.currency === target.currency && Math.abs(Number(a.value) - target.value) < EPSILON
      );
      if (!amount) continue;

      hits.push({
        lineId: line.id,
        lineNo: line.line_no,
        messageId: candidate.messageId,
        value: target.value,
        currency: target.currency,
        dayDelta: delta,
      });
    }

    if (hits.length === 0) {
      unmatchedEmails.push(candidate);
      continue;
    }

    if (hits.length === 1) {
      links.push(hits[0]);
      linkedLineIds.add(hits[0].lineId);
      continue;
    }

    // Several lines want the same email. The nearest date wins — but only if
    // it wins outright. Two charges equidistant from one receipt is exactly
    // the case where a confident guess files a bill against the wrong day.
    const nearest = Math.min(...hits.map((h) => Math.abs(h.dayDelta)));
    const closest = hits.filter((h) => Math.abs(h.dayDelta) === nearest);

    if (closest.length === 1) {
      links.push(closest[0]);
      linkedLineIds.add(closest[0].lineId);
    } else {
      ambiguous.push({
        messageId: candidate.messageId,
        lineIds: closest.map((h) => h.lineId),
        value: closest[0].value,
        currency: closest[0].currency,
      });
    }
  }

  const unmatchedLines = targets.map((t) => t.line).filter((l) => !linkedLineIds.has(l.id));

  return { links, ambiguous, unmatchedLines, unmatchedEmails };
}

/**
 * The arithmetic gate on anything a language model proposes.
 *
 * The model is allowed to suggest that three Amazon invoices together explain
 * one ₹1,668 charge. It is not allowed to be believed: the parts must add up
 * to the line, in the line's own currency, or the proposal is discarded. This
 * is what stops a fluent, plausible and wrong answer from reaching the
 * accounts department.
 */
export function validateProposal(line, parts) {
  const target = targetAmount(line);
  if (!target) return { ok: false, sum: 0, target: null, delta: null };

  const list = parts || [];
  if (!list.length) return { ok: false, sum: 0, target: target.value, delta: target.value };

  if (list.some((p) => p.currency !== target.currency)) {
    return { ok: false, sum: null, target: target.value, delta: null };
  }

  const sum = list.reduce((total, p) => total + Number(p.value || 0), 0);
  const delta = Math.abs(sum - target.value);
  const tolerance = Math.max(1, target.value * 0.005);

  return { ok: delta <= tolerance, sum: Number(sum.toFixed(2)), target: target.value, delta: Number(delta.toFixed(2)) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/harvest-match.test.js`
Expected: PASS, 16 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/harvest-match.js tests/harvest-match.test.js
git commit -m "$(cat <<'EOF'
Match emails to statement lines by amount alone

The bank's ledger is the fixed point, so the only question put to a mailbox
is whether anything in it mentions a given amount around a given date. No
sender is recognised and no merchant name parsed, which is why a hostel in
Prague and a funicular in Zermatt need no code of their own.

Foreign lines are looked for in the currency the merchant billed rather than
in rupees, because HDFC's rupee figure carries a markup and GST that appear
on no receipt anywhere and would never match.

Where two charges sit equidistant from one receipt the match is held for a
human instead of guessed, and anything a model proposes must add up to the
line in the line's own currency or be discarded.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `mail_accounts` — the table and its model layer

Stores both mailbox credentials encrypted, and replaces the single `GOOGLE_REFRESH_TOKEN` environment variable that everything currently reads.

**Files:**
- Create: `scripts/mailbox-migration.sql`
- Create: `lib/mail-account.js`
- Test: `tests/mail-account.test.js`

**Interfaces:**
- Consumes: `encryptSecret` / `decryptSecret` from `lib/secret-box.js`, `getSupabaseAdmin` from `lib/supabase.js`.
- Produces:
  - `normaliseEmail(input) -> string | null` — pure
  - `normaliseAppPassword(input) -> string | null` — pure, strips the spaces Google displays
  - `validateAccountInput({ email, auth_kind, credential, role }) -> { ok, errors: string[] }` — pure
  - `listMailAccounts(userId) -> Promise<Array<account>>` with `credential` **omitted**
  - `getMailAccount(userId, id) -> Promise<account & { credential }>` — decrypted, for adapters only
  - `primaryMailAccount(userId) -> Promise<account & { credential } | null>`
  - `saveMailAccount(userId, input) -> Promise<account>`
  - `removeMailAccount(userId, id) -> Promise<void>`
  - `markRevoked(userId, id) / markActive(userId, id) -> Promise<boolean>` — returns whether the status actually changed, so Task 9 alerts only on the transition

- [ ] **Step 1: Write the migration**

```sql
-- scripts/mailbox-migration.sql
-- Run in the Supabase SQL editor. DDL needs more than the anon key.

create table if not exists mail_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null,
  email             text not null,
  auth_kind         text not null
                    check (auth_kind in ('oauth','imap_app_password')),
  credential        text not null,               -- secret-box ciphertext, never plaintext
  role              text not null default 'invoices'
                    check (role in ('primary','invoices')),
  status            text not null default 'active'
                    check (status in ('active','revoked')),
  last_harvest_at   timestamptz,
  last_checked_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (user_id, email)
);

-- Exactly one mailbox per user may be the source of bank alerts and the
-- statement PDF. Two claiming it would be a quiet, ugly failure, so the
-- database refuses rather than the application remembering to check.
create unique index if not exists mail_accounts_one_primary
  on mail_accounts (user_id) where role = 'primary';

-- Which messages have already been looked at. Identifiers only: the body of a
-- discarded email is never persisted, which is the whole basis of letting this
-- read a personal mailbox at all.
create table if not exists mail_seen (
  user_id      text not null,
  account_id   uuid not null references mail_accounts(id) on delete cascade,
  message_id   text not null,
  cycle_id     uuid,
  outcome      text not null check (outcome in ('matched','discarded','ambiguous','error')),
  seen_at      timestamptz not null default now(),
  primary key (user_id, account_id, message_id)
);

create index if not exists mail_seen_cycle_idx on mail_seen (user_id, cycle_id);

alter table receipts add column if not exists mail_message_id text;
alter table receipts add column if not exists source_account  text;

create index if not exists receipts_mail_msg_idx
  on receipts (user_id, mail_message_id) where mail_message_id is not null;

-- Deny-all RLS for anon, matching scripts/receipt-rail-migration.sql. The app
-- talks to Supabase with the service role and scopes by user_id itself,
-- because it authenticates with NextAuth so auth.uid() is never populated.
do $$
declare t text;
begin
  foreach t in array array['mail_accounts','mail_seen'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_deny_anon', t);
    execute format(
      'create policy %I on %I for all to anon using (false) with check (false)',
      t || '_deny_anon', t
    );
  end loop;
end $$;
```

- [ ] **Step 2: Run the migration**

Paste the file into the Supabase SQL editor and run it. Then confirm:

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  for (const t of ['mail_accounts','mail_seen']) {
    const {error}=await sb.from(t).select('*').limit(1);
    console.log(t, error ? 'MISSING: '+error.message : 'ok');
  }
  const {error}=await sb.from('receipts').select('mail_message_id,source_account').limit(1);
  console.log('receipts columns', error ? 'MISSING: '+error.message : 'ok');
})();
"
```

Expected: three `ok` lines.

- [ ] **Step 3: Write the failing test**

```js
// tests/mail-account.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseEmail, normaliseAppPassword, validateAccountInput } from "../lib/mail-account.js";

test("email is lowercased and trimmed", () => {
  assert.equal(normaliseEmail("  KMutha@VippySoya.com "), "kmutha@vippysoya.com");
});

test("nonsense is not an email", () => {
  assert.equal(normaliseEmail("not-an-email"), null);
  assert.equal(normaliseEmail(""), null);
  assert.equal(normaliseEmail(null), null);
});

test("app passwords lose the spaces Google shows them with", () => {
  // Google displays "abcd efgh ijkl mnop"; users paste it exactly like that.
  assert.equal(normaliseAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
  assert.equal(normaliseAppPassword("abcdefghijklmnop"), "abcdefghijklmnop");
});

test("an app password is sixteen letters or it is not one", () => {
  assert.equal(normaliseAppPassword("abcd efgh ijkl"), null);
  assert.equal(normaliseAppPassword("abcd efgh ijkl mnop qrst"), null);
  assert.equal(normaliseAppPassword("abcd1fgh ijkl mnop"), null);
});

test("a valid oauth account passes", () => {
  const r = validateAccountInput({
    email: "kmutha@vippysoya.com", auth_kind: "oauth", credential: "1//0abc", role: "primary",
  });
  assert.deepEqual(r, { ok: true, errors: [] });
});

test("a valid app-password account passes", () => {
  const r = validateAccountInput({
    email: "khushmutha20@gmail.com", auth_kind: "imap_app_password",
    credential: "abcd efgh ijkl mnop", role: "invoices",
  });
  assert.equal(r.ok, true);
});

test("an app-password account may not be the primary mailbox", () => {
  // Bank alerts and the statement PDF are fetched over the Gmail API.
  const r = validateAccountInput({
    email: "khushmutha20@gmail.com", auth_kind: "imap_app_password",
    credential: "abcd efgh ijkl mnop", role: "primary",
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /primary/i.test(e)));
});

test("every fault is reported at once, not one at a time", () => {
  const r = validateAccountInput({ email: "nope", auth_kind: "carrier-pigeon", credential: "" });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test tests/mail-account.test.js`
Expected: FAIL — `Cannot find module '../lib/mail-account.js'`

**Note on imports — this rule governs Tasks 3, 6 and 7.** `node --test` runs without a bundler, so it cannot resolve `@/`. It also evaluates the *entire* module graph on import, so a test that touches only a pure function still fails if anything downstream uses the alias. `lib/logger.js`, `lib/storage.js` and `lib/match-service.js` all do.

This file is safe because it imports only `./supabase.js` and `./secret-box.js`, and neither of those reaches for the alias — `supabase.js` imports the npm package, `secret-box.js` imports `node:crypto`. Write both as **relative paths**, not `@/`.

Every other tested module in this repo (`card-account.js`, `matcher.js`, `recon.js`, `statement-lines.js`, `cycle-window.js`) has *no imports at all*. Where a pure function would otherwise be trapped behind an aliased dependency, split it into its own zero-import module — which is exactly why `cycle-window.js` exists apart from `cycles.js`. Tasks 6 and 7 each do this.

- [ ] **Step 5: Write the implementation**

```js
// lib/mail-account.js
import { getSupabaseAdmin } from "./supabase.js";
import { encryptSecret, decryptSecret } from "./secret-box.js";

/**
 * Connected mailboxes and their credentials.
 *
 * Two accounts, connected two different ways, because Google will not permit
 * one. gmail.readonly is a restricted scope: publishing the consent screen to
 * production would mean an annual third-party penetration test, and leaving it
 * in testing expires refresh tokens weekly. So the Workspace account uses an
 * Internal consent screen, which is exempt from both, and the personal account
 * uses an IMAP app password, which sidesteps OAuth altogether.
 *
 * Credentials are ciphertext here and plaintext nowhere except in the moment
 * an adapter opens a connection.
 */

const SELECT = "id, user_id, email, auth_kind, role, status, last_harvest_at, last_checked_at, created_at";

export function normaliseEmail(input) {
  const value = String(input ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** Google shows app passwords as four groups of four. People paste them that way. */
export function normaliseAppPassword(input) {
  const value = String(input ?? "").replace(/\s+/g, "");
  return /^[a-z]{16}$/i.test(value) ? value.toLowerCase() : null;
}

export function validateAccountInput({ email, auth_kind: authKind, credential, role = "invoices" } = {}) {
  const errors = [];

  if (!normaliseEmail(email)) errors.push("A valid email address is required.");

  if (authKind !== "oauth" && authKind !== "imap_app_password") {
    errors.push("auth_kind must be 'oauth' or 'imap_app_password'.");
  }

  if (!String(credential ?? "").trim()) {
    errors.push("A credential is required.");
  } else if (authKind === "imap_app_password" && !normaliseAppPassword(credential)) {
    errors.push("An app password is sixteen letters, as shown at myaccount.google.com/apppasswords.");
  }

  // Bank alerts and the statement PDF are fetched through the Gmail API, so
  // the primary mailbox cannot be one that only speaks IMAP.
  if (role === "primary" && authKind === "imap_app_password") {
    errors.push("The primary mailbox must be connected with OAuth, not an app password.");
  }

  return { ok: errors.length === 0, errors };
}

export async function listMailAccounts(userId) {
  const { data } = await getSupabaseAdmin()
    .from("mail_accounts")
    .select(SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return data || [];
}

/** With the credential decrypted. Only an adapter should call this. */
export async function getMailAccount(userId, id) {
  const { data } = await getSupabaseAdmin()
    .from("mail_accounts")
    .select(`${SELECT}, credential`)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;
  return { ...data, credential: decryptSecret(data.credential) };
}

export async function primaryMailAccount(userId) {
  const { data } = await getSupabaseAdmin()
    .from("mail_accounts")
    .select(`${SELECT}, credential`)
    .eq("user_id", userId)
    .eq("role", "primary")
    .maybeSingle();

  if (!data) return null;
  return { ...data, credential: decryptSecret(data.credential) };
}

export async function saveMailAccount(userId, input) {
  const check = validateAccountInput(input);
  if (!check.ok) throw new Error(check.errors.join(" "));

  const credential =
    input.auth_kind === "imap_app_password"
      ? normaliseAppPassword(input.credential)
      : String(input.credential).trim();

  const { data, error } = await getSupabaseAdmin()
    .from("mail_accounts")
    .upsert(
      {
        user_id: userId,
        email: normaliseEmail(input.email),
        auth_kind: input.auth_kind,
        credential: encryptSecret(credential),
        role: input.role || "invoices",
        status: "active",
      },
      { onConflict: "user_id,email" }
    )
    .select(SELECT)
    .single();

  // The partial unique index rejects a second primary. Say so in English.
  if (error) {
    if (/mail_accounts_one_primary/.test(error.message)) {
      throw new Error("Another mailbox is already the primary one. Demote it first.");
    }
    throw new Error(`Could not save the mailbox: ${error.message}`);
  }
  return data;
}

export async function removeMailAccount(userId, id) {
  const { error } = await getSupabaseAdmin()
    .from("mail_accounts")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(`Could not remove the mailbox: ${error.message}`);
}

async function setStatus(userId, id, status) {
  const sb = getSupabaseAdmin();
  const { data: before } = await sb
    .from("mail_accounts")
    .select("status")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  await sb
    .from("mail_accounts")
    .update({ status, last_checked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id);

  // Whether this was a transition, so a caller can alert once rather than daily.
  return Boolean(before) && before.status !== status;
}

export const markRevoked = (userId, id) => setStatus(userId, id, "revoked");
export const markActive = (userId, id) => setStatus(userId, id, "active");
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/mail-account.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 7: Seed the work account from the existing environment variable**

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {register}=require('esbuild-register/dist/node'); register();
const {saveMailAccount}=require('./lib/mail-account.js');
(async()=>{
  const a = await saveMailAccount('115105472683255155618', {
    email: 'kmutha@vippysoya.com',
    auth_kind: 'oauth',
    credential: process.env.GOOGLE_REFRESH_TOKEN,
    role: 'primary',
  });
  console.log('seeded', a.id, a.email, a.role);
})().catch(e=>{console.error(e.message);process.exit(1);});
"
```

Expected: `seeded <uuid> kmutha@vippysoya.com primary`

- [ ] **Step 8: Commit**

```bash
git add scripts/mailbox-migration.sql lib/mail-account.js tests/mail-account.test.js
git commit -m "$(cat <<'EOF'
Store mailbox credentials instead of pasting one into env

gmail.readonly is a restricted scope, so the obvious path — publish the
consent screen — means an annual third-party penetration test. Leaving it in
testing expires refresh tokens every seven days, which is the likeliest
explanation for the two months of sync this app once lost in silence.

So the two mailboxes connect differently and the table has to hold both: the
Workspace account through an Internal consent screen, exempt from
verification and from the seven-day rule, and the personal account through an
IMAP app password, which sidesteps OAuth entirely.

One mailbox per user may be primary, enforced by a partial unique index
rather than by the application remembering to check.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `lib/mailbox.js` — one interface, two transports

Both mailboxes are Gmail; only the way in differs. Both transports fetch the raw RFC822 message and hand it to the same MIME parser, so everything upstream sees one shape and never learns which account it is reading.

**Files:**
- Create: `lib/mailbox.js`
- Modify: `lib/gmail.js` — `getOAuth2Client()` takes a refresh token instead of reading `process.env`
- Modify: `app/api/cron/tick/route.js` — pass the primary account's credential into sync

**Interfaces:**
- Consumes: `getMailAccount` / `primaryMailAccount` from Task 3.
- Produces:
  - `openMailbox(account) -> Promise<Mailbox>` where `account` includes a decrypted `credential`
  - `Mailbox.search({ after, before, terms }) -> Promise<string[]>` of message ids
  - `Mailbox.fetch(messageId) -> Promise<Message | null>`
  - `Mailbox.close() -> Promise<void>`
  - `Mailbox.probe() -> Promise<boolean>` — cheap liveness check for Task 9
  - `HARVEST_TERMS` — the shared query fragment
  - A **Message** is `{ messageId, date, from, subject, text, html, attachments: Array<{ filename, contentType, size, content: Buffer }> }` with `date` an ISO `YYYY-MM-DD`. Used by Tasks 5, 6 and 7.

- [ ] **Step 1: Add the MIME parser**

```bash
npm install mailparser@^3.7.4
```

- [ ] **Step 2: Write the mailbox module**

```js
// lib/mailbox.js
import { google } from "googleapis";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/**
 * Reading a mailbox, without the caller knowing which kind it is.
 *
 * Both accounts are Gmail. Only the door differs: the Workspace one opens with
 * OAuth under an Internal consent screen, the personal one with an app
 * password over IMAP, because Google offers no single method that works for
 * both without an annual penetration test.
 *
 * Both transports fetch the raw RFC822 message and hand it to the same parser,
 * so the difference stops here and the harvester never sees it. Gmail's own
 * search syntax works over IMAP too, via X-GM-RAW, so even the query is shared.
 */

export const HARVEST_TERMS =
  "(invoice OR receipt OR booking OR ticket OR order OR confirmation OR payment OR bill OR reservation)";

function gmailQuery({ after, before, terms = HARVEST_TERMS }) {
  const d = (iso) => String(iso).slice(0, 10).replace(/-/g, "/");
  return `after:${d(after)} before:${d(before)} ${terms}`.trim();
}

function isoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Raw RFC822 bytes to the one shape the rest of the harvester understands. */
async function parseRaw(buffer, messageId) {
  const mail = await simpleParser(buffer);
  return {
    messageId,
    date: isoDate(mail.date) || null,
    from: mail.from?.text || "",
    subject: mail.subject || "",
    text: mail.text || "",
    html: mail.html || "",
    attachments: (mail.attachments || []).map((a) => ({
      filename: a.filename || "attachment",
      contentType: a.contentType || "application/octet-stream",
      size: a.size || a.content?.length || 0,
      content: a.content,
    })),
  };
}

function gmailAdapter(account) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
  );
  auth.setCredentials({ refresh_token: account.credential });
  const gmail = google.gmail({ version: "v1", auth });

  return {
    async probe() {
      const { token } = await auth.getAccessToken();
      return Boolean(token);
    },

    async search(window) {
      const q = gmailQuery(window);
      const ids = [];
      let pageToken;
      do {
        const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken });
        for (const m of res.data.messages || []) ids.push(m.id);
        pageToken = res.data.nextPageToken;
      } while (pageToken && ids.length < 2000);
      return ids;
    },

    async fetch(messageId) {
      const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "raw" });
      if (!res.data?.raw) return null;
      return parseRaw(Buffer.from(res.data.raw, "base64url"), messageId);
    },

    async close() {},
  };
}

function imapAdapter(account) {
  let client = null;

  async function connected() {
    if (client?.usable) return client;
    client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: account.email, pass: account.credential },
      logger: false,
    });
    await client.connect();
    return client;
  }

  return {
    async probe() {
      const c = await connected();
      await c.mailboxOpen("INBOX", { readOnly: true });
      return true;
    },

    async search(window) {
      const c = await connected();
      // "[Gmail]/All Mail" rather than INBOX: an invoice that was archived is
      // still an invoice, and Gmail archives aggressively.
      const lock = await c.getMailboxLock("[Gmail]/All Mail", { readOnly: true });
      try {
        // X-GM-RAW takes Gmail's own search syntax, so the query is identical
        // to the one the API adapter sends.
        const uids = await c.search({ gmraw: gmailQuery(window) }, { uid: true });
        return (uids || []).map(String);
      } finally {
        lock.release();
      }
    },

    async fetch(messageId) {
      const c = await connected();
      const lock = await c.getMailboxLock("[Gmail]/All Mail", { readOnly: true });
      try {
        const msg = await c.fetchOne(String(messageId), { source: true }, { uid: true });
        if (!msg?.source) return null;
        return parseRaw(msg.source, String(messageId));
      } finally {
        lock.release();
      }
    },

    async close() {
      if (client?.usable) await client.logout().catch(() => {});
      client = null;
    },
  };
}

export async function openMailbox(account) {
  if (!account?.credential) throw new Error(`Mailbox ${account?.email || "?"} has no credential`);
  return account.auth_kind === "imap_app_password" ? imapAdapter(account) : gmailAdapter(account);
}
```

- [ ] **Step 3: Make `lib/gmail.js` take a credential rather than read the environment**

Replace the existing `getOAuth2Client()` at `lib/gmail.js:4-12`:

```js
function getOAuth2Client(refreshToken) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
  );
  // The env var is the fallback only until every caller passes a stored
  // credential. mail_accounts is the source of truth.
  client.setCredentials({ refresh_token: refreshToken || process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}
```

Then thread it through both callers in the same file:

```js
export async function fetchHDFCEmails(sinceDate = null, { refreshToken = null } = {}) {
  const auth = getOAuth2Client(refreshToken);
  // ... rest unchanged
```

```js
export async function fetchStatementPdfs({ since = null, maxResults = 10, refreshToken = null } = {}) {
  const auth = getOAuth2Client(refreshToken);
  // ... rest unchanged
```

Leave `getAuthUrl()` and `getTokensFromCode()` alone; Task 8 rewrites their callback.

- [ ] **Step 4: Verify both transports against the real mailboxes**

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {register}=require('esbuild-register/dist/node'); register();
const {listMailAccounts,getMailAccount}=require('./lib/mail-account.js');
const {openMailbox}=require('./lib/mailbox.js');
const U='115105472683255155618';
(async()=>{
  for (const row of await listMailAccounts(U)) {
    const account = await getMailAccount(U, row.id);
    const box = await openMailbox(account);
    try {
      console.log(account.email, account.auth_kind, 'probe:', await box.probe());
      const ids = await box.search({ after: '2026-07-17', before: '2026-08-17' });
      console.log('  candidates:', ids.length);
      if (ids.length) {
        const m = await box.fetch(ids[0]);
        console.log('  first:', m.date, '|', m.subject.slice(0,50), '| attachments:', m.attachments.length);
      }
    } finally { await box.close(); }
  }
})().catch(e=>{console.error(e);process.exit(1);});
"
```

Expected: both accounts probe `true`, each returns a non-zero candidate count, and the first message shows a date, a subject and an attachment count. For the work account this should be roughly 30 candidates; for personal, over 100.

If the personal account errors with `Mailbox doesn't exist: [Gmail]/All Mail`, IMAP folder names are localised — list them with `await c.list()` and use the one flagged `\All`.

- [ ] **Step 5: Commit**

```bash
git add lib/mailbox.js lib/gmail.js package.json package-lock.json
git commit -m "$(cat <<'EOF'
Read either mailbox through one interface

Both accounts are Gmail and only the door differs, so both transports fetch
the raw RFC822 message and hand it to the same MIME parser. The difference
stops at this module and the harvester never sees it.

Gmail's own search syntax works over IMAP through X-GM-RAW, so even the query
is shared rather than written twice and drifting apart. The IMAP side reads
All Mail rather than INBOX, because an invoice that has been archived is
still an invoice.

lib/gmail.js now takes a refresh token instead of reading one from the
environment, falling back to the env var until every caller is converted.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `lib/render-email.js` — turn a message into something printable

Most invoice emails already carry a PDF and it is used verbatim. The rest are typeset, headed with their provenance so the document stands on its own once printed and detached from the mailbox.

**Files:**
- Create: `lib/render-email.js`
- Test: `tests/render-email.test.js`

**Interfaces:**
- Consumes: a **Message** from Task 4; `PDFDocument` from `pdfkit`.
- Produces:
  - `pickAttachment(message) -> { filename, contentType, content } | null` — pure, exported for testing
  - `htmlToText(html) -> string` — pure
  - `renderEmailToPdf(message) -> Promise<{ buffer: Buffer, kind: 'attachment' | 'typeset', filename: string }>`

  **This is the swap point** named in the spec: replacing typesetting with headless Chrome changes this function and nothing else.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/render-email.test.js`
Expected: FAIL — `Cannot find module '../lib/render-email.js'`

- [ ] **Step 3: Write the implementation**

```js
// lib/render-email.js
import PDFDocument from "pdfkit";

/**
 * An email becomes a document the accounts department can print and file.
 *
 * Most invoice emails already carry one — OBB, FlixBus, Matrix, Amazon,
 * Swiggy, Zomato, DataForSEO, Anthropic and Shopify all attach a PDF — and
 * that is both free and the strongest evidence available, so it is used
 * verbatim.
 *
 * The rest are typeset: a page headed with sender, subject and date, then the
 * body with its markup stripped. The result is the merchant's own email,
 * printed, which is what a forwarded-and-printed receipt has always been.
 *
 * Headless Chrome would reproduce the branding faithfully and is the intended
 * upgrade. It is deferred rather than rejected: it needs either
 * @sparticuz/chromium-min with the binary served from Blob storage or a Vercel
 * Sandbox, and swapping it in changes renderEmailToPdf and nothing else.
 */

// Comfortably under what a mail gateway will carry once base64 inflates it.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#39;": "'", "&apos;": "'", "&euro;": "€",
  "&pound;": "£", "&#8377;": "₹", "&#160;": " ",
};

export function pickAttachment(message) {
  const pdfs = (message?.attachments || []).filter(
    (a) =>
      /pdf/i.test(a.contentType || "") ||
      /\.pdf$/i.test(a.filename || "")
  );

  const usable = pdfs.filter((a) => (a.size || a.content?.length || 0) <= MAX_ATTACHMENT_BYTES);
  if (!usable.length) return null;

  // Terms and conditions ride along with the invoice on some receipts. The
  // invoice is reliably the larger document.
  return usable.reduce((biggest, a) =>
    (a.size || a.content.length) > (biggest.size || biggest.content.length) ? a : biggest
  );
}

export function htmlToText(html) {
  if (!html) return "";
  let text = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, all) => line || all[i - 1])
    .join("\n")
    .trim();
}

function safeName(message) {
  const stem = String(message.subject || "email")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "email";
  return `${stem}.pdf`;
}

async function typeset(message) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", resolve));

  const width = doc.page.width - 80;

  doc.font("Helvetica-Bold").fontSize(13).text(message.subject || "(no subject)", { width });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9).fillColor("#444444");
  doc.text(`From: ${message.from || "unknown"}`, { width });
  doc.text(`Date: ${message.date || "unknown"}`, { width });
  doc.moveDown(0.5);

  doc.moveTo(40, doc.y).lineTo(40 + width, doc.y).strokeColor("#999999").stroke();
  doc.moveDown(0.6);

  const body = message.text?.trim() || htmlToText(message.html) || "(this email had no readable body)";
  doc.fillColor("#000000").font("Helvetica").fontSize(9.5).text(body, { width, align: "left" });

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

export async function renderEmailToPdf(message) {
  const attachment = pickAttachment(message);
  if (attachment) {
    return { buffer: attachment.content, kind: "attachment", filename: attachment.filename };
  }
  return { buffer: await typeset(message), kind: "typeset", filename: safeName(message) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/render-email.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Eyeball one real typeset page**

```bash
node -e "
const {register}=require('esbuild-register/dist/node'); register();
const {renderEmailToPdf}=require('./lib/render-email.js');
const fs=require('fs');
(async()=>{
  const out = await renderEmailToPdf({
    messageId:'x', date:'2026-08-12', from:'Uber Receipts <noreply@uber.com>',
    subject:'Your Wednesday morning trip with Uber', text:'', attachments:[],
    html:'<h1>Thanks for riding, Khush</h1><p>Total</p><p><b>€33.90</b></p><p>Meter fare €30.40</p><p>Booking Fee €3.50</p><p>Visa ••••7634 €33.90</p>',
  });
  fs.writeFileSync('/tmp/typeset-sample.pdf', out.buffer);
  console.log(out.kind, out.filename, out.buffer.length, 'bytes -> /tmp/typeset-sample.pdf');
})();
" && open /tmp/typeset-sample.pdf
```

Confirm the amounts are legible and the header names the sender. This is the output Khush accepted as good enough for one cycle — if it looks worse than expected, say so before continuing rather than after the pack ships.

- [ ] **Step 6: Commit**

```bash
git add lib/render-email.js tests/render-email.test.js
git commit -m "$(cat <<'EOF'
Turn an email into something accounts can print

Most invoice emails already carry a PDF and it is used verbatim, which is
both free and the strongest evidence available. The rest are typeset: a page
headed with sender, subject and date, then the body with its markup
stripped — the merchant's own email, printed.

Headless Chrome would reproduce the branding and remains the intended
upgrade. It needs either chromium-min with the binary in Blob storage or a
Vercel Sandbox, so it is deferred behind this one function rather than
blocking the harvester.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `lib/harvest.js` — the sweep

Puts Tasks 1, 2, 4 and 5 together: sweep both mailboxes for the cycle, match by amount, store what hits, remember what did not so it is never read twice.

**Files:**
- Create: `lib/harvest-plan.js` — the pure half, so it can be tested
- Create: `lib/harvest.js` — the I/O half
- Test: `tests/harvest-plan.js` → `tests/harvest-plan.test.js`

`harvest.js` reaches `lib/storage.js` and `lib/match-service.js`, both of which import through `@/`. Anything testable therefore lives in `harvest-plan.js`, which imports only `./money-parse.js` (itself import-free). See the note in Task 3.

**Interfaces:**
- Consumes: `openMailbox` / `HARVEST_TERMS` (Task 4), `extractAmounts` (Task 1), `matchEmailsToLines` (Task 2), `renderEmailToPdf` (Task 5), `listMailAccounts` / `getMailAccount` (Task 3), `put` from `lib/storage.js`, `linkReceipt` from `lib/match-service.js`, `getSupabaseAdmin`, `logInfo` / `logWarn` from `lib/logger.js`.
- Produces from `lib/harvest-plan.js`:
  - `searchWindow(cycle) -> { after, before }` — pure
  - `candidateFrom(message) -> { messageId, date, amounts } | null` — pure
- Produces from `lib/harvest.js`:
  - `harvestCycle({ userId, cycle, statement, limitPerAccount }) -> Promise<summary>` where summary is `{ accounts, scanned, matched, ambiguous, discarded, errors, unmatchedLines, unmatchedEmails }`. `unmatchedLines` and `unmatchedEmails` feed Task 7.

- [ ] **Step 1: Write the failing test**

Only the pure parts are unit tested; `harvestCycle` is verified against the real August cycle in Step 5.

```js
// tests/harvest-plan.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchWindow, candidateFrom } from "../lib/harvest-plan.js";

test("the search window overhangs the cycle at both ends", () => {
  // Two days early because a receipt precedes its charge; five days late
  // because an invoice can arrive after the statement closes.
  const w = searchWindow({ cycle_start: "2026-07-17", cycle_end: "2026-08-16" });
  assert.deepEqual(w, { after: "2026-07-15", before: "2026-08-21" });
});

test("the window survives a month boundary", () => {
  const w = searchWindow({ cycle_start: "2026-03-01", cycle_end: "2026-03-31" });
  assert.deepEqual(w, { after: "2026-02-27", before: "2026-04-05" });
});

test("a candidate carries amounts from the plain text body", () => {
  const c = candidateFrom({
    messageId: "m1", date: "2026-08-12", subject: "trip", from: "uber",
    text: "Total €33.90 fare €30.40", html: "", attachments: [],
  });
  assert.equal(c.messageId, "m1");
  assert.deepEqual(c.amounts.map((a) => a.value), [33.9, 30.4]);
});

test("html is read when there is no plain text", () => {
  const c = candidateFrom({
    messageId: "m2", date: "2026-08-12", subject: "s", from: "f",
    text: "", html: "<p>Total <b>CHF 34.40</b></p>", attachments: [],
  });
  assert.deepEqual(c.amounts, [{ value: 34.4, currency: "CHF", raw: "CHF 34.40" }]);
});

test("the subject line is searched too", () => {
  // "Your order of ₹1,668.00 has shipped" — sometimes the only place it appears.
  const c = candidateFrom({
    messageId: "m3", date: "2026-07-17", subject: "Your order of ₹1,668.00 has shipped",
    from: "amazon", text: "Thanks!", html: "", attachments: [],
  });
  assert.deepEqual(c.amounts.map((a) => a.value), [1668]);
});

test("duplicate amounts are collapsed", () => {
  // Receipts repeat the total in a summary block; it is one amount, not three.
  const c = candidateFrom({
    messageId: "m4", date: "2026-08-12", subject: "", from: "",
    text: "Total €33.90 ... paid €33.90 ... €33.90", html: "", attachments: [],
  });
  assert.equal(c.amounts.length, 1);
});

test("a message with no date yields no candidate", () => {
  assert.equal(candidateFrom({ messageId: "m5", date: null, text: "€10.00" }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/harvest-plan.test.js`
Expected: FAIL — `Cannot find module '../lib/harvest-plan.js'`

- [ ] **Step 3a: Write the pure half**

```js
// lib/harvest-plan.js
import { extractAmounts } from "./money-parse.js";

/**
 * The decisions the sweep makes that need no mailbox and no database.
 *
 * Split out for the same reason lib/cycle-window.js is split out of
 * lib/cycles.js: node --test has no bundler, so a module that reaches an
 * aliased import cannot be tested at all — and the window arithmetic is
 * exactly the sort of thing that fails silently on a month boundary.
 */

function shift(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Two days before the cycle opens, because a receipt precedes its charge, and
 * five days after it closes, because invoices arrive late — a good many of
 * August's did.
 */
export function searchWindow(cycle) {
  return { after: shift(cycle.cycle_start, -2), before: shift(cycle.cycle_end, 5) };
}

export function candidateFrom(message) {
  if (!message?.date) return null;

  const haystack = [message.subject || "", message.text || message.html || ""].join("\n");
  const found = extractAmounts(haystack);

  // A receipt states its total two or three times over. Collapse to the set.
  const seen = new Set();
  const amounts = [];
  for (const a of found) {
    const key = `${a.currency}:${a.value.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    amounts.push(a);
  }

  return { messageId: message.messageId, date: message.date, amounts };
}
```

- [ ] **Step 3b: Write the I/O half**

```js
// lib/harvest.js
import crypto from "crypto";
import { getSupabaseAdmin } from "./supabase.js";
import { put } from "./storage.js";
import { linkReceipt } from "./match-service.js";
import { listMailAccounts, getMailAccount } from "./mail-account.js";
import { openMailbox } from "./mailbox.js";
import { searchWindow, candidateFrom } from "./harvest-plan.js";
import { matchEmailsToLines } from "./harvest-match.js";
import { renderEmailToPdf } from "./render-email.js";
import { logInfo, logWarn } from "./logger.js";

/**
 * Sweep the connected mailboxes for documents belonging to a statement.
 *
 * The statement is read first and turned into a list of amounts, and that list
 * is the only question ever put to a mailbox. An email that answers no is
 * forgotten immediately — its message id is recorded so it is never fetched
 * twice, and nothing else about it is kept. That is what makes reading a
 * personal account defensible: anything retained is, by construction, a charge
 * already on the company card.
 */

function merchantFrom(message) {
  // "Uber Receipts <noreply@uber.com>" -> "Uber Receipts"
  const name = String(message.from || "").replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  return (name || message.subject || "Unknown").slice(0, 80);
}

async function alreadySeen(userId, accountId) {
  const { data } = await getSupabaseAdmin()
    .from("mail_seen")
    .select("message_id")
    .eq("user_id", userId)
    .eq("account_id", accountId);
  return new Set((data || []).map((r) => r.message_id));
}

async function recordSeen(userId, accountId, cycleId, rows) {
  if (!rows.length) return;
  await getSupabaseAdmin().from("mail_seen").upsert(
    rows.map(({ messageId, outcome }) => ({
      user_id: userId, account_id: accountId, message_id: messageId,
      cycle_id: cycleId, outcome,
    })),
    { onConflict: "user_id,account_id,message_id" }
  );
}

/**
 * Store one matched document as a receipt and bind it to its charge.
 *
 * Returns the receipt id, or null when the same bytes are already on file —
 * the same attachment reaching both mailboxes, or a forwarded copy.
 */
async function storeDocument({ userId, account, message, link, line }) {
  const sb = getSupabaseAdmin();
  const rendered = await renderEmailToPdf(message);
  const sha256 = crypto.createHash("sha256").update(rendered.buffer).digest("hex");

  const { data: existing } = await sb
    .from("receipts")
    .select("id")
    .eq("user_id", userId)
    .eq("sha256", sha256)
    .maybeSingle();

  let receiptId = existing?.id || null;

  if (!receiptId) {
    receiptId = crypto.randomUUID();
    const path = `${userId}/gmail/${message.date.slice(0, 4)}/${message.date.slice(5, 7)}/${receiptId}.pdf`;
    await put(path, rendered.buffer, { contentType: "application/pdf" });

    const { error } = await sb.from("receipts").insert({
      id: receiptId,
      user_id: userId,
      source: "gmail",
      source_account: account.email,
      mail_message_id: message.messageId,
      storage_path: path,
      mime: "application/pdf",
      bytes: rendered.buffer.length,
      sha256,
      original_name: rendered.filename,
      merchant: merchantFrom(message),
      merchant_raw: message.subject || null,
      amount: link.value,
      currency: link.currency,
      receipt_date: message.date,
      status: "matched",
      extracted: { harvest: { kind: rendered.kind, subject: message.subject, from: message.from } },
      models_used: [],
    });

    if (error) throw new Error(`receipt insert failed: ${error.message}`);
  }

  // A statement line without a transaction is an orphan the reconciler never
  // paired up. The document is still worth keeping; it simply has nothing to
  // bind to yet, and the daily rematch will find it once one appears.
  if (line.transaction_id) {
    await linkReceipt({
      receiptId,
      transactionId: line.transaction_id,
      userId,
      score: null,
      matchedBy: "harvest",
    });
  }

  return receiptId;
}

export async function harvestCycle({ userId, cycle, statement, limitPerAccount = 400 }) {
  const sb = getSupabaseAdmin();

  const { data: lines } = await sb
    .from("statement_lines")
    .select("id, line_no, txn_date, descriptor, amount, currency, amount_orig, direction, type, transaction_id")
    .eq("statement_id", statement.id)
    .order("line_no");

  if (!lines?.length) return { skipped: "statement has no lines" };

  const linesById = new Map(lines.map((l) => [l.id, l]));
  const window = searchWindow(cycle);
  const accounts = await listMailAccounts(userId);

  const summary = {
    accounts: 0, scanned: 0, matched: 0, ambiguous: 0, discarded: 0, errors: 0,
    unmatchedLines: [], unmatchedEmails: [],
  };

  const messagesById = new Map();
  const allCandidates = [];
  const accountByMessage = new Map();

  for (const row of accounts) {
    if (row.status !== "active") continue;

    let box = null;
    try {
      const account = await getMailAccount(userId, row.id);
      box = await openMailbox(account);

      const ids = await box.search(window);
      const skip = await alreadySeen(userId, row.id);
      const fresh = ids.filter((id) => !skip.has(id)).slice(0, limitPerAccount);

      const seenRows = [];

      for (const id of fresh) {
        summary.scanned += 1;
        try {
          const message = await box.fetch(id);
          const candidate = message && candidateFrom(message);
          if (!candidate || !candidate.amounts.length) {
            seenRows.push({ messageId: id, outcome: "discarded" });
            summary.discarded += 1;
            continue;
          }
          messagesById.set(id, message);
          accountByMessage.set(id, account);
          allCandidates.push(candidate);
        } catch (err) {
          // Retried on the next run rather than blocking the sweep.
          seenRows.push({ messageId: id, outcome: "error" });
          summary.errors += 1;
        }
      }

      await recordSeen(userId, row.id, cycle.id, seenRows);
      await sb.from("mail_accounts")
        .update({ last_harvest_at: new Date().toISOString() })
        .eq("id", row.id);

      summary.accounts += 1;
    } catch (err) {
      summary.errors += 1;
      await logWarn({
        source: "harvest", event: "account_failed", userId,
        message: `Could not sweep ${row.email}: ${err.message}`,
      });
    } finally {
      if (box) await box.close().catch(() => {});
    }
  }

  const result = matchEmailsToLines(lines, allCandidates);
  const outcomes = new Map();

  for (const link of result.links) {
    const message = messagesById.get(link.messageId);
    const account = accountByMessage.get(link.messageId);
    const line = linesById.get(link.lineId);
    if (!message || !line) continue;

    try {
      await storeDocument({ userId, account, message, link, line });
      outcomes.set(link.messageId, "matched");
      summary.matched += 1;
    } catch (err) {
      outcomes.set(link.messageId, "error");
      summary.errors += 1;
      await logWarn({
        source: "harvest", event: "store_failed", userId,
        message: `Could not store ${link.messageId}: ${err.message}`,
      });
    }
  }

  for (const item of result.ambiguous) {
    outcomes.set(item.messageId, "ambiguous");
    summary.ambiguous += 1;
  }

  // Everything fetched but not linked is discarded, and only its id is kept.
  for (const candidate of result.unmatchedEmails) {
    if (!outcomes.has(candidate.messageId)) {
      outcomes.set(candidate.messageId, "discarded");
      summary.discarded += 1;
    }
  }

  for (const [messageId, outcome] of outcomes) {
    const account = accountByMessage.get(messageId);
    if (account) await recordSeen(userId, account.id, cycle.id, [{ messageId, outcome }]);
  }

  summary.unmatchedLines = result.unmatchedLines;
  summary.unmatchedEmails = result.unmatchedEmails
    .filter((c) => messagesById.has(c.messageId))
    .map((c) => {
      const m = messagesById.get(c.messageId);
      return {
        messageId: c.messageId, date: c.date, from: m.from,
        subject: m.subject, amounts: c.amounts,
        excerpt: (m.text || "").replace(/\s+/g, " ").slice(0, 500),
      };
    });

  await logInfo({
    source: "harvest", event: "cycle_swept", userId,
    message: `Swept ${summary.scanned} message(s): ${summary.matched} matched, ${summary.ambiguous} ambiguous`,
    details: { window, ...summary, unmatchedLines: summary.unmatchedLines.length, unmatchedEmails: summary.unmatchedEmails.length },
  });

  return summary;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/harvest-plan.test.js` — Expected: PASS, 7 tests.
Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Sweep the real August cycle**

The August statement is reconciled and 224 lines are on file, so this is the regression test the spec calls for.

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {register}=require('esbuild-register/dist/node'); register();
const {getSupabaseAdmin}=require('./lib/supabase.js');
const {harvestCycle}=require('./lib/harvest.js');
const U='115105472683255155618';
(async()=>{
  const sb=getSupabaseAdmin();
  const {data:cycle}=await sb.from('statement_cycles').select('*').eq('cycle_end','2026-08-16').single();
  const {data:statement}=await sb.from('statements').select('*').eq('cycle_id',cycle.id).single();
  const s=await harvestCycle({userId:U,cycle,statement});
  console.log(JSON.stringify({...s,unmatchedLines:s.unmatchedLines.length,unmatchedEmails:s.unmatchedEmails.length},null,1));
})().catch(e=>{console.error(e);process.exit(1);});
"
```

Expected: `scanned` in the low hundreds, `matched` **at least 15**, `errors` 0.

The August cycle was reconciled by hand and is known to contain matchable invoices for ÖBB (2), Matterhorn Gotthard Bahn (2), FlixBus (3), Matrix (3), Uber (8), Hostelworld (4), Amazon, Swiggy, Zomato, DataForSEO, Anthropic, Higgsfield and Shopify. If `matched` is below 15, the harvester is missing documents that are demonstrably there — do not proceed to Task 7, debug this first by dumping `unmatchedLines` and checking whether the amounts were extracted at all.

Some receipts already exist from the manual August run; `storeDocument` deduplicates on sha256, so re-running is safe.

- [ ] **Step 6: Commit**

```bash
git add lib/harvest-plan.js lib/harvest.js tests/harvest-plan.test.js
git commit -m "$(cat <<'EOF'
Sweep both mailboxes for documents the statement already knows about

The statement is read first and turned into a list of amounts, and that list
is the only question ever put to a mailbox. An email that answers no is
forgotten immediately: its id is recorded so it is never fetched twice, and
nothing else about it is kept.

That is what makes reading a personal account defensible. Anything retained
is, by construction, a charge already on the company card, so nothing
personal can reach the accounts department by accident.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `lib/harvest-ai.js` — the leftovers, with arithmetic as the gate

Exact matching cannot see that ₹1,668 on Amazon is three orders of ₹555, ₹878 and ₹235. One batched call handles those, and every proposal must add up or be thrown away.

**Files:**
- Create: `lib/harvest-prompt.js` — the pure half
- Create: `lib/harvest-ai.js` — the call and the gate
- Modify: `lib/harvest.js` — call it once the exact pass is done
- Test: `tests/harvest-prompt.test.js`

`harvest-ai.js` imports `./logger.js`, which reaches `@/lib/supabase`, so the prompt building and response parsing live in `harvest-prompt.js` with no imports at all. See the note in Task 3.

**Interfaces:**
- Consumes: `validateProposal` (Task 2), `summary.unmatchedLines` / `summary.unmatchedEmails` (Task 6), `@anthropic-ai/sdk`.
- Produces from `lib/harvest-prompt.js`:
  - `buildPrompt(lines, emails) -> string` — pure
  - `parseProposals(raw) -> Array<{ lineNo, parts }>` — pure, tolerant of prose around the JSON
- Produces from `lib/harvest-ai.js`:
  - `resolveLeftovers({ userId, lines, emails }) -> Promise<{ accepted, rejected, proposals }>`

- [ ] **Step 1: Write the failing test**

```js
// tests/harvest-prompt.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseProposals } from "../lib/harvest-prompt.js";

const line = { id: "l7", line_no: 7, txn_date: "2026-07-17", descriptor: "AMAZON PAY INDIA",
  amount: 1668, currency: "INR", amount_orig: null, direction: "debit", type: "purchase" };

const email = { messageId: "e1", date: "2026-07-17", from: "Amazon", subject: "Order shipped",
  amounts: [{ value: 555, currency: "INR" }], excerpt: "Your order total ₹555" };

test("the prompt states both sides and the currency to work in", () => {
  const p = buildPrompt([line], [email]);
  assert.match(p, /AMAZON PAY INDIA/);
  assert.match(p, /1668/);
  assert.match(p, /INR/);
  assert.match(p, /e1/);
});

test("the prompt says splits must add up", () => {
  // The model is told the rule it will be judged by, which improves compliance
  // even though compliance is verified independently afterwards.
  assert.match(buildPrompt([line], [email]), /sum|add up|exactly/i);
});

test("clean JSON parses", () => {
  const raw = '{"proposals":[{"lineNo":7,"parts":[{"messageId":"e1","value":555,"currency":"INR"}]}]}';
  assert.deepEqual(parseProposals(raw), [
    { lineNo: 7, parts: [{ messageId: "e1", value: 555, currency: "INR" }] },
  ]);
});

test("JSON wrapped in a fence or in chat parses", () => {
  const raw = 'Sure!\n```json\n{"proposals":[{"lineNo":7,"parts":[]}]}\n```\nHope that helps.';
  assert.deepEqual(parseProposals(raw), [{ lineNo: 7, parts: [] }]);
});

test("unparseable output yields nothing rather than throwing", () => {
  // A model outage must leave the exact matches intact, not crash the sweep.
  assert.deepEqual(parseProposals("I could not determine any matches."), []);
  assert.deepEqual(parseProposals(""), []);
  assert.deepEqual(parseProposals(null), []);
});

test("malformed proposals are dropped individually", () => {
  const raw = '{"proposals":[{"lineNo":7,"parts":[{"messageId":"e1","value":555,"currency":"INR"}]},{"noLineNo":true},{"lineNo":"x","parts":[]}]}';
  const got = parseProposals(raw);
  assert.equal(got.length, 1);
  assert.equal(got[0].lineNo, 7);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/harvest-prompt.test.js`
Expected: FAIL — `Cannot find module '../lib/harvest-prompt.js'`

- [ ] **Step 3a: Write the pure half**

```js
// lib/harvest-prompt.js
/**
 * What the model is asked, and how its answer is read. Pure — no imports, so
 * the prompt and the parser can be tested without an API key.
 *
 * The parser is deliberately forgiving of a model that wraps its JSON in a
 * fence or a sentence, and deliberately unforgiving of malformed entries: a
 * proposal missing a line number is dropped on its own rather than taking the
 * whole response with it.
 */

const MAX_LINES = 60;
const MAX_EMAILS = 120;

export function buildPrompt(lines, emails) {
  const lineRows = lines.slice(0, MAX_LINES).map((l) => {
    const target = l.currency && l.currency !== "INR" && l.amount_orig != null
      ? `${l.currency} ${l.amount_orig}`
      : `INR ${l.amount}`;
    return `  line ${l.line_no} | ${l.txn_date} | ${l.descriptor} | needs ${target}`;
  });

  const emailRows = emails.slice(0, MAX_EMAILS).map((e) => {
    const amounts = e.amounts.map((a) => `${a.currency} ${a.value}`).join(", ") || "none found";
    return `  ${e.messageId} | ${e.date} | ${e.from} | ${e.subject}\n      amounts: ${amounts}\n      excerpt: ${e.excerpt || ""}`;
  });

  return `These are credit card statement lines with no receipt, and emails that could not be matched to one by exact amount.

A line is usually explained by one email. Sometimes several emails together explain one line — three separate Amazon orders billed as one Amazon Pay charge, or a food delivery invoice plus its handling fee.

STATEMENT LINES:
${lineRows.join("\n")}

UNMATCHED EMAILS:
${emailRows.join("\n")}

Assign emails to lines only where you are confident. It is far better to leave a line unexplained than to guess.

Rules:
- The amounts you assign must sum to exactly what the line needs.
- Every amount must be in the same currency the line needs.
- An email may be used for at most one line.
- Do not invent messageIds or amounts. Use only what appears above.

Reply with JSON and nothing else:
{"proposals":[{"lineNo":7,"parts":[{"messageId":"e1","value":555,"currency":"INR"}]}]}

If nothing can be matched confidently, reply {"proposals":[]}.`;
}

export function parseProposals(raw) {
  if (!raw) return [];
  const text = String(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const list = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  return list.filter(
    (p) => Number.isInteger(p?.lineNo) && Array.isArray(p?.parts)
  ).map((p) => ({
    lineNo: p.lineNo,
    parts: p.parts
      .filter((x) => x && typeof x.messageId === "string" && Number.isFinite(Number(x.value)))
      .map((x) => ({ messageId: x.messageId, value: Number(x.value), currency: String(x.currency || "") })),
  }));
}
```

- [ ] **Step 3b: Write the call and the gate**

`buildPrompt` and `parseProposals` are imported from Step 3a — do not restate them here.

```js
// lib/harvest-ai.js
import Anthropic from "@anthropic-ai/sdk";
import { validateProposal } from "./harvest-match.js";
import { buildPrompt, parseProposals } from "./harvest-prompt.js";
import { logInfo, logWarn } from "./logger.js";

/**
 * What exact matching cannot see.
 *
 * A ₹1,668 Amazon Pay charge is three orders of ₹555, ₹878 and ₹235, and no
 * single email mentions the total. A ₹957 Swiggy charge is a ₹944 invoice plus
 * a handling fee. These need reading rather than arithmetic — but only to
 * *propose*. Every proposal is then made to add up to the statement line in
 * the line's own currency, and discarded if it does not.
 *
 * The model gets one batched call for the whole cycle, not one per email, and
 * it is never believed. That division — it suggests, the sum decides — is what
 * keeps a fluent wrong answer out of the accounts department.
 */

export async function resolveLeftovers({ userId, lines, emails }) {
  if (!lines?.length || !emails?.length) return { accepted: [], rejected: [], proposals: 0 };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const models = [
    process.env.STATEMENT_MODEL || "claude-opus-5",
    process.env.STATEMENT_MODEL_FALLBACK || "claude-sonnet-5",
  ];

  let raw = null;
  for (const model of models) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 4000,
        messages: [{ role: "user", content: buildPrompt(lines, emails) }],
      });
      raw = res.content?.[0]?.text || "";
      break;
    } catch (err) {
      await logWarn({
        source: "harvest", event: "model_failed", userId,
        message: `${model} could not resolve leftovers: ${err.message}`,
      });
    }
  }

  const proposals = parseProposals(raw);
  const byLineNo = new Map(lines.map((l) => [l.line_no, l]));
  const emailIds = new Set(emails.map((e) => e.messageId));

  const accepted = [];
  const rejected = [];
  const claimed = new Set();

  for (const proposal of proposals) {
    const line = byLineNo.get(proposal.lineNo);
    if (!line) {
      rejected.push({ ...proposal, why: "no such line" });
      continue;
    }

    // Nothing invented, and nothing used twice.
    if (proposal.parts.some((p) => !emailIds.has(p.messageId))) {
      rejected.push({ ...proposal, why: "cites an email that was not offered" });
      continue;
    }
    if (proposal.parts.some((p) => claimed.has(p.messageId))) {
      rejected.push({ ...proposal, why: "reuses an email already assigned" });
      continue;
    }

    const check = validateProposal(line, proposal.parts);
    if (!check.ok) {
      rejected.push({ ...proposal, why: `does not sum: ${check.sum} against ${check.target}` });
      continue;
    }

    for (const p of proposal.parts) claimed.add(p.messageId);
    accepted.push({ line, parts: proposal.parts });
  }

  await logInfo({
    source: "harvest", event: "leftovers_resolved", userId,
    message: `Model proposed ${proposals.length}, ${accepted.length} survived the sum check`,
    details: { rejected: rejected.map((r) => ({ lineNo: r.lineNo, why: r.why })) },
  });

  return { accepted, rejected, proposals: proposals.length };
}
```

- [ ] **Step 4: Wire it into the sweep**

In `lib/harvest.js`, add the import:

```js
import { resolveLeftovers } from "./harvest-ai.js";
```

and insert immediately before the final `await logInfo({ source: "harvest", event: "cycle_swept" ...})`:

```js
  // What exact matching could not see: splits, fees, and totals that appear in
  // no single email. Proposals are stored only after they add up.
  if (summary.unmatchedLines.length && summary.unmatchedEmails.length) {
    const ai = await resolveLeftovers({
      userId,
      lines: summary.unmatchedLines,
      emails: summary.unmatchedEmails,
    });

    for (const { line, parts } of ai.accepted) {
      for (const part of parts) {
        const message = messagesById.get(part.messageId);
        const account = accountByMessage.get(part.messageId);
        if (!message || !account) continue;
        try {
          await storeDocument({
            userId, account, message, line,
            link: { value: part.value, currency: part.currency },
          });
          summary.matched += 1;
          summary.discarded = Math.max(0, summary.discarded - 1);
          await recordSeen(userId, account.id, cycle.id, [{ messageId: part.messageId, outcome: "matched" }]);
        } catch (err) {
          summary.errors += 1;
        }
      }
    }

    summary.aiAccepted = ai.accepted.length;
    summary.aiRejected = ai.rejected.length;

    const resolved = new Set(ai.accepted.map((a) => a.line.id));
    summary.unmatchedLines = summary.unmatchedLines.filter((l) => !resolved.has(l.id));
  }
```

- [ ] **Step 5: Run the tests and re-sweep**

Run: `node --test tests/harvest-prompt.test.js` — Expected: PASS, 6 tests.
Run: `npm test` — Expected: PASS.

Then re-run the August sweep command from Task 6 Step 5. Expected: `aiAccepted` at least 1 (the Amazon split is known to be there), `aiRejected` reported rather than hidden, and `matched` higher than the exact-only run.

- [ ] **Step 6: Commit**

```bash
git add lib/harvest-prompt.js lib/harvest-ai.js lib/harvest.js tests/harvest-prompt.test.js
git commit -m "$(cat <<'EOF'
Let a model propose the splits, and the sum decide

A ₹1,668 Amazon Pay charge is three orders of ₹555, ₹878 and ₹235, and no
single email mentions the total. Exact matching cannot see that; reading can.

So the leftovers get one batched call for the whole cycle — never one per
email — and the answer is never believed. Every proposal must add up to the
statement line in the line's own currency, cite only emails it was offered,
and use each at most once. Anything else is discarded and logged with the
reason.

That division of labour is the point: the model suggests, arithmetic decides,
and a fluent wrong answer never reaches the accounts department.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Connecting a mailbox from Settings

The OAuth callback currently prints the refresh token on a page for pasting into `.env.local`. It stores it instead, and app-password mailboxes get a form beside it.

**Files:**
- Create: `app/api/mail-accounts/route.js`
- Rewrite: `app/api/auth/callback/route.js`
- Modify: `app/components/settings/SettingsTab.jsx` — add `MailboxesCard`, render it after `CorporateCardCard`

**Interfaces:**
- Consumes: everything exported by `lib/mail-account.js` (Task 3), `openMailbox` (Task 4), `getAuthUrl` / `getTokensFromCode` from `lib/gmail.js`.
- Produces: `GET/POST/DELETE /api/mail-accounts`. No other task depends on this — it is how a human connects a mailbox, and Tasks 6 and 9 read whatever it wrote.

**Read `node_modules/next/dist/docs/` for route handler and client component conventions before writing either file.** Per `AGENTS.md` this Next.js differs from training data.

- [ ] **Step 1: Write the API route**

```js
// app/api/mail-accounts/route.js
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/secret-box";
import {
  listMailAccounts, saveMailAccount, removeMailAccount,
  getMailAccount, validateAccountInput,
} from "@/lib/mail-account";
import { openMailbox } from "@/lib/mailbox";
import { getAuthUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

/**
 * Connected mailboxes. Credentials are write-only over this API: they go in
 * and never come back, not even redacted.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    accounts: await listMailAccounts(session.user.id),
    encryptionReady: hasEncryptionKey(),
    connectUrl: getAuthUrl(),
  });
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const input = {
    email: body.email,
    auth_kind: "imap_app_password",
    credential: body.app_password,
    role: "invoices",
  };

  const check = validateAccountInput(input);
  if (!check.ok) return NextResponse.json({ error: check.errors.join(" ") }, { status: 400 });

  let account;
  try {
    account = await saveMailAccount(session.user.id, input);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // Prove the credential works now, while someone is watching, rather than
  // discovering it at 3am on the 17th.
  try {
    const withCredential = await getMailAccount(session.user.id, account.id);
    const box = await openMailbox(withCredential);
    try {
      await box.probe();
    } finally {
      await box.close();
    }
  } catch (err) {
    await removeMailAccount(session.user.id, account.id);
    return NextResponse.json(
      { error: `Could not sign in to that mailbox: ${err.message}` },
      { status: 400 }
    );
  }

  return NextResponse.json({ account });
}

export async function DELETE(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await removeMailAccount(session.user.id, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Rewrite the OAuth callback so the token never reaches the browser**

Replace `app/api/auth/callback/route.js` entirely:

```js
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getTokensFromCode } from "@/lib/gmail";
import { saveMailAccount, listMailAccounts } from "@/lib/mail-account";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Where Google returns after consent.
 *
 * This used to render the refresh token as HTML so it could be pasted into
 * .env.local by hand. It is stored encrypted now and never sent to a browser:
 * a long-lived mailbox credential in a page, a scrollback or a screenshot is
 * a credential leaked.
 */
export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.redirect(new URL("/", request.url));

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const denied = searchParams.get("error");

  const back = (params) => {
    const url = new URL("/", request.url);
    url.hash = "settings";
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
  };

  if (denied) return back({ mailbox: "denied" });
  if (!code) return back({ mailbox: "error", reason: "no code returned" });

  try {
    const tokens = await getTokensFromCode(code);

    // Google withholds the refresh token when this account has already granted
    // consent. prompt=consent in getAuthUrl() is what forces a fresh one.
    if (!tokens.refresh_token) {
      return back({ mailbox: "error", reason: "no refresh token — revoke access at myaccount.google.com/permissions and retry" });
    }

    const email = tokens.id_token
      ? JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64").toString()).email
      : null;
    if (!email) return back({ mailbox: "error", reason: "Google did not identify the account" });

    // The first mailbox connected becomes the primary one, since bank alerts
    // and the statement have to come from somewhere.
    const existing = await listMailAccounts(session.user.id);
    const role = existing.some((a) => a.role === "primary") ? "invoices" : "primary";

    await saveMailAccount(session.user.id, {
      email, auth_kind: "oauth", credential: tokens.refresh_token, role,
    });

    await logInfo({
      source: "mailbox", event: "connected", userId: session.user.id,
      message: `Connected ${email} as ${role}`,
    });

    return back({ mailbox: "connected" });
  } catch (err) {
    await logError({
      source: "mailbox", event: "connect_failed", userId: session.user.id,
      message: "OAuth callback failed", error: err,
    });
    return back({ mailbox: "error", reason: err.message });
  }
}
```

- [ ] **Step 3: Add the Settings section**

In `app/components/settings/SettingsTab.jsx`, add a `MailboxesCard` component following the exact shape of the existing `ReceiptBotCard` at line 623 — same card wrapper, same `inputStyle`, same `msg` state pattern — and render it in the default export immediately after `<CorporateCardCard />`.

It must:

1. `GET /api/mail-accounts` on mount into `{ accounts, encryptionReady, connectUrl }`.
2. List each account showing **email**, **role** (`primary` badged differently from `invoices`), **kind** (`Google` or `App password`), and **status** — a `revoked` row rendered in the error colour with the text *"Reconnect this mailbox — the harvester cannot read it."*
3. Offer **Connect Google account** as a plain link to `connectUrl`.
4. Offer an **Add app-password mailbox** form: an email field, a password field, and a submit that `POST`s `{ email, app_password }`. On a non-200, show `error` from the body verbatim — it carries the IMAP sign-in failure, which is the message a user needs.
5. Offer **Remove** per row, `DELETE /api/mail-accounts?id=…`, behind a `confirm()`.
6. When `encryptionReady` is false, hide both forms and show *"Set STATEMENT_PW_KEY before connecting a mailbox."*
7. Read `?mailbox=` from `window.location.search` on mount and surface `connected` / `denied` / `error` (with `reason`) as the card's message, then clear the parameter with `history.replaceState` so a refresh does not repeat it.

Never render a credential. The API does not return one; do not add a field that would.

- [ ] **Step 4: Verify by hand**

```bash
npm run dev
```

Then in the browser at Settings:
- The work account appears as `primary` / `Google`, seeded by Task 3.
- **Add app-password mailbox** with `khushmutha20@gmail.com` and the real app password → the row appears as `invoices` / `App password`.
- Try it again with a deliberately wrong password → the row does **not** appear and the error names an authentication failure. Confirm no orphan row was left:

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {register}=require('esbuild-register/dist/node'); register();
require('./lib/mail-account.js').listMailAccounts('115105472683255155618')
  .then(a=>console.log(a.map(x=>[x.email,x.role,x.auth_kind,x.status])));
"
```

Expected: exactly two rows, both `active`.

- [ ] **Step 5: Commit**

```bash
git add app/api/mail-accounts app/api/auth/callback app/components/settings/SettingsTab.jsx
git commit -m "$(cat <<'EOF'
Connect a mailbox from Settings instead of by hand

The OAuth callback used to render the refresh token as HTML so it could be
pasted into .env.local. A long-lived mailbox credential sitting in a page, a
scrollback or a screenshot is a credential leaked, so it is encrypted and
stored now and never sent to a browser at all.

App-password mailboxes are proved at the moment they are saved, with a real
IMAP sign-in, and the row is rolled back if it fails. Discovering a bad
credential while someone is watching beats discovering it at 3am on the 17th.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Run it on a schedule, and be loud when a mailbox dies

**Files:**
- Modify: `app/api/cron/tick/route.js` — add the `harvest` job and the credential check
- Create: `lib/mailbox-health.js`

**Interfaces:**
- Consumes: `harvestCycle` (Tasks 6–7), `listMailAccounts` / `getMailAccount` / `markRevoked` / `markActive` (Task 3), `openMailbox` (Task 4), `sendMessage` from `lib/telegram.js`.
- Produces: `checkMailboxes(userId) -> Promise<{ checked, revoked, recovered, alerted }>`. Terminal — nothing consumes it.

- [ ] **Step 1: Write the health check**

```js
// lib/mailbox-health.js
import { getSupabaseAdmin } from "./supabase.js";
import { sendMessage, esc } from "./telegram.js";
import { listMailAccounts, getMailAccount, markRevoked, markActive } from "./mail-account.js";
import { openMailbox } from "./mailbox.js";
import { logInfo, logWarn } from "./logger.js";

/**
 * A dead mailbox must be loud.
 *
 * The credentials chosen in the design are the durable ones — an Internal
 * consent screen is exempt from Google's seven-day expiry, and an app password
 * lives until it is revoked — but neither is immortal. An app password can be
 * cancelled from a security page by accident, and an Internal app stops
 * working the day its owner leaves the Workspace.
 *
 * This app has already lost two months of sync to a credential that failed in
 * silence. So the alert fires on the transition into failure: once, naming the
 * mailbox, never repeated daily into deafness.
 */
async function chatFor(userId) {
  const { data } = await getSupabaseAdmin()
    .from("telegram_links")
    .select("tg_chat_id")
    .eq("user_id", userId)
    .not("linked_at", "is", null)
    .maybeSingle();
  return data?.tg_chat_id || null;
}

export async function checkMailboxes(userId) {
  const accounts = await listMailAccounts(userId);
  const result = { checked: 0, revoked: 0, recovered: 0, alerted: 0 };
  const chatId = await chatFor(userId);

  for (const row of accounts) {
    result.checked += 1;
    let alive = false;
    let reason = "";

    let box = null;
    try {
      const account = await getMailAccount(userId, row.id);
      box = await openMailbox(account);
      alive = await box.probe();
    } catch (err) {
      reason = err.message;
    } finally {
      if (box) await box.close().catch(() => {});
    }

    if (alive) {
      const changed = await markActive(userId, row.id);
      if (changed) {
        result.recovered += 1;
        if (chatId) {
          await sendMessage(chatId, `✅ <b>${esc(row.email)}</b> is readable again.`);
          result.alerted += 1;
        }
      }
      continue;
    }

    const changed = await markRevoked(userId, row.id);
    result.revoked += 1;

    await logWarn({
      source: "mailbox", event: "credential_dead", userId,
      message: `${row.email} could not be opened: ${reason}`,
    });

    // Only on the way in. A daily repeat trains you to ignore it.
    if (changed && chatId) {
      await sendMessage(
        chatId,
        [
          `⛔ <b>${esc(row.email)} stopped working</b>`,
          row.auth_kind === "imap_app_password"
            ? "The app password was rejected. Generate a new one at myaccount.google.com/apppasswords and re-add the mailbox in Settings."
            : "Google refused the credential. Reconnect the account in Settings.",
          "",
          `<i>${esc(reason).slice(0, 200)}</i>`,
          "",
          row.role === "primary"
            ? "This is the primary mailbox, so bank alerts and the statement have stopped too."
            : "Invoice harvesting from this mailbox has stopped.",
        ].join("\n")
      );
      result.alerted += 1;
    }
  }

  await logInfo({
    source: "mailbox", event: "health_checked", userId,
    message: `${result.checked} mailbox(es): ${result.revoked} dead, ${result.recovered} recovered`,
  });

  return result;
}
```

- [ ] **Step 2: Add the job to the cron dispatcher**

In `app/api/cron/tick/route.js`:

Add two imports, and extend the existing `@/lib/cycles` line rather than adding a second one:

```js
import { harvestCycle } from "@/lib/harvest";
import { checkMailboxes } from "@/lib/mailbox-health";
```

```js
// was: import { getCardAccount, cycleAwaitingSubmission } from "@/lib/cycles";
import { getCardAccount, cycleAwaitingSubmission, currentCycle } from "@/lib/cycles";
```

Extend the job list:

```js
const JOBS = ["sync", "rematch", "nudge", "harvest", "statement", "submit", "report", "mailboxes"];
```

Extend `jobsForToday` — replace the existing `due` line and the statement branch:

```js
  const due = ["sync", "rematch", "nudge", "mailboxes"];
  // The statement is dated on `statement_day` but the email lands a day or two
  // later, so the ingest is attempted on the following three days. Repeats are
  // free: a statement already on file is skipped by its Gmail message id.
  if (day > statementDay && day <= statementDay + 3) due.push("statement");
  // Harvesting runs every day from the statement closing until the package
  // goes out. It is idempotent, so a daily sweep simply catches the invoices
  // that arrive late — and most of them do.
  if (day > statementDay && day <= submitDay) due.push("harvest");
  if (day === submitDay) due.push("submit");
  if (day === 4) due.push("report");
```

Update the docstring's schedule list to match, then add both cases to `runJob`:

```js
    case "harvest": {
      const cycle = await currentCycle(user.id);
      if (!cycle) return { skipped: "no card configured" };

      const { data: statement } = await getSupabaseAdmin()
        .from("statements")
        .select("id, cycle_id, issued_on, status")
        .eq("user_id", user.id)
        .eq("status", "reconciled")
        .order("issued_on", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Nothing to look for until the bank has told us what was charged.
      if (!statement) return { skipped: "no reconciled statement yet" };

      const { data: cycleRow } = await getSupabaseAdmin()
        .from("statement_cycles")
        .select("*, card:card_accounts(*)")
        .eq("id", statement.cycle_id ?? cycle.id)
        .maybeSingle();

      const summary = await harvestCycle({
        userId: user.id,
        cycle: cycleRow || cycle,
        statement,
      });

      return {
        scanned: summary.scanned ?? 0,
        matched: summary.matched ?? 0,
        ambiguous: summary.ambiguous ?? 0,
        errors: summary.errors ?? 0,
      };
    }

    case "mailboxes":
      return checkMailboxes(user.id);
```

- [ ] **Step 3: Point sync at the stored credential**

Still in `runJob`, the `sync` case currently relies on `GOOGLE_REFRESH_TOKEN`. Leave `syncUserTransactions` alone — it reads `lib/gmail.js`, which still falls back to the env var — but confirm the fallback is actually exercised by checking the primary mailbox resolves:

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {register}=require('esbuild-register/dist/node'); register();
require('./lib/mail-account.js').primaryMailAccount('115105472683255155618')
  .then(a=>console.log(a ? ['primary:', a.email, a.auth_kind, 'credential length', a.credential.length].join(' ') : 'NO PRIMARY'));
"
```

Expected: `primary: kmutha@vippysoya.com oauth credential length <around 100>`

Converting `lib/sync.js` to take the credential explicitly is deliberately left to plan 2, so this plan does not touch the production sync path.

- [ ] **Step 4: Verify each job in isolation against production**

```bash
npm run build   # must be clean
npm test        # must be green
vercel --prod
```

Then, one at a time:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://vippy-spend-tracker.vercel.app/api/cron/tick?job=mailboxes" | python3 -m json.tool
```

Expected: `checked: 2`, `revoked: 0`. If a mailbox reports revoked here but worked locally in Task 4, that is Vercel blocking IMAP after all — go back to Task 0's failure branch.

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://vippy-spend-tracker.vercel.app/api/cron/tick?job=harvest" | python3 -m json.tool
```

Expected: `matched` at least 15 on the first run against the August statement, `errors: 0`. On an immediate second run, `scanned: 0` — everything is in `mail_seen` and nothing is fetched twice. **That second run is the important one**: a harvester that re-reads the whole mailbox daily will exhaust its time budget by the 23rd.

- [ ] **Step 5: Confirm what landed**

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const U='115105472683255155618';
(async()=>{
  const {data:r}=await sb.from('receipts').select('merchant,amount,currency,receipt_date,source,source_account')
    .eq('user_id',U).eq('source','gmail').order('receipt_date');
  console.log('harvested:', r.length);
  for (const x of r) console.log(' ', x.receipt_date, String(x.currency).padEnd(4), String(x.amount).padStart(10), x.merchant.slice(0,40), '<-', x.source_account);
  const {count}=await sb.from('mail_seen').select('*',{count:'exact',head:true}).eq('user_id',U);
  console.log('messages remembered:', count);
})();
"
```

Expected: at least 15 harvested rows spanning both `source_account` values, and a `mail_seen` count in the hundreds. Spot-check two rows against the statement — a Uber EUR amount and the ÖBB EUR 9.20 — and confirm the receipt is bound to the right charge:

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  const {data}=await sb.from('receipt_transactions').select('receipt_id,transaction_id,matched_by').eq('matched_by','harvest');
  console.log('harvest links:', data.length);
})();
"
```

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/tick/route.js lib/mailbox-health.js
git commit -m "$(cat <<'EOF'
Harvest daily from the statement closing until the package goes out

Invoices arrive late — some of August's turned up days after the statement —
so the sweep runs every day of that window rather than once. It is
idempotent: everything already looked at is in mail_seen and is never fetched
again, which is what keeps a daily run inside its time budget.

A credential check runs on every tick alongside it. The credentials this
design chose are the durable ones, but an app password can be revoked by
accident and an Internal app stops the day its owner leaves the Workspace.
This app has already lost two months of sync to a credential that failed
silently, so the alert fires on the transition into failure — once, naming
the mailbox, rather than daily into deafness.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done when

- Both mailboxes appear in Settings, one `Google` and one `App password`, both `active`.
- `?job=harvest` against the August statement matches at least 15 documents with no errors, and a second run immediately after scans nothing.
- Killing a credential on purpose produces exactly one Telegram alert naming the mailbox, and restoring it produces exactly one recovery message.
- `npm test` is green and `npm run build` is clean.

## Not in this plan

Plan 2 covers the pack itself: rewriting `lib/submission.js` onto a statement-line spine, `lib/pack-pdf.js` for the printable document, dropping the ₹500 waiver, reporting coverage as three numbers, and the approval flow on the 23rd. Everything harvested here is an ordinary `receipts` row, so plan 2 needs no knowledge that any of this happened.
