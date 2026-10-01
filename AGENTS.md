<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Worker coordination

- Read [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md) before editing or using
	shared resources: read Current Dispatch, then your GitHub label queue
	(`gh issue list -l core -l owner:<you>`), not historical receipts. When an issue
	is done, hand it off by label and start the next one without waiting.
	Proceed with useful work; do not return only an acknowledgement.
- One writer per source/resource, one executor for production. DevOps owns the
	active release. Talk directly to another owner when needed; do not route routine
	decisions through the coordinator or ask the user to relay worker messages.
- QA reviews high-risk changes and investigates concrete failures, not every
	ordinary release. Authors own focused checks; the release owner owns deployment
	and production smoke. No automatic coordinator or second-QA approval gate.
- Do not interrupt another worker's terminal, server, database, VM or tests, switch
	the shared branch, alter shared credentials or remove another worker's artifacts.
- Hand off the commit, result and any real blocker in the existing issue/PR.
	No separate receipt or manifest project for ordinary committed work. Report local,
	CI and production evidence honestly. A board update cannot wake a stopped chat.
- Keep the owner's checkout (`adbrain/`) clean: it is what the owner sees in
	Source Control. Workers edit, test, merge and release only in isolated worktrees
	under `/tmp`. The coordinator edits only docs there and commits and pushes them
	to `dev` immediately. Never leave a merge, staged files or local edits behind.

## Execution speed

- This is the standing default for every new feature, improvement and bug fix,
	not a payment-specific exception or temporary release mode. Apply it from scope
	and architecture through implementation, testing and deployment. Choose the
	simplest maintainable path to a complete customer outcome; add process only for
	a concrete risk, not because a new feature or worker handoff has started.
- September 28 owner direction: build and ship like a small startup. Default loop:
	implement a complete useful slice, run focused checks and required CI, deploy,
	then smoke-test in production. Staging and exhaustive local/browser replay are
	not default prerequisites. Follow [the fast release policy](docs/RELEASING.md#startup-fast-path).
- Assigned work includes routine implementation, scoped dependencies, tests,
	isolated worktree setup, commits and permitted publication. Do not ask permission
	again for each step. Keep production single-executor; preserve branch protection.
- Production testing is authorized for bounded, reversible, non-financial checks
	on owner-controlled or synthetic data. No blanket permission to charge/refund,
	spend on providers, activate ads, expose secrets or damage customer data.
- QA may run alongside implementation/CI; ordinary changes do not wait for a
	separate QA session. Money, tenant/auth boundaries and irreversible data changes
	need focused pre-release evidence. Reuse accepted evidence; a mechanical correction
	with no behavioral change does not reset acceptance when the release owner verifies
	the delta and its relevant check passes.
- Let required CI perform full gates. Do not duplicate full suites/builds, audits,
	installs or source scans without changed inputs or an actual failure. Never disable
	required checks, hide failures or bypass financial/security protections for speed.
- Fix ordinary UX failures in production or roll back promptly. A broken automation
	bridge is not itself a release gate: use working CLI/API access and owner manual
	smoke checks where appropriate. Missing authenticated target access remains real.
- Report an actual blocker once with the exact missing action. Continue independent
	work; do not turn waiting into repeated board edits, issue comments or user relays.
	No new research report, test harness or process document for a routine change.
- Deliver whole customer workflows and demonstrated fixes, not speculative polish.
	Workers can finish independent assigned work while one release is blocked; do not
	invent work just to occupy them. Historical holds do not override current authority.

## Engineering priorities and reuse

- **Core features come first, always.** AdBrain's core is: Brand, Create ads,
	review, launch a Meta campaign, manage it (sync/pause/results). Before anything
	else, that loop must work reliably in production. Spend time on other work
	(polish, performance, docs, compliance, support, analytics) only while the core
	loop is healthy, or when the owner asks for it. When in doubt, ask: does this
	help a customer make and run ads today?
- Track work in GitHub: one issue per real problem with the `core` or `later`
	label, linked commits/PRs, and close the issue when the fix is live. Close or
	park stale issues rather than leaving them open with old status.
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

## Documentation

- Use [docs/README.md](docs/README.md) to find the canonical guide and follow its
	maintenance rules. Update the owning reference with route, schema, configuration,
	workflow or operational changes; link shared definitions instead of duplicating them.
- Ground examples and claims in deciding code, tests and exact release evidence.
	Distinguish source, branch-only, migration-dependent, test-only, planned and deployed
	behavior. A new date or a passing local test is not production verification.
- Write for the reader's task: prerequisites, supported steps, expected result,
	failure recovery and limitations. Keep examples synthetic and identify side effects.
- Preserve historical receipts and stable links. Mark superseded plans explicitly;
	do not rewrite old evidence as current fact. Run relevant documentation checks;
	prose-only changes do not justify repeated application or provider tests.

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
