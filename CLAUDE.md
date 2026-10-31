# CLAUDE.md

Guidance for Claude and other agents working in this repo. Read this before changing anything.

@AGENTS.md

## What this is

**Following Seas** is the repo; **Fair Winds** is the app's display name. It is a phone-friendly, installable, multi-user job search web app. A person talks to a **Chief of Staff** agent, which dispatches specialist agents:

- **Search**: runs or imports searches and stores the postings.
- **Scoring**: scores each job 1 to 10 against a search profile, with reasons, gaps, unmet must-haves, and any deal-breaker.
- **Tracker**: tracks applications the person made themselves, and reminds them to follow up.
- **Writer** (later): drafts cover letters and notes for the person to review and send themselves.

Every user's data is private to them. Row Level Security enforces it in the database; do not rely on app code alone.

### Data sources (decided)

| Source | How | Enum value |
| --- | --- | --- |
| Indeed | JobSpy worker (`python-jobspy`). Also importable by hand | `indeed` |
| ZipRecruiter | JobSpy worker. Also importable by hand | `ziprecruiter` |
| Glassdoor | JobSpy worker. Also importable by hand | `glassdoor` |
| Google Jobs | JobSpy worker. Also importable by hand | `google` |
| LinkedIn | Apify actor `curious_coder/linkedin-jobs-scraper`, 25 to 50 results per run. Never JobSpy, never an `li_at` cookie | `linkedin` |
| USAJobs | Official API | `usajobs` |
| Manual | Entered by the person | `manual` |

## Hard gates (non-negotiable)

These are enforced in `src/lib/gates.ts`. Every agent action with side effects must call `assertAllowed(action)` first. An action not on the allow-list is refused.

- **Never submit an application.** The person applies themselves.
- **Never use Easy Apply**, on any site.
- **Never send email or messages**, and never message recruiters. Drafts only.
- **Never log in to LinkedIn and never use an `li_at` cookie** or any other session cookie. LinkedIn data comes only from the Apify actor.
- **LinkedIn cap: 25 to 50 results per run.** Use `clampLinkedInResults()` with `LINKEDIN_RESULT_CAP`.
- **Never invent resume facts.** Scoring and writing use only facts the person supplied (their career facts sheet). If a fact is missing, say so; do not guess.
- **Never hard-delete** profiles or jobs. They are soft-deleted (`deleted_at`) and the UI asks for confirmation. The database has no delete policy for them.
- **Never commit secrets.** Keys live in `.env.local` (gitignored) or Vercel env settings. `.env.example` holds names only. Never use the service role key in browser code or in code that runs on behalf of a signed-in user.

Allowed actions: `search`, `import`, `dedupe`, `score`, `shortlist_suggest`, `track`, `remind`, `draft`.
Forbidden actions: `submit_application`, `easy_apply`, `send_email`, `message_recruiter`, `linkedin_login`, `use_li_at_cookie`, `hard_delete`.

Changing either list is a product decision for the owner, not something to do in a refactor. If a change to gates is requested, keep the tests in `src/lib/__tests__/gates.test.ts` in step.

## Stack

- Next.js 16, App Router, TypeScript, React 19. **Next 16 differs from older versions**: `middleware.ts` is now `src/proxy.ts`, and Cache Components is on (`cacheComponents: true`), so reading cookies or other request data in a Server Component must sit inside `<Suspense>`. Read `node_modules/next/dist/docs/` before using an unfamiliar API.
- Tailwind CSS 4 (theme tokens in `src/app/globals.css`; navy `#0b2545`, brass accent).
- Supabase via `@supabase/supabase-js` and `@supabase/ssr`. Clients: `src/lib/supabase/client.ts` (browser), `server.ts` (Server Components and route handlers), `proxy.ts` (session refresh and route protection). All return `null` when env vars are missing so the app builds without them.
- Auth: email one-time code. `/login` emails a code and the person types it (`verifyOtp`), which works across browsers; the emailed PKCE link is a same-browser convenience handled by `/auth/callback`. Never install a session from URL tokens (a test enforces this). `/auth/signout` (POST) signs out. Every other route requires a session.
- Vitest for unit tests. ESLint (`eslint-config-next`).
- Deployed on Vercel. CI on GitHub Actions, Node 22.

## Database

Schema: `supabase/migrations/0001_init.sql`. Add new migrations as `0002_*.sql` and so on; never edit an applied migration.

Tables: `profiles` (search profiles), `queries` (query library per profile and source, with quality good/mixed/noise/untested), `jobs`, `scores`, `decisions` (keep/skip), `applications`, `agent_runs`, `audit_log`.

- Every table has `user_id uuid default auth.uid()` and RLS limiting access to the owner.
- Child tables reference parents through `(id, user_id)` composite foreign keys, so a row cannot point at another user's profile or job.
- `jobs.dedupe_key` is generated as `lower(company)|lower(title)|lower(location)` (nulls as empty) and is unique per user. `src/lib/dedupe.ts` must produce the same string; change both together.
- `audit_log` is append-only (select and insert only). Agents should log what they did there.
- Queries marked `noise` should be `retired = true`.

Seed: `supabase/seed/director-lab-services.sql`, generated by `scripts/generate_director_seed.py`. See README for how to run it with a user id.

## Commands

```bash
npm install
npm run dev         # local dev server
npm run lint        # ESLint
npm run typecheck   # next typegen + tsc --noEmit
npm test            # vitest run
npm run build       # production build; must pass with no env vars set
```

Run lint, typecheck, test, and build before every commit. CI runs the same.

## Roadmap

- **Phase 0, Foundation** (implemented): app shell and PWA basics, email-code auth, schema with RLS, gates, seed, CI.
- **Phase 1, Data sources** (implemented): Indeed, ZipRecruiter, Glassdoor, and Google via the JobSpy worker, LinkedIn via Apify (25 to 50 cap), USAJobs API. The app does not run JobSpy itself.
- **Phase 2, Search and scoring** (implemented): Search agent runs the query library; Scoring agent fills `scores`. Automated query-quality updates remain future work.
- **Phase 3, Shortlist and tracker** (implemented): keep/skip decisions, application tracking and follow-up reminders, plus import from existing `.xlsx` trackers.
- **Phase 4, Chief of Staff** (implemented): chat and the daily Brief.
- **Writer** (partial): review-only drafts for the person to send themselves.

## Conventions

- Mobile first. Test layouts at phone width; the tab bar is fixed at the bottom.
- Keep the look nautical but restrained: navy, sailcloth, a little brass. No novelty icons.
- Plain, calm copy. Empty states explain what will appear and that agents never act for the person.
