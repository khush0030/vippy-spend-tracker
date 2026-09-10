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

-- Harvested documents are linked by a fourth path. Idempotent: drop-then-add.
alter table receipt_transactions drop constraint if exists receipt_transactions_matched_by_check;
alter table receipt_transactions add constraint receipt_transactions_matched_by_check
  check (matched_by in ('auto','user','rematch','statement','admin','harvest'));

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
