# Swiggy Instamart invoices via the mailbox harvester — design

**Date:** 2026-09-14
**Status:** approved
**Scope:** operational activation of the existing harvester, plus a conditional patch.

## The ask

Every Swiggy Instamart order ends with a tax-invoice email. Those invoices should land in the
accounts package automatically, bound to their HDFC statement lines.

## Findings

- The harvester (`lib/harvest.js`, spec `2026-09-10-automatic-receipt-pack-design.md`) already
  does this for any merchant that emails an invoice. It is merged and deployed.
- It has never run. `mail_accounts` is empty: neither mailbox has been connected through
  Settings. `mail_seen` is empty and there are no `harvest` log rows.
- Swiggy mail arrives in the personal account (`khushmutha20@gmail.com`), not the Workspace
  account — the work Gmail has zero `from:swiggy.in` mail since mid-July 2026.
- The last reconciled statement (cycle 17 Jul – 16 Aug 2026) carries four Swiggy lines
  (₹957, ₹698, ₹535, ₹406) with no receipts linked. That statement is the live test.

## Decision

No merchant-specific code. Activate the general harvester and test it against real data.

1. **Connect mailboxes** (user, in Settings → Mailboxes):
   - `kmutha@vippysoya.com` — "Connect with Google" (Internal consent screen, role `primary`).
   - `khushmutha20@gmail.com` — app password (2-Step Verification on, then
     myaccount.google.com/apppasswords), role `invoices`.
2. **Trigger** `GET /api/cron/tick?job=harvest` with the cron secret. The job picks the latest
   reconciled statement, so it runs against the Jul–Aug cycle today without waiting for the 18th.
3. **Verify**: `receipts` rows with `source='gmail'` and `receipt_transactions` for transaction
   ids 415, 413, 373, 412; `mail_seen` outcomes; `harvest` log events.

## Known risk and the conditional patch

`candidateFrom` (`lib/harvest-plan.js`) reads amounts from the subject and body only. If the
Instamart email body does not state the total and the number lives solely inside the attached
PDF, exact matching misses it and the email is only offered to the model as a 500-char excerpt.

If the test shows that, the patch is: extract text from PDF attachments (pdf-parse is already a
dependency, used for statements) and feed it into `extractAmounts` alongside the body. Pure
function, testable with a fixture. Nothing else changes.

## Out of scope

- Archiving every Instamart invoice irrespective of the statement.
- Any change to search terms, matching, or the model prompt unless the test demands it.
