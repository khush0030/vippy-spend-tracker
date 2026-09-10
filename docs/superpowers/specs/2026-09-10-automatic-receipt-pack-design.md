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
  mail_accounts (work + personal)       |
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

## Component 1 — `mail_accounts`

A user may connect several mailboxes. Each carries a role, because they are not interchangeable:
the work account receives bank alerts and the statement PDF; the personal account receives
neither and would only waste API calls being swept for them.

Each also carries an **auth kind**, because Google will not let both connect the same way. See
"The credential problem" below — it is the single hardest constraint in this design.

```sql
create table mail_accounts (
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

create unique index mail_accounts_one_primary
  on mail_accounts (user_id) where role = 'primary';
```

`credential` holds an encrypted OAuth refresh token or an encrypted app password depending on
`auth_kind`. Both go through the existing `lib/secret-box.js`, the same mechanism already
protecting `card_accounts.statement_password`, reusing `STATEMENT_PW_KEY`. Losing that key costs a
reconnection of each mailbox and nothing more.

`role = 'primary'` selects the account used by `fetchHDFCEmails` and `fetchStatementPdfs`, enforced
to one per user by the partial index above. `lib/gmail.js` stops reading `GOOGLE_REFRESH_TOKEN`
from the environment and takes a credential argument instead; the env var is read once at migration
time to seed the work account, then ignored.

### The credential problem

`gmail.readonly` is a **restricted** scope, not merely a sensitive one. That makes the obvious
path — publish the OAuth consent screen to production — unavailable: restricted scopes require
CASA Tier 3 verification, a full third-party penetration test costing thousands of dollars and
repeated every twelve months. For a single-user tool that is not a real option.

Leaving the consent screen in Testing is equally unworkable. Google expires refresh tokens issued
by apps in Testing status after **seven days**. This app has already lost two months of sync to a
silent credential failure; a mailbox that dies every week is not automation.

So the two accounts connect differently:

| Account | Kind | Why |
|---|---|---|
| `kmutha@vippysoya.com` (Workspace) | `oauth`, consent screen set to **Internal** | Internal apps are exempt from verification, from the unverified-app warning, and from the seven-day expiry. Free and permanent. |
| `khushmutha20@gmail.com` (personal) | `imap_app_password` | Internal cannot cover an address outside the Workspace domain. App passwords remain supported for personal Gmail and do not expire until revoked. |

**Prerequisite for the work account:** the Google Cloud project must belong to the vippysoya.com
Workspace organisation, or the Internal option will not be offered. If the project was created
under a personal account it must be recreated under the Workspace one. This is a manual setup step
and is verified before any of this ships — the design depends on it.

**Prerequisite for the personal account:** 2-Step Verification must be enabled, or Google does not
offer app passwords.

### Reading a mailbox

`lib/mailbox.js` exposes one interface — search a window, fetch a message, fetch an attachment —
with two implementations behind it: the Gmail API for `oauth` accounts, IMAP for
`imap_app_password` ones. Everything upstream of it, including all the matching logic, is unaware
of which it is talking to.

### Connecting an account

`app/api/auth/callback/route.js` today exchanges the OAuth code and *renders the refresh token as
HTML* for manual copying into `.env.local`. It will instead encrypt it and insert a `mail_accounts`
row against the signed-in user, then redirect to Settings. The token never reaches the browser.

App-password accounts have no callback: Settings takes the address and the sixteen-character
password directly, verifies them with a test IMAP connection before saving, and stores only the
ciphertext.

Settings gains a **Connected mailboxes** section: the list with role, kind and status, *Connect
Google account*, *Add app-password mailbox*, and *Remove*.

## Component 2 — harvested invoices are receipts

`receipts` already carries `source text not null default 'telegram'`. Harvested documents reuse the
table rather than sitting in a parallel one, so the matcher, coverage arithmetic, `/unmatched`,
the pack builder and the dashboard all handle them with no new concept.

```sql
alter table receipts add column if not exists mail_message_id text;
alter table receipts add column if not exists source_account  text;
```

`source` becomes `'gmail'` for these. The existing `unique (user_id, sha256)` dedupes identical
bytes, so the same attachment harvested from two accounts, or from a forwarded copy, is stored
once. It does **not** catch a bill that was both photographed and emailed — those are different
bytes and arrive as two receipts against one charge. That is already a supported shape:
`planAttachments` handles many receipts per transaction, and the pack cites both.

A second table records which messages have been looked at, so a rerun is cheap and a discarded
email is never read twice. It stores identifiers only, never content:

```sql
create table mail_seen (
  user_id      text not null,
  account_id   uuid not null references mail_accounts(id) on delete cascade,
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

1. Search the cycle window through `lib/mailbox.js`. The Gmail adapter issues
   `after:.. before:.. (invoice OR receipt OR booking OR ticket OR order OR confirmation OR payment OR bill OR reservation)`;
   the IMAP adapter issues the equivalent `SINCE`/`BEFORE` plus `OR SUBJECT` terms.
2. Skip anything already in `mail_seen`. Cap at 400 messages per account per run — the window is
   swept daily for a week, so a cap costs latency, not coverage.
3. For each message, extract amounts from the plain-text body, falling back to HTML with tags
   stripped, and from the filenames and text of any PDF attachment.
4. Hand the whole candidate set to `harvest-match`.
5. Store matched documents; write `mail_seen` rows for everything, matched or not.

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

Headless Chrome renders these more faithfully and was used for the August pack. It is deferred
here, not rejected, and the distinction matters. A *hosted* HTML-to-PDF service would transmit
personal email to a third party and is ruled out permanently on those grounds. Chrome running
inside our own function is the same trust boundary as the code already reading the mailbox and
raises no privacy question at all.

What defers it is weight: Vercel caps a bundled function at 50MB and compressed Chromium is
roughly that alone, so it needs either `@sparticuz/chromium-min` with the binary served from Blob
storage, or Vercel Sandbox. Both are tractable, neither is free.

The decision is deliberately deferred because it is cheap to reverse. Rendering sits behind a
single function, `renderEmailToPdf(message) -> Buffer`; swapping typesetting for Chrome changes
that function and nothing else. One cycle of real output will settle whether the accounts team
cares, which is better evidence than a guess made now.

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
be raised later.

### Coverage becomes three numbers, not one

Removing the waiver takes the August cycle from 79 chaseable lines to 124, and a single percentage
would report that as a collapse from 65% to 41%. That percentage was always the wrong measurement:
it lumps together a Prague pub receipt that **cannot exist** with an Uber invoice sitting in an
inbox that **has not been fetched**. The first is finished business; the second is a task. Reported
identically, the number only communicates guilt.

The pack, the dashboard and the bot all report three:

```
124 purchase lines
  51  documented
  61  declared — no bill exists
  12  outstanding      <- the only actionable number
```

Ninety percent accounted for and truthful, against forty-one percent and demoralising, from
identical underlying facts.

`transactions.receipt_status` already supports `declared`, and both `cycleCoverage` and
`lib/recon.js` already count it alongside `attached`. What is missing is any way to *reach* that
state: `/declare` is advertised by the closing nudge and has no handler, and the daily nudge's
**No bill exists** button emits a `dq:` callback nothing listens for. Declaring is therefore
impossible today, which is why the third number would otherwise always read zero.

Wiring those, and adding a batch declare to the closing nudge — *"34 Prague restaurant charges,
all cash-only, mark the lot?"* — belongs to project B. This spec depends on it only for the
reported figure, and degrades honestly without it: undeclared lines simply stay in `outstanding`.

The nudge already sorts by amount descending and caps its list, so a lower threshold lengthens the
tail it draws from without lengthening the message.

## Component 9 — orchestration and health

`harvest` becomes a seventh job in `app/api/cron/tick/route.js`, due from `statement_day + 1`
through `submit_day` — the 17th to the 23rd for this card. It is idempotent, so running every day
in that window simply catches invoices that arrive late.

`submit` on the 23rd builds the pack and posts it to Telegram for approval, exactly as it does
now. The `send` callback is already wired.

**Credential health.** Every tick, each `mail_accounts` row is checked — an access-token request
for `oauth`, a no-op login for `imap_app_password`. On failure the row moves to `status='revoked'`
and a Telegram alert fires **once, on the transition**, naming the account and linking to Settings.

The credential choices in Component 1 are what make this rare rather than weekly, but neither is
immortal: an app password can be revoked from a Google security page by accident, and an Internal
app still breaks if the user leaves the Workspace. This app has already lost two months of sync to
a silent credential failure. A dead mailbox must be loud.

## Error handling

- A mailbox that fails to authorise is skipped; the others still harvest.
- A message that fails to parse is recorded `outcome='error'` in `mail_seen` and retried on the
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

1. `create table mail_accounts` with the one-primary partial index, `create table mail_seen`
2. `alter table receipts` — add `mail_message_id`, `source_account`
3. `alter table card_accounts alter column min_receipt_amount set default 0` and update the row
4. deny-all RLS for anon on both new tables, matching the existing convention
5. seed `mail_accounts` from `GOOGLE_REFRESH_TOKEN` as the `primary` work account, `auth_kind='oauth'`

Two manual steps have no SQL and gate the rest: moving the OAuth consent screen to **Internal**
under the vippysoya.com Workspace, and generating a Gmail app password on the personal account.
Both are verified before the harvester is enabled.

## Risks

| Risk | Handling |
|---|---|
| `gmail.readonly` is a restricted scope, so Production needs CASA Tier 3 | Not attempted. Work account uses an **Internal** consent screen, which is exempt; personal account uses an IMAP app password, which sidesteps OAuth entirely. |
| A credential dies anyway — app password revoked, Workspace membership lost | Per-account health check each tick, loud Telegram alert on the transition, never silent. |
| Cloud project sits under a personal account, so Internal is unavailable | Verified as a setup prerequisite before build, not discovered at deploy time. Remedy is recreating the project under the Workspace org. |
| Amount collisions between lines | Nearest-date wins; genuine ties are held and asked about, never guessed. |
| Separator parsing is subtle | Pure module, largest test suite in the change, explicit rejection over guessing. |
| Model invents a plausible split | Arithmetic validation discards any proposal that does not sum to the line. |
| Cron exceeds `maxDuration = 300` | 400-message cap per account per run, and a seven-day window to finish in. |
| Typeset emails read worse than browser renders | Accepted for one cycle. `renderEmailToPdf` is a single swappable function; the upgrade is `@sparticuz/chromium-min` with the binary in Blob storage, or Vercel Sandbox. |
| Removing the waiver makes coverage look like a collapse | Reported as three numbers — documented, declared, outstanding — so a receipt that cannot exist stops counting as work not done. |

## What this leaves for project B

The bot still only answers slash commands, and three of the affordances it advertises are broken:
`/declare` is promised by the closing nudge and has no handler, and the daily nudge's
**No bill exists** and **Tomorrow** buttons send `dq:` and `snooze` callbacks that nothing handles.
Those are bugs in the current bot, not gaps in this design, and they are fixed in B along with the
conversational layer and the batch declare that Component 8 depends on for its third number.
