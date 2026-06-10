-- leads
-- Marketing leads captured by the funnel exit/hesitation popup (api/lead.js).
-- Idempotent: safe to run on a fresh DB or to patch an existing table.
-- Run in the Supabase SQL Editor.

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text,
  phone       text,
  state       text,
  variant     text,   -- funnel A/B variant: 'fear' | 'leverage'
  source      text,   -- page URL the lead came from
  trigger     text,   -- what fired the popup: 'exit' | 'scroll_up' | 'dwell' | 'timeout'
  ip_address  text,
  created_at  timestamptz not null default now()
);

-- Patch older tables.
alter table public.leads add column if not exists name       text;
alter table public.leads add column if not exists email      text;
alter table public.leads add column if not exists phone      text;
alter table public.leads add column if not exists state      text;
alter table public.leads add column if not exists variant    text;
alter table public.leads add column if not exists source     text;
alter table public.leads add column if not exists trigger    text;
alter table public.leads add column if not exists ip_address text;
alter table public.leads add column if not exists created_at timestamptz not null default now();

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_email_idx   on public.leads (email);

-- The API writes with the service-role key (bypasses RLS). Enable RLS with no
-- public policies so the table is not readable/writable via the anon key.
alter table public.leads enable row level security;
