# Telegram Chat and Instant Pings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ping the user on Telegram within the hour of every card charge that lacks a receipt, and let them ask questions about (and act on) their finances in plain language through the same bot, on Sarvam-105B with a GPT fallback.

**Architecture:** The cron becomes hourly; `sync` and a new `ping` job run every tick, everything else keeps its once-a-day slot. Pings and chat share the existing Telegram webhook (`lib/tg-handlers.js`). Chat is a tool-calling loop in `lib/chat-agent.js` over a fixed tool set in `lib/chat-tools.js`; every number the model states comes from a tool, and every write goes through a Confirm button. Pure decision code (`lib/ping-plan.js`, `lib/chat-periods.js`, `lib/chat-args.js`) has no `@/` imports so `node --test` covers it.

**Tech Stack:** Next.js 16 App Router, plain JS, Supabase (service-role via `getSupabaseAdmin`), Telegram Bot API through `lib/telegram.js`, Sarvam-105B / GPT-5.6 through `lib/llm.js` (raw `fetch`, OpenAI chat-completions shape), Vercel Pro cron.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-telegram-chat-and-pings-design.md`.
- **No amount threshold and nothing waived.** Every non-refund charge needs a receipt. `card_accounts.min_receipt_amount` becomes 0 (default and existing row). "Subscription" tags a merchant as recurring; the charge stays `missing`.
- Tested modules (`lib/ping-plan.js`, `lib/chat-periods.js`, `lib/chat-args.js`, additions to `lib/llm.js`) must not import through `@/`.
- Model refs: `CHAT_MODEL` default `sarvam:sarvam-105b`, `CHAT_MODEL_FALLBACK` default `openai:gpt-5.6`. Chat calls pass `think: false`.
- Sarvam and OpenAI both take `tools` + `tool_choice` and return OpenAI-shaped `tool_calls`; tool results are `{ role: "tool", tool_call_id, content }`. Sarvam wants `max_tokens`, OpenAI `max_completion_tokens` (already handled in `chatJson`; reuse the same body builder).
- Telegram: HTML parse mode via `sendMessage`/`editMessage` in `lib/telegram.js`; `callback_data` ≤ 64 bytes, form `action:id`; messages ≤ 4,096 chars.
- Cron: `vercel.json` schedule `30 * * * *`; daily jobs only when `new Date().getUTCHours() === 3`.
- Max 5 pings per tick per user; max 6 tool calls per chat turn; last 20 conversation rows as context.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `npm test` green after every task; `npm run build` clean at the end of every task that touches `app/` or `@/`-importing `lib/` files.

---

### Task 1: Schema migration and cron cadence

**Files:**
- Create: `scripts/chat-migration.sql`
- Modify: `vercel.json`, `app/api/cron/tick/route.js:40-58` (`JOBS`, `jobsForToday`), `app/api/cron/tick/route.js:~88` (call site)

**Interfaces:**
- Produces: tables `receipt_pings`, `recurring_merchants`, `tg_conversations`; column `card_accounts.pings_paused_until date`; `jobsForToday(day, card, hourUtc)`; `JOBS` includes `"ping"` (the `case "ping"` arrives in Task 3 — until then the switch's default returns `{ skipped: "unknown job" }`, which is fine).

- [ ] **Step 1: Write the migration**

```sql
-- scripts/chat-migration.sql
-- Run once in the Supabase SQL editor. Idempotent.

create table if not exists receipt_pings (
  transaction_id bigint primary key references transactions(id) on delete cascade,
  user_id        text not null,
  sent_at        timestamptz not null default now(),
  tg_message_id  bigint,
  answered_at    timestamptz,
  answer         text check (answer in ('no_bill','subscription','later'))
);
create index if not exists receipt_pings_user_sent on receipt_pings (user_id, sent_at desc);

create table if not exists recurring_merchants (
  user_id    text not null,
  merchant   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, merchant)
);

create table if not exists tg_conversations (
  id           bigserial primary key,
  chat_id      bigint not null,
  user_id      text not null,
  role         text not null check (role in ('user','assistant','tool')),
  content      text,
  tool_calls   jsonb,
  tool_call_id text,
  created_at   timestamptz not null default now()
);
create index if not exists tg_conversations_chat_recent on tg_conversations (chat_id, created_at desc);

alter table card_accounts add column if not exists pings_paused_until date;
alter table card_accounts alter column min_receipt_amount set default 0;
update card_accounts set min_receipt_amount = 0;

-- Same posture as the other migrations: the app talks to Supabase with the
-- service role and scopes by user_id itself; anon gets nothing.
do $$
declare t text;
begin
  foreach t in array array['receipt_pings','recurring_merchants','tg_conversations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists deny_anon on %I', t);
    execute format('create policy deny_anon on %I for all to anon using (false)', t);
  end loop;
end $$;
```

- [ ] **Step 2: Run it**

Paste into the Supabase SQL editor for the project in `SUPABASE_URL` and run. Then verify from the repo root:

```bash
node --env-file=.env.local --input-type=module -e '
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
for (const t of ["receipt_pings","recurring_merchants","tg_conversations"]) { const r = await sb.from(t).select("*").limit(1); console.log(t, r.error ? "ERR " + r.error.message : "ok"); }
const c = await sb.from("card_accounts").select("min_receipt_amount,pings_paused_until"); console.log(c.data);'
```

Expected: three `ok` lines and `[{ min_receipt_amount: 0, pings_paused_until: null }]`.

- [ ] **Step 3: Hourly cron**

`vercel.json` becomes:

```json
{
  "crons": [
    {
      "path": "/api/cron/tick",
      "schedule": "30 * * * *"
    }
  ]
}
```

- [ ] **Step 4: Gate the daily jobs to the 03:30 UTC tick**

In `app/api/cron/tick/route.js` replace the `JOBS` line and `jobsForToday`:

```js
const JOBS = ["sync", "ping", "rematch", "nudge", "harvest", "statement", "submit", "report", "mailboxes"];

/**
 * The cron fires every hour. Sync and the receipt ping run on every tick;
 * everything else belongs to the 03:30 UTC tick (09:00 IST), where it has
 * always run.
 */
function jobsForToday(day, card, hourUtc) {
  const due = ["sync", "ping"];
  if (hourUtc !== 3) return due;

  const statementDay = card?.statement_day ?? 18;
  const submitDay = card?.submit_day ?? 23;

  due.push("rematch", "nudge", "mailboxes");
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
  return due;
}
```

And at the call site change `const due = requested ? [requested] : jobsForToday(today, card);` to:

```js
    const due = requested ? [requested] : jobsForToday(today, card, new Date().getUTCHours());
```

Also update the header comment near line 23 that says the Hobby plan allows once-daily crons: replace that sentence with `The cron fires hourly (Vercel Pro); sync and ping run every tick, the rest at 03:30 UTC.`

- [ ] **Step 5: Build and commit**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | grep -E "✓ Compiled|rror"`
Expected: all pass; `✓ Compiled successfully`.

```bash
git add scripts/chat-migration.sql vercel.json app/api/cron/tick/route.js
git commit -m "Run the cron hourly and add the ping, recurring and conversation tables

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `lib/ping-plan.js` — which charges to ping, and the wording

**Files:**
- Create: `lib/ping-plan.js`
- Test: `tests/ping-plan.test.js`

**Interfaces:**
- Produces:
  - `selectPings({ transactions, pinged, recurring, pausedUntil, today, max = 5 }) → transaction[]` — `transactions` are candidate rows `{ id, merchant, amount, date, txn_time, is_refund, receipt_status }`; `pinged` is a `Set` of transaction ids already in `receipt_pings`; `recurring` a `Set` of merchant names; `pausedUntil` an ISO date or null; `today` ISO date. Returns newest-first (by `date` desc, then `id` desc), at most `max`.
  - `pingText(txn, { recurring }) → { text, keyboard }` — Telegram HTML and inline keyboard rows.
  - `INR(n) → string` — `₹1,23,456` (no decimals when whole, two otherwise).

- [ ] **Step 1: Write the failing tests**

```js
// tests/ping-plan.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPings, pingText, INR } from "../lib/ping-plan.js";

const t = (id, over = {}) => ({
  id, merchant: "Swiggy", amount: 1372, date: "2026-09-14", txn_time: "19:42",
  is_refund: false, receipt_status: "missing", ...over,
});

test("every missing charge is pinged, however small — nothing is waived", () => {
  const out = selectPings({
    transactions: [t(1, { amount: 50 }), t(2, { amount: 5000 })],
    pinged: new Set(), recurring: new Set(), pausedUntil: null, today: "2026-09-15",
  });
  assert.deepEqual(out.map((x) => x.id), [2, 1]);
});

test("refunds, attached, declared and already-pinged charges are skipped", () => {
  const out = selectPings({
    transactions: [
      t(1, { is_refund: true }),
      t(2, { receipt_status: "attached" }),
      t(3, { receipt_status: "declared" }),
      t(4),
      t(5),
    ],
    pinged: new Set([4]), recurring: new Set(), pausedUntil: null, today: "2026-09-15",
  });
  assert.deepEqual(out.map((x) => x.id), [5]);
});

test("a recurring merchant is still pinged", () => {
  const out = selectPings({
    transactions: [t(1, { merchant: "Netflix" })],
    pinged: new Set(), recurring: new Set(["Netflix"]), pausedUntil: null, today: "2026-09-15",
  });
  assert.equal(out.length, 1);
});

test("pings pause until the date given, inclusive", () => {
  const args = { transactions: [t(1)], pinged: new Set(), recurring: new Set() };
  assert.equal(selectPings({ ...args, pausedUntil: "2026-09-15", today: "2026-09-15" }).length, 0);
  assert.equal(selectPings({ ...args, pausedUntil: "2026-09-14", today: "2026-09-15" }).length, 1);
});

test("at most five per tick, newest first", () => {
  const txns = Array.from({ length: 8 }, (_, i) => t(i + 1, { date: `2026-09-0${i + 1}` }));
  const out = selectPings({ transactions: txns, pinged: new Set(), recurring: new Set(), pausedUntil: null, today: "2026-09-15" });
  assert.deepEqual(out.map((x) => x.id), [8, 7, 6, 5, 4]);
});

test("rupees are grouped the Indian way", () => {
  assert.equal(INR(1372), "₹1,372");
  assert.equal(INR(123456), "₹1,23,456");
  assert.equal(INR(9066.95), "₹9,066.95");
});

test("the ping names the charge and offers no-bill, subscription and later", () => {
  const { text, keyboard } = pingText(t(7), { recurring: new Set() });
  assert.match(text, /₹1,372/);
  assert.match(text, /Swiggy/);
  assert.match(text, /14 Sep 19:42/);
  assert.deepEqual(keyboard.flat().map((b) => b.callback_data), ["nb:7", "sub:7", "later:7"]);
});

test("a recurring merchant gets the emailed-invoice wording and no subscription button", () => {
  const { text, keyboard } = pingText(t(7, { merchant: "Netflix" }), { recurring: new Set(["Netflix"]) });
  assert.match(text, /harvester/i);
  assert.deepEqual(keyboard.flat().map((b) => b.callback_data), ["nb:7", "later:7"]);
});

test("merchant names are HTML-escaped", () => {
  const { text } = pingText(t(7, { merchant: "Kara <K&Y>" }), { recurring: new Set() });
  assert.match(text, /Kara &lt;K&amp;Y&gt;/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/ping-plan.test.js`
Expected: FAIL — `Cannot find module '.../lib/ping-plan.js'`.

- [ ] **Step 3: Write the module**

```js
// lib/ping-plan.js
/**
 * The decisions the receipt ping makes that need no database.
 *
 * A ping is one Telegram message per charge, sent within the hour of the
 * charge landing. Nothing is exempt: a ₹50 subscription needs its invoice as
 * much as a hotel does, so there is no amount threshold and no waiver — only
 * "no bill exists" (declared) and "ask me tomorrow".
 *
 * No @/ imports: node --test runs this file directly.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const INR = (n) => {
  const v = Number(n || 0);
  const whole = Number.isInteger(v);
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function when(txn) {
  const [y, m, d] = String(txn.date || "").split("-").map(Number);
  const day = d && m ? `${d} ${MONTHS[m - 1]}` : String(txn.date || "");
  return txn.txn_time ? `${day} ${String(txn.txn_time).slice(0, 5)}` : day;
}

export function selectPings({ transactions, pinged, recurring, pausedUntil, today, max = 5 }) {
  if (pausedUntil && String(pausedUntil).slice(0, 10) >= String(today).slice(0, 10)) return [];

  return (transactions || [])
    .filter((t) => !t.is_refund && t.receipt_status === "missing" && !pinged.has(t.id))
    .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id - a.id))
    .slice(0, max);
}

export function pingText(txn, { recurring }) {
  const isRecurring = recurring.has(txn.merchant);
  const head = `🧾 <b>${INR(txn.amount)}</b> · ${esc(txn.merchant)} · ${when(txn)}`;

  const body = isRecurring
    ? "Recurring — the invoice usually arrives by email and the harvester checks the 17th–23rd. Forward it here if it doesn't turn up."
    : "Send me the bill when you have it.";

  const row = [{ text: "🚫 No bill", callback_data: `nb:${txn.id}` }];
  if (!isRecurring) row.push({ text: "🔁 Subscription", callback_data: `sub:${txn.id}` });
  row.push({ text: "⏰ Later", callback_data: `later:${txn.id}` });

  return { text: `${head}\n${body}`, keyboard: [row] };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/ping-plan.test.js`
Expected: `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/ping-plan.js tests/ping-plan.test.js
git commit -m "Decide which charges to ping, and how to word it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `lib/ping.js` — the ping job, its buttons, and the digest exclusion

**Files:**
- Create: `lib/ping.js`
- Modify: `app/api/cron/tick/route.js` (import + `case "ping"`), `lib/tg-handlers.js:450-470` (`handleCallback` — new actions `nb`, `sub`, `later`, and the digest's legacy `dq`, `snooze`), `lib/nudge.js:34-51` (`outstanding` threshold), `lib/nudge.js:58-99` (`dailyNudge` exclusion)

**Interfaces:**
- Consumes: `selectPings`, `pingText`, `INR`, `esc` from `lib/ping-plan.js`; `sendMessage`, `editMessage`, `answerCallback` from `lib/telegram.js`; `getCardAccount` from `lib/cycles.js`.
- Produces:
  - `runPing(userId) → { sent: number, skipped?: string }`
  - `answerPing({ userId, chatId, messageId, action, transactionId }) → Promise<void>` — `action` ∈ `nb|sub|later`; performs the write, edits the message, records `receipt_pings.answer`.
  - `pingedTodayUnanswered(userId, today) → Set<number>` used by `dailyNudge`.

- [ ] **Step 1: Write `lib/ping.js`**

```js
// lib/ping.js
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage, editMessage } from "@/lib/telegram";
import { getCardAccount } from "@/lib/cycles";
import { logInfo, logWarn } from "@/lib/logger";
import { selectPings, pingText, INR, esc } from "@/lib/ping-plan";

/**
 * The receipt ping: one message per charge, within the hour.
 *
 * Runs on every cron tick right after sync. Anything sync just inserted and
 * has no receipt is asked about once; the answer buttons write straight to
 * transactions.receipt_status. The morning digest picks up whatever was
 * asked and not answered.
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

async function recurringFor(userId) {
  const { data } = await getSupabaseAdmin().from("recurring_merchants").select("merchant").eq("user_id", userId);
  return new Set((data || []).map((r) => r.merchant));
}

export async function runPing(userId) {
  const sb = getSupabaseAdmin();
  const chatId = await chatFor(userId);
  if (!chatId) return { sent: 0, skipped: "no linked chat" };

  const card = await getCardAccount(userId).catch(() => null);
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 26 * 3600e3).toISOString();

  const { data: candidates } = await sb
    .from("transactions")
    .select("id, merchant, amount, date, txn_time, is_refund, receipt_status")
    .eq("user_id", userId)
    .gte("created_at", since);

  const ids = (candidates || []).map((t) => t.id);
  const { data: already } = ids.length
    ? await sb.from("receipt_pings").select("transaction_id").in("transaction_id", ids)
    : { data: [] };

  const recurring = await recurringFor(userId);
  const chosen = selectPings({
    transactions: candidates || [],
    pinged: new Set((already || []).map((r) => r.transaction_id)),
    recurring,
    pausedUntil: card?.pings_paused_until || null,
    today,
  });

  let sent = 0;
  for (const txn of chosen) {
    const { text, keyboard } = pingText(txn, { recurring });
    try {
      const msg = await sendMessage(chatId, text, { keyboard });
      await sb.from("receipt_pings").insert({
        transaction_id: txn.id, user_id: userId, tg_message_id: msg?.message_id ?? null,
      });
      sent++;
    } catch (err) {
      await logWarn({ source: "ping", event: "send_failed", userId, message: `Ping for txn ${txn.id} failed: ${err.message}` });
    }
  }

  if (sent) await logInfo({ source: "ping", event: "sent", userId, message: `Pinged ${sent} charge(s)` });
  return { sent };
}

/** Transactions pinged today and still unanswered — the digest leaves those alone. */
export async function pingedTodayUnanswered(userId, today) {
  const { data } = await getSupabaseAdmin()
    .from("receipt_pings")
    .select("transaction_id")
    .eq("user_id", userId)
    .is("answered_at", null)
    .gte("sent_at", `${today}T00:00:00Z`);
  return new Set((data || []).map((r) => r.transaction_id));
}

export async function answerPing({ userId, chatId, messageId, action, transactionId }) {
  const sb = getSupabaseAdmin();
  const { data: txn } = await sb
    .from("transactions")
    .select("id, merchant, amount")
    .eq("id", transactionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!txn) return editMessage(chatId, messageId, "That charge is no longer here.");

  const label = `${INR(txn.amount)} ${esc(txn.merchant)}`;
  let answer, text;

  if (action === "nb") {
    await sb.from("transactions").update({ receipt_status: "declared", declared_reason: "no bill exists" }).eq("id", txn.id);
    answer = "no_bill";
    text = `Noted — no bill for ${label}.`;
  } else if (action === "sub") {
    await sb.from("recurring_merchants").upsert({ user_id: userId, merchant: txn.merchant }, { onConflict: "user_id,merchant" });
    answer = "subscription";
    text = `Noted as recurring — ${esc(txn.merchant)} invoices usually arrive by email; the harvester checks the 17th–23rd. Forward it here if it doesn't turn up. This charge still needs its invoice.`;
  } else {
    answer = "later";
    text = `Okay — ${label} goes in tomorrow's list.`;
  }

  await sb
    .from("receipt_pings")
    .upsert({ transaction_id: txn.id, user_id: userId, answered_at: new Date().toISOString(), answer }, { onConflict: "transaction_id" });
  await logInfo({ source: "ping", event: answer, userId, message: `${label} → ${answer}` });
  return editMessage(chatId, messageId, text);
}
```

Check `sendMessage`'s return: `grep -n "export async function sendMessage" -A14 lib/telegram.js`. If it returns the Telegram `result` object, `msg.message_id` is right; if it returns the whole envelope, use `msg?.result?.message_id`. Adjust that one expression.

- [ ] **Step 2: Wire the cron**

In `app/api/cron/tick/route.js` add `import { runPing } from "@/lib/ping";` beside the other lib imports, and in `runJob`'s switch, after `case "sync": {...}` add:

```js
    case "ping":
      return runPing(user.id);
```

- [ ] **Step 3: Handle the buttons**

In `lib/tg-handlers.js` add `import { answerPing } from "@/lib/ping";` and, inside `handleCallback`'s `try` before `if (action === "p")`, add:

```js
    // Receipt pings (and the morning digest's older dq/snooze buttons, which
    // never had a handler). Ids here are transaction ids.
    if (action === "nb" || action === "sub" || action === "later" || action === "dq" || action === "snooze") {
      await answerCallback(query.id);
      const mapped = action === "dq" ? "nb" : action === "snooze" ? "later" : action;
      if (!targetId) return editMessage(chatId, messageId, "Okay — I'll ask again tomorrow.");
      return answerPing({ userId, chatId, messageId, action: mapped, transactionId: Number(targetId) });
    }
```

- [ ] **Step 4: Drop the threshold from the digest and exclude today's pings**

In `lib/nudge.js`:
- `outstanding`: delete the `const minAmount = ...` line and the `.gte("amount", minAmount)` line.
- `dailyNudge`: add `import { pingedTodayUnanswered } from "@/lib/ping";` at the top, and after `const rows = await outstanding(...)` insert:

```js
  // Asked once already within the hour of the charge; the digest is for what
  // is still open from before, not a second nag the same morning.
  const asked = await pingedTodayUnanswered(userId, today);
  const due = rows.filter((t) => !asked.has(t.id));
```

and use `due` instead of `rows` for the rest of `dailyNudge` (the `if (!rows.length)` guard, `lines`, `more`, the message, the log, the return). `closingNudge` is unchanged.

Also in `lib/cycles.js` `cycleCoverage`, change `const minAmount = cycle?.card?.min_receipt_amount ?? 500;` to `?? 0` so coverage counts every charge, matching the spec.

- [ ] **Step 5: Verify, build, live-test**

Run: `grep -n "minAmount\|min_receipt" lib/nudge.js lib/cycles.js` → only the `?? 0` line in `cycles.js`. `npm test` → all pass. `npm run build` → clean.

Live (after deploy in Task 9, or on a `vercel dev` session): `GET /api/cron/tick?job=ping` with the cron bearer → `{ job: "ping", sent: N }` and N messages in Telegram with three buttons; press **Later** on one → message edits to "goes in tomorrow's list" and `receipt_pings.answer = 'later'`.

- [ ] **Step 6: Commit**

```bash
git add lib/ping.js app/api/cron/tick/route.js lib/tg-handlers.js lib/nudge.js lib/cycles.js
git commit -m "Ping every new charge on Telegram within the hour

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `chatWithTools` in `lib/llm.js`

**Files:**
- Modify: `lib/llm.js` (extract a `requestBody` helper shared with `chatJson`; add `chatWithTools`)
- Test: `tests/llm.test.js`

**Interfaces:**
- Produces: `chatWithTools({ ref, messages, tools, toolChoice = "auto", maxTokens = 2048, think = false, fetch }) → Promise<{ message: { role: "assistant", content: string|null, tool_calls?: [{ id, type: "function", function: { name, arguments: string } }] }, finishReason: string }>`. Throws like `chatJson` on non-2xx / missing choice.

- [ ] **Step 1: Write the failing tests** (append to `tests/llm.test.js`; `fakeFetch` and `ok` already exist there)

```js
test("chatWithTools sends tools and returns the assistant message with its tool_calls", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const call = { id: "call_1", type: "function", function: { name: "spend_summary", arguments: '{"period":"this_cycle"}' } };
  const { fetch, calls } = fakeFetch(() => ok({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call] } }] }));
  const tools = [{ type: "function", function: { name: "spend_summary", parameters: { type: "object" } } }];
  const res = await chatWithTools({ ref: "sarvam:sarvam-105b", messages: [{ role: "user", content: "hi" }], tools, fetch });
  assert.equal(res.finishReason, "tool_calls");
  assert.deepEqual(res.message.tool_calls, [call]);
  assert.deepEqual(calls[0].body.tools, tools);
  assert.equal(calls[0].body.tool_choice, "auto");
  assert.equal(calls[0].body.reasoning_effort, null);
  assert.equal(calls[0].body.max_tokens, 2048);
});

test("chatWithTools on openai uses max_completion_tokens and honours tool_choice none", async () => {
  process.env.OPENAI_API_KEY = "oa-test";
  const { fetch, calls } = fakeFetch(() => ok({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done" } }] }));
  const res = await chatWithTools({ ref: "openai:gpt-5.6", messages: [{ role: "user", content: "hi" }], tools: [], toolChoice: "none", fetch });
  assert.equal(res.message.content, "done");
  assert.equal(calls[0].body.max_completion_tokens, 2048);
  assert.equal(calls[0].body.tool_choice, "none");
  assert.equal("temperature" in calls[0].body, false);
});

test("chatWithTools reports a missing choice as an error", async () => {
  process.env.SARVAM_API_KEY = "sk-test";
  const { fetch } = fakeFetch(() => ok({ choices: [] }));
  await assert.rejects(chatWithTools({ ref: "sarvam:sarvam-105b", messages: [], tools: [], fetch }), /returned no message/);
});
```

Add `chatWithTools` to the import line at the top of the test file.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/llm.test.js`
Expected: the three new tests fail with `chatWithTools is not a function` (or import error).

- [ ] **Step 3: Refactor `chatJson`'s body construction into a helper and add `chatWithTools`**

In `lib/llm.js`, replace the section of `chatJson` from `const body = { model, messages };` through the `if (provider === "openai" && !think) body.reasoning_effort = "low";` line with a call to a new helper, and add `chatWithTools`:

```js
/**
 * The request both providers accept, with the three places they differ:
 * the token-ceiling field name, whether temperature may be sent, and how
 * reasoning is switched off.
 */
function requestBody({ provider, model, messages, maxTokens, temperature, think, tools, toolChoice }) {
  const body = { model, messages };
  if (provider === "sarvam") body.temperature = temperature;
  if (provider === "openai") body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;
  // Sarvam-105B thinks by default and its reasoning tokens come out of
  // max_tokens; OpenAI's reasoning models do the same from
  // max_completion_tokens. Structured work does not need it.
  if (!think) body.reasoning_effort = provider === "sarvam" ? null : "low";
  if (tools) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  return body;
}

async function post({ provider, model, body, fetch }) {
  const cfg = PROVIDERS[provider];
  const key = process.env[cfg.keyVar];
  if (!key) throw new Error(`${cfg.keyVar} is not set`);
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cfg.headers(key) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * One turn of a tool-calling conversation. The caller owns the loop: it runs
 * the tools named in `message.tool_calls`, appends `{ role: "tool" }` results
 * and calls again.
 */
export async function chatWithTools({
  ref, messages, tools, toolChoice = "auto", maxTokens = 2048, think = false, fetch = globalThis.fetch,
}) {
  const { provider, model } = parseModelRef(ref);
  const body = requestBody({ provider, model, messages, maxTokens, temperature: 0, think, tools, toolChoice });
  const json = await post({ provider, model, body, fetch });
  const choice = json?.choices?.[0];
  if (!choice?.message) throw new Error(`${provider} returned no message`);
  return { message: choice.message, finishReason: choice.finish_reason || "stop" };
}
```

`chatJson` then becomes: parse ref → build `messages` → `const body = requestBody({ provider, model, messages, maxTokens, temperature, think });` → `const json = await post({ provider, model, body, fetch });` → the existing choice/text/finish_reason checks unchanged. Read the current function first so the key check now inside `post` is not duplicated, and keep the existing error messages byte-for-byte (`tests/llm.test.js` asserts them).

- [ ] **Step 4: Run all llm tests**

Run: `node --test tests/llm.test.js`
Expected: all pass (13 = 10 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/llm.js tests/llm.test.js
git commit -m "Add a tool-calling turn to the chat door

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `lib/chat-periods.js` and `lib/chat-args.js` — pure resolution and validation

**Files:**
- Create: `lib/chat-periods.js`, `lib/chat-args.js`
- Test: `tests/chat-periods.test.js`, `tests/chat-args.test.js`

**Interfaces:**
- Produces:
  - `resolvePeriod(spec, { today, cycle }) → { start, end, label }` (ISO dates, inclusive) or throws `Error("Unknown period: ...")`. `cycle` is `{ cycle_start, cycle_end }` of the current cycle. Accepts: `this_cycle`, `last_cycle`, `YYYY-MM`, `last_N_days`, `YYYY-MM-DD..YYYY-MM-DD`, `today`, `yesterday`, English month names (`august`, `Aug`) meaning the most recent such month not after today, `this_month`, `last_month`.
  - `CATEGORIES` — the fixed list `["amazon","fuel","dining","swiggy","utilities","subscriptions","office","travel","other"]`.
  - `validateArgs(toolName, args) → { ok: true, args } | { ok: false, error }` — per-tool schema: integer ids ≥ 1, `top`/`limit` clamped 1..40, `category` from `CATEGORIES`, `period` strings non-empty, `until_date` an ISO date, merchants trimmed and 1..80 chars.

- [ ] **Step 1: Write the failing tests**

```js
// tests/chat-periods.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePeriod } from "../lib/chat-periods.js";

const ctx = { today: "2026-09-15", cycle: { cycle_start: "2026-08-17", cycle_end: "2026-09-16" } };

test("cycle-relative periods come from the current cycle", () => {
  assert.deepEqual(resolvePeriod("this_cycle", ctx), { start: "2026-08-17", end: "2026-09-16", label: "this cycle (17 Aug – 16 Sep)" });
  assert.deepEqual(resolvePeriod("last_cycle", ctx), { start: "2026-07-17", end: "2026-08-16", label: "last cycle (17 Jul – 16 Aug)" });
});

test("calendar months, by number or name, and relative months", () => {
  assert.deepEqual(resolvePeriod("2026-08", ctx), { start: "2026-08-01", end: "2026-08-31", label: "August 2026" });
  assert.equal(resolvePeriod("august", ctx).start, "2026-08-01");
  assert.equal(resolvePeriod("Aug", ctx).start, "2026-08-01");
  // A month name after today's month means last year's.
  assert.equal(resolvePeriod("december", ctx).start, "2025-12-01");
  assert.deepEqual(resolvePeriod("this_month", ctx), { start: "2026-09-01", end: "2026-09-30", label: "September 2026" });
  assert.deepEqual(resolvePeriod("last_month", ctx), { start: "2026-08-01", end: "2026-08-31", label: "August 2026" });
});

test("day windows", () => {
  assert.deepEqual(resolvePeriod("last_30_days", ctx), { start: "2026-08-17", end: "2026-09-15", label: "last 30 days" });
  assert.deepEqual(resolvePeriod("today", ctx), { start: "2026-09-15", end: "2026-09-15", label: "today" });
  assert.deepEqual(resolvePeriod("yesterday", ctx), { start: "2026-09-14", end: "2026-09-14", label: "yesterday" });
  assert.deepEqual(resolvePeriod("2026-08-01..2026-08-10", ctx), { start: "2026-08-01", end: "2026-08-10", label: "1 Aug – 10 Aug" });
});

test("a month boundary in a day window is handled", () => {
  assert.equal(resolvePeriod("last_7_days", { ...ctx, today: "2026-09-03" }).start, "2026-08-28");
});

test("unknown specs throw", () => {
  assert.throws(() => resolvePeriod("whenever", ctx), /Unknown period/);
  assert.throws(() => resolvePeriod("", ctx), /Unknown period/);
  assert.throws(() => resolvePeriod("2026-13", ctx), /Unknown period/);
});
```

```js
// tests/chat-args.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArgs, CATEGORIES } from "../lib/chat-args.js";

test("ids must be positive integers", () => {
  assert.equal(validateArgs("declare_no_bill", { transaction_id: 415 }).ok, true);
  assert.equal(validateArgs("declare_no_bill", { transaction_id: "415" }).args.transaction_id, 415);
  assert.match(validateArgs("declare_no_bill", { transaction_id: -1 }).error, /transaction_id/);
  assert.match(validateArgs("declare_no_bill", {}).error, /transaction_id/);
});

test("categories come from the fixed list", () => {
  assert.equal(CATEGORIES.includes("swiggy"), true);
  assert.equal(validateArgs("set_category", { transaction_id: 1, category: "dining" }).ok, true);
  assert.match(validateArgs("set_category", { transaction_id: 1, category: "food" }).error, /category/);
});

test("limits are clamped and defaulted", () => {
  assert.equal(validateArgs("spend_by_merchant", { period: "this_cycle" }).args.top, 10);
  assert.equal(validateArgs("spend_by_merchant", { period: "this_cycle", top: 500 }).args.top, 40);
  assert.equal(validateArgs("search_transactions", { limit: 0 }).args.limit, 1);
});

test("merchants are trimmed and bounded; dates must be ISO", () => {
  assert.equal(validateArgs("rename_merchant", { from: "  Zomato Limited ", to: "Zomato" }).args.from, "Zomato Limited");
  assert.match(validateArgs("rename_merchant", { from: "", to: "Zomato" }).error, /from/);
  assert.match(validateArgs("rename_merchant", { from: "a", to: "x".repeat(81) }).error, /to/);
  assert.equal(validateArgs("snooze_pings", { until_date: "2026-09-20" }).ok, true);
  assert.match(validateArgs("snooze_pings", { until_date: "next monday" }).error, /until_date/);
});

test("an unknown tool is rejected", () => {
  assert.match(validateArgs("drop_table", {}).error, /Unknown tool/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/chat-periods.test.js tests/chat-args.test.js`
Expected: both fail with `Cannot find module`.

- [ ] **Step 3: Write `lib/chat-periods.js`**

```js
// lib/chat-periods.js
/**
 * "This cycle", "August", "last 30 days" — turned into dates once, here, so
 * every tool agrees on what a period means. No @/ imports.
 */

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function shift(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthRange(y, m) {
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end, label: `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}` };
}

function dayLabel(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${SHORT[m - 1]}`;
}

function isIso(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

export function resolvePeriod(spec, { today, cycle }) {
  const s = String(spec ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const [ty, tm] = today.split("-").map(Number);

  if (s === "this_cycle" && cycle) {
    return { start: cycle.cycle_start, end: cycle.cycle_end, label: `this cycle (${dayLabel(cycle.cycle_start)} – ${dayLabel(cycle.cycle_end)})` };
  }
  if (s === "last_cycle" && cycle) {
    const end = shift(cycle.cycle_start, -1);
    const startDate = new Date(`${cycle.cycle_start}T00:00:00Z`);
    startDate.setUTCMonth(startDate.getUTCMonth() - 1);
    const start = startDate.toISOString().slice(0, 10);
    return { start, end, label: `last cycle (${dayLabel(start)} – ${dayLabel(end)})` };
  }
  if (s === "today") return { start: today, end: today, label: "today" };
  if (s === "yesterday") { const d = shift(today, -1); return { start: d, end: d, label: "yesterday" }; }
  if (s === "this_month") return monthRange(ty, tm);
  if (s === "last_month") return tm === 1 ? monthRange(ty - 1, 12) : monthRange(ty, tm - 1);

  let m;
  if ((m = /^last_(\d{1,3})_days$/.exec(s))) {
    const n = Number(m[1]);
    return { start: shift(today, -(n - 1)), end: today, label: `last ${n} days` };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) {
    const y = Number(m[1]), mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return monthRange(y, mo);
  }
  if ((m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(s)) && isIso(m[1]) && isIso(m[2])) {
    return { start: m[1], end: m[2], label: `${dayLabel(m[1])} – ${dayLabel(m[2])}` };
  }
  const idx = MONTHS.findIndex((name) => name === s || name.slice(0, 3) === s);
  if (idx >= 0) {
    const mo = idx + 1;
    return monthRange(mo > tm ? ty - 1 : ty, mo);
  }
  throw new Error(`Unknown period: ${JSON.stringify(spec)}`);
}
```

- [ ] **Step 4: Write `lib/chat-args.js`**

```js
// lib/chat-args.js
/**
 * What the model is allowed to ask a tool for. Nothing here touches data;
 * a bad argument becomes a tool error string the model can read and retry.
 */

export const CATEGORIES = ["amazon", "fuel", "dining", "swiggy", "utilities", "subscriptions", "office", "travel", "other"];

const id = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
};
const clamp = (v, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(40, Math.max(1, Math.trunc(n)));
};
const text = (v, name, { required = true, max = 80 } = {}) => {
  const s = String(v ?? "").trim();
  if (required && !s) throw new Error(`${name} is required`);
  if (s.length > max) throw new Error(`${name} is too long (max ${max})`);
  return s;
};
const isoDate = (v, name) => {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) throw new Error(`${name} must be YYYY-MM-DD`);
  return s;
};
const category = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!CATEGORIES.includes(s)) throw new Error(`category must be one of ${CATEGORIES.join(", ")}`);
  return s;
};
const optNumber = (v, name) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};

const SCHEMAS = {
  spend_summary: (a) => ({ period: text(a.period, "period", { max: 40 }) }),
  spend_by_merchant: (a) => ({ period: text(a.period, "period", { max: 40 }), top: clamp(a.top, 10) }),
  search_transactions: (a) => ({
    query: text(a.query, "query", { required: false }),
    period: text(a.period, "period", { required: false, max: 40 }) || "this_cycle",
    min_amount: optNumber(a.min_amount, "min_amount"),
    max_amount: optNumber(a.max_amount, "max_amount"),
    category: a.category ? category(a.category) : null,
    limit: clamp(a.limit, 20),
  }),
  missing_receipts: (a) => ({ period: text(a.period, "period", { required: false, max: 40 }) || "this_cycle" }),
  receipt_status: (a) => ({
    transaction_id: a.transaction_id != null ? id(a.transaction_id, "transaction_id") : null,
    merchant: text(a.merchant, "merchant", { required: false }),
    amount: optNumber(a.amount, "amount"),
  }),
  cycle_status: () => ({}),
  statement_summary: (a) => ({ which: text(a.which, "which", { required: false, max: 20 }) || "latest" }),
  subscriptions: () => ({}),
  compare_periods: (a) => ({ a: text(a.a, "a", { max: 40 }), b: text(a.b, "b", { max: 40 }) }),
  declare_no_bill: (a) => ({ transaction_id: id(a.transaction_id, "transaction_id") }),
  mark_recurring: (a) => ({ merchant: text(a.merchant, "merchant") }),
  rename_merchant: (a) => ({ from: text(a.from, "from"), to: text(a.to, "to") }),
  set_category: (a) => ({ transaction_id: id(a.transaction_id, "transaction_id"), category: category(a.category) }),
  snooze_pings: (a) => ({ until_date: isoDate(a.until_date, "until_date") }),
};

export const TOOL_NAMES = Object.keys(SCHEMAS);
export const WRITE_TOOLS = new Set(["declare_no_bill", "mark_recurring", "rename_merchant", "set_category", "snooze_pings"]);

export function validateArgs(toolName, args) {
  const schema = SCHEMAS[toolName];
  if (!schema) return { ok: false, error: `Unknown tool: ${toolName}` };
  try {
    return { ok: true, args: schema(args || {}) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `node --test tests/chat-periods.test.js tests/chat-args.test.js`
Expected: `ℹ pass 10`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib/chat-periods.js lib/chat-args.js tests/chat-periods.test.js tests/chat-args.test.js
git commit -m "Resolve chat periods and validate tool arguments without touching data

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `lib/chat-tools.js` — the tools, over Supabase

**Files:**
- Create: `lib/chat-tools.js`, `lib/merchant-alias.js`, `lib/subscriptions.js`
- Modify: `app/api/transactions/rename/route.js` (call `renameMerchant`), `app/components/subscriptions/aggregations.js` (re-export from `lib/subscriptions.js`)

**Interfaces:**
- Consumes: `resolvePeriod` (Task 5), `validateArgs`, `WRITE_TOOLS`, `TOOL_NAMES` (Task 5), `currentCycle`, `cycleCoverage` from `lib/cycles.js`, `INR` from `lib/ping-plan.js`.
- Produces:
  - `TOOL_DEFS` — the OpenAI-shaped `tools` array (name, description, JSON-schema parameters) for the 14 tools in Task 5's `SCHEMAS`.
  - `runTool({ userId, name, args, today }) → Promise<string>` — JSON string for the model. Read tools return data; write tools return `JSON.stringify({ confirm: { kind, summary, payload } })` and write nothing.
  - `executeWrite({ userId, kind, payload }) → Promise<string>` — performs a confirmed write, returns a one-line human summary.
  - `renameMerchant({ supabase, userId, from, to }) → { updated }` in `lib/merchant-alias.js`.
  - `buildSubscriptions`, `upcoming30Days` in `lib/subscriptions.js` (moved from the component, unchanged bodies; the component file becomes `export { buildSubscriptions, upcoming30Days, priceHikes, monthlyRamp, CYCLE_COLORS } from "@/lib/subscriptions";` after moving all of them — check `grep -rn "subscriptions/aggregations" app` for importers and keep every export they use).

- [ ] **Step 1: Extract `renameMerchant`**

```js
// lib/merchant-alias.js
/**
 * Renaming a merchant everywhere at once, and remembering the rename so the
 * next sync applies it too. Shared by the dashboard route and the chat tool.
 */
export async function renameMerchant({ supabase, userId, from, to }) {
  const { data: rows, error } = await supabase
    .from("transactions")
    .update({ merchant: to })
    .eq("user_id", userId)
    .eq("merchant", from)
    .select("id");
  if (error) throw error;

  const { error: aliasError } = await supabase
    .from("merchant_aliases")
    .upsert({ user_id: userId, original_merchant: from, alias: to }, { onConflict: "user_id,original_merchant" });
  // 42P01 = table doesn't exist; tolerate so rename still works without the table.
  if (aliasError && aliasError.code !== "42P01") throw aliasError;

  return { updated: rows?.length || 0, aliasStored: !aliasError };
}
```

In `app/api/transactions/rename/route.js`, replace the block from `const { data: updatedRows, error: updateError } = await supabase` through the `aliasError` check with:

```js
    const { updated, aliasStored } = await renameMerchant({ supabase, userId, from: fromName, to: toName });
    return NextResponse.json({ success: true, updated, aliasStored });
```

and add `import { renameMerchant } from "@/lib/merchant-alias";`. Delete the now-unused original `return NextResponse.json({ success: true, updated: ..., aliasStored: ... })`.

- [ ] **Step 2: Move the subscription aggregations**

Create `lib/subscriptions.js` containing the full current contents of `app/components/subscriptions/aggregations.js`, with its first line changed to `import { normalizeMerchant } from "@/app/components/overview/aggregations";`. Replace the contents of `app/components/subscriptions/aggregations.js` with:

```js
export { buildSubscriptions, CYCLE_COLORS, upcoming30Days, priceHikes, monthlyRamp } from "@/lib/subscriptions";
```

Run `grep -rn "subscriptions/aggregations" app` and confirm every imported name is in that export list; add any that are missing.

- [ ] **Step 3: Write `lib/chat-tools.js`**

```js
// lib/chat-tools.js
import { getSupabaseAdmin } from "@/lib/supabase";
import { currentCycle, cycleCoverage } from "@/lib/cycles";
import { resolvePeriod } from "@/lib/chat-periods";
import { validateArgs, WRITE_TOOLS, CATEGORIES } from "@/lib/chat-args";
import { renameMerchant } from "@/lib/merchant-alias";
import { buildSubscriptions, upcoming30Days } from "@/lib/subscriptions";

/**
 * Everything the chat model can know or do, as named tools.
 *
 * The model never sees a query. It asks a question by name with a few
 * arguments, gets back compact JSON scoped to the user the handler passed
 * in, and states what it found. Writes come back as a proposal the handler
 * turns into a Confirm button; nothing changes until that button is pressed.
 */

const MAX_ROWS = 40;

export const TOOL_DEFS = [
  tool("spend_summary", "Total spend, count and per-category totals for a period.", {
    period: periodParam(),
  }, ["period"]),
  tool("spend_by_merchant", "Spend grouped by merchant for a period, largest first.", {
    period: periodParam(), top: { type: "integer", description: "How many merchants, 1-40, default 10" },
  }, ["period"]),
  tool("search_transactions", "Find transactions by merchant/notes text, amount range, category, within a period.", {
    query: { type: "string", description: "Text to match in merchant or notes (optional)" },
    period: periodParam(), min_amount: { type: "number" }, max_amount: { type: "number" },
    category: { type: "string", enum: CATEGORIES }, limit: { type: "integer", description: "1-40, default 20" },
  }, []),
  tool("missing_receipts", "Charges still without a receipt in a period (default this cycle).", {
    period: periodParam(),
  }, []),
  tool("receipt_status", "Whether one charge has a receipt, by transaction id or by merchant and amount.", {
    transaction_id: { type: "integer" }, merchant: { type: "string" }, amount: { type: "number" },
  }, []),
  tool("cycle_status", "Current statement cycle: dates, receipt coverage, days to statement and to submission.", {}, []),
  tool("statement_summary", "The latest reconciled statement: totals, tie-out result, refunds.", {
    which: { type: "string", description: "'latest' (default)" },
  }, []),
  tool("subscriptions", "Recurring charges detected from history, with expected next dates.", {}, []),
  tool("compare_periods", "Totals and biggest movers between two periods.", {
    a: periodParam(), b: periodParam(),
  }, ["a", "b"]),
  tool("declare_no_bill", "Mark a charge as having no bill (asks for confirmation).", {
    transaction_id: { type: "integer" },
  }, ["transaction_id"]),
  tool("mark_recurring", "Tag a merchant as recurring so pings say the invoice is usually emailed (asks for confirmation).", {
    merchant: { type: "string" },
  }, ["merchant"]),
  tool("rename_merchant", "Rename a merchant everywhere and remember it for future syncs (asks for confirmation).", {
    from: { type: "string" }, to: { type: "string" },
  }, ["from", "to"]),
  tool("set_category", "Change one transaction's category (asks for confirmation).", {
    transaction_id: { type: "integer" }, category: { type: "string", enum: CATEGORIES },
  }, ["transaction_id", "category"]),
  tool("snooze_pings", "Pause receipt pings until a date (asks for confirmation).", {
    until_date: { type: "string", description: "YYYY-MM-DD" },
  }, ["until_date"]),
];

function tool(name, description, properties, required) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}
function periodParam() {
  return {
    type: "string",
    description: "this_cycle | last_cycle | this_month | last_month | YYYY-MM | a month name | last_N_days | today | yesterday | YYYY-MM-DD..YYYY-MM-DD",
  };
}

async function txnsIn(sb, userId, { start, end }, extra = (q) => q) {
  const { data } = await extra(
    sb.from("transactions")
      .select("id, merchant, amount, date, category, is_refund, receipt_status, notes")
      .eq("user_id", userId)
      .gte("date", start)
      .lte("date", end)
  ).order("date", { ascending: false }).limit(2000);
  return data || [];
}

const spent = (rows) => rows.filter((t) => !t.is_refund);
const sum = (rows) => Math.round(rows.reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100;
const trim = (rows) => (rows.length > MAX_ROWS ? { rows: rows.slice(0, MAX_ROWS), truncated: rows.length - MAX_ROWS } : { rows });

const READ = {
  async spend_summary({ sb, userId, ctx, args }) {
    const p = resolvePeriod(args.period, ctx);
    const rows = spent(await txnsIn(sb, userId, p));
    const by = {};
    for (const t of rows) by[t.category || "other"] = (by[t.category || "other"] || 0) + Number(t.amount);
    const refunds = sum((await txnsIn(sb, userId, p)).filter((t) => t.is_refund));
    return { period: p, total: sum(rows), count: rows.length, refunds, by_category: by };
  },
  async spend_by_merchant({ sb, userId, ctx, args }) {
    const p = resolvePeriod(args.period, ctx);
    const rows = spent(await txnsIn(sb, userId, p));
    const by = {};
    for (const t of rows) { const k = t.merchant; by[k] = by[k] || { merchant: k, total: 0, count: 0 }; by[k].total += Number(t.amount); by[k].count++; }
    const list = Object.values(by).sort((a, b) => b.total - a.total).slice(0, args.top).map((m) => ({ ...m, total: Math.round(m.total * 100) / 100 }));
    return { period: p, merchants: list };
  },
  async search_transactions({ sb, userId, ctx, args }) {
    const p = resolvePeriod(args.period, ctx);
    const rows = await txnsIn(sb, userId, p, (q) => {
      if (args.query) q = q.or(`merchant.ilike.%${args.query}%,notes.ilike.%${args.query}%`);
      if (args.min_amount != null) q = q.gte("amount", args.min_amount);
      if (args.max_amount != null) q = q.lte("amount", args.max_amount);
      if (args.category) q = q.eq("category", args.category);
      return q;
    });
    return { period: p, ...trim(rows.slice(0, args.limit)) };
  },
  async missing_receipts({ sb, userId, ctx, args }) {
    const p = resolvePeriod(args.period, ctx);
    const rows = (await txnsIn(sb, userId, p)).filter((t) => !t.is_refund && t.receipt_status === "missing");
    return { period: p, total_missing: sum(rows), ...trim(rows.map(({ id, merchant, amount, date }) => ({ id, merchant, amount, date }))) };
  },
  async receipt_status({ sb, userId, args }) {
    let q = sb.from("transactions").select("id, merchant, amount, date, receipt_status, declared_reason").eq("user_id", userId);
    if (args.transaction_id) q = q.eq("id", args.transaction_id);
    else {
      if (!args.merchant && args.amount == null) return { error: "give a transaction_id, or a merchant and/or amount" };
      if (args.merchant) q = q.ilike("merchant", `%${args.merchant}%`);
      if (args.amount != null) q = q.eq("amount", args.amount);
    }
    const { data } = await q.order("date", { ascending: false }).limit(10);
    return { matches: data || [] };
  },
  async cycle_status({ userId, ctx }) {
    const cycle = ctx.cycle;
    if (!cycle) return { error: "no card configured" };
    const cov = await cycleCoverage(userId, cycle);
    const days = (iso) => Math.ceil((new Date(`${iso}T00:00:00Z`) - new Date(`${ctx.today}T00:00:00Z`)) / 86400e3);
    return {
      cycle_start: cycle.cycle_start, cycle_end: cycle.cycle_end, status: cycle.status,
      days_to_statement: days(cycle.cycle_end), submit_day: cycle.card?.submit_day ?? null,
      coverage: cov,
    };
  },
  async statement_summary({ sb, userId }) {
    const { data: st } = await sb.from("statements")
      .select("id, issued_on, status, period_start, period_end, opening_balance, closing_balance, total_debits, total_credits, minimum_due, due_date, control")
      .eq("user_id", userId).order("issued_on", { ascending: false }).limit(1).maybeSingle();
    if (!st) return { error: "no statement on file yet" };
    const { data: lines } = await sb.from("statement_lines").select("direction, amount").eq("statement_id", st.id);
    const credits = (lines || []).filter((l) => l.direction === "credit");
    return { ...st, line_count: (lines || []).length, credit_lines: credits.length, credit_total: sum(credits) };
  },
  async subscriptions({ sb, userId, ctx }) {
    const { data } = await sb.from("transactions").select("merchant, amount, date, category, is_refund").eq("user_id", userId).order("date", { ascending: false }).limit(3000);
    const subs = buildSubscriptions((data || []).map((t) => ({ ...t, isRefund: t.is_refund })));
    return { subscriptions: subs.slice(0, MAX_ROWS), upcoming_30_days: upcoming30Days(subs, new Date(`${ctx.today}T00:00:00Z`)) };
  },
  async compare_periods({ sb, userId, ctx, args }) {
    const A = await READ.spend_by_merchant({ sb, userId, ctx, args: { period: args.a, top: 40 } });
    const B = await READ.spend_by_merchant({ sb, userId, ctx, args: { period: args.b, top: 40 } });
    const totals = { a: sum(A.merchants.map((m) => ({ amount: m.total }))), b: sum(B.merchants.map((m) => ({ amount: m.total }))) };
    const byName = {};
    for (const m of A.merchants) byName[m.merchant] = { merchant: m.merchant, a: m.total, b: 0 };
    for (const m of B.merchants) (byName[m.merchant] ||= { merchant: m.merchant, a: 0, b: 0 }).b = m.total;
    const movers = Object.values(byName).map((x) => ({ ...x, delta: Math.round((x.b - x.a) * 100) / 100 }))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 10);
    return { a: A.period, b: B.period, totals, delta: Math.round((totals.b - totals.a) * 100) / 100, movers };
  },
};

const PROPOSE = {
  async declare_no_bill({ sb, userId, args }) {
    const { data: t } = await sb.from("transactions").select("id, merchant, amount, date").eq("id", args.transaction_id).eq("user_id", userId).maybeSingle();
    if (!t) return { error: `no transaction ${args.transaction_id}` };
    return { confirm: { kind: "declare_no_bill", summary: `Mark ₹${t.amount} ${t.merchant} (${t.date}) as having no bill`, payload: { transaction_id: t.id } } };
  },
  async mark_recurring({ args }) {
    return { confirm: { kind: "mark_recurring", summary: `Tag "${args.merchant}" as recurring (pings will say the invoice is usually emailed; receipts are still required)`, payload: { merchant: args.merchant } } };
  },
  async rename_merchant({ sb, userId, args }) {
    const { count } = await sb.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("merchant", args.from);
    if (!count) return { error: `no transactions named exactly "${args.from}"` };
    return { confirm: { kind: "rename_merchant", summary: `Rename "${args.from}" → "${args.to}" on ${count} transaction(s) and remember it`, payload: { from: args.from, to: args.to } } };
  },
  async set_category({ sb, userId, args }) {
    const { data: t } = await sb.from("transactions").select("id, merchant, amount, category").eq("id", args.transaction_id).eq("user_id", userId).maybeSingle();
    if (!t) return { error: `no transaction ${args.transaction_id}` };
    return { confirm: { kind: "set_category", summary: `Change ₹${t.amount} ${t.merchant} from ${t.category} to ${args.category}`, payload: { transaction_id: t.id, category: args.category } } };
  },
  async snooze_pings({ args }) {
    return { confirm: { kind: "snooze_pings", summary: `Pause receipt pings until ${args.until_date}`, payload: { until_date: args.until_date } } };
  },
};

export async function runTool({ userId, name, args, today = new Date().toISOString().slice(0, 10) }) {
  const v = validateArgs(name, args);
  if (!v.ok) return JSON.stringify({ error: v.error });
  const sb = getSupabaseAdmin();
  const cycle = await currentCycle(userId).catch(() => null);
  const ctx = { today, cycle };
  try {
    const fn = WRITE_TOOLS.has(name) ? PROPOSE[name] : READ[name];
    return JSON.stringify(await fn({ sb, userId, ctx, args: v.args }));
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

export async function executeWrite({ userId, kind, payload }) {
  const sb = getSupabaseAdmin();
  switch (kind) {
    case "declare_no_bill":
      await sb.from("transactions").update({ receipt_status: "declared", declared_reason: "no bill exists" }).eq("id", payload.transaction_id).eq("user_id", userId);
      return "Marked as no bill.";
    case "mark_recurring":
      await sb.from("recurring_merchants").upsert({ user_id: userId, merchant: payload.merchant }, { onConflict: "user_id,merchant" });
      return `"${payload.merchant}" tagged as recurring.`;
    case "rename_merchant": {
      const r = await renameMerchant({ supabase: sb, userId, from: payload.from, to: payload.to });
      return `Renamed on ${r.updated} transaction(s).`;
    }
    case "set_category":
      await sb.from("transactions").update({ category: payload.category }).eq("id", payload.transaction_id).eq("user_id", userId);
      return `Category set to ${payload.category}.`;
    case "snooze_pings": {
      const { data: card } = await sb.from("card_accounts").select("id").eq("user_id", userId).maybeSingle();
      if (card) await sb.from("card_accounts").update({ pings_paused_until: payload.until_date }).eq("id", card.id);
      return `Pings paused until ${payload.until_date}.`;
    }
    default:
      throw new Error(`unknown write ${kind}`);
  }
}
```

Before relying on `statement_summary`'s column list, run `grep -n "control\|opening_balance\|due_date" scripts/receipt-rail-migration.sql` and trim the `select` to columns that exist.

- [ ] **Step 4: Build, then smoke the tools by hand**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | grep -E "✓ Compiled|rror"`.

Then, from the repo root:

```bash
cat > scripts/_tools-smoke.js <<'EOF'
const { register } = require("esbuild-register/dist/node"); register();
const { runTool } = require("../lib/chat-tools.js");
const U = "115105472683255155618";
(async () => {
  for (const [name, args] of [
    ["cycle_status", {}], ["spend_summary", { period: "this_cycle" }], ["spend_by_merchant", { period: "august", top: 5 }],
    ["missing_receipts", {}], ["search_transactions", { query: "swiggy", period: "last_30_days" }],
    ["statement_summary", {}], ["subscriptions", {}], ["compare_periods", { a: "last_cycle", b: "this_cycle" }],
    ["declare_no_bill", { transaction_id: 1 }], ["snooze_pings", { until_date: "2026-09-20" }],
  ]) console.log(name, (await runTool({ userId: U, name, args })).slice(0, 300));
})();
EOF
node --env-file=.env.local scripts/_tools-smoke.js; rm scripts/_tools-smoke.js
```

Expected: every line prints JSON without `"error"` except `declare_no_bill` (transaction 1 may not be yours → an error string, which is the right answer) — and write tools print `{"confirm":...}`, never a change.

- [ ] **Step 5: Commit**

```bash
git add lib/chat-tools.js lib/merchant-alias.js lib/subscriptions.js app/api/transactions/rename/route.js app/components/subscriptions/aggregations.js
git commit -m "Give the chat model named tools over the user's own data

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `lib/chat-agent.js` — the loop, memory, confirmations

**Files:**
- Create: `lib/chat-agent.js`, `lib/chat-prompt.js`
- Test: `tests/chat-prompt.test.js`

**Interfaces:**
- Consumes: `chatWithTools` (Task 4), `TOOL_DEFS`, `runTool`, `executeWrite` (Task 6), `currentCycle`, `sendMessage`/`editMessage`.
- Produces:
  - `chatTurn({ userId, chatId, text }) → Promise<void>` — replies on Telegram itself.
  - `confirmWrite({ userId, chatId, messageId, confirmId }) → Promise<void>` and `cancelWrite(...)` — used by the callback handler (Task 8). Pending confirmations live in `tg_conversations` as a `tool` row with `tool_call_id = "confirm:<uuid>"` and `content` = the JSON `{ kind, payload, summary }`, so no extra table.
  - `lib/chat-prompt.js`: `systemPrompt({ today, cycle, cardLabel }) → string` and `splitTelegram(text, max = 3900) → string[]` — pure, tested.

- [ ] **Step 1: Write the failing test**

```js
// tests/chat-prompt.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { systemPrompt, splitTelegram } from "../lib/chat-prompt.js";

test("the system prompt states the date, the cycle and the rules that matter", () => {
  const p = systemPrompt({ today: "2026-09-15", cycle: { cycle_start: "2026-08-17", cycle_end: "2026-09-16" }, cardLabel: "HDFC Corporate ···7634" });
  assert.match(p, /2026-09-15/);
  assert.match(p, /2026-08-17/);
  assert.match(p, /HDFC Corporate/);
  assert.match(p, /every number.*tool/i);
  assert.match(p, /HTML/);
  assert.match(p, /₹1,23,456/);
});

test("long replies split at line breaks under Telegram's cap", () => {
  const line = "x".repeat(100);
  const text = Array.from({ length: 50 }, () => line).join("\n");
  const parts = splitTelegram(text, 1000);
  assert.ok(parts.length >= 5);
  for (const p of parts) assert.ok(p.length <= 1000);
  assert.equal(parts.join("\n"), text);
});

test("a short reply is one part", () => {
  assert.deepEqual(splitTelegram("hello"), ["hello"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/chat-prompt.test.js` → `Cannot find module`.

- [ ] **Step 3: Write `lib/chat-prompt.js`**

```js
// lib/chat-prompt.js
/**
 * What the assistant is told about itself. Kept short: the tools carry the
 * knowledge, the prompt carries the manners. No @/ imports.
 */

export function systemPrompt({ today, cycle, cardLabel }) {
  const cycleLine = cycle
    ? `The current statement cycle runs ${cycle.cycle_start} to ${cycle.cycle_end}.`
    : "No card is configured yet.";
  return [
    `You are the Receipt Rail assistant on Telegram for one person's corporate card (${cardLabel}). Today is ${today}. ${cycleLine} Amounts are INR unless a tool says otherwise.`,
    "Every number you state must come from a tool call in this conversation — never estimate, never recall from earlier turns. If a tool returns an error, say what you could not look up.",
    "Reply in Telegram HTML: <b>bold</b>, <i>italic</i>, <code>code</code>; no Markdown, no headings. Format rupees with Indian grouping (₹1,23,456). Keep it under 12 lines unless a list was asked for; lead with the answer, then the detail.",
    "For advice questions (overspending, budgeting), answer from the aggregates you fetched and show the numbers; do not invent benchmarks.",
    "Write tools only propose; the user confirms with a button. After proposing, say what will happen and stop.",
    "If the user writes in Hinglish or Hindi, answer the same way.",
  ].join("\n\n");
}

export function splitTelegram(text, max = 3900) {
  const s = String(text ?? "");
  if (s.length <= max) return [s];
  const parts = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut + (rest[cut] === "\n" ? 1 : 0));
  }
  parts.push(rest);
  return parts;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/chat-prompt.test.js` → `ℹ pass 3`.

- [ ] **Step 5: Write `lib/chat-agent.js`**

```js
// lib/chat-agent.js
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { chatWithTools } from "@/lib/llm";
import { TOOL_DEFS, runTool, executeWrite } from "@/lib/chat-tools";
import { systemPrompt, splitTelegram } from "@/lib/chat-prompt";
import { currentCycle } from "@/lib/cycles";
import { sendMessage, editMessage } from "@/lib/telegram";
import { logInfo, logWarn, logError } from "@/lib/logger";

/**
 * A question in, an answer out, with tools in between.
 *
 * Sarvam-105B first; if any step of the turn throws, the whole turn is retried
 * once on GPT with the same messages. The model proposes writes; the Confirm
 * button performs them.
 */

const CHAT_MODEL = process.env.CHAT_MODEL || "sarvam:sarvam-105b";
const CHAT_MODEL_FALLBACK = process.env.CHAT_MODEL_FALLBACK || "openai:gpt-5.6";
const HISTORY = 20;
const MAX_TOOL_CALLS = 6;

async function history(chatId) {
  const { data } = await getSupabaseAdmin()
    .from("tg_conversations")
    .select("role, content, tool_calls, tool_call_id")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  const rows = (data || []).reverse();
  // A tool result whose call fell off the window would be an orphan the API
  // rejects; drop leading tool rows.
  while (rows.length && rows[0].role === "tool") rows.shift();
  return rows.map((r) => {
    if (r.role === "tool") return { role: "tool", tool_call_id: r.tool_call_id, content: r.content || "" };
    if (r.role === "assistant" && r.tool_calls) return { role: "assistant", content: r.content, tool_calls: r.tool_calls };
    return { role: r.role, content: r.content || "" };
  });
}

async function remember(chatId, userId, rows) {
  if (!rows.length) return;
  await getSupabaseAdmin().from("tg_conversations").insert(
    rows.map((m) => ({
      chat_id: chatId, user_id: userId, role: m.role, content: m.content ?? null,
      tool_calls: m.tool_calls ?? null, tool_call_id: m.tool_call_id ?? null,
    }))
  );
}

async function runLoop({ ref, userId, system, prior, userText, today }) {
  const messages = [{ role: "system", content: system }, ...prior, { role: "user", content: userText }];
  const fresh = [{ role: "user", content: userText }];
  let confirm = null;
  let calls = 0;

  for (;;) {
    const exhausted = calls >= MAX_TOOL_CALLS;
    const { message } = await chatWithTools({
      ref, messages, tools: TOOL_DEFS, toolChoice: exhausted ? "none" : "auto", maxTokens: 2048, think: false,
    });
    messages.push(message);
    fresh.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls ?? null });

    if (!message.tool_calls?.length || exhausted) return { text: message.content || "", fresh, confirm };

    for (const tc of message.tool_calls) {
      calls++;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
      const result = await runTool({ userId, name: tc.function.name, args, today });
      const parsed = JSON.parse(result);
      if (parsed.confirm && !confirm) confirm = parsed.confirm;
      const toolMsg = { role: "tool", tool_call_id: tc.id, content: result };
      messages.push(toolMsg);
      fresh.push(toolMsg);
    }
  }
}

export async function chatTurn({ userId, chatId, text }) {
  const today = new Date().toISOString().slice(0, 10);
  const cycle = await currentCycle(userId).catch(() => null);
  const cardLabel = cycle?.card ? `${cycle.card.label} ···${cycle.card.last4}` : "corporate card";
  const system = systemPrompt({ today, cycle, cardLabel });
  const prior = await history(chatId);

  let out = null;
  for (const ref of [CHAT_MODEL, CHAT_MODEL_FALLBACK]) {
    try {
      out = await runLoop({ ref, userId, system, prior, userText: text, today });
      await logInfo({ source: "chat", event: "turn", userId, message: `${ref}: ${text.slice(0, 80)}` });
      break;
    } catch (err) {
      await logWarn({ source: "chat", event: "model_failed", userId, message: `${ref}: ${err.message.slice(0, 200)}` });
    }
  }

  if (!out) {
    await logError({ source: "chat", event: "turn_failed", userId, message: `Both models failed for: ${text.slice(0, 80)}` });
    return sendMessage(chatId, "I couldn't look that up just now. Try again in a minute.");
  }

  await remember(chatId, userId, out.fresh);

  if (out.confirm) {
    const confirmId = crypto.randomUUID();
    await remember(chatId, userId, [{ role: "tool", tool_call_id: `confirm:${confirmId}`, content: JSON.stringify(out.confirm) }]);
    const summary = out.text?.trim() || out.confirm.summary;
    return sendMessage(chatId, `${summary}\n\n<i>${out.confirm.summary}</i>`, {
      keyboard: [[
        { text: "✅ Confirm", callback_data: `cf:${confirmId}` },
        { text: "✖ Cancel", callback_data: `cx:${confirmId}` },
      ]],
    });
  }

  for (const part of splitTelegram(out.text || "…")) await sendMessage(chatId, part);
}

async function pending(chatId, confirmId) {
  const { data } = await getSupabaseAdmin()
    .from("tg_conversations")
    .select("id, user_id, content")
    .eq("chat_id", chatId)
    .eq("tool_call_id", `confirm:${confirmId}`)
    .maybeSingle();
  return data ? { row: data, confirm: JSON.parse(data.content) } : null;
}

export async function confirmWrite({ userId, chatId, messageId, confirmId }) {
  const p = await pending(chatId, confirmId);
  if (!p || p.row.user_id !== userId) return editMessage(chatId, messageId, "That confirmation has expired.");
  const done = await executeWrite({ userId, kind: p.confirm.kind, payload: p.confirm.payload });
  await getSupabaseAdmin().from("tg_conversations").delete().eq("id", p.row.id);
  await remember(chatId, userId, [{ role: "user", content: `[confirmed: ${p.confirm.summary}]` }, { role: "assistant", content: done }]);
  await logInfo({ source: "chat", event: "write", userId, message: `${p.confirm.kind}: ${p.confirm.summary}` });
  return editMessage(chatId, messageId, `✅ ${done}`);
}

export async function cancelWrite({ userId, chatId, messageId, confirmId }) {
  const p = await pending(chatId, confirmId);
  if (p && p.row.user_id === userId) await getSupabaseAdmin().from("tg_conversations").delete().eq("id", p.row.id);
  return editMessage(chatId, messageId, "Cancelled — nothing changed.");
}
```

- [ ] **Step 6: Build and commit**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | grep -E "✓ Compiled|rror"`.

```bash
git add lib/chat-agent.js lib/chat-prompt.js tests/chat-prompt.test.js
git commit -m "Run a tool-calling chat turn with memory and confirmed writes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire chat into the bot

**Files:**
- Modify: `lib/tg-handlers.js` (`HELP`, the plain-text branch of `handleMessage`, `handleCallback` for `cf`/`cx`)

**Interfaces:**
- Consumes: `chatTurn`, `confirmWrite`, `cancelWrite` (Task 7).

- [ ] **Step 1: Help text**

In `HELP`, after the `"/statement — how the last statement reconciled",` line add:

```js
  "",
  "Or just ask — <i>how much on Swiggy this cycle?</i>, <i>what's still missing a receipt?</i>, <i>rename NLOVKLJ to Netflix</i>.",
```

- [ ] **Step 2: Route plain text to the agent**

Replace the final block of `handleMessage`:

```js
  if (text) {
    return sendMessage(
      chatId,
      "Send me a photo of a bill, or use /status to see where this cycle stands. /help for everything."
    );
  }
```

with:

```js
  if (text.startsWith("/")) {
    return sendMessage(chatId, "I don't know that command. /help lists them — or just ask me in plain words.");
  }
  if (text) return chatTurn({ userId, chatId, text });
```

and add `import { chatTurn, confirmWrite, cancelWrite } from "@/lib/chat-agent";`.

- [ ] **Step 3: Confirm / cancel callbacks**

In `handleCallback`, next to the ping block from Task 3, add:

```js
    if (action === "cf" || action === "cx") {
      await answerCallback(query.id);
      const fn = action === "cf" ? confirmWrite : cancelWrite;
      return fn({ userId, chatId, messageId, confirmId: targetId });
    }
```

- [ ] **Step 4: Build, commit**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | grep -E "✓ Compiled|rror"`.

```bash
git add lib/tg-handlers.js
git commit -m "Answer plain questions in the Telegram bot

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Replay, deploy, live check

**Files:**
- Create: `scripts/replay-chat.js`

- [ ] **Step 1: The replay script**

```js
#!/usr/bin/env node
/* Twenty questions through the chat loop on both models, answers side by side.
 * Prints only; nothing is written and no Telegram message is sent.
 * Usage: node --env-file=.env.local scripts/replay-chat.js
 */
const { register } = require("esbuild-register/dist/node"); register();
const { chatWithTools } = require("../lib/llm.js");
const { TOOL_DEFS, runTool } = require("../lib/chat-tools.js");
const { systemPrompt } = require("../lib/chat-prompt.js");
const { currentCycle } = require("../lib/cycles.js");

const USER_ID = "115105472683255155618";
const QUESTIONS = [
  "how much did I spend this cycle?", "top 5 merchants in August", "what's still missing a receipt?",
  "when is the statement due?", "how much on swiggy and zomato last 30 days?", "did the last statement tie out?",
  "what subscriptions am I paying for?", "compare this cycle with last cycle", "biggest charge in July",
  "any refunds this cycle?", "show me the uber rides in august", "how much did the europe trip cost? (august, non-INR merchants)",
  "am I overspending on food?", "is there a receipt for the 9066.95 openai charge?", "kitna kharcha hua is mahine?",
  "mark the 20 rupee blinkit charge as no bill", "rename NLOVKLJ4LBGYBAYJZY to Netflix", "pause pings till sunday",
  "what did I spend on 2026-09-09?", "how many transactions in this cycle are under 100 rupees?",
];

async function ask(ref, q, system, today) {
  const messages = [{ role: "system", content: system }, { role: "user", content: q }];
  const calls = [];
  for (let i = 0; i < 8; i++) {
    const { message } = await chatWithTools({ ref, messages, tools: TOOL_DEFS, toolChoice: i >= 6 ? "none" : "auto", think: false });
    messages.push(message);
    if (!message.tool_calls?.length) return { text: message.content, calls };
    for (const tc of message.tool_calls) {
      let args = {}; try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
      calls.push(`${tc.function.name}(${JSON.stringify(args)})`);
      messages.push({ role: "tool", tool_call_id: tc.id, content: await runTool({ userId: USER_ID, name: tc.function.name, args, today }) });
    }
  }
  return { text: "(no final answer)", calls };
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const cycle = await currentCycle(USER_ID);
  const system = systemPrompt({ today, cycle, cardLabel: "HDFC Corporate ···7634" });
  for (const q of QUESTIONS) {
    console.log(`\n=== ${q}`);
    for (const ref of ["sarvam:sarvam-105b", "openai:gpt-5.6"]) {
      const t0 = Date.now();
      try {
        const { text, calls } = await ask(ref, q, system, today);
        console.log(`--- ${ref} (${Math.round((Date.now() - t0) / 1000)}s) tools: ${calls.join(" · ") || "none"}\n${text}`);
      } catch (err) {
        console.log(`--- ${ref} FAILED: ${err.message.slice(0, 200)}`);
      }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it and read every answer**

Run: `node --env-file=.env.local scripts/replay-chat.js 2>&1 | grep -v Warning > /tmp/replay-chat.out; less /tmp/replay-chat.out`

Pass criteria: on Sarvam, every question calls at least one tool (the "am I overspending" one may reason from `spend_summary` + `compare_periods`), no answer states a number that is not in a tool result, the three write questions end in a `confirm` proposal, and Hinglish gets a Hinglish reply. Where Sarvam picks the wrong tool or period, fix the tool `description` or the period param text in `lib/chat-tools.js` (that is the prompt for tool choice), rerun, commit the tweak with the replay note in the message.

- [ ] **Step 3: Vercel env, deploy**

Run: `vercel env ls production | grep -E "CHAT_MODEL"` — expected empty (defaults apply). Nothing to add.

Merge to `main` and push (the branch this was built on is the working branch; use `git checkout main && git merge --no-edit <branch> && git push origin main`). Watch `vercel ls --prod` until `● Ready`.

- [ ] **Step 4: Live check**

1. `GET https://vippy-spend-tracker.vercel.app/api/cron/tick?job=ping` with `Authorization: Bearer $CRON_SECRET` → `sent: N` and N Telegram messages with **No bill / Subscription / Later**. Press **Later** on one; message edits.
2. In Telegram: "how much on swiggy this cycle?" → an answer with a rupee figure; `app_logs` has a `chat turn` row naming `sarvam:sarvam-105b`.
3. "rename NLOVKLJ4LBGYBAYJZY to Netflix" → proposal with Confirm/Cancel; press Confirm → "✅ Renamed on N transaction(s)." and the dashboard shows Netflix.
4. Wait for the next hourly tick (`:30` past) — no daily jobs ran (`app_logs` shows `sync` and `ping` only for that tick).

- [ ] **Step 5: Commit the script**

```bash
git add scripts/replay-chat.js
git commit -m "Add a replay that asks the chat twenty questions on both models

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
