-- Fair Winds (Following Seas) Phase 4: the daily Brief.
--
--   briefs:          one stored brief per person per day, written by the daily
--                    run (GET /api/cron/daily) and read on /brief and GET /api/brief.
--   brief_settings:  per-person schedule preference (daily run on or off).
--
-- Same rules as 0001: user_id defaults to auth.uid(), Row Level Security limits
-- every operation to the owner. The daily run writes briefs with the service
-- role key, which bypasses RLS; that code filters every query by user id.
-- People can read their briefs but not write or delete them through the API.

create table public.briefs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  brief_date    date not null,
  since         timestamptz not null,
  generated_at  timestamptz not null default now(),
  content       jsonb not null,
  unique (user_id, brief_date)
);

comment on table public.briefs is 'Daily Brief per person. Written by the scheduled run; read only for the person.';
comment on column public.briefs.since is 'Start of the "new since the last brief" window.';
comment on column public.briefs.content is 'The Brief object built by src/lib/brief/build.ts.';

create index briefs_user_generated_idx on public.briefs (user_id, generated_at desc);

alter table public.briefs enable row level security;

create policy briefs_select_own on public.briefs
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.briefs from anon, authenticated;

create table public.brief_settings (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  daily_run   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.brief_settings is 'Schedule preference. No row means the daily run is on.';
comment on column public.brief_settings.daily_run is 'When false, the daily run skips this person: no searches, scoring, or brief.';

create trigger brief_settings_set_updated_at
  before update on public.brief_settings
  for each row execute function public.set_updated_at();

alter table public.brief_settings enable row level security;

create policy brief_settings_select_own on public.brief_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy brief_settings_insert_own on public.brief_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy brief_settings_update_own on public.brief_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
