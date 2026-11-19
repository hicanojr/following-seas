# Deploy checklist (Drako's progress bar)

100% means ready to deploy, not deployed. Deploying still needs Drako the Destroyer's explicit OK.

## Done (verified)

- [x] Phases 0–4 implemented and merged to `main` (Foundation, Data sources, Search/scoring, Shortlist/tracker, Chief of Staff) — latest commit acd8494, PR #9
- [x] `npm run lint` passes
- [x] `npm run typecheck` passes (`next typegen` + `tsc --noEmit`)
- [x] `npm test` passes — 307 tests across 30 files
- [x] `npm run build` passes with no env vars set (all 23 routes generated)
- [x] Docs corrected: README status line and CLAUDE.md roadmap reflect implemented phases
- [x] `BOARD.md` and `HANDOFF.md` created

## Left to do (not deployed yet)

- [ ] Commit `BOARD.md`, `HANDOFF.md`, `README.md`, `CLAUDE.md`, and this `DEPLOY_CHECKLIST.md`
- [ ] Create `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for local sign-in testing (never commit; `.env*` is gitignored)
- [ ] Provision a Supabase project and run migrations `0001_init` through `0007_jobspy` (SQL Editor or `npx supabase db push`)
- [ ] Set Vercel environment variables (server-only where marked): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `APIFY_TOKEN`, `USAJOBS_API_KEY`, `USAJOBS_USER_AGENT`, plus optional `SCORING_MODEL`, `CHIEF_MODEL`, `DAILY_SEARCH_CAP`
- [ ] Import the GitHub repo in Vercel and deploy (framework preset: Next.js)
- [ ] Add `https://<vercel-domain>/auth/callback` to Supabase Authentication > URL Configuration redirect URLs
- [ ] Greptile PR review passes (Gemini manual backup via `@gemini_cli /review`)
- [ ] End-to-end smoke test of the deployed app: magic-link sign-in, `/brief`, `/chief`, `/jobs`, `/profiles`, `/tracker`
- [ ] Configure the JobSpy worker (Docker cron / GitHub Actions schedule) and its env vars (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `JOBSPY_*`, `EMBEDDING_*`)
- [ ] Run `supabase/migrations/0006_brief.sql` before the first scheduled daily run; run `0007_jobspy.sql` before the first worker run

## Notes

- Do not commit `.env.local` or any secrets. `.env.example` holds names only.
- The worker (Indeed/ZipRecruiter/Glassdoor/Google via JobSpy) runs outside the Next.js app; it is a separate deploy target.
- 100% checked = ready to deploy. Actual deploy requires Drako the Destroyer's explicit OK.
