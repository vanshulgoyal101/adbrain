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
	(`→ QA: ready at <sha>`), five lines at most; long evidence goes in the PR.
	New issues and PRs follow the [work](.github/ISSUE_TEMPLATE/work.md) and
	[PR](.github/pull_request_template.md) templates: why, do, done-when, files, risk,
	next owner.
	**Every comment that finishes your part names who acts next** (`→ DevOps: release`,
	`→ Dev: yours`), and a verdict on a release PR always ends with `→ DevOps`. Move the
	`owner:` label to whoever acts next. Start PR titles with the issue number (`#274 …`)
	so the issue's owner hears about the PR. Start
	your own comments with your role (`Dev 2:`); everyone posts as one GitHub user, so
	`QA: …` reads as written *by* QA and `wait-for-work` won't wake QA. No status or idle
	posts. Need the CEO (priority, money rules, owner approval)? Open an issue
	labelled `decision`. Need the CTO? Label `owner:cto`. Blocked on the owner? Label
	`waiting-owner`; only the CEO asks the owner, in one batched list.
- **GitHub queue first; direct chat messages rarely** (owner, Oct 26). Work and
	handoffs go on GitHub: the `owner:<role>` label plus a `→ <Role>:` comment on the
	issue or PR. The receiver's `wait-for-work` wakes on that. Messages sent straight
	into another chat get folded into its running turn or sit unread, so they are not
	a work channel.
	Send a direct chat message (`send_message`, links in pinned #819) **only** to:
	1. wake a chat that is idle (turn complete, no waiter running) when it has queued
		work: one line pointing at the issue, `queue` delivery;
	2. stop a chat doing something harmful or obsolete right now (P0), with `steer`.
	Never stack messages; replace or cancel a pending one. **Never end a turn
	silently:** before stopping, run your waiter or post `→ <Role>` for what's next.
- Read [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md) before editing or using
	shared resources: read Current Dispatch, then your GitHub label queue
	(`gh issue list -l core -l owner:<you>`), not historical receipts. When an issue
	is done, hand it off by label and start the next one without waiting.
	Proceed with useful work; do not return only an acknowledgement.
- One writer per source/resource. Low-risk PRs (no migration, money, tenant/auth
	or config change) auto-merge on green CI and the author smoke-tests production.
	Auto-merge is only for low-risk PRs; the required `core-approval` check holds any
	PR touching Meta/launch/money paths or migrations until QA, the Reviewer or the
	CTO approves its head (#926). To hold a PR, `gh pr merge <n> --disable-auto`: a
	hold comment can't stop auto-merge.
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
	processes). Run `node scripts/wait-for-work.mjs --me <dev|dev2|dev3|qa|qa2|reviewer|devops|cto|ceo>`
	from a worktree on current `origin/main`, **in the foreground only**. It first
	lists any item you own where someone else spoke last (said while you were busy),
	then returns when something is labelled for you, someone comments on your issue
	or a PR whose title names it, or someone addresses you (`→ QA:`, `→ CEO`). Do the
	work, then wait again. Before waiting, finish your row on the [Team board](https://github.com/vanshulgoyal101/adbrain/issues/580) in order.
	A scheduled check (live-run reads) ends your comment with `Next read 2026-10-25T16:00Z`:
	the item stays quiet until then, and the waiter wakes you when it's due.
	**Never idle with briefed work around (pull, don't wait):** when nothing you own is
	actionable, the waiter offers the oldest `ready` issue in your lane (`lane:dev`,
	`lane:qa`, `lane:devops`, `lane:review`; core first). Claim it with the printed command
	and start. While a PR waits for review, pull the next item instead of waiting on it.
	**Restart-proof:** end each work step with the issue's latest comment saying what's
	done and what's next, and push the branch. If it isn't in GitHub or git, it doesn't
	survive a chat restart. Restart a chat with one line: `You are <Role> on AdBrain. Run
	node scripts/wait-for-work.mjs --me <role> and continue.` It prints your role card, your
	in-flight work and any unsaved worktree. After 30 minutes
	with nothing new it exits: **run it again**, don't stop (owner, Oct 27: no idle team
	members). Between waits, pull the next item from your board row or an unowned `core`
	issue in your area. Stop only if the CEO says so or the Mac is shutting down. Never end a turn with anything running in
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
- **Every role may spin up its own helpers** (owner, Oct 26): subagents, background
	agents, research assistants, or a separate helper chat (`create_session`) for a
	long, self-contained slice. No approval needed; the measure is a better product.
	Title a helper chat `<Role> helper: <issue>` and post its link on the issue. It
	works under your role and label (it signs `<Role> (helper):`), and you close it
	when the slice ships. A new standing role (a new label and waiter name) still goes
	through the CEO.
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

- **Before any task, load the matching skills** (owner, Oct 24). `wait-for-work`
	prints them next to each item from the map below; this table is the only copy.
	Open-source skills and ours live in `.github/skills/` (sources, pins and licenses
	in [SOURCES.md](.github/skills/SOURCES.md); ours sync from the `skills` repo with
	`node scripts/sync-own-skills.mjs`).
- **No good match? Get one:** search maintained sources (anthropics/skills,
	obra/superpowers, vercel-labs/agent-skills, supabase, trailofbits), check the
	licence, add the folder plus a SOURCES.md row in a small auto-merge PR, then
	use it. Pre-approved. Reusable lessons go to the CTO as `Lesson:` lines, who
	publishes them to the `skills` repo and re-syncs.

| Task | Keywords (title or label) | Skills |
| --- | --- | --- |
| UI and visual design | ui, design, look, phone, homepage, sign-up, screen, layout, dead space, professional, polish | frontend-design, web-design-guidelines |
| Speed | slow, speed, faster, snappy, lcp, perf, load, waterfall | core-web-vitals, vercel-react-best-practices |
| Database and migrations | migration, database, rls, supabase, index, advisor, schema | supabase-postgres-best-practices, supabase-rls-complete |
| Bug or failure | bug, fails, failure, error, broken, stuck, wrong, 500, 429 | systematic-debugging, test-driven-development |
| Money, tenant, auth | money, payment, razorpay, tenant, auth, security, quota | differential-review, security-boundary-contracts |
| AI models and prompts | model, llm, ai, provider, prompt, groq, gemini, openrouter | task-aware-llm-routing, provider-cooldown-rotation |
| Ad images and generation | image, render, creative, font, 9:16, picture, create | validated-multimodal-generation, verification-before-completion |
| Meta and external APIs | meta, whatsapp, insights, campaign, graph, advantage | meta-ads-campaign-qa, external-api-error-contracts, verification-before-completion |
| Release, deploy, rollback | release, deploy, rollback, promote, guard | post-deploy-production-guard, vercel-deploy-pipeline |
| Incident | smoke failed, production is not, outage, incident, down, sev, postmortem | sev-triage, postmortem-writer |
| CI and workflows | ci, workflow, actions, scheduler, cron | github-actions-hardening, ci-merge-throughput |
| QA walks and live checks | walk, verify, live check, qa, screenshot | playwright-cli, rendered-ui-evidence |
| Coordination | queue, handoff, worker, orchestration, roles, skills | multi-worker-delivery, dispatching-parallel-agents |
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
- **Lean (owner, Oct 28: no bloatware; #1171).** Delete before you add: every
	feature PR removes or simplifies something, or says why not. Build only what a
	customer or the owner needs now; no speculative features. Removing existing
	features, flags, scripts, docs or workflows needs the owner's scope on the
	issue. Every removal PR tags the last commit that still has it
	(`removed/<name>`), adds its row to the pinned log #1173, and never drops a
	column or table.

## Branches and deployments

- **Deploy train (#461; Vercel Hobby allows 100 deploys a day).** Branch from current
	`origin/next` (`bash scripts/wt.sh <issue>` does it), open a PR to **`next`**, enable
	auto-merge. A PR opened against `main` is retargeted to `next` automatically.
	`main` is production; the deploy train promotes a green `next` to `main` at most
	every 30 minutes, so your change is live within about 30 minutes of merging. Smoke it
	then. Hotfixes and migration/money releases go to `main` (DevOps or CTO; label
	`hotfix`). Required checks are build, test, core and secrets.
- Migrations, production settings and rollbacks go through DevOps. Never
	force-push or run `npm run db:push` against production.
- Update the matching doc in the same PR when you change a route, schema or
	setting. No separate documentation work.

## Local development servers

- Reuse an existing healthy dev server when possible.
- Start temporary browser-validation servers with `npm run dev` so the configured memory limit applies.
- Stop any server you start as soon as browser validation is complete unless the user explicitly asks to keep it running.
- Do not leave dev servers detached or orphaned after an agent session.
