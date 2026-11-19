# Following Seas — Task Board

| ID | Task | Owner | Status | Last updated |
|----|------|-------|--------|--------------|
| T-01 | Set up project tracking (BOARD.md, HANDOFF.md) | Cline | done | 2026-11-18 |
| T-02 | Install dependencies and verify lint/typecheck/test/build pass | Cline | done | 2026-11-18 |
| T-03 | Update stale README/CLAUDE.md roadmap (says Phase 0; Phases 0-4 are merged) | Cline | done | 2026-11-18 |
| T-04 | Phase 5 / Writer: cover letter and note drafts for the person to review and send | Cline | done | 2026-11-19 |
| T-05 | Create DEPLOY_CHECKLIST.md (deploy-checklist rule) | Cline | done | 2026-11-18 |

## Notes
- All Phases 0-4 (Foundation, Data sources, Search/scoring, Shortlist/tracker, Chief of Staff) are merged to `main` per git history.
- `node_modules` is installed; `.env.local` does not exist. The app builds without Supabase env vars.
- CI runs lint, typecheck, tests, and build (no env vars) plus worker unit tests on every push/PR.
- Owner on this board: address as Drako the Destroyer; Hector means the same person.
