-- ApplyPilot hands-free discovery migration (extension v2.2.0). Idempotent: safe to run more than once.
-- applications.source: 'manual' (dashboard/extension, the default) or 'auto' (found by Auto mode discovery).
-- jobs.ats_score: deterministic ATS keyword match (0-100) computed at discovery time (no AI).
begin;
alter table public.applications add column if not exists source text not null default 'manual';
alter table public.applications drop constraint if exists applications_source_check;
alter table public.applications add constraint applications_source_check check (source in ('manual', 'auto'));
create index if not exists applications_user_source_time on public.applications (user_id, source, created_at);
alter table public.jobs add column if not exists ats_score int;
commit;
