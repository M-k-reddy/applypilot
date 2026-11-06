-- ApplyPilot zero-click auto-apply (v2.4). Idempotent. Already included in web/supabase/schema.sql.
begin;
alter table public.profiles add column if not exists auto_settings jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists board_status jsonb not null default '{}'::jsonb;
commit;
