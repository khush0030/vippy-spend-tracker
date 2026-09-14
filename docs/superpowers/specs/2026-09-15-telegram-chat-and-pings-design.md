# Telegram chat and instant receipt pings — design

**Date:** 2026-09-15
**Status:** approved
**Scope:** project B from the receipt-pack spec. Two pieces that share the Telegram bot:
a reminder within the hour of each charge, and a conversational assistant over the user's
own finances, Sarvam-first with a GPT fallback.

## Why

Receipts arrive late or never because the nudge is a morning digest and the moment of spend
has passed. And the bot only speaks in fixed commands; asking "how much on Swiggy this
cycle?" means opening the dashboard.

## Part A — instant pings

### Cadence

`vercel.json` cron becomes hourly: `30 * * * *`. Vercel Pro allows it. The tick keeps its
day-of-month logic; the jobs that should run once a day (`rematch`, `nudge`, `mailboxes`,
`statement`, `harvest`, `submit`, `report`) run only on the 03:30 UTC tick (09:00 IST) —
`jobsForToday(day, card, hourUtc)` adds them only when `hourUtc === 3`. `sync` and the new
`ping` run every tick.

### `ping` job

`lib/ping.js`. After `sync` inserts rows, `ping` selects `transactions` for the user where
`receipt_status = 'missing'`, `is_refund = false`, `amount >= card.min_receipt_amount`,
inserted in the last 26 hours, and with no row in `receipt_pings`. For each (newest first,
max 5 per tick to keep the chat readable) it sends:

```
🧾 ₹1,372 · Swiggy · 14 Sep 19:42
Send me the bill when you have it.
[ 🚫 No bill ]  [ 🔁 Subscription ]  [ ⏰ Later ]
```

and records `receipt_pings (transaction_id pk, user_id, sent_at, tg_message_id, answered_at,
answer)`. Buttons (callback_data ≤ 64 bytes, existing `action:id` style):

- `nb:<txn>` → `receipt_status = 'declared'`, edit message to "Noted — no bill for ₹1,372 Swiggy."
- `sub:<txn>` → `receipt_status = 'waived'` and insert the merchant into `waived_merchants
  (user_id, merchant)`; future pings skip that merchant. Message edited to say so.
- `later:<txn>` → `answer = 'later'`; the morning `dailyNudge` already re-lists it, so
  nothing else changes.

A merchant on `waived_merchants` is never pinged. A charge already `attached` at ping time
(the harvester or a photo beat the ping) is not pinged.

`dailyNudge` is unchanged except that it excludes charges pinged today and unanswered —
they were asked once already; the digest is for what is still open from before.

## Part B — chat

### Entry

`handleMessage` in `lib/tg-handlers.js`: text that is not a `/command` goes to
`chatTurn({ userId, chatId, text })` in `lib/chat-agent.js`. Replies are Telegram HTML.
`/help` gains a line: "or just ask — 'how much on Swiggy this cycle?', 'what's still missing?'".

### Model

Sarvam-105B first, GPT-5.6 on failure, through a new `chatWithTools` in `lib/llm.js`:

```js
chatWithTools({ ref, messages, tools, maxTokens, think })
  // -> { message, finishReason }  message = { role, content, tool_calls? }
```

Same body shape as `chatJson` plus `tools` and `tool_choice: "auto"`. Both providers return
OpenAI-shaped `tool_calls`; tool results go back as `{ role: "tool", tool_call_id, content }`.
Verified live against Sarvam-105B on 2026-09-15. `think: false` (reasoning off) — the tools
carry the reasoning, and reasoning tokens would eat the ceiling as they did for sync.

Env: `CHAT_MODEL` default `sarvam:sarvam-105b`, `CHAT_MODEL_FALLBACK` default `openai:gpt-5.6`.

### Loop

`chatTurn`:
1. Load the last 20 turns for this chat from `tg_conversations (chat_id, user_id, role,
   content, tool_calls, tool_call_id, created_at)`; append the user text.
2. Call `chatWithTools`. If `tool_calls`: run each through `lib/chat-tools.js` (max 6 tool
   calls per turn, then a final call with `tool_choice: "none"`), append results, repeat.
3. A write tool does not write. It returns `{ confirm: { kind, id, summary } }`; the agent
   replies with the summary and Confirm/Cancel buttons; the callback performs the write.
4. Store the turn (user, assistant, and tool messages) and reply.

If the primary throws at any step the whole turn is retried once on the fallback with the
same messages. If both fail: "I couldn't look that up just now." and a `chat` error log.

### System prompt

Short. Who the user is (one card, INR, statement cycle dates from `currentCycle`), today's
date, the rule that every number comes from a tool (never estimated), Telegram HTML only,
Indian grouping for rupees (₹1,23,456), ≤ 12 lines unless a list was asked for, Hinglish
in if Hinglish comes in. Advice questions ("am I overspending on food?") are answered from
tool aggregates with the numbers shown; no invented benchmarks.

### Tools (`lib/chat-tools.js`)

Every tool takes `userId` from the handler, never from the model. Periods are resolved by a
pure `resolvePeriod(spec, { today, cycle })` in `lib/chat-periods.js` accepting `this_cycle`,
`last_cycle`, `YYYY-MM`, `last_N_days`, `YYYY-MM-DD..YYYY-MM-DD`, and month names.

Read:
- `spend_summary(period)` → total, count, by_category
- `spend_by_merchant(period, top=10)`
- `search_transactions(query?, period?, min_amount?, max_amount?, category?, limit=20)`
- `missing_receipts(period=this_cycle)` → the `outstanding()` list
- `receipt_status(transaction_id | merchant + amount)`
- `cycle_status()` → dates, coverage %, days to statement/submit, package state
- `statement_summary(which=latest)` → the stored tie-out verdict, totals, refunds
- `subscriptions()` → recurring merchants and next expected dates (reuse
  `app/components/subscriptions/aggregations.js` logic, moved to `lib/subscriptions.js`
  so both can import it)
- `compare_periods(a, b)` → totals and top movers

Write (confirm first):
- `declare_no_bill(transaction_id)` → `receipt_status='declared'`
- `waive_merchant(merchant)` → `waived_merchants` + `receipt_status='waived'` on open charges
- `rename_merchant(from, to)` → the existing `/api/transactions/rename` logic, called as a
  function (extract `renameMerchant` into `lib/merchant-alias.js`)
- `set_category(transaction_id, category)`
- `snooze_pings(until_date)` → `card_accounts.pings_paused_until`; `ping` respects it

Results are compact JSON, amounts as numbers, ≤ 40 rows; tools truncate and say so.

### Safety

- Tools are the only data path; the model never sees SQL, other users, or credentials.
- Writes need a button press; the callback re-checks `user_id`.
- Tool args validated (period spec, integer ids, category from the fixed list); invalid →
  a tool error string, not a throw.
- Messages over 3,900 chars are split at line breaks (Telegram's 4,096 cap).

## Schema (`scripts/chat-migration.sql`)

```sql
create table receipt_pings (
  transaction_id bigint primary key references transactions(id) on delete cascade,
  user_id text not null, sent_at timestamptz not null default now(),
  tg_message_id bigint, answered_at timestamptz, answer text
    check (answer in ('no_bill','subscription','later')));
create table waived_merchants (
  user_id text not null, merchant text not null, created_at timestamptz default now(),
  primary key (user_id, merchant));
create table tg_conversations (
  id bigserial primary key, chat_id bigint not null, user_id text not null,
  role text not null check (role in ('user','assistant','tool')),
  content text, tool_calls jsonb, tool_call_id text,
  created_at timestamptz not null default now());
create index on tg_conversations (chat_id, created_at desc);
alter table card_accounts add column pings_paused_until date;
```
Deny-all RLS for anon on the three tables, matching the existing migrations.

## Testing

- `tests/chat-periods.test.js` — every period form, month boundaries, cycle relative.
- `tests/chat-tools-args.test.js` — arg validation.
- `tests/ping-plan.test.js` — pure selection: threshold, waived merchant, already pinged,
  paused, refund, max 5.
- `tests/llm.test.js` — `chatWithTools` request shape and tool-result round trip via fake
  fetch.
- `scripts/replay-chat.js` — 20 canned questions through Sarvam and GPT, answers printed
  side by side for eyeballing before ship. Run by hand.

## Out of scope

- Voice notes, images in chat other than receipts (already handled).
- Multi-user or group chats.
- Proactive advice messages; the assistant speaks when spoken to, pings aside.
