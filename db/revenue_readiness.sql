-- Revenue-readiness migration. Idempotent and additive except for intentional
-- privilege hardening. The backend uses service_role; browser users retain
-- SELECT-only access to their own profile through RLS.

revoke all on table public.user_profiles from anon, authenticated;
grant select on table public.user_profiles to authenticated;

drop policy if exists "Users can update own profile" on public.user_profiles;

-- These functions are called by backend service-role code or table triggers.
-- None is a supported public browser RPC.
revoke execute on function public.admin_get_stats() from public, anon, authenticated;
revoke execute on function public.increment_analysis_count(uuid) from public, anon, authenticated;
revoke execute on function public.increment_blocklist_count(text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.generate_case_number() from public, anon, authenticated;
revoke execute on function public.get_case_with_analysis(uuid) from public, anon, authenticated;
revoke execute on function public.set_analysis_version() from public, anon, authenticated;
revoke execute on function public.find_statute_by_charge(text, text) from public, anon, authenticated;

alter function public.admin_get_stats() set search_path = '';
alter function public.increment_analysis_count(uuid) set search_path = '';
alter function public.increment_blocklist_count(text) set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.generate_case_number() set search_path = '';
alter function public.get_case_with_analysis(uuid) set search_path = '';
alter function public.set_analysis_version() set search_path = '';
alter function public.find_statute_by_charge(text, text) set search_path = '';

create table if not exists public.billing_events (
  stripe_event_id text primary key,
  event_type text not null,
  stripe_session_id text,
  user_id uuid not null references auth.users(id) on delete restrict,
  tier text not null check (tier in ('single', 'practitioner', 'firm')),
  amount_total integer,
  currency text,
  created_at timestamptz not null default now(),
  processed_at timestamptz not null default now()
);
create unique index if not exists billing_events_session_unique
  on public.billing_events (stripe_session_id) where stripe_session_id is not null;
alter table public.billing_events enable row level security;
revoke all on table public.billing_events from public, anon, authenticated;
grant all on table public.billing_events to service_role;

create table if not exists public.analysis_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_event_id text not null references public.billing_events(stripe_event_id) on delete restrict,
  credits_total integer not null default 1 check (credits_total > 0),
  credits_used integer not null default 0 check (credits_used between 0 and credits_total),
  created_at timestamptz not null default now(),
  unique (source_event_id)
);
create index if not exists analysis_credits_user_idx on public.analysis_credits(user_id, created_at);
alter table public.analysis_credits enable row level security;
revoke all on table public.analysis_credits from public, anon, authenticated;
grant all on table public.analysis_credits to service_role;

create table if not exists public.analysis_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null check (tier in ('none', 'single', 'practitioner', 'firm', 'enterprise')),
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 minutes'),
  completed_at timestamptz,
  released_at timestamptz
);
create index if not exists analysis_reservations_active_idx
  on public.analysis_reservations(user_id, expires_at) where status = 'reserved';
alter table public.analysis_reservations enable row level security;
revoke all on table public.analysis_reservations from public, anon, authenticated;
grant all on table public.analysis_reservations to service_role;

create or replace function public.fulfill_checkout_payment(
  p_stripe_event_id text,
  p_event_type text,
  p_stripe_session_id text,
  p_user_id uuid,
  p_tier text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_amount_total integer,
  p_currency text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
  existing_subscription text;
begin
  if p_stripe_event_id is null or p_user_id is null or
     p_tier not in ('single', 'practitioner', 'firm') then
    raise exception 'invalid fulfillment input';
  end if;

  select stripe_subscription_id into existing_subscription
  from public.user_profiles where user_id = p_user_id for update;
  if not found then raise exception 'profile not found'; end if;
  if p_tier = 'single' and existing_subscription is not null then
    raise exception 'one-off purchase conflicts with active subscription';
  end if;
  if p_tier <> 'single' and existing_subscription is not null and
     existing_subscription is distinct from p_stripe_subscription_id then
    raise exception 'duplicate subscription requires reconciliation';
  end if;

  insert into public.billing_events(
    stripe_event_id,event_type,stripe_session_id,user_id,tier,amount_total,currency
  ) values (
    p_stripe_event_id,p_event_type,p_stripe_session_id,p_user_id,p_tier,p_amount_total,lower(p_currency)
  ) on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return false; end if;

  if p_tier = 'single' then
    insert into public.analysis_credits(user_id,source_event_id)
    values (p_user_id,p_stripe_event_id);
    update public.user_profiles set
      subscription_tier = case when subscription_tier in ('practitioner','firm','enterprise') then subscription_tier else 'single' end,
      stripe_customer_id = coalesce(p_stripe_customer_id,stripe_customer_id),
      updated_at = now()
    where user_id = p_user_id;
  else
    update public.user_profiles set
      subscription_tier = p_tier,
      stripe_customer_id = coalesce(p_stripe_customer_id,stripe_customer_id),
      stripe_subscription_id = p_stripe_subscription_id,
      updated_at = now()
    where user_id = p_user_id;
  end if;
  return true;
end;
$$;
revoke execute on function public.fulfill_checkout_payment(text,text,text,uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.fulfill_checkout_payment(text,text,text,uuid,text,text,text,integer,text) to service_role;

create or replace function public.reserve_analysis(p_user_id uuid)
returns table(reservation_id uuid, reserved_tier text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.user_profiles%rowtype;
  active_count integer;
  credit_available integer;
  new_id uuid;
begin
  select * into p from public.user_profiles where user_id=p_user_id for update;
  if not found then raise exception 'profile not found'; end if;
  if p.month_reset_date is null or p.month_reset_date <= current_date then
    update public.user_profiles set analyses_this_month=0,
      month_reset_date=(date_trunc('month',current_date)+interval '1 month')::date,
      updated_at=now() where user_id=p_user_id;
    p.analyses_this_month := 0;
  end if;
  select count(*) into active_count from public.analysis_reservations
    where user_id=p_user_id and status='reserved' and expires_at>now();
  if p.subscription_tier='none' and p.analyses_this_month+active_count >= 1 then raise exception 'free_limit_reached'; end if;
  if p.subscription_tier='practitioner' and p.analyses_this_month+active_count >= 50 then raise exception 'monthly_limit_reached'; end if;
  if p.subscription_tier='single' then
    select coalesce(sum(credits_total-credits_used),0) into credit_available
      from public.analysis_credits where user_id=p_user_id;
    if credit_available-active_count <= 0 then raise exception 'credit_required'; end if;
  end if;
  insert into public.analysis_reservations(user_id,tier)
    values(p_user_id,p.subscription_tier) returning id into new_id;
  return query select new_id,p.subscription_tier;
end;
$$;
revoke execute on function public.reserve_analysis(uuid) from public,anon,authenticated;
grant execute on function public.reserve_analysis(uuid) to service_role;

create or replace function public.complete_analysis(p_user_id uuid,p_reservation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.analysis_reservations%rowtype; credit_id uuid;
begin
  select * into r from public.analysis_reservations where id=p_reservation_id and user_id=p_user_id for update;
  if not found or r.status<>'reserved' or r.expires_at<=now() then raise exception 'invalid_or_expired_reservation'; end if;
  if r.tier='single' then
    select id into credit_id from public.analysis_credits where user_id=p_user_id and credits_used<credits_total
      order by created_at,id for update skip locked limit 1;
    if credit_id is null then raise exception 'credit_required'; end if;
    update public.analysis_credits set credits_used=credits_used+1 where id=credit_id;
  end if;
  update public.user_profiles set analyses_this_month=coalesce(analyses_this_month,0)+1,
    analyses_total=coalesce(analyses_total,0)+1,updated_at=now() where user_id=p_user_id;
  if not found then raise exception 'profile not found'; end if;
  update public.analysis_reservations set status='completed',completed_at=now() where id=p_reservation_id;
end;
$$;
revoke execute on function public.complete_analysis(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_analysis(uuid,uuid) to service_role;

create or replace function public.release_analysis(p_user_id uuid,p_reservation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.analysis_reservations set status='released',released_at=now()
    where id=p_reservation_id and user_id=p_user_id and status='reserved';
end;
$$;
revoke execute on function public.release_analysis(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_analysis(uuid,uuid) to service_role;
