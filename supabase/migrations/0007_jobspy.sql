-- Fair Winds (Following Seas): JobSpy postings, resume cache, and embeddings.
--
--   * glassdoor and google join job_source. Indeed, ZipRecruiter, Glassdoor,
--     and Google are searched by the JobSpy worker, not by the app.
--   * pgvector stores 384-dimension embeddings from
--     sentence-transformers/all-MiniLM-L6-v2 (cosine distance).
--   * resumes holds the person's base resume, the one-time Claude JSON parse,
--     and the resume embedding. The person can edit the text. Only the service
--     role can write the parse and the embedding.
--   * keyword_gaps is a suggestion list. It is never a decision to apply,
--     skip, or message anyone.
--
-- New enum values are added and not used in this file. Postgres allows
-- ADD VALUE inside a migration transaction, but the new labels cannot be
-- used until the migration commits.

create extension if not exists vector with schema extensions;

alter type public.job_source add value if not exists 'glassdoor';
alter type public.job_source add value if not exists 'google';

-- ---------------------------------------------------------------------------
-- resumes: one base resume per person
-- ---------------------------------------------------------------------------

create table public.resumes (
  user_id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  raw_text         text not null,
  -- sha256 hex of raw_text as stored (UTF-8, no extra trimming). The worker
  -- re-parses and re-embeds only when this no longer matches the text.
  content_hash     text not null,
  parsed           jsonb,
  parsed_model     text,
  parsed_at        timestamptz,
  embedding        extensions.vector(384),
  embedding_model  text,
  embedded_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.resumes is 'Base resume, cached Claude JSON, and embedding. One row per person.';
comment on column public.resumes.parsed is 'Cached extraction of raw_text. Reused until the text changes. Not a source of facts the person did not write.';
comment on column public.resumes.embedding is '384-d all-MiniLM embedding of the resume. Cosine distance.';

create trigger resumes_set_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

-- Authenticated sessions may change the text. The parse and the embedding
-- are cleared when the text changes, and a session cannot write either one.
-- The JobSpy worker uses the service role key, which auth.role() reports
-- as service_role, and that is the only writer of the cache.
create or replace function public.resumes_guard_cache()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    if tg_op = 'INSERT' then
      new.parsed := null;
      new.parsed_model := null;
      new.parsed_at := null;
      new.embedding := null;
      new.embedding_model := null;
      new.embedded_at := null;
    elsif new.raw_text is distinct from old.raw_text then
      new.parsed := null;
      new.parsed_model := null;
      new.parsed_at := null;
      new.embedding := null;
      new.embedding_model := null;
      new.embedded_at := null;
    else
      new.parsed := old.parsed;
      new.parsed_model := old.parsed_model;
      new.parsed_at := old.parsed_at;
      new.embedding := old.embedding;
      new.embedding_model := old.embedding_model;
      new.embedded_at := old.embedded_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger resumes_guard_cache
  before insert or update on public.resumes
  for each row execute function public.resumes_guard_cache();

alter table public.resumes enable row level security;

create policy resumes_select_own on public.resumes
  for select to authenticated using (user_id = (select auth.uid()));
create policy resumes_insert_own on public.resumes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy resumes_update_own on public.resumes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy resumes_delete_own on public.resumes
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- job_embeddings: one vector per posting
-- ---------------------------------------------------------------------------

create table public.job_embeddings (
  job_id           uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  embedding        extensions.vector(384) not null,
  embedding_model  text not null,
  -- sha256 hex of the text that was embedded, so an unchanged posting is skipped.
  content_hash     text not null,
  embedded_at      timestamptz not null default now(),
  foreign key (job_id, user_id) references public.jobs (id, user_id) on delete cascade
);

comment on table public.job_embeddings is '384-d all-MiniLM embedding of a posting. Written by the JobSpy worker.';

create index job_embeddings_user_idx on public.job_embeddings (user_id);

create index job_embeddings_cosine_idx
  on public.job_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.job_embeddings enable row level security;

create policy job_embeddings_select_own on public.job_embeddings
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.job_embeddings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Similarity of each live posting to the person's resume.
-- security_invoker so Row Level Security on the underlying tables applies.
-- The service role bypasses RLS; callers still filter by user_id.
-- ---------------------------------------------------------------------------

create view public.job_resume_similarity
with (security_invoker = true) as
select
  j.user_id,
  j.id as job_id,
  (1 - (je.embedding operator(extensions.<=>) r.embedding))::double precision as similarity
from public.jobs j
join public.job_embeddings je
  on je.job_id = j.id
 and je.user_id = j.user_id
join public.resumes r
  on r.user_id = j.user_id
where j.deleted_at is null
  and r.embedding is not null;

comment on view public.job_resume_similarity is 'Cosine similarity of a live posting to the person''s resume embedding. 1 is identical.';

revoke all on public.job_resume_similarity from public, anon;
grant select on public.job_resume_similarity to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- keyword_gaps: required terms on the posting that are not in the resume.
-- Suggestions only. suggestions_only cannot be turned off.
-- ---------------------------------------------------------------------------

create table public.keyword_gaps (
  job_id            uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  missing           text[] not null default '{}',
  resume_hash       text,
  suggestions_only  boolean not null default true check (suggestions_only),
  computed_at       timestamptz not null default now(),
  foreign key (job_id, user_id) references public.jobs (id, user_id) on delete cascade
);

comment on table public.keyword_gaps is 'Required-skill terms missing from the resume. Suggestions only: not a score, not a decision, and never a reason to apply or message anyone.';

create index keyword_gaps_user_idx on public.keyword_gaps (user_id);

alter table public.keyword_gaps enable row level security;

create policy keyword_gaps_select_own on public.keyword_gaps
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.keyword_gaps from anon, authenticated;
