---
name: multi-worker-delivery
description: "Use when independent coding agents share repositories, split implementation and review, hand off idle workers, or prepare a release from several feature branches."
---

<!-- Generated from vanshulgoyal101/skills@b877c32 skills/multi-worker-delivery.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Multi-Worker Delivery

## Trigger

Use when independent coding agents share repositories, split implementation and
review, hand off idle workers, or prepare a release from several feature branches.

## Invariant

Each mutable surface has one writer, each task advances a customer outcome, and
acceptance names exact source. Coordination must remove waits rather than become
a new dependency. Assigned, running, committed, reviewed and deployed are distinct.

## Failure pattern

A coordinator becomes the approval point for helper names, worktree allocation,
every push and repeated test receipts. Independent chats stop after handoffs;
editing the board does not wake them. Completed work waits behind unrelated
documents, whole-suite reruns and stale approval holds. Several workers then
repair or integrate the same file while the user sees a growing local backlog.

## Recommended method

1. Choose a complete customer workflow or demonstrated release blocker. Use the
   smallest dependency-complete slice, not the smallest visible code change.
2. Keep a short current dispatch with outcome, owner, exact source, real blocker
   and next action. Archive old decisions; do not reread the whole history to start.
   Retire superseded repair, credential and deployment holds when their evidence
   changes. A newer receipt does not help if the controlling assignment still
   tells the next worker to wait or repeat the completed phase.
3. Give authors isolated issue worktrees and authority for routine helpers, tests
   and scoped dependencies. One executor owns shared integration and production.
4. Assign files and interfaces, not just role names. Parallelize UI and server
   repairs only when their component/test/schema ownership is unambiguous.
5. Let owners discuss routine interfaces directly. Escalate scope, authority,
   unavailable external decisions or genuine conflicts to the coordinator.
6. Commit coherent locally checked work before handoff or task switching. Review
   only owned paths/hunks; publication and deployment remain separate decisions.
7. Review while CI runs. Name the accepted source and conditions; integrate in
   parallel without changing the reviewer's frozen candidate. Review later deltas.
8. Hand off issue/source, result, concrete blocker and next owner, with one link
   to existing evidence. Do not make a new report or validation harness per handoff.
9. Reuse published commits or shared local Git objects. Require an uncommitted
   source manifest only when a commit cannot represent the candidate.
10. Resume idle independent chats through their real communication mechanism.
    A board update is not a wake-up, acknowledgement or lock. Leave workers idle
    when no independent useful work exists; do not invent audits to fill capacity.
11. Close completed phases with the next executable handoff. Unverified real
   payment or provider delivery is a separate milestone, not an automatic hold
   on unrelated accepted software. Keep deployed, frontend-verified and actual
   transaction/provider-verified outcomes distinct.
12. Scope temporary ownership transfers to exact resources and operations. Record
   the handoff, avoid concurrent writers, verify the result and return ownership;
   a one-variable configuration upload does not authorize flags or deployment.
13. Keep the owner's own checkout clean. Workers write only in isolated worktrees;
   the coordinator commits and pushes its dispatch edits immediately. An
   unfinished merge or uncommitted board edit reappears as a pile of changes.
14. When workers go idle, read their latest handoffs and assign each a concrete
   next slice in the same pass, with a paste-ready resume line per chat.
15. Run work as label-driven queues: priority labels (`core`/`later`) plus an
   owner label for who acts next. Workers pull their own queue, hand off by
   label and start the next item; the coordinator only keeps labels honest.
16. Let authors ship low-risk PRs themselves: branch from current main, open the
   PR, enable auto-merge on green CI, then smoke production. Keep migrations,
   money, tenant/auth, configuration and rollback with one release owner.
17. Keep worktrees outside `/tmp` (it is wiped on restart) with dependencies
   installed, so typecheck failures are real. Commits survive in the shared Git
   object store; `git worktree prune` clears dangling registrations. Cloning
   `node_modules` copy-on-write from a cache keyed by the lockfile hash made a
   warm worktree setup take 21s with typecheck green (verified locally only).
18. Test the product's core loop in production before assigning side work. A
   week of secondary releases can hide that the main flow still fails.
19. Split one issue into parallel subagent jobs: research, CI log reading,
   running and summarizing tests, reviewing your own diff, a red test, a small
   adjacent fix, the doc update. Do small cross-role tasks (a quick QA-style check
   by DevOps) with your own subagent instead of routing them to another worker.
   Hand off only what needs another owner's authority or independence: migrations,
   money, production settings, secrets, rollback, independent review of a
   high-risk change, or files someone is editing right now.
20. The parent owns subagent output. Brief each one (goal, files it may change,
   checks, what to return), review the result and commit it yourself. Guardrails:
   the parent's or its own worktree, never the owner's checkout; one writer per
   file; no paid runs, external writes, production settings or secrets unless the
   brief allows them; at most one heavy job (full suite, build, dev server,
   browser) per worker on a shared machine; read-only subagents may run in
   parallel. One read-only research subagent read about 40 issues and PRs and
   returned 67 structured lessons in one pass while the parent kept dispatching.
   Adopted 2026-10-21; throughput effect not measured.
21. Capture lessons as one `Lesson:` line when an issue closes (what failed, the
   check that proved it, the fix). One coordinator publishes them in batches to
   shared knowledge repositories, so concurrent agents do not collide there.
22. Give every cross-owner action, especially a production setting change, one
   named owner and a dated follow-up check. Comment-only requests ("tell me the
   values", "@DevOps please set") left a fallback setting unapplied for 15 days
   because neither agent was running; see
   [the CI stall incident](../incidents/adbrain-two-week-ci-stall.md).
23. Publish a pre-approved action list (one diagnostic call, paid runs within a
   worker's share, auto-merging finished low-risk PRs, read-only production
   queries). Waiting for permission the list already gives was the most common
   delay; one diagnostic waited days before it was pre-approved.
24. Give each worker a fixed share of paid test runs and log every run's result
   in an append-only log (issue comments work). Derive the counter from the log:
   a hand-kept dispatch said 2 of 10 runs were used when the log showed 6.
25. Check in in a fixed order: CI on main and every long-lived branch; open PRs
   (merge green-but-stuck ones); production serves main HEAD and its smoke is
   green; idle workers get the next P0; only then dispatch and doc edits. Checking
   CI first exposed a red gate and an unapplied setting that had stalled work
   for two weeks.
26. Under a stall, freeze everything except a few named P0 issues and let
   every worker join them. After one such freeze, 14 PRs merged in 67 minutes,
   including a core regression gate and a production guard (shipping volume
   measured; the underlying reliability goal stayed open).
27. Ship one change to a core routing path at a time. A second routing PR was
   held and closed while another changed the same path, so a failed run had one
   suspect.
28. Answer the owner in a fixed shape: one line that answers first, a table of
   what you saw / what it is / status, and at most one owner action.
29. Address handoffs with an arrow (`→ QA: ready at <sha>`) and sign your own comments
   with your role. Check the convention against the wake script's real regexes (#287).
30. Retire a shared branch by freezing its writers, then diffing from the last known tip
   before deleting. Two commits landed after the freeze; the diff caught both (#260).
31. Keep the coordinator a manager: an owner request becomes an issue with done-criteria,
   routed to its owner and tracked. Building it yourself skips review and starves the plan.
32. Give every role a one-line card (owns / hands off) in the shared dispatch, and print it
   from the wake script so each wake and each restart re-reads it.
33. Make any chat restartable from one line: the wake script lists the role card, your
   open items (including ones where you spoke last) and unpushed local work. GitHub and
   git hold the state; chat memory holds nothing that matters.
34. Before "make delivery faster", time each stage. CI was 59 s and the post-deploy
   guard 100 s; the real losses were reviews waiting, environment friction and a
   brittle smoke that froze deploys.
35. Treat a reloaded editor as a dead team. After a restart the old chats reject messages
   ("Unknown chat owner") and return empty transcripts. Recover by starting one fresh chat
   per role from a stored restart prompt (role, dispatch, label queue, today's P0, waiter).
   All eight roles resumed within two minutes, with GitHub as the memory (#573).
36. Check that a worker is alive by reading its chat's latest turn, not by counting its
   recent issue comments. Workers stuck on a dead tool call look identical to workers
   waiting for work in both the UI and the comment log; only the turn shows which.
37. Steer a busy chat; queue for an idle one. A steer to an idle chat is refused, so
   fall back to queueing the message, then confirm the chat picked it up.
38. Rank the queue by its value to customers, from production data, at least daily.
   An agent team fills empty queues with internal tooling (metrics, flaky-test
   quarantine, skill programs). One production query showing no outside customers
   re-ranked the whole team toward the core loop and first pilots (#679, #681).
39. Give a core-focus sprint one owner per product step and a production baseline per
   step. "Prepare: 0 of 89 runs fully succeeded" sets the order better than a walk alone.
40. Refill idle queues from production failure data (top error codes per route), not
   from a wishlist. Each item then arrives with a target and a recorded response.
41. A role is live only when its wake script accepts it on the deployed branch. A new
   role merged to a staging branch failed `--me <role>` on main with a usage error, and
   the worker sat idle for hours (#575).
42. A decision posted as a PR review is invisible to a waiter that polls only issue
   comments. Either poll reviews too or mirror the verdict in a comment (#390).
43. A handoff on an item the next owner doesn't own is invisible. Make the waiter check
   who spoke last on every owned item, not only new events (#354).
44. When an owner-only step needs a browser, open the page yourself and tell the owner
   which tab to use. "Sign in to the shared browser" means nothing when no tab exists.
45. A waiter that exits after N idle minutes must be followed by running it again, not
   by stopping. A rule of "when it exits, stop" shut down every role after one quiet
   half-hour. Print "run me again" in the waiter's own exit message, so even workers you
   can't message see it.
46. "Idle" usually means an empty queue, not a stuck worker. Compare actionable items per
   role, rebalance from the busiest, and file work for the empty ones; waiters woke 9 of
   10 roles within two minutes once items were labelled.
47. Give every long-lived role its own session. Chats nested in one coordinator session
   share its direct-message cap (100 per process) and its fate, and chats can't be
   deleted from inside the session that owns them.
48. Use direct chat messages only to wake an idle chat or stop harm. A message queued
   to a busy chat sits unread until its turn ends; a steered one is folded into the
   running turn and looks lost. GitHub is the work channel.
49. A machine-local team stops when the machine sleeps. A laptop on battery went dark
   for 12 hours twice; nothing in software fixes a power setting. Check `pmset -g log`
   before debugging a silent team.
50. Supervisors that start headless one-shot runs leave a finished session behind each
   time; delete them in the same tick, or the owner's sidebar fills with dozens.
51. A hold comment doesn't cancel auto-merge. Leave auto-merge off on a PR that needs a
   verdict, run `gh pr merge <n> --disable-auto` to hold one, and make the approval a
   required check on core paths so the rule is mechanical.
52. A required check must also be satisfiable by bot-opened PRs (a train's sync and
   promotion PRs trigger no workflows), or the train stops.
53. Ask each role's restart prompt to re-read the issue's latest state and check for
   existing objects before any external write. A restarted worker with a stale plan is
   how duplicates get made.
54. Prefer the owner's stated experience over a one-run test when they conflict and the
   test hasn't spent yet ("WhatsApp always beats lead forms" ended a ₹0 arm).
55. Keep a single register of paused work, with what was built and the event that
   restarts it, and label it `parked`. "Delete as you go" otherwise deletes paused
   branches. Before deleting any branch or worktree, `git cherry origin/main <branch>`
   must show no `+` lines. GitHub keeps every PR's commits at `pull/<n>/head` after
   branch deletion, so closed PRs are recoverable.
56. When the priority order changes, remove `ready` from parked items in the same pass.
   Otherwise the pool still offers them and workers build paused work (two devs built
   upload slices for an hour after the owner put core and UI first).
57. A worker silent for 2+ hours on a P0 after two pings is stuck, not busy. Compare
   per-role comment counts against the queue, and restart with a direct, ordered brief.
58. A pool of 10 is not enough if every item is one lane. Count the ready pool
   per lane (dev, design, product, research, qa, ops) at every review.
59. When pinging about a red PR, ping the branch's author (`dev3/...`), not only the
   issue's owner. Otherwise both wait for the other.
60. Check the owner's latest scope before a cleanup PR. A lean-codebase pass deleted a doc
   the owner had just said to keep, and it had to be restored.
61. Research briefs belong on the issue, not as docs in git.
62. Before approving a test that needs Meta writes, check the test workspace is
   actually Meta-connected. A tab that is already signed in can replace an owner step.
63. A "next item" waiter is not enough: a worker that posted last on an item is never
   woken for it. The waiter must hand each worker its oldest actionable owned item
   before waiting, and keep a floor of ≥ 3 actionable items for **every** role, not only
   devs. Probe every role's waiter output after changing it.
64. When you pause a worker's activity, say in the same message when it resumes. A
   careful worker stops and waits for an all-clear that never comes.
65. Check process state, not comment counts: `ps` for waiters, and the chat's live
   transcript. A role with a recent comment can still be stalled.
66. Before each review pass, list everything addressed to the coordinator (→ CEO,
   `decision` labels). A deliverable waited 1.5 h for review because only worker
   activity was being checked.
67. Before approving anything the owner will see, check it against the owner's exact
   words point by point and against what's live now. Show the owner 3 samples before
   the full set (30 "artistic" ads shared one style and were rejected).
68. Size the team to the machine: 12 agent chats on 8 GB pushed load to 140. Restart in
   batches of 3–4, measure load and free memory between batches, and set limits:
   targeted tests only, no local builds or full suites, browsers only for QA roles,
   closed after each check.
69. A team kill switch must stop only the team. The supervisor's OFF switch also
   stopped production's scheduled jobs; keep production dispatch separate.
70. After a pause or restart, check `gh pr list --head <branch> --state all` before
   rebuilding anything; it may have shipped. `git branch -vv` `[gone]` doesn't mean
   merged.
71. Keep secrets to two env files (app secrets, test logins). One-off env files per
   test account multiply fast and leak into the owner's checkout.
72. Write engineering standards into the handbook *and* the PR template ("build every
   layer properly; refactor in its own small PR; never hold a release for a refactor"),
   so reviewers can block on them.
73. Before closing an issue as done, check `gh pr view <n> --json state` and
   `git cherry origin/next <branch>`, and grep main for the final string if a label was
   renamed mid-PR; memory and the PR title don't prove it shipped (#1740, #1641). A
   mockup issue closes when its last build slice is live; name that PR on it (#1251).
74. Before starting a refilled brief, read the issue's latest comments and `git grep`
   main for its number; one had shipped a day earlier, another already had a used
   summary (#1136, #1514).
75. Verify every quote in a helper's or researcher's draft yourself: a sentence marked
   "unverified" was in the official guide, and checking a research rule list against
   the code found a real bug (#2050, #1782).
76. Ask research to end in copy-ready replacement text for the decision record; it then
   lands as one docs PR (#2048).
77. Put review verdicts on the slice PRs; an umbrella tracker only adds re-check pings
   (#872).
78. Conflict recipes: when a stacked PR's base was squash-merged, take the target
   wholesale for files the PR never touched and keep only your hunks; when a docs split
   lands under an open PR, merge the target and move the paragraph (a rebase discards
   the approved head); when copy collides with an in-flight translation PR, take the
   target's `t()` lines and add new keys to every locale with a test (#1920, #1627,
   #1530).
79. Budget a shared API token across all workers together: authenticated conditional
   requests, read the rate-limit headers, and type-check any imported JS contract as
   well as running it (#2021).
80. Before filing a bug against a team tool, check which branch it runs from; the waiter
   ran `main`, which trailed `next` by hours while the train was blocked (#2162).

## Discriminating checks

- Can each worker state its owned files and next executable action without asking
  for routine permission or reopening the full repository map?
- Does a claimed missing handoff actually exist as a commit, issue comment or
  current receipt? Check once before turning it into a blocker.
- Is the expensive shared step genuinely serial? Split independent source work,
  but do not add several operators changing one production database/environment.
- Does the next check cover a changed input, required gate or uncovered behavior?
  If not, reuse the existing result rather than keeping a worker busy.
- Are local HEAD, remote HEAD, integration HEAD and deployed source distinguished?
  A dirty old checkout can coexist with already-committed worker branches.
- Can a complete accepted feature ship independently of another feature? Check
  actual imports, schema/grants and configuration; never infer independence from
  a small diff or include unfinished work merely to empty the backlog.
- Does an accepted UI delta sit on a rejected backend parent? Compare the complete
   repaired stack and relevant file bytes; delta acceptance cannot approve its base.
- Has the author stopped with a clean commit but no validation handoff? Ask for
   the existing results and limitations, not another implementation or full suite.
- Do reported production features have visible authenticated interaction evidence?
   A deployment status or an API response cannot establish that a gated control works.
- Before enabling auto-merge, does the PR's compare against current main list
   only the intended files? Worktrees share refs, so `origin/main` can move between
   a rebase and the merge; one stale merge would have reset 8 files and reverted
   three merged PRs ([near-miss](../incidents/adbrain-core-gate-merge-near-miss.md)).
- Before telling an author to "update the branch", merge the head into current
   main in a throwaway worktree and run the failing tests. In one case the same 3
   tests still failed because the test encoded an outdated provider order.
- Does each budget counter equal a recount of its append-only log?
- Is every cross-owner request older than one check-in owned by a named worker
   with a verified result, or is it waiting on a comment nobody will read?
- Does an approval at an earlier head still apply? Only if `git patch-id` of its patch
   against main equals the current head's (#259).
- Is a stale unmerged branch archived before deletion? Push an `archive/<name>` tag and
   confirm the remote tag's SHA equals the branch head (#260).

## Common traps

- Rewriting the dispatch for every idle/running notification.
- Treating a conditional QA pass as production permission or a real-provider test.
- Applying another worker's red regression without its fix and calling it green.
- Waiting for publication when the exact local commit is already reviewable.
- Re-adding tests already adopted from a QA overlay during integration.
- Using broad standing access as financial consent or applying one project's
  permissions to another repository.
- Solving slow releases by removing required CI, tenant or money protections.
- Leaving a rejected experimental follow-up described as a defect in the already
   accepted production foundation, or treating a corrected verdict as still blocked.
- Calling a commit "accepted but unreleased" because its SHA is missing from main.
   Cherry-picked releases change SHAs; compare patch content and issue state.
- Keeping an investigation open after owner evidence settles the outcome. Record
   the residual gap at its real priority instead of blocking unrelated work.
- Writing a not-yet-existing command into checked docs. A docs checker in CI
   failed the branch; run the same checker locally before pushing board edits.
- Long narrative handoffs. Five lines (change, proof, risk, PR, next) are faster
   to write and read and lose nothing a reviewer needs.
- Letting a subagent commit, spend or touch production settings because the
   parent could. The brief sets its authority; the parent reviews and commits.
- Five agents writing the same knowledge repository at once. Collect `Lesson:`
   lines and publish in one batch.
- Two routing or model changes in flight on the core path at once. A failed run
   then has no single suspect and no clean revert.
- Polling per issue from every chat on one shared token (5,000 requests/hour).
   Measure calls per poll before rollout: one repo-wide call cut 26 to 2 (#222).
- Pushing to another worker's PR branch without re-reading its thread: a merge fix
   raced the author's assigned rebase and was replaced. Let the author fix it (#217).
- Keying approval on "QA:": all agents post as one GitHub user, and handoffs to QA use
   it too. Require explicit verdicts at the head SHA; replay real threads (#228, #245).
- Opening a handoff with the addressee's role ("QA: ready") under one shared user: it
   reads as QA's own, so a wake script that skips self-authored comments misses it (#287).
- A release script that checks one reviewer silently drops a second required review;
   a money and migration PR shipped without the CTO's. Encode every approval (#259).
- Reusing an approval across a restack: against main, a stacked branch's patch also
   carries its parent PR (28 files, not 17). Re-request review after restacking (#259).
- Sharing `node_modules` across worktrees by symlink: the source checkout was stale and
   typecheck missed a package the branch needed. Install per worktree with `npm ci` (#282).
- Running a coordination script from a stale checkout: it lagged `origin/main` by 43
   lines. Run the current copy with `git show origin/main:<path> | node --input-type=module -`
   when it imports only built-ins, or from a fresh worktree.
- Editing live, already-approved ads unannounced: even a no-content save in the ad
   manager sends the ad back through review and delays delivery. Post every live edit
   on the run's issue first (#157).
- Reading a funnel without excluding internal accounts: three "real sign-ups" were QA
   test accounts and nearly triggered owner outreach (#339). Exclude internal users by
   default in every product query.
- Giving every target a date but no owner, or an owner but no date: idle workers sat next
   to a full backlog. Pair each open item with both, in one place.
- Re-approving a byte-identical rebased patch by hand: a two-hour wait for a one-line
   re-approval blocked three releases. Compare the PR's own changed lines
   (`git diff -U0` against its merge base) and carry the approval when they match (#524).
- Deleting branches by pattern in a shared-`.git` worktree setup: delete only branches
   you created, by exact name (#390).
- Starting a rebalanced issue without checking `gh pr list --search <n>` and the
   previous owner's worktree: work gets done twice (#470).
- Carrying a change across branches with `git checkout <branch> -- <dir>`: it copies
   whole directories. Use `git diff <base> <tip> | git apply` and check the PR's file
   list before enabling auto-merge (#372).
- Two workers in one worktree: a commit landed on the other's branch. Check
   `git branch --show-current` and `git status` right before every commit.
- Pushing review fixes after the PR already auto-merged: the fixes never ship. Check
   `gh pr view <n> --json state` first, and open a follow-up PR if it's merged.
- A squash from a stale branch silently reverting someone else's tests: read
   `git diff --stat origin/next...HEAD` for unexpected deletions before merging. Bring a
   red test over with cherry-pick, never by checking out a whole file.
- Committing research write-ups or prospect lists to a public repo: findings go on the
   issue; outreach data goes to a private store.

## Related methods

- [Evidence-first development](evidence-first-development-plans.md) for the first edit.
- [Verification gates](verification-gates.md) for risk and evidence reuse.
- [Runtime resource lifecycle](runtime-resource-lifecycle.md) for owned services.
- [Release checklist](../checklists/release.md) for the production handoff.

The failure pattern was observed in multi-worker web-app implementation and
release work. It supports these ownership and evidence rules, not a numerical
claim about agent throughput or guaranteed delivery time.
