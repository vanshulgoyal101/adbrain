<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Worker coordination

- Read [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md) before editing or using
	shared resources: read its Current Dispatch and your assigned issue, not every
	historical checkpoint. Include role, scope and conflicts in the first work update;
	do not end a turn with only an acknowledgement when work can proceed.
- Follow its single-writer register and applicable contract gates. Discuss needed
	interfaces directly with their owner; involve the coordinator for conflicts or
	material scope/policy changes, not routine helper names or local setup.
- QA owns independent acceptance, DevOps owns release execution, and the coordinator
	owns priorities and the central board. Workers maintain their own evidence receipts.
- Do not interrupt another worker's terminal, server, database, VM or tests, switch
	the shared branch, alter shared credentials or remove another worker's artifacts.
- Hand off an exact commit or reproducible source manifest. Keep implementation,
	local acceptance, hosted checks, provider evidence and production verification separate.
- The board is advisory coordination, not automatic dispatch, locking or permission
	for production actions. The release and approval rules below remain in force.

## Execution speed

- The assigned issue is authority for related implementation, helpers, tests and
	issue-local dependencies. Do not request permission again for each routine step.
- Choose work that completes a core customer workflow, clears a real blocker or
	reduces a demonstrated recurring cost. Idle capacity is better than invented work.
- Deliver the assigned customer outcome; defer optional polish, speculative
	abstractions and unrelated edge cases. Financial, tenant and security protections
	are required, not optional polish.
- Own routine decisions inside your isolated issue worktree: reuse or create its
	allocation, add necessary helpers/tests, install scoped dependencies, and commit.
	Under the board's publication authority, push only your feature branch and open
	its PR after deployment-policy checks. Do not wait for DevOps to perform these
	steps; shared integration, main and production remain single-executor operations.
- Find the deciding code and a focused check, then implement. Prefer existing
	tests, commands and maintained libraries; do not build a new validation harness
	or research report for each routine change.
- Run focused author checks as code changes. Reuse matching exact-candidate
	evidence; let required CI provide the canonical full gates. Do not repeat a full
	suite/build, dependency install, audit or source hash scan without a changed input,
	actual failure or required environment check. Never skip required CI or tests.
- QA can review the diff while checks run and make approval conditional on green
	required checks. Non-blocking suggestions go to the backlog. Unchanged green CI
	does not require another review session just to copy its results.
- Keep handoffs short: issue/PR, exact source, result, blocker and next owner.
	Reference existing evidence once. A blocker must name the missing decision or
	failing command and the work that can continue; no repeated status-only handoffs.
- The current publication hold overrides general push permission until resolved.
	Do not interrupt active work or change release controls to adopt process updates.

## Engineering priorities and reuse

- Prioritize complete, high-value customer workflows over isolated polish or rare
	edge-case features. Retain essential financial, privacy and security protections.
- Before building a substantial capability, check existing project dependencies,
	official provider SDKs and maintained open-source solutions. Prefer integration
	over recreating standard authentication, payment APIs, scheduling or parsing.
- Evaluate actual feature coverage, maintenance, security history, license,
	runtime compatibility and total operating cost; popularity alone is not trust.
	Prefer the smallest suitable dependency and verify its current documented APIs.
- Keep custom code focused on AdBrain's business rules and thin integration
	boundaries. SDKs do not replace tenant authorization, local persistence,
	allocation/reconciliation rules or approval to spend customer funds.
- Briefly record the reuse choice and remaining gaps in the existing worker
	handoff. Avoid a new research/documentation project for every dependency choice.
- Replace existing custom code only when the benefit exceeds migration risk and
	maintenance cost; preserve behavior and tests. Do not disrupt an active release
	or start a broad rewrite merely to adopt a library.

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
