# Automatic receipt pack — design

**Date:** 2026-09-10
**Status:** approved, not yet built
**Scope:** project A of two. Project B (conversational Telegram bot) is designed separately.

## The problem

Receipt Rail can already read the HDFC statement, reconcile it, and email accounts a package.
But the package it builds is worse than the one assembled by hand for the August cycle, and the
only way a receipt can enter the system is a photograph sent to Telegram.

That last point is the real gap. Of the receipts recovered for the 17 Jul – 16 Aug statement,
roughly four in five were never paper at all — Uber, ÖBB, Hostelworld, Matterhorn Gotthard Bahn,
FlixBus, Matrix, Amazon, Swiggy, Zomato, DataForSEO, Anthropic, Shopify. Every one of them was
sitting in a mailbox, and half were in a personal account the app has never been given.

The August pack took an afternoon of manual work: two Gmail searches, a headless browser, and a
throwaway script that mapped emails to statement lines by hand. This spec makes that afternoon
happen on its own, every month, between the statement landing and the payment falling due.

## Goals

1. Both mailboxes connected durably, with tokens stored rather than pasted into env vars.
2. E-invoices harvested from email and matched to statement lines without per-merchant code.
3. The package accounts receives is the one built by hand in August, not the current weaker one.
4. Nothing waived. Every purchase line on the statement wants a document, whatever its size.
5. The whole thing runs between statement day and submit day, ending in a Telegram approval.

## Non-goals

- A conversational bot. That is project B and gets its own spec.
- Reading anything from the personal mailbox that is not already a charge on the company card.
- Pixel-perfect reproduction of HTML emails. See "Rendering" for why.
- Replacing `lib/sync.js` or its prompt. It is tuned in production and stays untouched.

## Architecture

```
statement reconciled (day 17-19)
        |
        v
  statement_lines  ------> shopping list of amounts
                              EUR 33.90, CHF 34.40, USD 15.68, INR 1,668 ...
                                        |
  gmail_accounts (work + personal)      |
        |                               |
        v                               v
   candidate emails  --> extract amounts --> exact match on amount + currency + date
   (cycle window,          (pure)                        |
    invoice-shaped)                                      +--> hit:  store as a receipt
                                                         |
                                                         +--> miss: discard, nothing written
                                                         |
                                                         +--> leftovers -> Claude, one batched
                                                              call, arithmetic-validated
        |
        v
   receipts (source='gmail')  --joins-->  receipt_transactions  -->  pack builder v2
                                                                          |
                                                                          v
                                                            Telegram approval -> accounts
```

The load-bearing idea: **the statement tells the harvester what to look for.** It never indexes a
mailbox. It asks a closed question — "does any email in this window mention CHF 34.40?" — and
forgets everything that answers no.

## Component 1 — `gmail_accounts`

A user may connect several mailboxes. Each carries a role, because they are not interchangeable:
the work account receives bank alerts and the statement PDF; the personal account receives
neither and would only waste API calls being swept for them.

```sql
create table gmail_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null,
  email             text not null,
  refresh_token     text not null,               -- secret-box ciphertext, never plaintext
  role              text not null default 'invoices'
                    check (role in ('primary','invoices')),
  status            text not null default 'active'
                    check (status in ('active','revoked')),
  last_harvest_at   timestamptz,
  last_checked_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (user_id, email)
);
```

Tokens are encrypted with the existing `lib/secret-box.js`, the same mechanism already protecting
`card_accounts.statement_password`. `STATEMENT_PW_KEY` is reused; losing it costs a re-authorisation
of each mailbox and nothing more.

`role = 'primary'` selects the account used by `fetchHDFCEmails` and `fetchStatementPdfs`. Exactly
one account per user may hold it, enforced in the database rather than in application code:

```sql
create unique index gmail_accounts_one_primary
  on gmail_accounts (user_id) where role = 'primary';
```
 `lib/gmail.js` stops reading `GOOGLE_REFRESH_TOKEN` from the
environment and takes a token argument instead; the env var is read once at migration time to seed
the work account, then ignored.

### Connecting an account

`app/api/auth/callback/route.js` today exchanges the code and *renders the refresh token as HTML*
for manual copying into `.env.local`. It will instead encrypt it and insert a `gmail_accounts` row
against the signed-in user, then redirect to Settings with a success flag. The token never reaches
the browser.

Settings gains a **Connected mailboxes** section: the list, each with role and status, a *Connect
another* button, and a *Remove* action.

## Component 2 — harvested invoices are receipts

`receipts` already carries `source text not null default 'telegram'`. Harvested documents reuse the
table rather than sitting in a parallel one, so the matcher, coverage arithmetic, `/unmatched`,
the pack builder and the dashboard all handle them with no new concept.

```sql
alter table receipts add column if not exists gmail_message_id text;
alter table receipts add column if not exists source_account   text;
```

`source` becomes `'gmail'` for these. The existing `unique (user_id, sha256)` dedupes identical
bytes, so the same attachment harvested from two accounts, or from a forwarded copy, is stored
once. It does **not** catch a bill that was both photographed and emailed — those are different
bytes and arrive as two receipts against one charge. That is already a supported shape:
`planAttachments` handles many receipts per transaction, and the pack cites both.

A second table records which messages have been looked at, so a rerun is cheap and a discarded
email is never read twice. It stores identifiers only, never content:

```sql
create table gmail_seen (
  user_id      text not null,
  account_id   uuid not null references gmail_accounts(id) on delete cascade,
  message_id   text not null,
  cycle_id     uuid,
  outcome      text not null check (outcome in ('matched','discarded','ambiguous','error')),
  seen_at      timestamptz not null default now(),
  primary key (user_id, account_id, message_id)
);
```

## Component 3 — `lib/money-parse.js` (pure)

`extractAmounts(text) -> [{ value, currency, raw }]`

This module is where the bugs will live, so it has no imports and is tested directly.

Recognised shapes, symbol before or after the number:
`€33.90` · `EUR 33.90` · `33,90 €` · `CHF 1'234.56` · `1 473,50 Kč` · `CZK 1150.46` ·
`₹10,168.64` · `Rs. 1,694.07` · `INR 5,093.22` · `$19.74` · `US$53.22` · `£30.99` · `GBP 40.77`

Separator resolution, in order:

1. Strip Swiss apostrophes and non-breaking spaces used as thousands separators.
2. If both `.` and `,` appear, the **rightmost** is the decimal separator; the other is thousands.
3. If only one appears and exactly two digits follow it to the end of the number, it is decimal.
4. If only one appears and three digits follow, it is a thousands separator.
5. Anything else is rejected rather than guessed.

So `€ 630,91` → 630.91, `₹10,168.64` → 10168.64, `1,234` → 1234, `12,50` → 12.50.

Currency is normalised to ISO codes. `Kč` → CZK, `Rs.`/`₹` → INR, `US$`/`$` → USD, `£` → GBP.
A bare `$` is ambiguous but no statement line in scope bills in CAD or AUD, so it maps to USD.

## Component 4 — `lib/harvest-match.js` (pure)

`matchEmailsToLines(lines, candidates) -> { links, ambiguous, unmatchedLines, unmatchedEmails }`

For each statement line, the amount to look for is:

- `amount_orig` in `currency`, when the line is foreign;
- otherwise `amount` in INR.

A candidate email matches a line when it contains that amount to two decimal places in that
currency, and its date falls within **−1 to +3 days** of the line's `txn_date`. The window is
asymmetric because a card charge posts after the merchant sends the receipt, never long before.

Resolution rules:

- **Several emails → one line** is legitimate and all are attached. Amazon's ₹1,668 is three
  orders; Saravanaa Bhavan is a bill and a card slip.
- **One email → several lines** is ambiguous — two Bulldog Hotel charges at €7.10 on consecutive
  days. Rank by absolute date distance and take the unique minimum. Only a genuine tie is held
  for the bot to ask about.
- No match either way falls through to the model.

## Component 5 — `lib/harvest.js` (I/O)

Per account, per run:

1. Query Gmail across the cycle window:
   `after:.. before:.. (invoice OR receipt OR booking OR ticket OR order OR confirmation OR payment OR bill OR reservation)`
2. Skip anything already in `gmail_seen`. Cap at 400 messages per account per run — the window is
   swept daily for a week, so a cap costs latency, not coverage.
3. For each message, extract amounts from the plain-text body, falling back to HTML with tags
   stripped, and from the filenames and text of any PDF attachment.
4. Hand the whole candidate set to `harvest-match`.
5. Store matched documents; write `gmail_seen` rows for everything, matched or not.

Discarded emails leave a message id behind and nothing else. Their bodies are never persisted.

### The model fallback

One batched call per cycle, not per email. It receives the statement lines still bare and the
candidate emails still unassigned — sender, subject, date, extracted amounts, first 500 characters
of body — and returns proposed assignments, including splits.

**Every proposal is then checked by arithmetic**: the assigned emails' amounts must sum to the
line's amount within ₹1 or 0.5%, whichever is larger. A proposal that does not balance is
discarded. The model proposes; the sum disposes. This is what stops a plausible-looking
hallucination from reaching the accounts team.

Model selection reuses the `STATEMENT_MODEL` / `STATEMENT_MODEL_FALLBACK` pattern already in the
environment.

## Component 6 — rendering

An email becomes a printable document one of two ways.

**It already has one.** ÖBB, FlixBus, Matrix, Amazon, Swiggy, Zomato, DataForSEO, Anthropic,
Higgsfield and Shopify all attach a PDF. Attachments up to 10MB are used verbatim, which is both
free and the strongest possible evidence.

**It does not.** Uber, Hostelworld, Matterhorn Gotthard Bahn and Bulldog Hotel send HTML only.
These are typeset with `pdfkit` — already a dependency — as a page headed with From, Subject, Date
and receiving account, followed by the email's body with markup stripped, wrapped and paginated.
The result is the merchant's own email, printed. That is what a forwarded-and-printed receipt has
always looked like and accounts treat it as such.

Headless Chrome would render these more faithfully and was used for the August pack. It is
rejected here: on Vercel it means a ~50MB binary and cold starts, and a hosted HTML-to-PDF service
would mean transmitting personal email to a third party, which contradicts the scoping rule this
whole design rests on. If the typeset output proves unreadable in practice, Chrome via
`@sparticuz/chromium` is the upgrade path and nothing else in the design changes.

Stored at `${userId}/gmail/${YYYY}/${MM}/${receiptId}.pdf`.

## Component 7 — pack builder v2

`lib/submission.js` is rewritten to emit what the August pack emitted:

| File | Contents |
|---|---|
| `Receipts_Printable_<date>.pdf` | cover with totals, index, missing list, then one page per document headed with its statement line number, date, descriptor and amount |
| `reconciliation_<card>_<date>.csv` | every statement line; `receipt_file` names the file in `receipts/` |
| `MISSING_RECEIPTS.csv` | purchase lines with no document |
| `Statement_HDFC_<card>_<date>.pdf` | the decrypted statement |
| `receipts/` | `R-nnn_…` photographs and `E-nnn_…` e-invoices |
| `README.txt` | what each file is and how the columns join |

The spine changes from transactions to **statement lines**, falling back to transactions only when
no statement has been reconciled. This fixes a real defect: the 16 July King Power charge appears
on the August statement but outside the app's August transaction window, so the current builder
omits it entirely.

Page layout moves to a new `lib/pack-pdf.js` so `submission.js` stays about assembly.

The package is capped at 20MB as today. When rendering pushes it past that, e-invoice pages are
rasterised at lower DPI before anything is dropped, and the Telegram approval message says so.

## Component 8 — nothing waived

`min_receipt_amount` currently defaults to 500 and gates four places: `cycleCoverage`,
`missingText`, `nudge.outstanding` and `buildSubmission`'s chaseable count. On the August
statement that hid 45 lines.

The default becomes 0 and the existing card row is set to 0. The column stays so the threshold can
be raised later. Coverage will drop sharply the first time this runs — that is the number being
honest, not a regression.

The nudge already sorts by amount descending and caps its list, so a lower threshold lengthens the
tail it draws from without lengthening the message.

## Component 9 — orchestration and health

`harvest` becomes a seventh job in `app/api/cron/tick/route.js`, due from `statement_day + 1`
through `submit_day` — the 17th to the 23rd for this card. It is idempotent, so running every day
in that window simply catches invoices that arrive late.

`submit` on the 23rd builds the pack and posts it to Telegram for approval, exactly as it does
now. The `send` callback is already wired.

**Token health.** Every tick, each `gmail_accounts` row is checked by requesting an access token.
On failure the row moves to `status='revoked'` and a Telegram alert fires **once, on the
transition**, naming the account and linking to Settings. Google expires refresh tokens after
seven days while an OAuth consent screen sits in Testing mode, and this app has already lost two
months of sync to a silent credential failure. A dead mailbox must be loud.

## Error handling

- A mailbox that fails to authorise is skipped; the others still harvest.
- A message that fails to parse is recorded `outcome='error'` in `gmail_seen` and retried on the
  next run rather than blocking the sweep.
- An attachment that cannot be fetched falls back to typesetting the body.
- The model call failing leaves exact matches intact; only the leftovers go unresolved.
- The pack refuses to build when the statement does not tie out, unless forced. Unchanged.

## Testing

New pure modules, tested with `node --test` like the rest:

- `tests/money-parse.test.js` — every recognised format, both separator conventions, the Swiss
  apostrophe, the trailing-symbol forms, and the rejection cases. The largest of the new suites.
- `tests/harvest-match.test.js` — exact hits, the date window's asymmetry, many-emails-to-one-line,
  the ambiguous one-email-to-many-lines tie, and the arithmetic validation of a model proposal.
- `tests/pack-pdf.test.js` — page planning: how many pages a document produces, headers carrying
  the right statement line, and the ordering.

`tests/submission.test.js` is extended for the statement-line spine and the no-waiver counting.

Fixtures come from the August cycle, which is real and already reconciled: it is the regression
test for the entire design.

## Migration

`scripts/harvest-migration.sql`:

1. `create table gmail_accounts`, `create table gmail_seen`
2. `alter table receipts` — add `gmail_message_id`, `source_account`
3. `alter table card_accounts alter column min_receipt_amount set default 0` and update the row
4. deny-all RLS for anon on both new tables, matching the existing convention
5. seed `gmail_accounts` from `GOOGLE_REFRESH_TOKEN` as the `primary` work account

## Risks

| Risk | Handling |
|---|---|
| Refresh tokens expire after 7 days in Testing mode | Per-account health check each tick, loud Telegram alert on the transition. Consent screen should be moved to Production. |
| Amount collisions between lines | Nearest-date wins; genuine ties are held and asked about, never guessed. |
| Separator parsing is subtle | Pure module, largest test suite in the change, explicit rejection over guessing. |
| Model invents a plausible split | Arithmetic validation discards any proposal that does not sum to the line. |
| Cron exceeds `maxDuration = 300` | 400-message cap per account per run, and a seven-day window to finish in. |
| Typeset emails read worse than browser renders | Accepted for now; `@sparticuz/chromium` is a drop-in upgrade behind the same interface. |

## What this leaves for project B

The bot still only answers slash commands, and three of the affordances it advertises are broken:
`/declare` is promised by the closing nudge and has no handler, and the daily nudge's
**No bill exists** and **Tomorrow** buttons send `dq:` and `snooze` callbacks that nothing handles.
Those are bugs in the current bot, not gaps in this design, and they are fixed in B along with the
conversational layer.
