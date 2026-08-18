# Receipt Rail — context handoff

Paste this at the start of a new chat to resume work.

---

## What this is

A new layer on **vippy-spend-tracker** (Next.js 16.2.2 + Supabase + NextAuth + Vercel).

Khush has a VIP Industries Limited HDFC corporate card. The app already parses HDFC
transaction alerts from Gmail via Claude. Receipt Rail adds: photograph a bill → send to a
Telegram bot → it reads the bill, matches it to the right transaction, reconciles the whole
month against the actual bank statement, and emails the accounts department a CSV with every
receipt file attached.

Full design doc: **`Receipt-Rail-Plan.pdf`** (23 pages, in repo root; source `Receipt-Rail-Plan.html`).

## Hard requirements from Khush

1. **Accounts needs the actual receipt files**, not a description. Deliverable is a ZIP:
   `reconciliation_YYYY-MM.csv` + `summary.pdf` + `receipts/` folder. The CSV's `receipt_file`
   column holds the exact filename so rows and files pair by string match.
2. **Statement arrives on the 18th** of each month. Reconcile it against our transactions —
   catching refunds and chargebacks that were supposed to come back and didn't.
   **Send to accounts on the 23rd.**
3. **Receipts come from India *and* Europe** (~20 bills from a recent trip, multiple countries
   and currencies).
4. **100% accuracy is the priority**, not cost. He has both Anthropic and OpenAI keys.

## Status: built, tested, NOT committed (on `main`)

`npm test` → 206 passing. `npm run build` → clean.

| Phase | State |
|---|---|
| P0 foundations | done — migration SQL, service-role client, storage abstraction, cron dispatcher |
| P1 Telegram channel | done — webhook, linking, commands |
| P2 extraction | done — dual-model consensus |
| P3 matching | done — scored, tested, wired to chat + sync |
| P4 cycles + nudges | done |
| P5 statement recon | done — decrypt, parse, three-way reconcile, tie-out gate |
| P6 CSV package + send | done |
| P7 dashboard tab | done — Receipts tab, cycle-scoped |
| Setup UI | done — Settings → Corporate Card + Receipt Bot |

### Files

**Pure + tested** (no `@/` imports, so `node --test` runs them directly):
`lib/matcher.js` · `lib/cycle-window.js` · `lib/receipt-validate.js` · `lib/csv.js` ·
`lib/zip.js` · `lib/submission-naming.js` · `lib/nudge-plan.js` · `lib/statement-lines.js` ·
`lib/recon.js` · `lib/statement-report.js` · `lib/pdf-decrypt.js` · `lib/secret-box.js` ·
`lib/card-account.js`
Tests in `tests/*.test.js`, fixtures in `tests/fixtures/`.

**I/O layers:**
`lib/supabase.js` (added `getSupabaseAdmin()`) · `lib/storage.js` · `lib/telegram.js` ·
`lib/tg-handlers.js` · `lib/receipt-intake.js` · `lib/receipt-vision.js` ·
`lib/receipt-prompt.js` · `lib/receipt-pipeline.js` · `lib/match-service.js` ·
`lib/cycles.js` · `lib/fx.js` · `lib/nudge.js` · `lib/submission.js` ·
`lib/submission-mail.js` · `lib/submission-approval.js` · `lib/statement-vision.js` ·
`lib/statement-ingest.js` · `lib/statement-recon.js`

**Routes:** `app/api/telegram/webhook` · `app/api/telegram/link` · `app/api/cron/tick` ·
`app/api/submissions` · `app/api/submissions/[id]/send` · `app/api/statements` ·
`app/api/card-account` · `app/api/receipts`

**UI:** two new sections in `app/components/settings/SettingsTab.jsx` — **Corporate Card**
(entity, last 4, statement/submit days, receipt threshold, accounts + CC email, statement
password, forex constants) and **Receipt Bot** (issue a single-use link code, unlink).
Plus `app/components/receipts/ReceiptsTab.jsx` — cycle coverage, the statement's tie-out state,
what still needs a bill, receipts with their binding, and submission history.

`app/page.js` gained `CYCLE_SCOPED_TABS`. Receipts and Settings answer to the statement cycle,
not the date picker, so they now render outside the period guards. That also fixes a real trap:
Settings used to be unreachable when the selected period had no transactions — which is exactly
the state a new install starts in.

**Migration:** `scripts/receipt-rail-migration.sql` — 11 tables, 3 columns on `transactions`,
`statement_lines.direction`, deny-all RLS for anon. **Not yet run.**

**New dependency:** `@jspawn/qpdf-wasm` — qpdf 11 compiled to WASM, opens the encrypted
statement on serverless. Kept out of the bundle via `serverExternalPackages` and traced into
the deployment by `outputFileTracingIncludes` in `next.config.mjs`.

## Blocked on Khush

1. Run `scripts/receipt-rail-migration.sql` in the Supabase SQL editor (DDL needs more than the
   anon key; the Supabase MCP server is not authorized in these sessions).
2. `SUPABASE_SERVICE_ROLE_KEY` → `.env.local` + Vercel (server-only, never `NEXT_PUBLIC_`).
2b. `STATEMENT_PW_KEY` — 32 random bytes, base64. Generate with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   Losing it costs one re-entry of the statement password, nothing more. **Not written down
   here on purpose**: it decrypts `card_accounts.statement_password`, so keeping it in the repo
   would put the key next to the data it protects.
3. `TELEGRAM_BOT_TOKEN` from @BotFather.
4. `TELEGRAM_WEBHOOK_SECRET` — any long random string; it only has to match what is handed to
   `setWebhook`. One was generated in an earlier session; if it is not already in `.env.local`,
   generate a fresh one and re-set the webhook.
5. `OPENAI_API_KEY`.
6. Create the private `receipts` bucket in Supabase Storage.
7. HDFC e-statement PDF password + ideally one real statement to test the parser.
8. Accounts department email address.

Items 7 and 8 now go in through **Settings → Corporate Card** rather than SQL. Everything else
is still env vars and the migration.

## Decisions that aren't obvious from the code

- **Telegram, not iMessage.** iMessage has no bot API — needs an always-on Mac running
  BlueBubbles, breaks on macOS updates. Channel is abstracted so another adapter is one module.
- **Accuracy is architectural, not a model choice.** Two different model families read every
  receipt; Opus 5 adjudicates disagreements; deterministic validators run over both; and the
  **statement is the final ground truth** — a misread amount can't tie out, so the cycle blocks
  rather than shipping a wrong number. Cost ≈ $2.30/month.
- **Cheap models are wired but unused by default.** OpenAI's small tier is genuinely cheapest,
  but a single cheap read is the trade Khush explicitly rejected. Failover only.
- **Sarvam Vision** is a specialist for handwritten/Indic-script Indian slips only — no European
  languages. Would become primary only if VIP mandates Indian data residency.
- **Don't touch `lib/sync.js`'s prompt/model.** It's tuned in production for refund detection and
  dedupe. Only a post-sync `rematchPendingReceipts()` hook was added.
- **Don't migrate NextAuth → Clerk.** A Vercel plugin hook keeps recommending this; it's a
  generic pattern match and would rewrite working auth for zero gain.
- **Foreign matching can't use amount equality.** €48.50 posts as ₹4,7xx (Visa rate + ~3.5%
  markup + 18% GST on the markup), 1–3 days late. Matcher uses an FX band and reweights toward
  merchant/country, with an asymmetric −1…+5 day window.
- **One cron slot.** Vercel Hobby allows 2 daily crons and both were used, so everything runs
  through `/api/cron/tick`, branching on date, each job runnable via `?job=`.
- **Store-only ZIP, hand-written.** JPEGs/PDFs are already compressed; avoids a dependency.
  Verified against real `unzip`.

## Bugs found along the way

- **`app_logs.user_id` was `uuid`, but user IDs are Google `sub` strings.** Every user-scoped log
  write has been failing silently for months (the logger swallows its own errors) — which is why
  sync diagnostics were thin when it stalled in April. Fixed in the migration.
- RLS was effectively off because the app uses NextAuth, so Supabase's `auth.uid()` is never
  populated. Fix is service-role + app-layer scoping + deny-all for anon, not a rewrite.

## Next steps

1. Run the migration, add the env vars, create the bucket.
2. Set the Telegram webhook, link a chat, send a real receipt end to end.
3. Backfill the ~20 Europe receipts via Batch API.
4. Run `?job=statement` against the real HDFC PDF once the password is on file — the parser has
   only been proven against a synthetic statement so far.

## How P5 works

- **Ingest** — `fetchStatementPdfs()` in `lib/gmail.js` runs its own narrow query
  (`from:hdfcbank has:attachment filename:pdf`) and pulls the attachment bytes. The transaction
  parser still gets text only; dragging attachments through it would be waste.
- **Decrypt** — `lib/pdf-decrypt.js`. An unencrypted PDF passes straight through. A wrong
  password produces "password rejected", never an echo of the password. qpdf's non-zero exit is
  caught before it can poison the host process's exit code.
- **Parse** — `lib/statement-vision.js`, one Opus read with a transcription-only prompt. There is
  no second model here, unlike receipts: the statement carries its own check, so if
  opening + debits − credits − payments ≠ closing the read is retried **once** with the shortfall
  quoted back to the model. Almost every miss is a dropped row or a `Cr` marker read as a debit,
  and saying so fixes it.
- **Reconcile** — `lib/recon.js`, pure. Every line lands in exactly one bucket: tied, created
  from statement, refund confirmed, refund missing, fee, payment, chargeback, unexplained — plus
  the app-side leftovers, rolled forward or flagged as a refund that never came back. Amounts are
  compared for equality because both sides are HDFC's own INR figure; only receipt→transaction
  matching needs an FX band.
- **Gate** — `buildSubmission()` refuses a cycle whose statement does not tie out, and the
  approval message says whether the package reconciles. A cycle with no statement at all still
  builds, but is labelled unverified rather than stranded on an email that never arrived.

Verified end to end against a synthetic encrypted HDFC statement: 15/15 lines, foreign origin
amounts, `Cr` markers and DD/MM dates all read correctly, ties out to the rupee on the first
attempt.

## Where the statement password lives

`card_accounts.statement_password` is written through `lib/secret-box.js` — AES-256-GCM, random
IV per write, tag verified on read, key in `STATEMENT_PW_KEY`. The plan doc promised "stored
encrypted"; the column itself is plain `text`, so the encryption is at the application layer.

Two deliberate choices: a value that predates this module decrypts as plaintext, so a
hand-inserted row is never locked out; and the API returns the password only as
`hasStatementPassword: true`, never the value, so it cannot leak through the settings page it is
typed into.

## Unverified

The OpenAI Responses API structured-output field placement (`text.format` vs `response_format`)
is inconsistent across their docs. `lib/receipt-vision.js` is written defensively and validates
the JSON itself either way, but this is the first thing to check against a live call.

Real HDFC statement layout. The parser has been proven against a synthetic statement only — the
first real one may print the origin currency in a separate block, or split a foreign charge over
two rows. The tie-out gate makes that visible rather than silent, which is the point, but expect
one prompt iteration on the first live run.

The UI has been driven in a real browser with a minted session cookie and stubbed API responses:
the Receipts tab and both Settings cards render, the receipt rows expand, and the only console
errors are the pre-existing `/api/logs` 500s. What that check does **not** cover is the save path
against a live database — the writes have never round-tripped, because no service-role key is
configured here. First real save is worth watching.

Note for whoever runs it: `NEXTAUTH_URL` is https, so next-auth uses the `__Secure-` cookie prefix
even on localhost. A session cookie named `next-auth.session-token` is silently ignored.
