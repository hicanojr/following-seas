<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Code-review routing

Greptile is the primary PR reviewer. Gemini is a manually requested backup only when Greptile is unavailable or a maintainer needs a second opinion. Use the existing Gemini dispatcher, never launch duplicate automatic reviews. Keep tests, security scanning, human review, and branch protections unchanged. This policy concerns code review, not runtime AI model calls. Future projects should inherit this policy, with repository access and an actual current-commit Greptile review verified before claiming activation.
