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
   `origin/main`, keep the change small, push, and open a PR to `main` titled
   with the issue number. Comment on the issue in five lines or fewer: what
   changed, proof, risk, PR link, next step.
4. **Low-risk PRs ship themselves.** No migration, money, tenant/auth or config
   change: run `gh pr merge <n> --auto --squash`. GitHub merges when CI passes
   (about 3 minutes) and Vercel deploys. Branches no longer need to be up to date
   with `main` to merge. After deploy, smoke the changed flow in production,
   close the issue with the PR link (plus one `Lesson:` line if you learned
   something reusable) and start your next issue.
   **Ship the same day.** Open the PR as soon as one small slice works; do not
   hold finished work on a branch or batch it. A green PR that is still open after
   30 minutes gets merged by whoever sees it (`gh pr merge <n> --squash`). A branch
   older than a day is either merged or closed.
5. **DevOps ships the rest**: anything with a migration, money, tenant/auth or
   config change. Label it `ready-to-ship` and `owner:devops`. DevOps applies
   migrations first, merges, smokes and closes. Money and tenant changes get
   `owner:qa` first. QA's approval plus the CTO's review is enough to release; the
   CEO decides only prices, fees, refund rules, spend limits and who may approve
   money. DevOps also owns rollback when a production smoke fails.
6. **A core failure found live** gets its own `core` `bug` issue with the exact
   step, error and owner label. Add `owner:qa` when a red test helps. One issue
   per problem; do not bury new failures in long comment threads.
7. **The CEO** (coordinator chat) sets priority and the milestone, approves budgets
   and money, handles the owner's steps (Meta, Razorpay, browser sign-in) and
   maintains this file except the worker table. **The CEO delegates, not builds**
   (owner, Oct 24): an owner request becomes an issue with done-criteria, labelled
   for its owner (`owner:cto` to slot, or a worker directly), and tracked to done.
8. **The CTO** turns priorities into work: owns the worker table under "Now",
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
- **Paid budget.** Create runs: **no count limit** (owner, Oct 23: "as many as
  you need"; runs 1-20 used by then). Run Create whenever the work needs it, not
  in loops. Log `Create run N` with the saved count in
  [#98](https://github.com/vanshulgoyal101/adbrain/issues/98). A run costs about
  ₹10-20 in AI; if one costs far more, stop and post. The #98 model bake-off has
  its own $1 cap.
  No Meta ad spend: campaigns stay PAUSED. One exception (owner, Oct 23, replaces
  the Oct 22 ₹600): the owner added ₹1,000 to Solaride 101, which is ₹847 for ads
  after GST, so the run is ₹280/day for 3 days (₹840). It is Solaride's first
  watched run, capped on Meta, run by Dev 3 with QA's checklist on
  [#157](https://github.com/vanshulgoyal101/adbrain/issues/157).
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

### Now (October 23): the first watched run on Solaride

Done October 22: offer in the first 125 characters (#194), the owner's own photo
in an ad (#195), capped campaigns resume and sync (#197), #202, #177, #181,
#185 and capped activation (PR193). Done October 23: capped runs reserve cap +
GST (#208), custom amounts and top-ups (#212), phone big and bold (#215), phone
layout (#220).

CEO priorities and targets (Oct 24, 10:50Z; owner: lean, high value only). Every
open issue has a target; a miss gets one line on its issue with the new date. The
CTO's queue map (#364) orders each worker's row to match.

- **Top today: #408, skills used on every task** (CTO; owner: the single most
  high-value thing). See Role cards → Skills first.
- **Gate for every outside customer: #156 Meta App Review. Submit today, Oct 24**
  (Dev 2 + owner sitting: confirm Data handling, record screencasts with a no-role
  Facebook account, Submit). Meta then takes days to weeks. No outside sign-ups yet.
- **Live run #157 (Dev 3, QA reads): ends Oct 26 14:24Z.** First real lead in; no
  edits. Final report Oct 26, then the next Solaride run uses #333 and #334.
- **Today, Oct 24:** #334 Advantage+ audience (Dev 2, PR #357); #281 auto-cite
  (Dev); #376 part 1, phone dead space on the sign-up intro (Dev 3); #383 role
  cards read by all; #270 after-number at 18:40Z (DevOps).
- **Oct 25:** #300 bold + Indic image text (Dev 3, PR #358); #372 results to WhatsApp
  (Dev 2); #371 Create learns from results (Dev, CTO design on the issue); #384
  restart-proof roles (CTO); #390 dev speed, the biggest of its 3 causes (DevOps);
  #274 scheduler 24 h check, then close (DevOps).
- **Oct 26:** #333 9:16 ads (Dev 3); #387 live edit preview (Dev 2); #360 + #376
  part 2 phone speed and Enquiries layout (Dev 2); #378 interview validation gap
  (Dev); #379 internal accounts excluded from metrics (DevOps); #157 final report.
- **By Oct 28:** #335 log real WhatsApp enquiries (Dev; migration → QA → DevOps);
  #366 faster Prepare (Dev 3); #367 angle chip over the logo (Dev); #388 model
  picks per task, then a review every 3 weeks (CTO; first review about Nov 14).
- **Umbrellas, close when their slices are done:** #67 (snappier app), #51 (UI/UX
  polish; QA's top 5 next). #364 is the CTO's standing queue map.
- **Later (no date):** #178 (Razorpay webhook proof), #229 (email alerts), #253
  (managed-account WhatsApp numbers), #296 (AI-answer visibility).
- **Owner batch (CEO asks):** #156 sitting; #337 30-second share test on his phone.
- **Filter for new issues:** it must help a customer make and run ads today,
  make the product faster or clearer, or remove a real failure. Otherwise file
  it as `later`, or don't file it.

The CTO maintains the worker table below.

| Worker | Work, in order |
| --- | --- |
| Everyone | **When idle:** run `node scripts/wait-for-work.mjs --me <you>` in the foreground only (it first lists items you own where someone else spoke last; it gives up after 30 min; then stop) and continue with what it prints. **Every finished step names who acts next** (`→ DevOps: release`) and moves the `owner:` label; release-PR verdicts end with `→ DevOps`. Never leave anything running in the background. **Talk on the issue or PR;** hand off with the owner label plus one arrow line (`→ QA: ready at <sha>`), and sign your own comments with your role ([AGENTS.md](../AGENTS.md#worker-coordination)). No status or idle posts. Technical calls and reviews: `owner:cto`. Owner steps: `waiting-owner` (the CEO asks him). Money PRs ship on QA approval plus the CTO's review. **Queue empty?** Take the next item in your row, then QA's #51 findings, then any unowned `core` issue in your area (add your label); only then `wait-for-work` |
| QA | 1. [#410](https://github.com/vanshulgoyal101/adbrain/issues/410) live check once DevOps's fallback is set, then review Dev's 503 PR. 2. [#371](https://github.com/vanshulgoyal101/adbrain/issues/371) live check of Create's opening line. 3. **P0 [#157](https://github.com/vanshulgoyal101/adbrain/issues/157)** read ~16:00Z. 4. Walk each [#403](https://github.com/vanshulgoyal101/adbrain/issues/403) slice at 390 and 1440 |
| Dev | 1. Merge PR #425 ([#371](https://github.com/vanshulgoyal101/adbrain/issues/371), CTO approved) and post the opening line. 2. [#410](https://github.com/vanshulgoyal101/adbrain/issues/410) part 2 (503 + logged provider reasons). 3. [#418](https://github.com/vanshulgoyal101/adbrain/issues/418) eval gate, then [#388](https://github.com/vanshulgoyal101/adbrain/issues/388) model bake-off through it (covers [#378](https://github.com/vanshulgoyal101/adbrain/issues/378)). You own `ad-assistant.tsx` and `interview.ts` |
| DevOps | 1. Close the smoke incidents #413/#414/#420/#415 once be4952c's guard passes. 2. [#410](https://github.com/vanshulgoyal101/adbrain/issues/410) part 1: `LLM_BUDGET_PROVIDER_ORDER=groq,google,openrouter` with before/after. 3. [#423](https://github.com/vanshulgoyal101/adbrain/issues/423) Copilot review ruleset (advisory). 4. [#390](https://github.com/vanshulgoyal101/adbrain/issues/390) parts 2–3. 5. [#388](https://github.com/vanshulgoyal101/adbrain/issues/388) 3-weekly reminder; [#270](https://github.com/vanshulgoyal101/adbrain/issues/270) at ~18:40Z |
| Dev 3 | 1. [#376](https://github.com/vanshulgoyal101/adbrain/issues/376) part 1 (sign-up intro). 2. [#366](https://github.com/vanshulgoyal101/adbrain/issues/366) (Prepare: fast fallback, preflight timing). 3. [#417](https://github.com/vanshulgoyal101/adbrain/issues/417) S0 `ui-gate` baseline, then [#403](https://github.com/vanshulgoyal101/adbrain/issues/403) S1 tokens + components, S3 words/stepper/headers, S4 homepage + sign-up on the same tokens. 4. [#289](https://github.com/vanshulgoyal101/adbrain/issues/289) next slices |
| Dev 2 | 1. [#387](https://github.com/vanshulgoyal101/adbrain/issues/387) (live preview while editing). 2. [#403](https://github.com/vanshulgoyal101/adbrain/issues/403) slices S2 (formats + owner-only data), S5 (Campaigns rows, Settings columns), S6 (shadcn/Radix dialog + menu); CTO spec on #403. 3. [#419](https://github.com/vanshulgoyal101/adbrain/issues/419) placement track. [#156](https://github.com/vanshulgoyal101/adbrain/issues/156) jumps the queue when the owner is at the Meta dashboard |
