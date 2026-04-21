-- Run this in Supabase SQL Editor to enable app error logging.
create table if not exists app_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  level text not null check (level in ('info','warn','error')),
  source text not null,
  event text not null,
  user_id uuid,
  message text,
  details jsonb
);

create index if not exists app_logs_created_at_idx on app_logs (created_at desc);
create index if not exists app_logs_level_idx on app_logs (level);
create index if not exists app_logs_user_id_idx on app_logs (user_id);

-- Retain 30 days only. Run periodically (or add a pg_cron job).
-- delete from app_logs where created_at < now() - interval '30 days';
