-- Fair Winds (Following Seas) Phase 2: career facts.
--
-- One row per user. The Scoring and Writer agents may use only what is written
-- here; they never invent experience, numbers, titles, or dates. Each section is
-- plain text, one fact per line, so the person can paste and edit it freely.
--
-- Same rules as 0001: user_id defaults to auth.uid(), Row Level Security limits
-- every operation to the owner's row.

create table public.career_facts (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  credentials text not null default '',
  experience  text not null default '',
  other       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.career_facts is 'The only facts agents may use about the person. One row per user.';
comment on column public.career_facts.credentials is 'Degrees, certifications, licenses. One per line.';
comment on column public.career_facts.experience is 'Roles, settings, scope, and dates as the person states them. One per line.';
comment on column public.career_facts.other is 'Anything else the person wants agents to know. One per line.';

create trigger career_facts_set_updated_at
  before update on public.career_facts
  for each row execute function public.set_updated_at();

alter table public.career_facts enable row level security;

create policy career_facts_select_own on public.career_facts
  for select to authenticated using (user_id = (select auth.uid()));
create policy career_facts_insert_own on public.career_facts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy career_facts_update_own on public.career_facts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy career_facts_delete_own on public.career_facts
  for delete to authenticated using (user_id = (select auth.uid()));
