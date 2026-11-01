# AdBrain Worker Orchestration

Part of [Team](README.md).

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
the [Startup Fast Path](../operations/releasing.md#startup-fast-path).

### Role cards

One line each: what you own, and what you hand off. If a task doesn't fit your card,
label it for the owner instead of doing it.

| Role | Owns | Hands off |
| --- | --- | --- |
| **CEO** | Priorities and target dates, money and budgets, decisions (`decision`), the owner's steps (Meta, Razorpay, sign-ins), this dispatch. Turns owner requests into issues. Checks weekly that skills are used | Building anything: implementation goes to the CTO or a worker |
| **CTO** | Technical direction and designs, assigning and briefing issues, the worker table, labels, CI and production health, design calls and Meta-credential reviews, publishing `Lesson:` lines | Feature building (assign it); priority and money (CEO) |
| **Dev** | Create: the assistant, interview, generation and its tests (`ad-assistant.tsx`, `interview.ts`), plus issues assigned to you | Migrations, config, money releases (DevOps); priority (CEO) |
| **Dev 2** | Editing ads and image rendering, Meta App Review (#156), plus issues assigned to you | Same as Dev |
| **Dev 3** | WhatsApp-first, first impression (homepage, sign-up), the live-run engineering (#157), plus issues assigned to you | Same as Dev |
| **QA** | Independent review of high-risk changes (money, migration, tenant/auth), red tests (live checks go to QA 2) | Fixing product code (send it to the owner Dev); routine low-risk PRs need no QA |
| **QA 2** | Live checks: live-run reads and final reports (#157, #499), production smoke follow-up, phone and desktop walks, 2-Tier acceptance walks (#527) | Same as QA |
| **Reviewer** | High-risk code review (money, migration, tenant/auth); when no review is waiting, pick your own audit of a failing #681 row and file findings into the pool (the CTO doesn't refill this row): `gh pr review <n> --comment --body "Reviewer review of <sha>: **approved**. …"`, accepted by `release.mjs` where the CTO's is; reviews in parallel with QA, within an hour | Design and priority calls (CTO, CEO); fixing code (the author) |
| **DevOps** | When no release waits, pick your own ops hygiene (Supabase advisors, slow queries, costs, alerts, the train); the CTO doesn't refill this row. Migrations, money/tenant/config releases, secrets and production settings, rollback, scheduler, CI and the production guard | Feature work; priority (CEO) |
| **Dev 4** | The pre-launch Review step (#681): every rejection says in plain words what to fix, with a one-tap path to fix it, plus issues assigned to you | Same as Dev |
| **CPO** | Product: research and the ranked roadmap (#703), feature proposals with evidence, cost and the smallest test (#694), labelled `owner:cpo` | Building (CTO assigns); priority and money (CEO) |
| **Analyst** | Market and competitor research (#750), evidence-backed lessons filed as `later` issues for the CPO to rank; picks its own research when empty, labelled `owner:analyst` | Product ranking (CPO); building (CTO assigns); priority and money (CEO) |
| **Designer** | The product's look and feel (#847): screen audits, one type/colour/spacing system, design slices built and shipped as small UI PRs with QA's 390/1440 check; labelled `owner:designer` | Feature logic and Meta/money code (the step owner); priority (CEO) |
| **Docs** | The product's documentation (#1851): the layered `docs/` tree and its indexes, `docs:check` rules, module READMEs and the ADR index; reviews merged PRs' doc changes daily and fixes drift; labelled `owner:docs` / `lane:docs` | Code changes (the area owner); authors still update the matching doc in their own PR; private business data goes to vbrain-private |

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
   `core` or `later` (priority), `owner:dev`, `owner:dev2`, `owner:dev3`, `owner:qa`, `owner:cpo`, `owner:analyst`, `owner:designer`, `owner:docs`,
   `owner:devops`, `owner:cto` (who acts next), `ready-to-ship` (committed,
   waiting for DevOps), `blocked` (needs something outside the team; the issue says
   what), `waiting-owner` (blocked on the owner; the CEO asks him) and `decision`
   (needs the CEO). Talk on the issue or PR itself; see
   [AGENTS.md](../../AGENTS.md#worker-coordination) Communication.
2. **Start or resume** by reading this section, then your queue:
   `gh issue list -R vanshulgoyal101/adbrain -l core -l owner:<you>`. Work the
   oldest. Empty queue: take an unowned `core` issue in your area and add your
   label. Nothing left: run `wait-for-work` (no idle post;
   [AGENTS.md](../../AGENTS.md#worker-coordination)) and continue with what it
   reports. Stop only when it times out. Do not invent work. While you own an
   actionable item, the waiter prints your top 3 and exits 6 instead of waiting
   (#2122): park, block or hand off by label what you can't act on.
3. **Finish an issue** with a PR, not a loose commit. Branch from current
   `origin/next`, keep the change small, push, and open a PR to `next` titled
   with the issue number. Comment on the issue in five lines or fewer: what
   changed, proof, risk, PR link, next step.
4. **Low-risk PRs ship themselves.** No migration, money, tenant/auth or config
   change: run `gh pr merge <n> --auto --squash`. GitHub merges when CI passes
   (about 3 minutes) into `next`, and the deploy train ships `next` to production
   at most every 30 minutes (#461). Branches don't need to be up to date to merge.
   Don't wait for the train: start your next item, and once it's live smoke the
   changed flow in production on your next pass (never sleep or poll for a deploy;
   the `.github/hooks/no-deploy-wait.json` hook refuses sync `sleep ≥60s`, sleep
   loops and `gh run watch`, escape with `# allow-wait`, #2481),
   then close the issue with the PR link (plus one `Lesson:` line if you learned
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
   `Lesson:` lines. Weekly it posts `npm run team-metrics` (DORA's four keys:
   deploys to `main`, lead time to production, change-failure rate and time to
   restore from the production guard's smoke; active hours per role, PR lead time,
   handoff latency, idle gaps, workflow failures) on #364 and fixes the worst number.
   **Outcome first, not queue length** (owner, Oct 30, replacing the 3-item floor): a
   worker's next item must pass the #580 filter; with none, it waits. At the
   end of every wait it also reports workers with queued work but no signed comment
   in 90 minutes and PRs untouched for 60 minutes; the CTO checks and unblocks them.
   **CI failures are the CTO's without being asked** (owner, Oct 27): the waiter reports
   every red run on `main`/`next` and any workflow failing on 2+ PR branches (`CI systemic`).
   The CTO fixes it the same hour: a broken check gets a fix PR, a flaky test a deflake PR
   (or the test owner's `bug` issue if it needs product knowledge), a red `next` a rerun plus
   the fix. New workflows must never fail before their script reaches the default branch.
   Whenever the CEO changes the priorities, the CTO re-slots every row and posts
   the queue map on the CEO's `decision` issue for confirmation.
   **Reviews have a 1-hour target:** a QA or CTO review requested on a PR is given
   within an hour; the on-track check flags PRs untouched for 60 minutes. The CEO and CTO talk on the issue at hand; the CTO raises CEO
   calls as `decision` issues. On a conflict, money and priority
   follow the CEO; the technical approach follows the CTO.

**Shared GitHub budget (#2021).** Every role uses the same login and 5,000 REST
requests/hour. The waiter defaults to a 300-second poll, revalidates reads with
ETags (unchanged authenticated responses return 304 without spending quota),
and uses response headers instead of extra `rate_limit` requests. On a
rate-limited 403/429 it logs the delay and retries after the later of
`Retry-After` and the primary quota reset, with jitter; absent valid hints it
backs off from 1 to 15 minutes. Backoff still respects the waiter's deadline
and parent lifetime. Other permission failures remain errors. Restart waiters
from current `origin/main` after this fix ships. Keep one-off API scans below
200 calls; larger scans need a quiet window and an explicit call budget, not
parallel per-item polling.

### Supervisor: waking idle and stuck chats (#573 A1)

**No chat needs to stay alive.** A LaunchAgent (`in.adbrain.team-supervisor`) runs
`npm run team-supervisor` every 10 minutes from `adbrain-wt/supervisor` (on `origin/main`).
Each tick:
1. A role is **live** if its waiter runs or its chat (a `~/.copilot/session-state` log whose
   first prompt is "You are AdBrain's <Role>…") changed in the last 20 min.
2. For the first role in order DevOps, QA, Reviewer, QA 2, Dev 3, Dev, Dev 2 that has work
   (`wait-for-work --probe`) and isn't live, it starts **one** headless Copilot CLI run: the
   role card, the first queue item, the hard limits (no money, Meta writes, secrets,
   production settings or force-push), signed "<Role> (headless):". One run at a time, detached from the tick
   so the 10-min ticks keep dispatching scheduled jobs while it works (#766),
   40 min cap, 150 AI credits per run, 8 runs a day that did work (a run with no signed
   "(headless):" comment, review or PR doesn't count), 30 runs a day hard ceiling (CEO sets the caps).
   A role with queued work not woken for an hour goes first, longest wait first, even past the daily cap.
   **Enforced in code, not only the prompt (#1513):** runs get `ADBRAIN_HEADLESS=1`, so `release.mjs`,
   `migrate-db --apply` and Meta recorder writes refuse; the CLI denies `launchctl`, `vercel`, `supabase`,
   `gh auth`, `gh secret` and `gh variable`, and file access stays inside the supervisor worktree (no
   `--allow-all-paths`). If a run leaves edits in that worktree, no further role runs start until it's clean.
   **Load guard (#1495):** no run starts while the 1-min load is over 1.5 per core or under 2 GB of memory is
   available (macOS memory-pressure level, not `os.freemem()`); the tick logs why. Override with
   `ADBRAIN_SUPERVISOR_MAX_LOAD` / `ADBRAIN_SUPERVISOR_MIN_FREE_GB`. Scheduled jobs and the nightly backup still run.
3. Log: `~/.adbrain-supervisor/supervisor.log`; stop role runs with `touch ~/.adbrain-supervisor/OFF` (scheduled-job dispatch and the nightly backup keep running, #1525);
   `--dry-run` shows who it would wake; `--install`/`--uninstall` manage the LaunchAgent.

**CEO handover and restarts (#2476).** The owner rotates CEO chats often and closes the old one, and a
VS Code restart ends every chat. Either way, GitHub and git are the memory. Start a new CEO with the text
from `npm run team-supervisor -- --restart-prompt ceo`. It reads the board and its `decision` queue, adopts
live worker chats (`list_sessions`, `get_session_context`) and starts each missing role with `create_session`
(relationship `independent`, title `AdBrain <Role>`) using `npm run team-supervisor -- --restart-prompt <role>`.
Workers never nest inside a CEO session, so closing a CEO chat leaves them running; never delete another
session. The outgoing CEO writes no handover: every decision and promise is already on its issue, and
scheduled reads are `Next read <time>` comments. If workers still sit inside an earlier CEO's session, the
owner closes it first and the new CEO then starts their independent replacements (worktrees survive). A
running chat reads no chat messages (steers stay "processing"; queued ones land when the turn ends), so
reach workers on GitHub (`→ <Role>:`, or the Everyone row of #580) and use `send_message` (queue) only to
start a chat whose status is idle. `npm run team-status` lists each role as `waiting`, `has-work`, `no-work`
or `error`.

### Ready pool (pull, don't wait)

The CTO keeps 3+ briefed issues per lane labelled `ready` + `lane:<dev|qa|devops|review|design|product|research|docs>`
(why with evidence, do, done-when, files). Anyone in the lane with nothing actionable claims
the oldest core one (`--add-label owner:<you> --remove-label ready`); `wait-for-work` offers
it. Not for you? Add `declined:<you>` and it isn't offered to you again. QA's walks and the Reviewer's audits file their findings straight into the pool.

### Standing rules

- **Worktrees.** Start one with `bash scripts/wt.sh <issue>`: a `work/issue-<n>`
  branch from `origin/main` at `/Users/vanshulgoyal/Development/copilot/adbrain-wt/<issue>`,
  with `node_modules` cloned from a shared lockfile cache in seconds (a full `npm ci`
  only when the lockfile changed). Not `/tmp`, which is wiped on restart. Push your branch at each coherent step.
  Never edit the owner's checkout (`adbrain/`).
- **Checks.** Run the tests for what you changed plus typecheck; CI runs the rest.
  Do not rerun full suites or re-review unchanged code.
- **Subagents.** Split your issue across subagents and do small cross-role tasks
  yourself instead of handing them off; rules in [AGENTS.md](../../AGENTS.md#subagents).
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
