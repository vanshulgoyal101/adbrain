# AdBrain Worker Orchestration

Updated October 23, 2026. Maintainers: the CEO (coordinator) and the CTO (worker
table).
Goal: our core features work first: Brand, Create, review, launch and manage a
Meta campaign. Other work waits until that loop is healthy in production.
Ship quickly, with checks proportional to risk.
This file is the current dispatch. GitHub issues own scope and acceptance; PRs
own review and CI evidence. Historical dispatches do not grant or block work.

## Current Dispatch

### Priority

Core features come first, always: Brand, Create 3 ads, review, launch a Meta
campaign and manage it (sync/pause/results), working reliably in production.
Other work (polish, speed, docs, compliance, support, analytics) waits until that
loop is healthy or the owner asks for it. Build, ship and test in production via
the [Startup Fast Path](RELEASING.md#startup-fast-path).

### Role cards

One line each: what you own, and what you hand off. If a task doesn't fit your card,
label it for the owner instead of doing it.

| Role | Owns | Hands off |
| --- | --- | --- |
| **CEO** | Priorities and target dates, money and budgets, decisions (`decision`), the owner's steps (Meta, Razorpay, sign-ins), this dispatch. Turns owner requests into issues. Checks weekly that skills are used | Building anything: implementation goes to the CTO or a worker |
| **CTO** | Technical direction and designs, assigning and briefing issues, the worker table, labels, CI and production health, high-impact reviews, publishing `Lesson:` lines | Feature building (assign it); priority and money (CEO) |
| **Dev** | Create: the assistant, interview, generation and its tests (`ad-assistant.tsx`, `interview.ts`), plus issues assigned to you | Migrations, config, money releases (DevOps); priority (CEO) |
| **Dev 2** | Editing ads and image rendering, Meta App Review (#156), plus issues assigned to you | Same as Dev |
| **Dev 3** | WhatsApp-first, first impression (homepage, sign-up), the live-run engineering (#157), plus issues assigned to you | Same as Dev |
| **QA** | Independent review of high-risk changes (money, migration, tenant/auth), red tests, live-run reads, UX walks on phone and desktop | Fixing product code (send it to the owner Dev); routine low-risk PRs need no QA |
| **DevOps** | Migrations, money/tenant/config releases, secrets and production settings, rollback, scheduler, CI and the production guard | Feature work; priority (CEO) |

Every worker: build, test, ship and smoke your own slice end to end (low-risk PRs
auto-merge); hand off with the label and one `→ Role:` line.
**Skills first (owner, Oct 24: the highest-value habit).** Before any task, load
the matching skill from `.github/skills/` (task → skill map: #408). No good match?
Find a maintained, licence-checked open-source skill, add it with a SOURCES.md line
in a small auto-merge PR (pre-approved), then use it. Reusable lessons go to the CTO,
who publishes them to the skills repo.

### How work flows

Routine steps never wait for the CEO or the CTO.

1. **Work lives in GitHub issues.** Labels say what matters and who acts next:
   `core` or `later` (priority), `owner:dev`, `owner:dev2`, `owner:dev3`, `owner:qa`,
   `owner:devops`, `owner:cto` (who acts next), `ready-to-ship` (committed,
   waiting for DevOps), `blocked` (needs something outside the team; the issue says
   what), `waiting-owner` (blocked on the owner; the CEO asks him) and `decision`
   (needs the CEO). Talk on the issue or PR itself; see
   [AGENTS.md](../AGENTS.md#worker-coordination) Communication.
2. **Start or resume** by reading this section, then your queue:
   `gh issue list -R vanshulgoyal101/adbrain -l core -l owner:<you>`. Work the
   oldest. Empty queue: take an unowned `core` issue in your area and add your
   label. Nothing left: run `wait-for-work` (no idle post;
   [AGENTS.md](../AGENTS.md#worker-coordination)) and continue with what it
   reports. Stop only when it times out. Do not invent work.
3. **Finish an issue** with a PR, not a loose commit. Branch from current
   `origin/next`, keep the change small, push, and open a PR to `next` titled
   with the issue number. Comment on the issue in five lines or fewer: what
   changed, proof, risk, PR link, next step.
4. **Low-risk PRs ship themselves.** No migration, money, tenant/auth or config
   change: run `gh pr merge <n> --auto --squash`. GitHub merges when CI passes
   (about 3 minutes) into `next`, and the deploy train ships `next` to production
   at most every 30 minutes (#461). Branches don't need to be up to date to merge.
   After the train deploys it, smoke the changed flow in production,
   close the issue with the PR link (plus one `Lesson:` line if you learned
   something reusable) and start your next issue.
   **Ship the same day.** Open the PR as soon as one small slice works; do not
   hold finished work on a branch or batch it. A green PR that is still open after
   30 minutes gets merged by whoever sees it (`gh pr merge <n> --squash`). A branch
   older than a day is either merged or closed.
5. **DevOps ships the rest**: anything with a migration, money, tenant/auth or
   config change. Label it `ready-to-ship` and `owner:devops`. DevOps applies
   migrations first, merges, smokes and closes. Money and tenant changes get
   `owner:qa` first. **Tenant/auth-only** changes ship on QA's approval alone; **money,
   migrations and Meta credential changes** need QA's approval plus the CTO's review. The
   CEO decides only prices, fees, refund rules, spend limits and who may approve
   money. DevOps also owns rollback when a production smoke fails.
6. **A core failure found live** gets its own `core` `bug` issue with the exact
   step, error and owner label. Add `owner:qa` when a red test helps. One issue
   per problem; do not bury new failures in long comment threads.
7. **The CEO** (coordinator chat) sets priority and the milestone, approves budgets
   and money, handles the owner's steps (Meta, Razorpay, browser sign-in) and
   maintains this file and the priorities on the [Team board](https://github.com/vanshulgoyal101/adbrain/issues/580). **The CEO delegates, not builds**
   (owner, Oct 24): an owner request becomes an issue with done-criteria, labelled
   for its owner (`owner:cto` to slot, or a worker directly), and tracked to done.
8. **The CTO** turns priorities into work: owns the worker table on the Team board (#580),
   assigns and briefs issues, keeps labels honest, closes or parks stale issues,
   watches CI and production health, reviews high-impact diffs and publishes
   `Lesson:` lines. **Queues never run dry:** every worker keeps at least 2
   actionable items (not `waiting-owner`, `blocked` or `decision`), each traceable
   to a line in the CEO priorities below; `wait-for-work --me cto` reports any
   worker that drops below 2, and the CTO refills that row the same hour. At the
   end of every wait it also reports workers with queued work but no signed comment
   in 90 minutes and PRs untouched for 60 minutes; the CTO checks and unblocks them.
   Whenever the CEO changes the priorities, the CTO re-slots every row and posts
   the queue map on the CEO's `decision` issue for confirmation.
   **Reviews have a 1-hour target:** a QA or CTO review requested on a PR is given
   within an hour; the on-track check flags PRs untouched for 60 minutes. The CEO and CTO talk on the issue at hand; the CTO raises CEO
   calls as `decision` issues. On a conflict, money and priority
   follow the CEO; the technical approach follows the CTO.

### Standing rules

- **Worktrees.** Start one with `bash scripts/wt.sh <issue>`: a `work/issue-<n>`
  branch from `origin/main` at `/Users/vanshulgoyal/Development/copilot/adbrain-wt/<issue>`,
  with `node_modules` cloned from a shared lockfile cache in seconds (a full `npm ci`
  only when the lockfile changed). Not `/tmp`, which is wiped on restart. Push your branch at each coherent step.
  Never edit the owner's checkout (`adbrain/`).
- **Checks.** Run the tests for what you changed plus typecheck; CI runs the rest.
  Do not rerun full suites or re-review unchanged code.
- **Subagents.** Split your issue across subagents and do small cross-role tasks
  yourself instead of handing them off; rules in [AGENTS.md](../AGENTS.md#subagents).
  Hand off only migrations, money, production settings, secrets and rollback
  (DevOps), independent review of high-risk changes (QA), or files someone else
  is editing right now.
- **Browser.** Signed in to the owner's demo account: Cedar Ridge Chiropractic,
  Meta connected to the Solaride ad account and Page. Each worker uses its own tab.
  Background tabs do not render; use a page-local frame flush or call the same API
  the UI calls. If the session expires, label the issue `waiting-owner` and the
  CEO signs in.
- **Paid budget.** OpenRouter is capped ($9 total until the owner raises it, #449).
  Internal tests run at about $0 (free providers, #466); paid Create only for real
  customers and approved checks (CEO decides, e.g. #502's $0.15); log runs on #98.
  No Meta ad spend except CEO-approved, Meta-capped runs (#157, #499).
- **Access.** Production DB: Supabase Management API with `SUPABASE_TOKEN` from
  `/Users/vanshulgoyal/Development/copilot/arcade/.env` (parse into memory, never
  print), project `kmzuxrvfrwwpwmoovwcp`, `BEGIN READ ONLY` for checks. Vercel:
  `npx --yes vercel@60.1.3`. Docs: `node scripts/check-docs.mjs` after `npm ci`.
- **Pre-approved: do not wait or ask.** One diagnostic Prepare request at any time
  (no Meta create). Create runs inside your budget share. Opening and auto-merging
  a finished low-risk PR, including scripts and docs. Read-only production queries.
  Waiting for permission that this list already gives is the most common delay.
- **Never** force-push, bypass branch protection, print secrets, activate ad
  delivery, charge or refund without approval, or touch the #54 Sep 29 held request.

### Now

**Live priorities and worker queues: the pinned [Team board #580](https://github.com/vanshulgoyal101/adbrain/issues/580).**
The CEO edits its priorities and the CTO its worker table directly in the issue body
(no PR, CI or deploy); `wait-for-work` prints your row on every wake. Discuss changes
on #364.
