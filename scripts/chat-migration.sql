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
