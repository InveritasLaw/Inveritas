-- analysis_history
-- Stores standalone "quick analysis" runs:
--   * WRITTEN by  api/analyze.js   (full situation + result JSONB + metadata)
--   * READ by     api/history.js   (dashboard "Analysis History" tab)
--
-- This script is IDEMPOTENT. Run it in the Supabase SQL Editor. It is safe on a
-- fresh database (creates the table) and on an existing table that predates the
-- full schema (adds only the missing columns; never drops or rewrites data).
--
-- Background: the table existed in production without the `vectors_found`,
-- `situation_length`, and `result` columns, so every insert from analyze.js was
-- failing silently (non-blocking try/catch) and the history reader 500'd with
-- "column analysis_history.vectors_found does not exist".

create table if not exists public.analysis_history (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  state            text,
  county           text,
  charge           text,
  situation        text,
  situation_length integer,
  result           jsonb,
  vectors_found    integer default 0,
  ip_address       text,
  created_at       timestamptz not null default now()
);

-- Patch tables that were created before the full schema existed.
alter table public.analysis_history add column if not exists state            text;
alter table public.analysis_history add column if not exists county           text;
alter table public.analysis_history add column if not exists charge           text;
alter table public.analysis_history add column if not exists situation        text;
alter table public.analysis_history add column if not exists situation_length integer;
alter table public.analysis_history add column if not exists result           jsonb;
alter table public.analysis_history add column if not exists vectors_found    integer default 0;
alter table public.analysis_history add column if not exists ip_address       text;
alter table public.analysis_history add column if not exists created_at       timestamptz not null default now();

-- The history list queries by user_id ordered by recency.
create index if not exists analysis_history_user_created_idx
  on public.analysis_history (user_id, created_at desc);

-- The API uses the service-role key (bypasses RLS). Enable RLS with a
-- self-select policy anyway, so the table stays safe if it's ever queried
-- with the anon/authenticated key.
alter table public.analysis_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'analysis_history'
      and policyname = 'analysis_history_select_own'
  ) then
    create policy analysis_history_select_own
      on public.analysis_history
      for select
      using (auth.uid() = user_id);
  end if;
end $$;
