-- ============================================================================
-- Receipt Rail — Phase 0 migration
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- Adds: receipt capture, matching, statement reconciliation, submissions.
-- Changes nothing about how existing transactions/sync behave.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Fix: app_logs.user_id is uuid, but user ids are Google `sub` strings.
--    Every user-scoped log write has been failing silently (logger swallows
--    its own errors). Widen to text so diagnostics actually land.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'app_logs' and column_name = 'user_id' and data_type = 'uuid'
  ) then
    alter table app_logs alter column user_id type text using user_id::text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Card accounts — one row per physical card
-- ---------------------------------------------------------------------------
create table if not exists card_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            text not null,
  entity_name        text not null default 'VIP Industries Limited',
  label              text not null default 'HDFC Corporate',
  last4              text,
  statement_day      int  not null default 18,   -- day the statement is issued
  submit_day         int  not null default 23,   -- day the package goes to accounts
  grace_days         int  not null default 5,
  accounts_email     text[] not null default '{}',
  cc_email           text[] not null default '{}',
  statement_password text,                        -- for HDFC's encrypted PDF
  forex_markup_pct   numeric not null default 3.5,
  forex_gst_pct      numeric not null default 18,
  min_receipt_amount numeric not null default 500,
  created_at         timestamptz not null default now(),
  unique (user_id, last4)
);

-- ---------------------------------------------------------------------------
-- 2. Trips — groups foreign spend for travel claims
-- ---------------------------------------------------------------------------
create table if not exists trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  name       text not null,
  countries  text[] not null default '{}',
  start_date date not null,
  end_date   date not null,
  created_at timestamptz not null default now()
);
create index if not exists trips_user_dates_idx on trips (user_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- 3. Statement cycles — materialised, frozen once submitted
-- ---------------------------------------------------------------------------
create table if not exists statement_cycles (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  card_account_id uuid not null references card_accounts(id) on delete cascade,
  cycle_start     date not null,
  cycle_end       date not null,
  status          text not null default 'open'
                  check (status in ('open','closing','verified','submitted')),
  created_at      timestamptz not null default now(),
  unique (card_account_id, cycle_start)
);
create index if not exists statement_cycles_user_idx on statement_cycles (user_id, cycle_end desc);

-- ---------------------------------------------------------------------------
-- 4. Statements — the bank's own ledger; the spine of a submission
-- ---------------------------------------------------------------------------
create table if not exists statements (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  card_account_id uuid not null references card_accounts(id) on delete cascade,
  cycle_id        uuid references statement_cycles(id) on delete set null,
  email_id        text,                    -- Gmail message id it came from
  issued_on       date not null,
  period_start    date,
  period_end      date,
  opening_balance numeric,
  closing_balance numeric,
  total_debits    numeric,
  total_credits   numeric,
  tie_out_diff    numeric,                 -- must be 0 before a cycle can submit
  storage_path    text,                    -- decrypted copy, private bucket
  parsed          jsonb,
  status          text not null default 'parsed'
                  check (status in ('parsed','reconciled','failed')),
  created_at      timestamptz not null default now(),
  unique (user_id, email_id)
);
create index if not exists statements_user_issued_idx on statements (user_id, issued_on desc);

create table if not exists statement_lines (
  id             uuid primary key default gen_random_uuid(),
  statement_id   uuid not null references statements(id) on delete cascade,
  user_id        text not null,
  line_no        int,
  txn_date       date,
  post_date      date,
  descriptor     text,
  amount         numeric not null,          -- always positive; sign lives in `direction`
  direction      text not null default 'debit'
                 check (direction in ('debit','credit')),
  type           text not null default 'purchase'
                 check (type in ('purchase','refund','fee','payment','chargeback')),
  currency       text,                      -- origin currency when foreign
  amount_orig    numeric,
  transaction_id bigint references transactions(id) on delete set null,
  recon_status   text not null default 'unmatched'
                 check (recon_status in ('tied','created','orphan','unexplained','unmatched')),
  created_at     timestamptz not null default now()
);
-- `direction` was added after the first draft of this file; the create above
-- only applies to a fresh database, so an existing one is patched here.
alter table statement_lines add column if not exists direction text not null default 'debit';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'statement_lines_direction_check'
  ) then
    alter table statement_lines add constraint statement_lines_direction_check
      check (direction in ('debit','credit'));
  end if;
end $$;

create index if not exists statement_lines_stmt_idx on statement_lines (statement_id, line_no);
create index if not exists statement_lines_txn_idx  on statement_lines (transaction_id);

-- ---------------------------------------------------------------------------
-- 5. Receipts
-- ---------------------------------------------------------------------------
create table if not exists receipts (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  source         text not null default 'telegram',

  -- provenance
  tg_chat_id     bigint,
  tg_message_id  bigint,
  tg_file_id     text,

  -- the original bytes, untouched
  storage_path   text not null,
  mime           text,
  bytes          int,
  sha256         text not null,
  original_name  text,

  -- extraction
  doc_type       text,
  merchant       text,
  merchant_raw   text,
  amount         numeric,                   -- in `currency`, never converted
  tax_total      numeric,
  receipt_date   date,
  receipt_time   text,
  invoice_no     text,
  card_last4     text,

  -- international
  currency       text not null default 'INR',
  amount_inr     numeric,                   -- estimate only; statement is truth
  dcc_amount_inr numeric,
  fx_rate        numeric,
  fx_date        date,
  country        text,
  city           text,
  language       text,
  tax_id         text,
  tax_id_type    text,
  tax_breakdown  jsonb,

  trip_id        uuid references trips(id) on delete set null,

  -- model consensus audit trail
  extracted      jsonb,                     -- every model's raw answer
  models_used    text[] not null default '{}',
  consensus      text,                      -- agree | tiebreak | conflict
  confidence     numeric,

  status         text not null default 'pending'
                 check (status in ('pending','matched','unmatched','duplicate','rejected')),
  user_note      text,
  created_at     timestamptz not null default now(),
  unique (user_id, sha256)
);
create index if not exists receipts_user_status_idx on receipts (user_id, status, receipt_date desc);
create index if not exists receipts_trip_idx        on receipts (trip_id);

-- Join table, not a foreign key: one bill can span two charges, and one charge
-- can be covered by an invoice plus a payment slip.
create table if not exists receipt_transactions (
  receipt_id     uuid   not null references receipts(id) on delete cascade,
  transaction_id bigint not null references transactions(id) on delete cascade,
  match_score    numeric,
  matched_by     text not null default 'auto'
                 check (matched_by in ('auto','user','rematch','statement','admin')),
  created_at     timestamptz not null default now(),
  primary key (receipt_id, transaction_id)
);
create index if not exists receipt_transactions_txn_idx on receipt_transactions (transaction_id);

-- ---------------------------------------------------------------------------
-- 6. Submissions
-- ---------------------------------------------------------------------------
create table if not exists submissions (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  cycle_id       uuid references statement_cycles(id) on delete set null,
  zip_path       text,
  csv_path       text,
  pdf_path       text,
  line_count     int,
  receipt_count  int,
  coverage_pct   numeric,
  total_amount   numeric,
  status         text not null default 'draft'
                 check (status in ('draft','awaiting_approval','sent','failed')),
  sent_to        text[] not null default '{}',
  resend_id      text,
  sent_at        timestamptz,
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists submissions_user_idx on submissions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Telegram
-- ---------------------------------------------------------------------------
create table if not exists telegram_links (
  user_id     text primary key,
  tg_chat_id  bigint unique,
  tg_username text,
  link_code   text,
  code_expires_at timestamptz,
  linked_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists telegram_links_code_idx on telegram_links (link_code);

-- Makes the webhook idempotent: Telegram retries on any non-200.
create table if not exists tg_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. FX rates — cached per currency-day so a lookup is never paid for twice
-- ---------------------------------------------------------------------------
create table if not exists fx_rates (
  rate_date date not null,
  base      text not null,
  quote     text not null default 'INR',
  rate      numeric not null,
  source    text not null default 'ecb',
  fetched_at timestamptz not null default now(),
  primary key (rate_date, base, quote)
);

-- ---------------------------------------------------------------------------
-- 9. transactions — three new columns
-- ---------------------------------------------------------------------------
alter table transactions add column if not exists receipt_status text default 'missing';
alter table transactions add column if not exists declared_reason text;
alter table transactions add column if not exists statement_line_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_receipt_status_check'
  ) then
    alter table transactions add constraint transactions_receipt_status_check
      check (receipt_status in ('missing','attached','declared','waived'));
  end if;
end $$;

-- Seed receipt_status from the legacy boolean so nothing regresses.
update transactions
   set receipt_status = case when has_receipt then 'attached' else 'missing' end
 where receipt_status is null;

create index if not exists transactions_user_receipt_idx
  on transactions (user_id, receipt_status, date desc);

-- ---------------------------------------------------------------------------
-- 10. RLS — deny-all for anon on every new table.
--
--     The app authenticates with NextAuth, not Supabase Auth, so auth.uid()
--     is never populated and policies written against it would deny all.
--     All server access uses the service-role key, which bypasses RLS.
--     These policies exist so a leaked anon key reads nothing.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'card_accounts','trips','statement_cycles','statements','statement_lines',
    'receipts','receipt_transactions','submissions','telegram_links',
    'tg_updates','fx_rates'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_deny_anon', t);
    execute format(
      'create policy %I on %I for all to anon using (false) with check (false)',
      t || '_deny_anon', t
    );
  end loop;
end $$;
