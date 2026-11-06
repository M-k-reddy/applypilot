-- ApplyPilot Board Auto-Apply migration (extension v2.3). Idempotent: safe to run more than once.
-- applications.board: which job board the runner applied on (naukri, internshala, indeed, foundit).
-- profiles.unanswered: screening questions the runner could not answer, for the user to fill once.
-- (Already included in web/supabase/schema.sql; run this alone on an existing database.)
begin;
alter table public.applications add column if not exists board text;
alter table public.profiles add column if not exists unanswered jsonb not null default '[]'::jsonb;
commit;
