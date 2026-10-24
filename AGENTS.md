<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Worker coordination

- **Leadership.** The CEO (coordinator chat) owns priorities, money and budgets,
	owner approvals and owner-assisted steps (Meta, Razorpay, browser sign-in). The
	CTO owns technical direction: who works on what, technical briefs, CI and
	production health, high-impact reviews and lessons. Take work from either. On a
	conflict, money and priority follow the CEO; the technical approach follows the
	CTO.
- **Communication** (Oct 23; #74 is closed). Work talk lives on its issue or PR.
	Hand off with the label plus one line addressed to the next owner with an arrow
	(`→ QA: ready at <sha>`), five lines at most; long evidence goes in the PR. Start
	your own comments with your role (`Dev 2:`); everyone posts as one GitHub user, so
	`QA: …` reads as written *by* QA and `wait-for-work` won't wake QA. No status or idle
	posts. Need the CEO (priority, money rules, owner approval)? Open an issue
	labelled `decision`. Need the CTO? Label `owner:cto`. Blocked on the owner? Label
	`waiting-owner`; only the CEO asks the owner, in one batched list.
- Read [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md) before editing or using
	shared resources: read Current Dispatch, then your GitHub label queue
	(`gh issue list -l core -l owner:<you>`), not historical receipts. When an issue
	is done, hand it off by label and start the next one without waiting.
	Proceed with useful work; do not return only an acknowledgement.
- One writer per source/resource. Low-risk PRs (no migration, money, tenant/auth
	or config change) auto-merge on green CI and the author smoke-tests production.
	DevOps owns migrations, money/tenant releases, config and rollback. Talk directly
	to another owner when needed; do not route routine
	decisions through the CEO or CTO or ask the user to relay worker messages.
- QA reviews high-risk changes and investigates concrete failures, not every
	ordinary release. Authors own focused checks; the release owner owns deployment
	and production smoke. No automatic CEO, CTO or second-QA approval gate.
- Do not interrupt another worker's terminal, server, database, VM or tests, switch
	the shared branch, alter shared credentials or remove another worker's artifacts.
- Hand off the commit, result and any real blocker in the existing issue/PR.
	No separate receipt or manifest project for ordinary committed work. Report local,
	CI and production evidence honestly. A board update cannot wake a stopped chat.
- **When idle, wait briefly, then stop** (owner, Oct 24: no stale background
	processes). Run `node scripts/wait-for-work.mjs --me <dev|dev2|dev3|qa|devops|cto|ceo>`
	from a worktree on current `origin/main`, **in the foreground only**. It returns
	when something is labelled for you, someone comments on your issue, or someone
	addresses you (`→ QA:`, `→ CEO`). Do the work, then wait again. After 30 minutes
	with nothing new it exits: stop there. Never end a turn with anything running in
	the background (waiters, dev servers, watchers, test databases), and close
	finished terminals.
- When you close an issue, add one `Lesson:` line if you learned something reusable
	(what failed, the check that proved it, the fix). The CTO publishes
	these to the shared `skills` and `vbrain-private` repos.
- Keep the owner's checkout (`adbrain/`) clean: it is what the owner sees in
	Source Control. Workers edit, test, merge and release only in isolated worktrees
	under `~/Development/copilot/adbrain-wt/`. `main` is the only long-lived branch: the
	CEO and CTO ship docs edits there as small docs PRs with auto-merge. Never leave a
	merge, staged files or local edits behind.
- **Delete as you go** (owner, Oct 23: lean systems). When work is done, delete its
	branch, worktree, one-off scripts and temporary files. Don't commit dated
	reports, audits or handoffs; evidence goes in the issue or PR. Docs hold current
	truth only, and git keeps the history.

## Execution speed

- **Owner rule (Oct 21): develop fast, directly in production, as long as the core
	is not broken.** Build a small slice, open a PR, let it auto-merge on green CI,
	check it in production, move on. No staging, no extra approvals, no reports.
- The only things that slow this down on purpose: the core check and production
	smoke (below), money (charges, refunds, ad spend) and secrets. Everything else is
	the author's call.
- Do not ask permission for routine steps. Report a real blocker once, with the
	exact missing action, and keep working on something else meanwhile.

## Subagents

- **Use subagents to go faster** (owner, Oct 21). Split an issue into independent
	parts and run them in parallel: research, CI logs, running tests, reviewing your
	own diff, a red test, a small adjacent fix, the doc update.
- **Do small cross-role tasks yourself** with a subagent instead of handing them
	off. DevOps needing a quick QA-style check starts a subagent; it does not route
	the task to QA. Hand off only what needs another owner: migrations, money,
	production settings, secrets and rollback (DevOps), independent review of a
	high-risk change (QA), or files another worker is editing right now.
- **You own the result.** Brief each subagent (goal, files it may change, checks,
	what to return), review its output and commit it yourself. Subagents work in your
	worktree or their own under `adbrain-wt/`, one writer per file. No paid AI runs,
	Meta writes, production settings or secrets unless the brief allows them. At most
	one heavy job per worker at a time (full suite, build, dev server or browser):
	all workers share one Mac. Read-only subagents can run in parallel.

## Skills

- **Open-source skills** live in `.github/skills/` (list, sources and licenses in
	[SOURCES.md](.github/skills/SOURCES.md)). They cover UI design, React/Next speed,
	Postgres/Supabase, debugging, red-test-first, browser QA, security review, CI
	hardening and planning with subagents. Load the matching skill before the task.
- They are advice: this file and `docs/ORCHESTRATION.md` win on any conflict.
	"Your human partner" means the issue's owner (the CTO for technical calls, the
	CEO for priority and money); decide and note it on the issue, never ask the
	owner directly. Plans and review scratch stay out of git (`.superpowers/` is
	ignored). No deploys, `db push`, global installs or production changes because
	a skill says so; your role's normal limits still apply.

## Engineering priorities and reuse

- **Core features come first, always.** AdBrain's core is: Brand, Create ads,
	review, launch a Meta campaign, manage it (sync/pause/results). Before anything
	else, that loop must work reliably in production. Spend time on other work
	(polish, performance, docs, compliance, support, analytics) only while the core
	loop is healthy, or when the owner asks for it. When in doubt, ask: does this
	help a customer make and run ads today?
- **Never break the core.** Generating ads and running campaigns must keep working
	after every change. No change merges unless the core regression check
	(`test:core`, the required `core` CI job) passes. Any change to
	generation, validation, prompts, models, timeouts, the planner, Meta calls or
	CSP must add or update a core test with recorded real responses, not only mocks.
	After every production deploy the core smoke runs; if it fails, roll back first
	and debug second. Change production AI or Meta settings only with a recorded
	before and after, followed by the smoke. A non-core change that breaks the core
	is reverted, not patched forward.
- Track work in GitHub: one issue per real problem with the `core` or `later`
	label, linked commits/PRs, and close the issue when the fix is live. Close or
	park stale issues rather than leaving them open with old status.
- Prefer existing dependencies, official SDKs and maintained libraries over
	rebuilding standard pieces. Keep custom code to AdBrain's own business rules.

## Branches and deployments

- Branch from current `origin/main`, open a PR to `main`, enable auto-merge.
	`main` is production; Vercel deploys it automatically. Branches do not need to
	be up to date with `main`; required checks are build, test, core and secrets.
- Migrations, production settings and rollbacks go through DevOps. Never
	force-push or run `npm run db:push` against production.
- Update the matching doc in the same PR when you change a route, schema or
	setting. No separate documentation work.

## Local development servers

- Reuse an existing healthy dev server when possible.
- Start temporary browser-validation servers with `npm run dev` so the configured memory limit applies.
- Stop any server you start as soon as browser validation is complete unless the user explicitly asks to keep it running.
- Do not leave dev servers detached or orphaned after an agent session.
