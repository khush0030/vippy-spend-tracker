# Telegram chat + pings — context handoff

Paste this at the start of a new chat to resume. Written 2026-09-15.

## Where things stand

**Shipped to production (main, Vercel Ready):**
- Anthropic removed entirely. Sarvam-105B for text (sync, harvest leftovers), GPT-5.6 for
  vision (receipts, statements), Sarvam Extract as the second receipt reader. Details and
  live-verified API quirks: `docs/superpowers/specs/2026-09-14-sarvam-gpt-providers-design.md`
  and the memory file `model-providers.md`.
- Mailbox harvester live: both Gmail accounts connected, Instamart invoices match.
- Cron is already **hourly** (`30 * * * *`) in production, with `ping` in `JOBS` but its
  `case` not deployed yet — it returns `{ skipped: "unknown job" }` until this branch ships.

**In progress on branch `telegram-chat-pings`** (not merged, not pushed):
- Spec: `docs/superpowers/specs/2026-09-15-telegram-chat-and-pings-design.md`
- Plan: `docs/superpowers/plans/2026-09-15-telegram-chat-and-pings.md` (9 tasks)
- Ledger: `.superpowers/sdd/progress.md` (git-ignored) — last section is this project.

| Task | State |
|---|---|
| 1 migration + hourly cron | done `957ef6a` — **SQL NOT YET RUN in Supabase** (`scripts/chat-migration.sql`) |
| 2 `lib/ping-plan.js` | done, reviewed |
| 3 `lib/ping.js` + buttons + digest exclusion | done, reviewed; race fixed `4866dda` |
| 4 `chatWithTools` in `lib/llm.js` | done, reviewed |
| 5 `lib/chat-periods.js`, `lib/chat-args.js` | done, reviewed; month-rollover fixed `811ccb6` |
| 6 `lib/chat-tools.js` (+ `lib/merchant-alias.js`, `lib/subscriptions.js`) | implemented `976af4f`, **review pending** |
| 7 `lib/chat-agent.js`, `lib/chat-prompt.js` | not started |
| 8 wire into `lib/tg-handlers.js` | not started |
| 9 `scripts/replay-chat.js`, deploy, live check | not started |

Resume with superpowers:subagent-driven-development: package `811ccb6..976af4f`, dispatch the
Task 6 reviewer, then Tasks 7–9, then a whole-branch review, then merge to main and push.

## Hard requirements from Khush

1. **Every charge needs a receipt.** No amount threshold, nothing waived — a ₹50 subscription
   counts. `min_receipt_amount` → 0 in the migration. "Subscription" button only tags the
   merchant as recurring (`recurring_merchants`); the charge stays `missing`.
2. Pings within the hour of the charge, with **No bill / Subscription / Later** buttons.
3. Chatbot in Telegram: **Sarvam-105B primary, GPT-5.6 fallback** (`CHAT_MODEL`,
   `CHAT_MODEL_FALLBACK`). Read-only Q&A + actions (each confirmed with a button) + advice
   from real aggregates. Sarvam tool calling verified live 2026-09-15.

## Things another session did in this checkout

The same working tree is used by another Claude session (UI redesign work). It has:
merged/pushed my branches into main on its own, deleted `telegram-chat-pings` once (recreated
at `ec83dac`), switched the checkout to `main` mid-task, and committed `9b940d9` (timezone fix)
onto my branch. **Always `git branch --show-current` before acting**, and expect `main` to move.

## Still owed to Khush / by Khush

- Run `scripts/chat-migration.sql` in the Supabase SQL editor (Khush, one paste) — needed
  before `ping` and chat can work live.
- 42 bogus HDFC-alert "receipts" from the first harvest run still need deleting (Khush said
  nothing yet; the delete was blocked by the permission classifier).
- Historical `transactions` rows (pre-2026-09-14) may have shifted `email_id`/`date` from the
  old positional-pairing bug; merchant+amount are right. Optional backfill.
- After deploy: press **Later** on a live ping, ask the bot "how much on swiggy this cycle?",
  and confirm a rename — the Task 9 live checks.

## Gotchas that cost time

- Sarvam-105B thinks by default; pass `reasoning_effort: null` (`think: false`) or it eats
  `max_tokens` and returns nothing.
- OpenAI chat completions: `max_completion_tokens`, no `temperature`; `gpt-5.6-mini` does
  not exist on this account (`gpt-5.4-mini` does).
- Sarvam Extract: single `type` per node, `description` on every field, result under `data`.
- `node --test` only runs modules without `@/` imports; scripts use `esbuild-register`.
- Turbopack refuses a symlinked `node_modules` in a worktree — build on the main checkout.
- Reviewers on Sonnet are reliable; Opus hit a session rate limit once (resets ~21:10 IST).
