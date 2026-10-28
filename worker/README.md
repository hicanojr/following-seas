# JobSpy worker

Searches Indeed, ZipRecruiter, Glassdoor, and Google with [JobSpy](https://github.com/speedyapply/JobSpy) (`python-jobspy`), then writes postings into Supabase. It also embeds the base resume and the postings, parses the resume once with Claude, and stores a per-job keyword suggestion list.

It never submits an application, never uses Easy Apply, never messages anyone, and never signs in to LinkedIn. LinkedIn stays on the Apify actor inside the app, capped at 25 to 50 results. Do not point this worker at LinkedIn.

## What Hector sets up

1. Run `supabase/migrations/0007_jobspy.sql` (SQL editor or `npx supabase db push`). That enables pgvector, adds the `glassdoor` and `google` sources, and creates `resumes`, `job_embeddings`, and `keyword_gaps`. If the SQL editor says the vector extension is not available, enable **vector** under Database → Extensions and run the migration again.
2. In the app, open **Profiles** and paste the base resume. Saving stores the text only. The worker parses it.
3. Add non-retired queries for `indeed`, `ziprecruiter`, `glassdoor`, and `google` on a profile. Noise queries stay retired and are skipped. A query's `filters.location` is the place searched; otherwise the profile's first location is used.
4. Put the secrets below in GitHub Actions (for the scheduled workflow) or in the VPS environment. Never commit them.

| Name | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Project URL. Same value as `NEXT_PUBLIC_SUPABASE_URL`. The worker also accepts that name. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server only. A scheduled run has no signed-in person, so this bypasses Row Level Security. Every query still filters by user id. |
| `ANTHROPIC_API_KEY` | for parsing | One Claude call per resume text. Later runs reuse the cached JSON until the text changes. Scoring in the app uses the same key. |

Optional:

| Name | Default | Purpose |
| --- | --- | --- |
| `JOBSPY_RESULTS_WANTED` | 20 | Results per query, clamped to 1–50. |
| `JOBSPY_HOURS_OLD` | 72 | How recent a posting must be. Glassdoor rounds this up to whole days. |
| `JOBSPY_COUNTRY` | `USA` | Indeed and Glassdoor country. |
| `JOBSPY_QUERY_CAP` | 8 | Most JobSpy queries per person per run, stalest first. |
| `JOBSPY_EMBED_LIMIT` | 200 | Most postings embedded per person per run. |
| `JOBSPY_FETCH_DESCRIPTION` | on | Read each public posting page so the description is stored. Set `0` to skip that. |
| `JOBSPY_USER_ID` | all users | Limit the run to one user uuid. |
| `EMBEDDING_PROVIDER` | `local` | `local` uses sentence-transformers all-MiniLM in this process. `api` calls `EMBEDDING_API_URL`. |
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | 384 dimensions. An API model must return that size. |
| `EMBEDDING_API_URL` | | OpenAI-compatible embeddings endpoint. Only for `EMBEDDING_PROVIDER=api`. |
| `EMBEDDING_API_KEY` | | Bearer token for that endpoint. |
| `RESUME_PARSE_MODEL` | `claude-haiku-5-5` | Model for the one-time resume parse. |

Example queries, after `select set_config('seed.user_id', '<USER_UUID>', false);` is not required if you set the user id yourself:

```sql
insert into public.queries (user_id, profile_id, source, query_text, filters)
values
  ('<USER_UUID>', '<PROFILE_UUID>', 'indeed', 'Director of Laboratory Services', '{"location": "Boston, MA"}'),
  ('<USER_UUID>', '<PROFILE_UUID>', 'ziprecruiter', 'Director of Laboratory Services', '{"location": "Boston, MA"}'),
  ('<USER_UUID>', '<PROFILE_UUID>', 'glassdoor', 'Director of Laboratory Services', '{"location": "Boston, MA"}'),
  ('<USER_UUID>', '<PROFILE_UUID>', 'google', 'Director of Laboratory Services', '{"location": "Boston, MA"}');
```

## What a run does

For each person with a saved resume or a JobSpy query:

1. If the resume text changed, or it has never been parsed, call Claude once and store the JSON. Otherwise reuse the cache.
2. Embed the resume with all-MiniLM when the embedding is missing or stale.
3. Run the saved queries. Dedupe is `lower(company)|lower(title)|lower(location)`, the same key as the database. A posting that is already saved is not duplicated. If the saved row has no URL and the new one does, the URL is filled in. Soft-deleted rows stay deleted.
4. The stored URL is JobSpy's direct posting link (`job_url_direct`) when that is an http(s) link, otherwise the board link (`job_url`).
5. Embed postings that do not yet have a matching vector, including LinkedIn and USAJobs rows the app already saved.
6. Write keyword suggestions: required terms on the posting that do not appear in the resume. They are suggestions only.

The Vercel daily run still searches only LinkedIn and USAJobs. It scores after that. Schedule this worker earlier (the GitHub workflow uses 10:00 UTC; the daily brief is 11:00 UTC) so new JobSpy postings are embedded before scoring. Postings the app just found are embedded on the next worker run, and scored on the run after that, once a resume embedding exists. Until a resume embedding exists, scoring behaves as before and sends the usual batch to Claude.

## GitHub Actions

`.github/workflows/jobspy.yml` runs every day at 10:00 UTC and can be started by hand (`workflow_dispatch`). Add the three required names as repository secrets. Actions must be enabled on the repository. The first run downloads the embedding model, so it is slower than later runs.

## Docker and cron

From `worker/`:

```bash
cp ../.env.example ../.env.local   # then fill in the three required values
docker compose build
docker compose run --rm jobspy
```

`docker-compose.yml` reads `../.env.local`. The container runs one pass and exits. `cron.example` is a 10:00 UTC line for a VPS. Rebuild the image when the worker code changes.

## Tests

```bash
python3 -m unittest discover -s worker/tests -v
```

These tests do not install JobSpy or the embedding model.
