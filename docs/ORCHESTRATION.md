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

CEO priorities (Oct 24, 08:30Z; owner: lean, high value only):
- **P0:** the live Solaride WhatsApp run
  ([#157](https://github.com/vanshulgoyal101/adbrain/issues/157)): ₹840 capped,
  ends Oct 26 14:24Z. **First real lead** (owner confirmed the first chat was a
  real customer). Delivery is a trickle (about ₹1/hour); the owner's Ads Manager
  Delivery column is the next step. Monitor and report spend, chats and cost per chat.
  #156 (Meta App Review) is the gate for every outside customer; it needs the
  owner's Facebook sign-in, then submit.
- **P0, first customers (#339, Oct 24):** 3 real businesses signed up, made ads
  and stopped at Campaigns, because Meta blocks anyone without an app role until #156
  passes. The owner WhatsApps all 3 today; whoever says yes gets Tester access and
  launches on their own ad account (PAUSED first, Solaride caps). Before approval, new
  owners see "launching opens soon" plus download/share (#336, #337). Measure the
  funnel (#338).
- **P1-top, three tracks in parallel:**
  - **Edit and image text, Dev 2:** #280 (edit at every step: text is live; next
    the words on the image, then the background only) and #300 (real bold fonts,
    then Hindi/Punjabi shaping). Done Oct 24: #284, #282, #281, #290.
  - **Launch on a phone, Dev:** #305 (campaign setup: 9 large ad tiles before
    name and budget; ship the tile fix first), after #271 if it is mid-flight.
  - **First impression, Dev 3:** #289 (sign-up page and homepage hero are live;
    next a homepage video, an ideas gallery per industry and honest trust signals).
- **P1:** #274 (a reliable scheduler; PR #309 with the CTO), #235 (WhatsApp-first;
  slice 3 live in #278), #334 (Advantage+ audience off starves delivery), #333
  (9:16 assets for Stories/Reels), #335 (cost per real WhatsApp enquiry).
- **P1, a snappy and polished product (owner):** #67 (snappier app) with slices
  #270, #238 and #239; #51 (UI/UX polish). Each slice is a small PR with a
  before/after number.
- **Later:** #229 (email alerts; PR #268 closed, branch kept; WhatsApp-first),
  #253, #178, #296.
- **Filter for new issues:** it must help a customer make and run ads today,
  make the product faster or clearer, or remove a real failure. Otherwise file
  it as `later`, or don't file it.

The CTO maintains the worker table below.

| Worker | Work, in order |
| --- | --- |
| Everyone | **When idle:** run `node scripts/wait-for-work.mjs --me <you>` in the foreground only (it first lists items you own where someone else spoke last; it gives up after 30 min; then stop) and continue with what it prints. **Every finished step names who acts next** (`→ DevOps: release`) and moves the `owner:` label; release-PR verdicts end with `→ DevOps`. Never leave anything running in the background. **Talk on the issue or PR;** hand off with the owner label plus one arrow line (`→ QA: ready at <sha>`), and sign your own comments with your role ([AGENTS.md](../AGENTS.md#worker-coordination)). No status or idle posts. Technical calls and reviews: `owner:cto`. Owner steps: `waiting-owner` (the CEO asks him). Money PRs ship on QA approval plus the CTO's review. **Queue empty?** Take the next item in your row, then QA's #51 findings, then any unowned `core` issue in your area (add your label); only then `wait-for-work` |
| QA | 1. [#280](https://github.com/vanshulgoyal101/adbrain/issues/280) walk incl. 'use my photo'; close if clean. 2. Verdict on PR #309 at d44e9c4. 3. **P0 #157** twice daily. 4. Review [#335](https://github.com/vanshulgoyal101/adbrain/issues/335)'s migration when labelled |
| Dev | 1. [#281](https://github.com/vanshulgoyal101/adbrain/issues/281) (auto-cite a Brand offer the copy states; CTO decision). 2. [#335](https://github.com/vanshulgoyal101/adbrain/issues/335) (log real WhatsApp enquiries, cost per real enquiry; migration → QA → DevOps). You own `ad-assistant.tsx` and `interview.ts` |
| DevOps | 1. Clear the Solaride Regenerate claim on [#281](https://github.com/vanshulgoyal101/adbrain/issues/281). 2. Release PR #309 ([#274](https://github.com/vanshulgoyal101/adbrain/issues/274)) after QA's verdict, then the 6 h watch. 3. [#270](https://github.com/vanshulgoyal101/adbrain/issues/270) after-numbers. 4. #335's migration when ready |
| Dev 3 | 1. `/login`: a `redirect` to an app route opens sign-in mode, no intro (CTO note on #289). 2. [#300](https://github.com/vanshulgoyal101/adbrain/issues/300) (bold fonts, then Hindi/Punjabi). 3. [#333](https://github.com/vanshulgoyal101/adbrain/issues/333) (9:16 for Stories/Reels; same `render.tsx`). 4. [#289](https://github.com/vanshulgoyal101/adbrain/issues/289) slices 3–4 |
| Dev 2 | 1. **[#156](https://github.com/vanshulgoyal101/adbrain/issues/156) now** (owner is signed in): advanced-access check, no-role test user, submit packet. 2. [#334](https://github.com/vanshulgoyal101/adbrain/issues/334) (Advantage+ audience on for new campaigns; recorded `validate_only`; not on the live #157 run). Post on #300 before touching `render.tsx` |
