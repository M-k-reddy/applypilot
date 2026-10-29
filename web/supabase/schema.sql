-- ApplyPilot schema. Safe to re-run: every statement is idempotent, so it also upgrades a v1 database.

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  plan text not null default 'free',            -- free | pro
  razorpay_subscription_id text,
  profile_json jsonb,                            -- parsed resume / answer sheet
  preferences jsonb default '{}'::jsonb,         -- titles, locations, remote, max_experience
  created_at timestamptz default now()
);

create table if not exists resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  storage_path text, raw_text text,
  created_at timestamptz default now()
);

-- Shared free job feed (Greenhouse / Lever / Ashby / Workable / SmartRecruiters). Written only by the service role (cron).
create table if not exists feed_jobs (
  id uuid primary key default gen_random_uuid(),
  external_id text unique not null,              -- source:company:id
  source text not null,
  title text not null, company text, location text, remote boolean default false,
  apply_url text, description text,
  posted_at timestamptz, department text, employment_type text,
  experience_min int, experience_max int, fresher boolean default false,
  skills text[] default '{}',
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now()
);
create index if not exists feed_jobs_first_seen on feed_jobs (first_seen_at desc);
create index if not exists feed_jobs_posted on feed_jobs (posted_at desc);
create index if not exists feed_jobs_title_lower on feed_jobs (lower(title));

-- The user's own jobs (JSearch results, saved/scored feed jobs, pages saved from the extension)
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  external_id text, title text, company text, location text, remote boolean,
  apply_url text, description text,
  fit_score int, missing_keywords text[], tailored jsonb,
  created_at timestamptz default now(),
  unique (user_id, external_id)
);
alter table jobs add column if not exists feed_job_id uuid references feed_jobs on delete set null;
alter table jobs add column if not exists match jsonb;          -- deterministic match: matched/missing skills, experience fit

-- Tracker + autofill audit trail
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  job_id uuid references jobs on delete set null,
  page_url text, company text, title text,
  status text not null default 'filled',         -- saved | filled | applied | interview | offer | rejected
  actions jsonb,                                 -- audit trail of what the agent filled
  created_at timestamptz default now()
);
alter table applications add column if not exists location text;
alter table applications add column if not exists notes text;
alter table applications add column if not exists source text;           -- extension | feed | search | autofill
alter table applications add column if not exists hiring_team jsonb;     -- names/links read from the LinkedIn job page
alter table applications add column if not exists updated_at timestamptz default now();
update applications set status = 'applied' where status = 'submitted';   -- v1 used "submitted"
alter table applications drop constraint if exists applications_status_check;
alter table applications add constraint applications_status_check
  check (status in ('saved', 'filled', 'applied', 'interview', 'offer', 'rejected'));
create index if not exists applications_user_url on applications (user_id, page_url);

create table if not exists ats_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  score int, report jsonb, jd text,
  created_at timestamptz default now()
);

create table if not exists tailored_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  job_id uuid references jobs on delete set null,
  title text, company text,
  resume jsonb, html text,
  created_at timestamptz default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  keywords text not null,                        -- comma separated, any may match
  location text default '',
  remote boolean default false,
  fresher boolean default true,
  email boolean default true,                    -- only used when RESEND_API_KEY is set
  active boolean default true,
  last_run_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  kind text default 'job_alert',
  title text, body text, data jsonb,
  read boolean default false,
  created_at timestamptz default now()
);
create index if not exists notifications_user on notifications (user_id, read, created_at desc);

-- Plan-limit counter. Users can read and add their own rows but never update or delete them.
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  feature text not null,                         -- autofill | ats | ats_fix | tailor | match | outreach | find_hr
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
-- v1 -> v2 compatibility (safe to re-run)
alter table profiles add column if not exists plan text not null default 'free';
alter table profiles add column if not exists razorpay_subscription_id text;
alter table applications drop constraint if exists applications_source_check;
alter table applications alter column source drop not null;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='usage_events' and column_name='kind') then
    alter table usage_events drop constraint if exists usage_events_kind_check;
    alter table usage_events alter column kind drop not null;
    alter table usage_events add column if not exists feature text;
    update usage_events set feature = kind where feature is null;
    alter table usage_events alter column feature set default 'other';
    update usage_events set feature = 'other' where feature is null;
    alter table usage_events alter column feature set not null;
  end if;
end $$;
alter table usage_events add column if not exists meta jsonb default '{}'::jsonb;
create index if not exists usage_user_feature on usage_events (user_id, feature, created_at desc);

-- Row level security
alter table profiles enable row level security;
alter table resumes enable row level security;
alter table feed_jobs enable row level security;
alter table jobs enable row level security;
alter table applications enable row level security;
alter table ats_reports enable row level security;
alter table tailored_resumes enable row level security;
alter table alerts enable row level security;
alter table notifications enable row level security;
alter table usage_events enable row level security;

drop policy if exists "own profile" on profiles;
drop policy if exists "own resumes" on resumes;
drop policy if exists "own jobs" on jobs;
drop policy if exists "own applications" on applications;
drop policy if exists "read feed" on feed_jobs;
drop policy if exists "own ats" on ats_reports;
drop policy if exists "own tailored" on tailored_resumes;
drop policy if exists "own alerts" on alerts;
drop policy if exists "own notifications read" on notifications;
drop policy if exists "own notifications update" on notifications;
drop policy if exists "own usage read" on usage_events;
drop policy if exists "own usage insert" on usage_events;

-- NOTE: users must not be able to set their own plan. Profile updates go through the API, but RLS alone would allow
-- a user to update `plan`; the trigger below blocks that for non-service-role callers.
create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own resumes" on resumes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own jobs" on jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own applications" on applications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read feed" on feed_jobs for select to authenticated using (true);
create policy "own ats" on ats_reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tailored" on tailored_resumes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own alerts" on alerts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notifications read" on notifications for select using (auth.uid() = user_id);
create policy "own notifications update" on notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own usage read" on usage_events for select using (auth.uid() = user_id);
create policy "own usage insert" on usage_events for insert with check (auth.uid() = user_id);

create or replace function protect_plan() returns trigger language plpgsql as $$
begin
  if new.plan is distinct from old.plan and coalesce(auth.role(), '') <> 'service_role' then
    new.plan := old.plan;
  end if;
  if new.razorpay_subscription_id is distinct from old.razorpay_subscription_id and coalesce(auth.role(), '') <> 'service_role' then
    new.razorpay_subscription_id := old.razorpay_subscription_id;
  end if;
  return new;
end; $$;
drop trigger if exists profiles_protect_plan on profiles;
create trigger profiles_protect_plan before update on profiles for each row execute function protect_plan();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

