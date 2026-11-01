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
	**A hand-off comment names who acts next** (`→ DevOps: release`,
	`→ Dev: yours`), and a verdict on a release PR always ends with `→ DevOps`. Move the
	`owner:` label to whoever acts next. Start PR titles with the issue number (`#274 …`)
	so the issue's owner hears about the PR. Start
	your own comments with your role (`Dev 2:`); everyone posts as one GitHub user, so
	`QA: …` reads as written *by* QA and `wait-for-work` won't wake QA. No status or idle
	posts. Need the CEO (priority, money rules, owner approval)? Open an issue
	labelled `decision`. Need the CTO? Label `owner:cto`. Blocked on the owner? Label
	`waiting-owner`; only the CEO asks the owner, in one batched list.
	**The repo is public** (#1605): evidence that includes a customer's name, phone,
	email or Meta id goes in `vbrain-private`; the issue gets only an opaque key.
- **Trails, not talk** (owner, Oct 30; experiments measured weekly on #2360). Agents
	coordinate through the shared world, not announcements: the code on `next`, CI,
	production, labels and PR state *are* the status. Comment only to hand off to
	another owner, record a decision or attach evidence; never to say what you are
	about to do, are doing or just pushed. Don't ask others to adapt to your change:
	make it, and if it breaks work already merged, fixing that is part of your
	change. **One owner end to end:** the author takes an issue from code to production
	smoke and hands off only at a hard gate (money, Meta writes, migrations, secrets,
	production settings, `core-approval`). **Fix forward:** a red `next` or a non-core
	break in production gets a fix PR on top from whoever sees it first, with no author
	ping; a core break in production still rolls back first. **Try to break it
	yourself:** before asking for `core-approval`, run a subagent that did not write
	the change to attack it, and paste its one-line result in the PR.
- **GitHub queue first; direct chat messages rarely** (owner, Oct 26). Work and
	handoffs go on GitHub: the `owner:<role>` label plus a `→ <Role>:` comment on the
	issue or PR. The receiver's `wait-for-work` wakes on that. Messages sent straight
	into another chat get folded into its running turn or sit unread, so they are not
	a work channel.
	**A running chat reads no chat messages** (Nov 1): a `steer` to a worker mid-turn
	stayed "processing" for hours (DevOps had three), and a `queue` message lands only
	when the turn ends. So reach a busy worker through GitHub, which its waiter and
	`gh` calls read: the `owner:` label plus `→ <Role>:` on the issue, or a
	team-wide rule in the Everyone row of #580 (every waiter run prints it).
	Send a direct chat message (`send_message`, `queue` delivery) **only** to start
	a chat whose turn has ended (status idle): one line pointing at the issue. To stop
	harm right now (P0), kill the harmful process by PID and post the rule on its issue.
	Never stack messages; replace or cancel a pending one. **Never end a turn
	silently:** before stopping, run your waiter or post `→ <Role>` for what's next.
- Read [docs/team/orchestration.md](docs/team/orchestration.md) before editing or using
	shared resources: read Current Dispatch, then your GitHub label queue
	(`gh issue list -l core -l owner:<you>`), not historical receipts. When an issue
	is done, hand it off by label and start the next one without waiting.
	Proceed with useful work; do not return only an acknowledgement.
- One writer per source/resource. Low-risk PRs (no migration, money, tenant/auth
	or config change) auto-merge on green CI and the author smoke-tests production.
	Auto-merge is only for low-risk PRs; the required `core-approval` check holds any
	PR touching Meta/launch/money paths or migrations until QA, the Reviewer or the
	CTO approves its head (#926); wording-only changes and docs pass on green CI
	(money wording needs one approval). To hold a PR, `gh pr merge <n> --disable-auto`: a
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
	issue in your area. **Never run the waiter while you own an item you can act on**
	(owner, Oct 28): having posted last on it doesn't make it done. Close it, or work it.
	The waiter enforces this (#2122): if you own any item not labelled `waiting-owner`,
	`blocked`, `parked`, `decision`, `later` or `standing`, it prints the top 3 and exits 6
	instead of waiting.
	**Outcome first, not activity (owner, Oct 30: 1,071 contributions on Oct 29 moved
	the core very little).** The CTO keeps every worker on the next item that passes the
	#580 filter (core loop works in production, an outside pilot goes live, or cost
	per enquiry drops), not on a ticket count; when none exists, the worker runs the
	waiter instead of opening docs, wording, translation, refactor or process tickets.
	One coherent customer fix is one PR with one writer, not split across files. The
	CEO checks hourly that workers are on that outcome and wakes them. Stop only if the CEO says so or the Mac is shutting down. Never end a turn with anything running in
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
- **Never lose built work** (owner, Oct 28). Paused work gets the `parked` label
	and a row with its resume trigger in #1258; keep its PRs open as drafts and its
	branches. Before deleting any branch or worktree, `git cherry origin/main <branch>`
	shows no `+` lines (or the work is in an open PR or #1258), and uncommitted edits
	are pushed to a branch first. Removed product features go in #1173.
- **Two env files only** (owner, Oct 29: neat repo). Secrets go in `.env.local`, every
	test login in `.env.smoke` (in the owner's checkout), and the committed template is
	`.env.example`. Never create another `.env.*` file or leave files in the owner's
	checkout root. Evidence, screenshots, recordings and one-time sign-in links go in the
	issue or PR (private data in vbrain-private), never in a file in the repo folder.

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

- **Copilot Fusion, high intelligence** (owner, Oct 29). Role chats run on Copilot
	Fusion (the default; 30% cheaper), which routes each request by difficulty. Work at a
	high level of intelligence so Fusion routes you to its stronger models: think
	carefully, reason through edge cases and verify before claiming. Brief every subagent
	or helper chat the same way ("use a high level of intelligence"); don't pin a model.
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
- They are advice: this file and `docs/team/orchestration.md` win on any conflict.
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
- **Build it properly, from the ground up (owner, Oct 29: no makeshift updates).**
	Speed comes from small slices, not from shortcuts. Every feature or fix:
	1. **Design first** when it touches more than one layer: a short plan on the issue
		(data model, API, service, UI, tests, docs, rollout) before code. It must fit the
		target architecture (#1792): core domain stays channel-neutral, platform calls only
		in that channel's adapter.
	2. **Change every layer it needs**, in the right place: types, DB migration,
		service, API route, UI, words, tests and the matching doc. No patching a
		symptom in the UI when the cause is in the service, no copy-pasted logic, and no
		special cases bolted on with `if (businessId === …)`.
	3. **Leave the code better than you found it:** reuse or extend the existing
		module instead of adding a parallel one; split a file you grow past ~400 lines;
		delete what your change makes dead.
	4. **No temporary hacks without an owner and date.** A shortcut that must ship
		needs a `TODO(#issue)` and a follow-up issue in the same PR; otherwise do it
		properly.
	5. **Tests at the right level:** a unit test for the rule, a core test with
		recorded real responses for core paths, and an e2e check for user flows.
	Reviewers block PRs that skip a layer, duplicate logic or add a hack without
	an issue.
- **Refactor continuously, without slowing anyone down (owner, Oct 29).**
	- Small refactors (rename, extract a function, split a file you're touching)
		ride along in the feature PR. Anything bigger is its **own** small PR
		(≤ ~400 changed lines), behaviour-unchanged and proven by existing tests, so
		it reviews in minutes and auto-merges on green CI.
	- Never hold a feature, fix or release for a refactor, and never mix a
		refactor with a money or migration change in one PR.
	- When you hit messy code, log it on #1792 (one line: file, problem, fix) and
		keep going; the CTO slots it into a phase.
	- Speed is measured, not guessed: the CTO watches PR cycle time, CI duration,
		release frequency and the waiter (idle time) weekly, and posts any slowdown
		on #364 with its fix.

## Branches and deployments

- **Deploy train (#461; Vercel Hobby allows 100 deploys a day).** Branch from current
	`origin/next` (`bash scripts/wt.sh <issue>` does it), open a PR to **`next`**, enable
	auto-merge with `gh pr merge <n> --auto --squash` (one green commit per PR; only the train's
	sync and promotion PRs use `--merge`, #2479). A PR opened against `main` is retargeted to `next` automatically.
	`main` is production; the deploy train promotes a green `next` to `main` at most
	every 30 minutes, so your change is live within about 30 minutes of merging. **Don't
	wait for the train** (owner, Nov 1): check the changed flow before merging (locally or
	on the PR preview), start your next item, and smoke production on your next pass once
	it's live. Never sleep or poll for a deploy; it blocks your chat. Hotfixes and migration/money releases go to `main` (DevOps or CTO; label
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
