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
   maintains this file except the worker table.
8. **The CTO** turns priorities into work: owns the worker table under "Now",
   assigns and briefs issues, keeps labels honest, closes or parks stale issues,
   watches CI and production health, reviews high-impact diffs and publishes
   `Lesson:` lines. The CEO and CTO talk on the issue at hand; the CTO raises CEO
   calls as `decision` issues. On a conflict, money and priority
   follow the CEO; the technical approach follows the CTO.

### Standing rules

- **Worktrees.** Use `/Users/vanshulgoyal/Development/copilot/adbrain-wt/<issue>`,
  not `/tmp`, which is wiped on restart. Install dependencies once per worktree
  so typecheck and tests run for real. Push your branch at each coherent step.
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

CEO priorities (Oct 24; owner: lean, high value only):
- **P0:** the live Solaride WhatsApp run
  ([#157](https://github.com/vanshulgoyal101/adbrain/issues/157)): ₹840 capped,
  ends Oct 26 14:24Z. Monitor it and report spend, chats and cost per chat.
  #156 (Meta App Review) is the gate for every outside customer; it needs the
  owner's Facebook sign-in, then submit.
- **P1-top, two tracks in parallel (owner, Oct 24):**
  - **Create, one dev:** #284 (a real user got stuck in Create; first), #282
    (confirm and move Regenerate), #281 (the Regenerate error is a fact-check
    rejection shown as a generic 502), #280 (edit at every step: text, then the
    words on the image, then the background only), then #290 (Hindi in Create).
  - **First impression, another dev:** #289 (sign-up page first, then a
    homepage video, an ideas gallery per industry and honest trust signals).
- **P1:** #258 (live results refresh themselves and flag rejected or stalled
  ads), #274 (a reliable scheduler for those jobs), #235 (WhatsApp-first), #260
  (lean pass).
- **P1, a snappy and polished product (owner):** #67 (snappier app) with slices
  #230 (measure every main page, fix the top 5), #238 and #239; #51 (UI/UX
  polish) with #232. Each slice is a small PR with a before/after number.
- **Later:** #229 (email alerts; built, flag off, no provider; WhatsApp-first),
  #253, #178. Closed: #66 (superseded by #260) and #254.
- **Filter for new issues:** it must help a customer make and run ads today,
  make the product faster or clearer, or remove a real failure. Otherwise file
  it as `later`, or don't file it.

The CTO maintains the worker table below.

| Worker | Work, in order |
| --- | --- |
| Everyone | **When idle:** run `node scripts/wait-for-work.mjs --me <you>` in the foreground only (it gives up after 30 min; then stop) and continue with what it prints. Never leave anything running in the background. **Talk on the issue or PR;** hand off with the owner label plus one arrow line (`→ QA: ready at <sha>`), and sign your own comments with your role ([AGENTS.md](../AGENTS.md#worker-coordination)). No status or idle posts. Technical calls and reviews: `owner:cto`. Owner steps: `waiting-owner` (the CEO asks him). Money PRs ship on QA approval plus the CTO's review |
| QA | **P0 #157 is delivering** (since Oct 24: 2 impressions, ₹0.97, 1 WhatsApp conversation; CTO correction on #157). Watch twice daily and post spend, chats and cost per chat. Delivery is very slow: if spend is still under about ₹50 by 12:00Z, ask for the owner's Ads Manager Delivery column. Review PR #278. The other new PRs (#282, #284, #281, #280) are low risk and auto-merge; walk #280 on phone and desktop once slices 1–2 are live. Then the #51 UX walk |
| Dev | **Create track:** [#284](https://github.com/vanshulgoyal101/adbrain/issues/284) first (Create gets stuck; CTO brief), then [#281](https://github.com/vanshulgoyal101/adbrain/issues/281) (Regenerate's misleading error), then [#290](https://github.com/vanshulgoyal101/adbrain/issues/290) (Create in Hindi; same files), then #271's form-check read (CTO answer on #271). You own `ad-assistant.tsx` and `interview.ts` on this track |
| DevOps | [#274](https://github.com/vanshulgoyal101/adbrain/issues/274) first (reliable scheduler: results refresh and the not-delivering alert depend on it). [#270](https://github.com/vanshulgoyal101/adbrain/issues/270): post the 24 h after-numbers. Release PR #268 (#229, flag off) after Dev 2 merges `main` and QA and the CTO approve |
| Dev 3 | PR #278 (#235) is with QA; then **first-impression track:** [#289](https://github.com/vanshulgoyal101/adbrain/issues/289), starting with slice 1 (sign-up page; CTO notes on the issue). #286 is closed: `DISCONNECTED` numbers do receive chats (proof on #157), so don't build it |
| Dev 2 | **Editing track:** merge `main` into PR #268 (quick), then [#282](https://github.com/vanshulgoyal101/adbrain/issues/282) (confirm before Regenerate), then [#280](https://github.com/vanshulgoyal101/adbrain/issues/280) slices 1–3 (edit text, the words on the image, only the picture; CTO brief). [#156](https://github.com/vanshulgoyal101/adbrain/issues/156) step 3 jumps the queue when the owner signs in |
