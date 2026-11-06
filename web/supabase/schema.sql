-- ApplyPilot v2 schema. Idempotent: safe to run again on a fresh or a v1 database.
-- Run the whole file in Supabase → SQL Editor. Then create a PRIVATE storage bucket named "resumes"
-- (or let the last block below create it).

create extension if not exists pgcrypto;

-- ───────────────────────── profiles (user-editable: profile_json, preferences only)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  profile_json jsonb,
  preferences jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles add column if not exists updated_at timestamptz default now();

-- ───────────────────────── subscriptions (service role writes only)
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text,
  razorpay_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz default now()
);

-- Migrate v1 columns (profiles.plan / razorpay_subscription_id) into subscriptions, then drop them.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'plan') then
    execute $m$
      insert into public.subscriptions (user_id, plan, razorpay_subscription_id)
      select id, coalesce(plan, 'free'), razorpay_subscription_id from public.profiles
      where plan = 'pro' or razorpay_subscription_id is not null
      on conflict (user_id) do nothing
    $m$;
    alter table public.profiles drop column if exists plan;
    alter table public.profiles drop column if exists razorpay_subscription_id;
  end if;
end $$;

-- ───────────────────────── usage_events (append-only, service role only)
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('analysis', 'tailor', 'cover_letter', 'autofill', 'parse')),
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_kind_time on public.usage_events (user_id, kind, created_at);

-- ───────────────────────── api_keys (sha256 hash only; the key itself is shown once)
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'Chrome extension',
  prefix text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_user on public.api_keys (user_id);

-- ───────────────────────── resumes
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  storage_path text, raw_text text,
  created_at timestamptz default now()
);

-- ───────────────────────── jobs
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  external_id text, title text, company text, location text, remote boolean,
  apply_url text, description text,
  fit_score int, missing_keywords text[], tailored jsonb,
  created_at timestamptz default now(),
  unique (user_id, external_id)
);
alter table public.jobs add column if not exists source text;
alter table public.jobs add column if not exists salary text;
alter table public.jobs add column if not exists posted_at timestamptz;
alter table public.jobs add column if not exists match jsonb;
alter table public.jobs add column if not exists cover_letter text;
alter table public.jobs add column if not exists interview jsonb;

-- ───────────────────────── applications (tracker + autofill audit trail)
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  job_id uuid references public.jobs on delete set null,
  page_url text, company text, title text,
  status text not null default 'saved',
  actions jsonb,
  created_at timestamptz default now()
);
alter table public.applications add column if not exists page_key text;
alter table public.applications add column if not exists notes text;
alter table public.applications add column if not exists follow_up date;
alter table public.applications add column if not exists position double precision default 0;
alter table public.applications add column if not exists updated_at timestamptz default now();
alter table public.applications add column if not exists applied_at timestamptz;
alter table public.applications add column if not exists autofilled_at timestamptz;
alter table public.applications alter column status set default 'saved';
-- Auto mode discovery (v2.2): where a card came from, and the ATS match computed when it was found.
alter table public.applications add column if not exists source text not null default 'manual';
alter table public.applications drop constraint if exists applications_source_check;
update public.applications set source = 'manual' where source is null or source not in ('manual', 'auto');
alter table public.applications add constraint applications_source_check check (source in ('manual', 'auto'));
create index if not exists applications_user_source_time on public.applications (user_id, source, created_at);
alter table public.jobs add column if not exists ats_score int;
-- Board Auto-Apply (v2.3): board the runner applied on; questions it could not answer.
alter table public.applications add column if not exists board text;
alter table public.profiles add column if not exists unanswered jsonb not null default '[]'::jsonb;
-- Zero-click auto-apply (v2.4): settings edited on the website; per-board sign-in status reported by the extension.
alter table public.profiles add column if not exists auto_settings jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists board_status jsonb not null default '{}'::jsonb;

-- v1 statuses → v2 Kanban columns
update public.applications set status = 'saved' where status = 'filled';
update public.applications set status = 'applied' where status = 'submitted';
update public.applications set page_key = coalesce(page_key, id::text) where page_key is null;

-- Status check (includes 'needs_review' for Auto mode). Drop + re-add so re-running upgrades older constraints.
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in ('saved', 'needs_review', 'applied', 'interview', 'offer', 'rejected'));
create unique index if not exists applications_user_page_key on public.applications (user_id, page_key);

-- ───────────────────────── Row level security
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.api_keys enable row level security;
alter table public.resumes enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;

drop policy if exists "own profile" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);
create policy "update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the service role (server + webhook) writes plans.

-- usage_events and api_keys: no policies at all → only the service role can read or write.
drop policy if exists "own usage" on public.usage_events;
drop policy if exists "own api keys" on public.api_keys;

drop policy if exists "own resumes" on public.resumes;
create policy "own resumes" on public.resumes for select using (auth.uid() = user_id);

drop policy if exists "own jobs" on public.jobs;
create policy "own jobs" on public.jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own applications" on public.applications;
create policy "own applications" on public.applications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Column-level privileges: signed-in users may only change profile_json / preferences on their profile.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (profile_json, preferences, updated_at) on public.profiles to authenticated;

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

revoke all on public.usage_events from anon, authenticated;
revoke all on public.api_keys from anon, authenticated;

revoke insert, update, delete on public.resumes from anon, authenticated;
grant select on public.resumes to authenticated;

-- ───────────────────────── New user → profile + free subscription row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  insert into public.subscriptions (user_id, plan) values (new.id, 'free') on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Backfill rows for users created before this trigger existed.
insert into public.profiles (id, email) select id, email from auth.users on conflict (id) do nothing;
insert into public.subscriptions (user_id, plan) select id, 'free' from auth.users on conflict (user_id) do nothing;

-- ───────────────────────── Storage bucket for resume PDFs (private)
insert into storage.buckets (id, name, public) values ('resumes', 'resumes', false) on conflict (id) do nothing;
