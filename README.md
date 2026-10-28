# Following Seas

Fair Winds job search app: a Chief of Staff agent and specialist agents that find, score, and track jobs.

It is a phone-friendly, installable web app. Each person signs in with an email link and sees only their own data. Agents search, score, and track. They never apply, never use Easy Apply, and never contact anyone on your behalf. See [CLAUDE.md](CLAUDE.md) for the full rules.

**Status:** Phase 0 (foundation). The app shell, sign-in, database schema, and agent gates are in place. Agents come in later phases.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Supabase (Postgres, Auth, Row Level Security) · Vitest · Vercel

## Setup

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. In **Authentication > Sign In / Providers**, make sure **Email** is enabled. Magic links are on by default.
3. In **Authentication > URL Configuration**, set **Site URL** to your app's URL (for local work, `http://localhost:3000`) and add `http://localhost:3000/auth/callback` and `https://<your-vercel-domain>/auth/callback` to **Redirect URLs**.

### 2. Run the migration

Either paste `supabase/migrations/0001_init.sql` into the **SQL Editor** and run it, or use the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

This creates the tables, enums, and Row Level Security policies.

### 3. Seed the Director of Laboratory Services profile (optional)

Sign in to the app once with the account that should own the profile. Find its user id in **Authentication > Users**. Then, in the SQL Editor, run this line followed by the contents of `supabase/seed/director-lab-services.sql`:

```sql
select set_config('seed.user_id', '<USER_UUID>', false);
```

Or with psql (use the connection string from **Project Settings > Database**):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "select set_config('seed.user_id', '<USER_UUID>', false)" \
  -f supabase/seed/director-lab-services.sql
```

The seed is safe to run more than once. It inserts one profile and 31 queries from the trial; the 13 Noise queries are marked retired. To regenerate it from the trial workbook: `python3 -I scripts/generate_director_seed.py <path-to-xlsx> > supabase/seed/director-lab-services.sql` (needs `openpyxl`).

### 4. Set environment variables

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from **Project Settings > API**. The other keys are for later phases. Never commit `.env.local`.

Without the Supabase variables the app still builds and runs, but every page sends you to the sign-in screen, which explains what is missing.

### 5. Run locally

Requires Node 22.

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm start`.

### 6. Deploy to Vercel

1. Import the GitHub repo in [Vercel](https://vercel.com/new). The framework preset is Next.js; no build settings need changing.
2. Add the environment variables from `.env.example` in **Settings > Environment Variables**. Mark `SUPABASE_SERVICE_ROLE_KEY` and the API keys as server-only (they must not start with `NEXT_PUBLIC_`).
3. Deploy, then add `https://<your-vercel-domain>/auth/callback` to the Supabase redirect URLs (step 1).

On a phone, open the site and use **Add to Home Screen** to install it.

## Scheduled runs

Vercel Cron calls `GET /api/cron/daily` once a day at 11:00 UTC (see `vercel.json`). For each person with at least one active search profile, and the daily run left on (the switch at the bottom of `/brief`), it:

1. Runs their non-retired LinkedIn and USAJobs queries through the Search agent, stalest first. LinkedIn stays at 25 to 50 results per run. Indeed, ZipRecruiter, Glassdoor, and Google are not run here; the [JobSpy worker](worker/README.md) runs those. Queries marked noise are skipped.
2. Scores the new jobs, only when `ANTHROPIC_API_KEY` is set.
3. Stores that day's brief in the `briefs` table. `/brief` and `GET /api/brief` show it.

Every step is logged to `agent_runs` and `audit_log`. Nothing is emailed, messaged, or pushed; the brief is read in the app.

Settings (server only, in Vercel **Settings > Environment Variables**):

- `CRON_SECRET`: required. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`. Without it the route returns 503; with a wrong header, 401.
- `SUPABASE_SERVICE_ROLE_KEY`: required for the daily run. There is no signed-in person on a scheduled call, so this route (and only this route) uses the service role key, which bypasses Row Level Security. All of its queries filter by the person's user id explicitly (`src/lib/brief/daily.ts`, `load.ts`, `scoped-search-store.ts`); a test checks that nothing else imports the service role client.
- `DAILY_SEARCH_CAP`: optional, default 10. Most searches per person per day, counting searches they ran by hand that day.
- `APIFY_TOKEN`, `USAJOBS_API_KEY`, `USAJOBS_USER_AGENT`: a source without its keys is skipped.

Run `supabase/migrations/0006_brief.sql` before the first scheduled run. To try it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/daily`.

## JobSpy worker

A separate Python program searches Indeed, ZipRecruiter, Glassdoor, and Google, writes the postings (including the posting URL), embeds the resume and the postings, parses the base resume once, and stores keyword suggestions. It does not run inside the Next.js app. LinkedIn stays on Apify.

Setup, the Docker cron, the GitHub Actions schedule, and the environment variable names are in [worker/README.md](worker/README.md). Run `supabase/migrations/0007_jobspy.sql` before the first worker run. Paste the base resume on the Profiles tab.

When a resume embedding exists, scoring sends only the closest quarter of postings to Claude. Keyword lists on each job are suggestions only. Agents still never apply, never use Easy Apply, and never message anyone.

## Project layout

```
src/app/(app)/        Brief, Jobs, Profiles, Tracker (signed-in pages with the tab bar)
src/app/login/        Magic-link sign-in
src/app/auth/         Magic-link callback and sign-out
src/proxy.ts          Session refresh and route protection (Next 16 "proxy", formerly middleware)
src/lib/gates.ts      Agent allow-list, forbidden actions, LinkedIn result cap
src/lib/dedupe.ts     Job dedupe key, mirrors the SQL generated column
src/lib/supabase/     Browser, server, and proxy Supabase clients
supabase/migrations/  Database schema and RLS
supabase/seed/        Seed data
scripts/              Seed generator
worker/               JobSpy search, embeddings, resume parse (Python)
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, and build on every pull request and on pushes to `main`.
