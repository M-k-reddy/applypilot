-- ApplyPilot Auto mode migration. Idempotent: safe to run more than once.
-- Adds the 'needs_review' tracker status used when Auto mode skips a job it can't submit with full confidence.
-- (Already included in web/supabase/schema.sql; run this alone on an existing database.)
begin;
alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in ('saved', 'needs_review', 'applied', 'interview', 'offer', 'rejected'));
commit;
