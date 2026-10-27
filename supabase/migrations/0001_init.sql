-- Fair Winds (Following Seas) Phase 0 schema.
--
-- Rules that hold for every table:
--   * user_id defaults to auth.uid() and references auth.users.
--   * Row Level Security is enabled; a user can only see and change their own rows.
--   * profiles and jobs are soft-deleted (deleted_at). There is no DELETE policy on
--     them, so the API cannot hard-delete them.
--   * audit_log is append-only: SELECT and INSERT policies only.
--   * Child rows reference parents through (id, user_id) composite foreign keys, so a
--     row can never point at another user's profile or job.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.job_source as enum ('indeed', 'ziprecruiter', 'linkedin', 'usajobs', 'manual');
create type public.query_quality as enum ('good', 'mixed', 'noise', 'untested');
create type public.easy_apply_status as enum ('yes', 'no', 'unknown');
create type public.decision_kind as enum ('keep', 'skip');
create type public.application_status as enum ('saved', 'applied', 'interview', 'offer', 'closed');
create type public.agent_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: search profiles (one line of search each)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  target_titles  text[] not null default '{}',
  locations      text[] not null default '{}',
  min_base_pay   integer check (min_base_pay is null or min_base_pay >= 0),
  must_haves     jsonb not null default '[]'::jsonb,
  deal_breakers  jsonb not null default '[]'::jsonb,
  plus_factors   jsonb not null default '[]'::jsonb,
  scoring_rubric jsonb not null default '{}'::jsonb,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (id, user_id)
);

comment on table public.profiles is 'Search profiles. Soft delete only (deleted_at).';
comment on column public.profiles.locations is 'Empty array means any location.';
comment on column public.profiles.min_base_pay is 'Minimum base pay in USD per year.';
comment on column public.profiles.scoring_rubric is 'Score bands and always-flagged gaps used by the Scoring agent.';

create unique index profiles_user_name_active_key
  on public.profiles (user_id, lower(name))
  where deleted_at is null;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- queries: the query library per profile and source
-- ---------------------------------------------------------------------------

create table public.queries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id    uuid not null,
  source        public.job_source not null,
  query_text    text not null check (length(trim(query_text)) > 0),
  filters       jsonb not null default '{}'::jsonb,
  quality       public.query_quality not null default 'untested',
  runs          integer not null default 0 check (runs >= 0),
  relevant_hits integer check (relevant_hits is null or relevant_hits >= 0),
  total_hits    integer check (total_hits is null or total_hits >= 0),
  retired       boolean not null default false,
  notes         text,
  last_run_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (profile_id, user_id) references public.profiles (id, user_id) on delete cascade,
  unique (profile_id, source, query_text)
);

comment on column public.queries.relevant_hits is 'Null means not counted.';

create index queries_user_profile_idx on public.queries (user_id, profile_id);

create trigger queries_set_updated_at
  before update on public.queries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- jobs: postings from every source, deduplicated per user
-- ---------------------------------------------------------------------------

create table public.jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source       public.job_source not null,
  external_id  text,
  url          text,
  title        text not null,
  company      text,
  location     text,
  salary_min   integer check (salary_min is null or salary_min >= 0),
  salary_max   integer check (salary_max is null or salary_max >= 0),
  salary_text  text,
  description  text,
  requirements jsonb not null default '[]'::jsonb,
  easy_apply   public.easy_apply_status not null default 'unknown',
  posted_at    timestamptz,
  -- Keep in sync with src/lib/dedupe.ts.
  dedupe_key   text generated always as (
                 lower(coalesce(company, '')) || '|' ||
                 lower(coalesce(title, ''))   || '|' ||
                 lower(coalesce(location, ''))
               ) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  check (salary_min is null or salary_max is null or salary_min <= salary_max),
  unique (id, user_id),
  unique (user_id, dedupe_key)
);

comment on table public.jobs is 'Job postings. Soft delete only (deleted_at). A soft-deleted job keeps its dedupe_key so it is not re-imported.';
comment on column public.jobs.easy_apply is 'Informational only. Agents never use Easy Apply.';

create index jobs_user_source_external_idx on public.jobs (user_id, source, external_id);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- scores: fit of a job against a profile
-- ---------------------------------------------------------------------------

create table public.scores (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id            uuid not null,
  profile_id        uuid not null,
  fit               smallint not null check (fit between 1 and 10),
  reason            text,
  requirements_met  jsonb not null default '[]'::jsonb,
  gaps              jsonb not null default '[]'::jsonb,
  unmet_must_haves  jsonb not null default '[]'::jsonb,
  deal_breaker_hit  text,
  scored_at         timestamptz not null default now(),
  foreign key (job_id, user_id) references public.jobs (id, user_id) on delete cascade,
  foreign key (profile_id, user_id) references public.profiles (id, user_id) on delete cascade,
  unique (job_id, profile_id)
);

create index scores_user_profile_fit_idx on public.scores (user_id, profile_id, fit desc);

-- ---------------------------------------------------------------------------
-- decisions: keep or skip, made by the user
-- ---------------------------------------------------------------------------

create table public.decisions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id      uuid not null,
  profile_id  uuid not null,
  decision    public.decision_kind not null,
  reason      text,
  decided_at  timestamptz not null default now(),
  foreign key (job_id, user_id) references public.jobs (id, user_id) on delete cascade,
  foreign key (profile_id, user_id) references public.profiles (id, user_id) on delete cascade,
  unique (job_id, profile_id)
);

create index decisions_user_idx on public.decisions (user_id, decided_at desc);

-- ---------------------------------------------------------------------------
-- applications: tracked by the user (agents never submit)
-- ---------------------------------------------------------------------------

create table public.applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id        uuid not null,
  status        public.application_status not null default 'saved',
  applied_on    date,
  follow_up_on  date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (job_id, user_id) references public.jobs (id, user_id) on delete cascade,
  unique (job_id)
);

create index applications_user_follow_up_idx on public.applications (user_id, follow_up_on);

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- agent_runs: one row per agent invocation
-- ---------------------------------------------------------------------------

create table public.agent_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent        text not null,
  input        jsonb not null default '{}'::jsonb,
  output       jsonb,
  status       public.agent_run_status not null default 'queued',
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  check (finished_at is null or finished_at >= started_at)
);

create index agent_runs_user_started_idx on public.agent_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- audit_log: append-only record of what people and agents did
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  actor         text not null default 'user',
  action        text not null,
  entity_table  text,
  entity_id     uuid,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on column public.audit_log.actor is '"user" or the agent name, for example "search".';

create index audit_log_user_created_idx on public.audit_log (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.queries      enable row level security;
alter table public.jobs         enable row level security;
alter table public.scores       enable row level security;
alter table public.decisions    enable row level security;
alter table public.applications enable row level security;
alter table public.agent_runs   enable row level security;
alter table public.audit_log    enable row level security;

-- Full CRUD on own rows.
do $$
declare
  t text;
begin
  foreach t in array array['queries', 'scores', 'decisions', 'applications', 'agent_runs']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
      t || '_delete_own', t);
  end loop;
end;
$$;

-- Soft delete only: select, insert, update. No delete policy.
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'jobs']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update_own', t);
  end loop;
end;
$$;

-- Append only.
create policy audit_log_select_own on public.audit_log
  for select to authenticated using (user_id = (select auth.uid()));
create policy audit_log_insert_own on public.audit_log
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Belt and braces: the API roles cannot hard-delete soft-delete tables or rewrite the audit log.
revoke delete on public.profiles, public.jobs from anon, authenticated;
revoke update, delete on public.audit_log from anon, authenticated;
