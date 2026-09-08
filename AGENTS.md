<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Branches and deployments

- Read [docs/RELEASING.md](docs/RELEASING.md) before branching, committing,
	pushing, opening a release PR, deploying, migrating, or changing credentials.
- Develop on `dev` or a feature branch based on it, not `main`. Preserve unrelated
	local changes; never reset or stash them just to prepare a release.
- `main` is live production. Promote only a tested, dependency-complete change
	through a PR with passing required checks. Never bypass branch protection,
	force-push, or merge all of `dev` when it contains unfinished work.
- Do not run `vercel --prod`, `npm run db:push`, credential backfills, or enable
	preview deployments without explicit authorization for that operation and
	verification of the target environment. A Git push is not migration approval.
- `dev` Git deployments are disabled. Other branches are not automatically
	isolated: check Vercel deployment rules and credentials before pushing them.
- Separate local tests, hosted CI, real-provider verification, and production
	deployment evidence in reports. Mocked Meta consent is not real consent.

## Local development servers

- Reuse an existing healthy dev server when possible.
- Start temporary browser-validation servers with `npm run dev` so the configured memory limit applies.
- Stop any server you start as soon as browser validation is complete unless the user explicitly asks to keep it running.
- Do not leave dev servers detached or orphaned after an agent session.
