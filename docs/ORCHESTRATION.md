# AdBrain Worker Orchestration

Updated October 1, 2026. Maintainer: coordinator.
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

Routine steps never wait for the coordinator.

1. **Work lives in GitHub issues.** Labels say what matters and who acts next:
   `core` or `later` (priority), `owner:dev`, `owner:dev2`, `owner:qa`,
   `owner:devops` (who acts next), `ready-to-ship` (committed, waiting for DevOps)
   and `blocked` (needs something outside the team; the issue says what).
2. **Start or resume** by reading this section, then your queue:
   `gh issue list -R vanshulgoyal101/adbrain -l core -l owner:<you>`. Work the
   oldest. Empty queue: take an unowned `core` issue in your area and add your
   label. Nothing left: post one line in #74 that you are idle and stop. Do not
   invent work.
3. **Finish an issue** by committing in your worktree and pushing your branch
   (feature branches do not deploy). Comment the SHA and what you checked, set
   `ready-to-ship` and `owner:devops`, remove your label, and start your next issue.
4. **DevOps ships** every `ready-to-ship` issue: migrations first, required CI,
   protected merge, production smoke, then close the issue with the PR link.
   Changes to money, tenant boundaries or irreversible data get `owner:qa` first;
   QA confirms and hands back to DevOps. Everything else ships on CI.
5. **A core failure found live** gets its own `core` `bug` issue with the exact
   step, error and owner label. Add `owner:qa` when a red test helps. One issue
   per problem; do not bury new failures in long comment threads.
6. **The coordinator** sets priority, resolves conflicts, approves budgets, signs
   the browser in, keeps labels honest and closes or parks stale issues.

### Standing rules

- **Worktrees.** `/tmp` can be wiped on restart. Commit each coherent step and
  push your branch. Never edit the owner's checkout (`adbrain/`).
- **Browser.** Signed in to the owner's demo account: Cedar Ridge Chiropractic,
  Meta connected to the Solaride ad account and Page. Each worker uses its own tab.
  Background tabs do not render; use a page-local frame flush or call the same API
  the UI calls. If the session expires, post in #74 and the coordinator signs in.
- **Paid budget.** Create runs: 10 approved on Oct 1 (Dev up to 7, DevOps 3).
  Log `Create run N/10` with the saved count in [#88](https://github.com/vanshulgoyal101/adbrain/issues/88).
  At the limit, stop and post; the coordinator asks the owner for the next 10.
  No Meta ad spend: campaigns stay PAUSED.
- **Access.** Production DB: Supabase Management API with `SUPABASE_TOKEN` from
  `/Users/vanshulgoyal/Development/copilot/arcade/.env` (parse into memory, never
  print), project `kmzuxrvfrwwpwmoovwcp`, `BEGIN READ ONLY` for checks. Vercel:
  `npx --yes vercel@60.1.3`. Docs: `node scripts/check-docs.mjs` after `npm ci`.
- **Never** force-push, bypass branch protection, print secrets, activate ad
  delivery, charge or refund without approval, or touch the #54 Sep 29 held request.

### Current focus (October 1)

| Worker | Queue |
| --- | --- |
| Dev | [#90](https://github.com/vanshulgoyal101/adbrain/issues/90) Create page crash (CSP blocks Zod eval), then [#88](https://github.com/vanshulgoyal101/adbrain/issues/88). Run 1/10 saved 1 of 3 (repeated-opening, unsupported-claim, one provider failure) |
| Dev 2 | [#74](https://github.com/vanshulgoyal101/adbrain/issues/74) campaign mechanics: one PAUSED test campaign in the Solaride account with a Solaride lead form, then sync, pause/resume, archive. `29db6cf` is ready-to-ship |
| QA | Red tests for #90 and for whichever #88 rejection Dev is fixing |
| DevOps | Ship `29db6cf` ([#87](https://github.com/vanshulgoyal101/adbrain/issues/87)) and retry Prepare once. Then any `ready-to-ship`; confirm Create when Dev reports 3/3 |

## Historical Dispatch Receipts

Everything below is retained history and evidence. The Current Dispatch above
supersedes its assignments, pending-state wording and process instructions.

### Sep 30 release notes

[#75](https://github.com/vanshulgoyal101/adbrain/issues/75#issuecomment-5904233276)
is deployed via PR77, with final required CI and Vercel Ready evidence. The
verification flag was configured off for that deployment. Actual live interview
quality remains distinct from author tests; do not create another release of it.

[#73](https://github.com/vanshulgoyal101/adbrain/issues/73) is deployed via PR79
at `5e430bc`; its exact rollup migration and grants were read back by DevOps.
Authenticated action/engagement persistence has not yet been demonstrated. A safe
manual inspect-existing-creative and foreground-page check can supply that evidence;
no new generation or retention prune is needed. The original candidates stay frozen.

[PR72](https://github.com/vanshulgoyal101/adbrain/pull/72) released to
`ad73b750aa4332b5902f0c1654a37db50036fd8f`. The owner completed the INR10 payment;
coordinator read-only verification confirmed one capture/effect, no review hold and
zero service/ad allowance. Preserve its receipt. DevOps configured verification
off for PR77; do not repeat that cleanup absent a new mismatch. No repeat payment
or QA cycle is needed.

The earlier Supabase login blocker is resolved. At the owner's request, the
coordinator found an existing `SUPABASE_TOKEN` in the sibling Arcade environment
file (local source below). Read it with a dotenv parser into process memory; do
not print, copy into AdBrain, commit, rotate or send it through chat. No fresh
login is needed. The existing Arcade database scripts demonstrate the API pattern;
do not run those scripts or use their different project target for AdBrain.

```text
Local credential source: /Users/vanshulgoyal/Development/copilot/arcade/.env
Variable: SUPABASE_TOKEN
AdBrain target: kmzuxrvfrwwpwmoovwcp
API: https://api.supabase.com/v1/projects/kmzuxrvfrwwpwmoovwcp
```

Verified access: project GET200 matched AdBrain/ACTIVE_HEALTHY and read-only
POST `/database/query` succeeded. The initial pricing-preflight absence is historical:
DevOps subsequently applied the pricing migration under PR72. Platform backup
metadata reported zero backups/PITR disabled; PR72 has a scoped encrypted before-state,
not a full backup. Reuse the authenticated API with exact target/ledger/hash guards.
Do not replay whole schema. Analytics baseline read found 76 product events in
24 hours; existing database logging works, but this is not #73 deployment evidence.

`npx --yes vercel@60.1.3` works. The broken browser bridge is not itself a
deployment gate: use owner manual production smoke rather than repeated CDP
diagnosis. Do not reopen the superseded CLI login blocker or request credentials
already available locally. Apply the required migration before dependent callers.

Payment scope remains: privately verified Solaride owner/business, default and
maximum INR 10, one expiring recoverable verification order, zero service/ad
allocation, normal INR 10,000 annual price unchanged. The owner alone submits
payment after checking displayed/server/Razorpay amount. No automatic refund or
Meta activation. Preserve saved quotes and late recovery; keep quote-aware code
after a nondefault order exists. Disable new verification after the test.
Accepted migration `20260927_configurable_payment_quotes.sql` SHA256:
`f4b66888428add6cf4ee645f99168243c6ba5a9baf0c2680e462d2ac619edef4`.
Do not use superseded d10de1 bytes or rewrite applied history.

### Sep 30 ownership notes

Superseded by the Current Dispatch at the top of this file. Existing payment
acceptance remains valid; no routine second QA sign-off or unchanged-suite replay.
These assignments authorize scoped development, not new live charges, provider
spend, ad activation or unsupported clearing of the unresolved production intent.

Next ready release is [#67](https://github.com/vanshulgoyal101/adbrain/issues/67)
thumbnail source `794156742bcd846635fd5b5175e59691533cf510`, with scoped QA
acceptance reported. Preserve originals and legacy fallback; no old-asset backfill.
It need not wait for payment-provider evidence. DevOps may ship this independent
accepted slice while payment access is blocked, without a new approval loop or
mixing it into PR72. Do not start speculative polish to fill worker capacity.

The existing [one Solaride Brand save approval](https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5856545914)
also remains valid: name Solaride, offer "Free rooftop solar site survey and subsidy
application guidance, subject to eligibility", area Chandigarh and Panchkula;
preserve other values, read back and do not retry uncertain writes blindly.

Use one issue/PR for commit, result and blocker; no separate routine receipt.
Verify only changed inputs and required gates, then test ordinary behavior in
production with reversible synthetic/owner-controlled data. No secret exposure,
destructive customer operations or unapproved charges/refunds/provider spend.
Preserve peer work and services. A posted assignment cannot wake a stopped chat.

Last release reported and verified by DevOps: `04e2d001f4f1153fd8bd8c5ea33ad51612bf0dd0` (PR80).
Interview, Create recovery, analytics and declared memory are deployed. Authenticated
memory save/reload/forget and recovery of the old failed Create request remain
incomplete. INR10 application capture is verified; signed webhook and settlement
remain separate unverified evidence. No open source-QA blocker remains for #76.

### Earlier receipts

Everything below is retained historical coordination/evidence. The current
dispatch above supersedes its assignments, pending-state wording and process
instructions; dated receipts still describe only what they actually verified.

Current release: [PR69](https://github.com/vanshulgoyal101/adbrain/pull/69#issuecomment-5855189625)
deployed the accepted #49 spend-observation follow-up at
3f33108163db28471c304e1a11c1221203178f11. Required PR/main CI passed; Vercel
reported Ready on the canonical domain. Visible authenticated Settings rendered
with guardrail controls at a measured 362px; no setting was saved. No schema,
credential or payment-flag changes were made. The daily job may now read insights
and pause at-risk active campaigns; no scheduled run or live provider pause was
observed. Code rollback cannot undo an already-executed provider pause.
The assigned release queue is complete. The owner selected Solaride in the
privately specified AdBrain login as the internal pilot on September 27. Confirm
that exact owner/workspace binding before inspecting its readiness; do not publish
the login email. Start with bounded read-only preparation, not another release.
Payment, paid-generation, campaign creation and ad-spending scope remain separate.

Previous release: [PR68](https://github.com/vanshulgoyal101/adbrain/pull/68#issuecomment-5854254280)
deployed #52/#63/#65 at 98e6860f729510236a749161e58f51dc0df914c2 with required
PR/main CI green and the canonical Vercel deployment Ready. Authenticated Home
and Brand rendered; no Brand save, induced auth failure or real asset deletion
was exercised, and the workspace had no assets for a live #65 check. Keep those
limits separate from the accepted isolated tests. No migration or payment config
changed. The release is complete; the PR64 evidence below remains its earlier baseline.

Earlier production release: PR64 released #54/#60/#59 and the exact generation
intent migration at `fff1f456f97c527c49e43a234e4e8124e305e608`; required PR/main
CI passed and Vercel reported Ready on the canonical alias. The
[release receipt](https://github.com/vanshulgoyal101/adbrain/pull/64#issuecomment-5853880204)
records schema/RLS/RPC readback and the generation-status API check, but not a
successful interactive #59 smoke: Campaigns stayed on its loading shell in a
hidden browser session. Do not equate this deployment with frontend acceptance.
The subsequent [visible frontend walkthrough](https://github.com/vanshulgoyal101/adbrain/pull/64#issuecomment-5854107831)
verified authenticated Billing rendering/consent gating, #59 composer retention
and focus, #60 variant selection, and empty-Enquiries controls/navigation at
measured desktop/narrow viewports. Foregrounding resolved the hidden-tab loading
shell. Real enquiry-row follow-up, paid generation, payment capture/webhook and
Meta delivery remain unverified. Automatic campaign sync appeared before the
browser mutation guard; no manual sync was requested and its provider impact was
not independently established. Do not claim the walkthrough proved zero effects.
Earlier PR62 released #50/#57 at a8ec89d after PR61's #49/#55 release.
DevOps enabled #48 collection on a8ec89d in Ready deployment
`dpl_Dc3EGqxH2c7Q9Z7h7gjXiJAhbF5U`. The
[activation receipt](https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5850364461)
records the canonical alias, live SDK authentication and non-charge authenticated
Billing/order-read checks. Anonymous live-orders now returns 401, not disabled 404.
Signed provider delivery, actual capture and bank settlement remain unverified;
keep #48 open for that evidence, not as an integration/release blocker.
Do not repeat payment activation, upload credentials again or initiate a charge.
The assignments below are ordered next steps, not a claim that a chat is running.
#48 has four non-secret production target/identity variables configured. The
webhook secret and live API key pair are now stored as sensitive Production-only
Vercel variables, with metadata readback verified. The owner reports the Razorpay
webhook was created; DevOps has completed technical activation and non-charge
readiness as recorded above. Do not request these uploads again from old receipts.
Local live-key fields now exist, but are not a verified production configuration.
The owner's subsequent explicit request to upload the local live API pair
supersedes the earlier temporary replacement hold for this bounded transfer;
it is not a claim of credential rotation or provider verification. Preserve the
verified production account binding: a key-ID prefix substitution is not a
merchant account ID. The earlier local webhook placeholder has been replaced.
Keep environment files closed/unselected before chat replies; Git ignore and
hidden terminal input do not prevent editor context from attaching their contents.
September 27 owner instruction explicitly authorizes technical live-collection
enablement and leaves tax handling to the owner. Do not wait for a separate tax
determination or change the approved price, consent, invoice/refund policy or
invent a GST claim. This supersedes earlier tax-confirmation coordination holds;
it does not bypass technical payment safeguards or authorize a test charge.
The owner must enter secrets directly in secure consoles; browser-tool snapshots
must not handle secret fields. DevOps verifies configuration and the effective
operator-managed policy, enables the two production payment flags, redeploys
through the approved workflow and verifies non-charge readiness. If a technical
check fails, keep collection disabled and report the precise failure.
Owner's "put it in vercel now" one-variable coordinator write is complete:
RAZORPAY_LIVE_WEBHOOK_SECRET was uploaded to verified project
prj_LNNhyKmbQYXyBUNadG2hZJSLDjOw and read back as sensitive, Production-only.
The value moved in process memory with no secret output. Other environment
metadata was unchanged; no API key/account change, payment flag change or
deployment was performed. The bounded write is closed; DevOps again owns all
production configuration. Stored configuration does not prove live webhook delivery.
The subsequent owner-authorized live-pair transfer is also complete:
RAZORPAY_LIVE_KEY_ID and RAZORPAY_LIVE_KEY_SECRET were stored as sensitive,
Production-only variables on the same verified project. API acknowledgement and
metadata readback matched both entries; all other environment metadata was
unchanged, including the webhook and account binding. No payment flag or deployment
changed. The coordinator's bounded write is closed; DevOps has sole production
configuration ownership for the remaining readiness, flags and deployment steps.
Latest QA verdicts: the #54 P1 is CLOSED on exact repaired source
`26abaaad73ca75463c0c9d9c487276d3540f5f94`. The complete #54/#60 stack at
`facdeec221267ec86dbc92af8260a236512f8185` is source-accepted; QA verified the
repaired backend/SQL bytes and unchanged accepted Studio delta. #59 is separately
accepted at `3a6c6000217a8adf6323c738c8c3931578571ed4`.
PR64 has now integrated and released these sources. Do not repeat their assembly,
unchanged-source review or migration; the remaining task is deployed frontend
verification, distinct from paid/provider execution.
The #54 migration SHA256 is
`f690c73a570c2c4e8824dae6b6470dea0019b17afccfb82a2d24903ffc74ec8f`;
its exact-target application is recorded in PR64, not pending release work.
#56 source 4517b85 is acceptable to QA, conditional on a verified monitored request
channel before publishing it as working. Earlier checkpoints are historical.

Latest owner decision: enable real customer payments ASAP; the owner handles
paying Meta from the bank account/card outside AdBrain. Automatic Meta funding
verification/automation is no longer a checkout or release dependency.
[The current payment boundary](PAYMENTS-PLAN.md#current-funding-boundary)
supersedes the earlier automatic-funding-first requirement and investigation.
Checkout #48 is technically enabled with the approved operator-managed policy.
PR61/PR62 are complete; preserve the enabled production configuration during the
next release. Customer capture, signed delivery and settlement evidence stay
separate from software acceptance and from Meta ad-delivery eligibility.
The three original payment defects were repaired/accepted and PR46 is merged
to dev cdcf574; do not reopen that old repair packet. Assignments do not resume chats.
Read this section and your issue, then act within scope.

Owner has also explicitly approved [the initial live offer and refund policy](PAYMENTS-PLAN.md#approved-initial-offer).
Do not keep commercial terms or automatic Meta funding listed as unanswered
generic gates. Implement the recorded version and real customer consent; verify
technical configuration without inventing a tax claim; the owner handles tax
obligations outside this technical activation. Live setup still needs correct
credentials/webhook/schema and required checks; no arbitrary test charge is included.

Important status: #48 removed the automatic Meta funding prerequisite for new
operator-managed checkout; legacy orders retain their historical contract.
Customer collection can be enabled independently when its live checks pass.
Campaign activation still requires deployed #49 protections, actual delivery
eligibility and separate spending consent; source acceptance is not activation.

Pre-customer fast path: focused author checks for changed behavior, the existing
required CI once per relevant candidate, then deploy and smoke-test the actual
workflow using owner-controlled test data. No duplicate local full suites,
independent re-review of unchanged source, separate staging project or elaborate
restore/cutover rehearsal is required merely to ship a no-customer increment.
Use the existing target checks, transactional migration tooling and SQL evidence.
Preserve existing data and credentials; take a suitable recoverable snapshot for
risky data/grant changes and keep a compatible rollback or forward-fix path.
A brief controlled maintenance window is allowed for an incompatible transition;
it does not authorize destructive resets or unsafe grants. Do not assume the
database is empty because the owner has no customers.

DevOps is explicitly authorized to open the necessary PRs targeting dev/main
to trigger existing required CI and complete protected releases. No further
CI-trigger/PR permission question is needed. Required checks and branch protection
stay intact. Prefer the already-prepared accepted enquiry release over another
assembly study; split a batch only when a concrete dependency makes that faster
and safe. Real charges/refunds, bank operations and ad spending still require
specific financial consent; payment collection stays off until its known defects
and applicable live prerequisites are resolved.

Owner priority: enabled customer collection and per-customer spend accounting.
Enquiries are already deployed at f639cc3. Ship the new operator-managed checkout
without a bank-to-Meta adapter; customer-funded ad activation waits for #49's
balance/reservation guard. Capture alone must not activate campaigns.
Do not hold a complete feature for unrelated documentation, optional polish,
another status receipt or another worker's unrelated packet. Reuse exact accepted
evidence; review only changed behavior and keep mandatory financial/tenant/CI gates.

DevOps must advance required CI for the accepted selective candidate through the
already-authorized protected release workflow; no repeated approval is needed
merely to run CI or prepare the release. Do not promote while schema/recovery
requirements are unmet. Check whether the complete enquiry workflow can be
released with its two additive migrations independently of DB-A's incompatible
grant revocations. If it can, prepare that dependency-complete first release;
if it cannot, name the actual caller/security/schema dependency once. Do not
weaken safeguards, invent a workaround or couple payments to the enquiry release.

Owner subsequently granted broad AdBrain read/write/modify authority in response
to the production-preflight request. This supersedes the earlier code-only and
read-only-preflight approval holds for necessary AdBrain software, configuration
and database rollout. DevOps remains the sole production executor: verify the
target, exact migration inputs, preflight, recovery and compatible transition,
then execute safe in-scope changes without another generic permission round.
Apply the lean verification requirements above, not historical rehearsal checklists.
Preserve customer data, existing credentials and
unrelated work; no force-push, protection bypass, destructive cleanup or blind SQL
replay. Use a secure owner-controlled backup/recovery process, never raw customer
records or secrets in chat. No arbitrary paid infrastructure purchase, customer
charge/refund, bank mandate/transfer, Meta funding or ad activation is included
without specific financial limits and consent. Escalate an actual technical,
destructive or financial decision once with a recommendation, not "approval pending".
Routine progress goes in the existing issue/handoff; update this board only for
ownership, priority or material gate changes, not every idle/running notification.

The #49 spend-observation repair aaad67c11ac3ab0178389de078fde3924d49ea67
at /tmp/adbrain-issue-49-spend-evidence is now
[QA source-accepted](https://github.com/vanshulgoyal101/adbrain/issues/49#issuecomment-5854579988).
All three findings on its rejected parent 90ada778 are closed for the repaired
source. QA checked realistic query filtering/cursor termination, held funds beyond
the first 100 active rows, page-two failure, missing spend and draft/paused
coverage. Reuse the accepted evidence; no further unchanged-source review hold.
PR69 has completed current-base integration, required CI and release verification;
do not queue the original or repair again. Live provider efficacy remains separate.
Daily/60-second scheduling and delayed provider reports are not real-time or
provider-side hard-cap guarantees; source acceptance does not prove a live pause.

QA accepted the scoped #52 recovery behavior at
004fd5f6e5e74ca689d1c049680bc48f604f344c, #63 Brand save feedback at
724b9981eaf23084248172a5127e8d6328f9300e, and #65 asset focus visibility at
2e39edd728990d9b05bab9991e539b1c9c5f509f; PR68 has since deployed their selective
integration with clean required checks. Do not repeat that release or the old-base
diagnostics investigation. #52 still lacks a demonstrated solution to a genuinely
never-resolving upstream request, and deployed interaction limits remain explicit.

| Worker | Current outcome | Next useful action |
| --- | --- | --- |
| Dev | #67 media review support | Clean local candidate 45aa994 is handed off. Preserve selected-image priority, lazy thumbnails and unchanged export/recovery behavior while QA compares it. No production performance or image-byte reduction claim; await concrete findings |
| Dev 2 | #67 navigation review support | Clean local candidate 8aa107a isolates the Dashboard spend notice behind Suspense. Preserve auth, pending/error truthfulness and enforcement while QA reviews the actual boundary. The synthetic 75ms result is not deployed navigation latency; await findings |
| DevOps | One approved Solaride Brand save | In the verified owner-selected Solaride workspace, save only the approved display name, offer and service area below. Preserve other fields and verify saved values after reload. No paid generation, payment/order, asset or campaign change; external cost and Meta spend both capped at INR 0 |
| QA | [#67 Exact-candidate review and comparison](https://github.com/vanshulgoyal101/adbrain/issues/67) | Review 8aa107a navigation and 45aa994 media independently using the existing common fixtures. Verify pending/over-cap/error behavior and representative rendering. Check mobile media benefit and possible desktop regression under matching conditions; intercepted responses that bypass throttling are not valid timing evidence. Return per-candidate findings and limited claims, not whole-app acceptance |
| Coordinator | Pilot save plus bounded performance work | The approved Solaride save remains independent. The owner's request activates the three #67 slices above; no full-repo rewrite or new financial/provider authority. Keep shared configuration/test ownership explicit, preserve the pilot and require measured improvements. #56 remains open and #66 deferred |

Owner approval, September 27, following the Solaride readiness report:

- Display name: Solaride.
- Offer: Free rooftop solar site survey and subsidy application guidance, subject
   to eligibility.
- Service area: Chandigarh and Panchkula.
- Authorized action: one Brand record save through the existing application,
   followed by read-only persistence verification. Preserve unrelated fields and
   the same owner/business identity; do not create a duplicate business.
- Limits: zero creative generations, zero asset/campaign/connection changes,
   no payment/order/refund, maximum external cost INR 0 and Meta spend INR 0.

If the record already matches, verify without submitting. If a submitted save is
uncertain, read back before proposing a retry; do not blindly repeat it. Missing
access, validation conflicts or a paid side effect are concrete blockers. Do not
change or activate the seasonal/unsupported existing creatives as part of this save.

The #67 assignments are now active on manual resume; earlier issue-creation-only
and not-started notes are superseded for these slices. Each author takes a local
baseline, follows it to deciding code and delivers one checked improvement before
expanding. QA baseline work runs in parallel, not as a new permission checkpoint.
First author candidates are now committed: navigation
8aa107ad5d12c977162265a621963a39c8e2c388 at /tmp/adbrain-issue-67-navigation;
media 45aa99433a2da04a3f8bb09a932da7b0ea8daf91 at /tmp/adbrain-issue-67-media.
Both are local-only and await independent review. Media author evidence shows
faster selected-image completion only in a three-run mobile proxy, no established
desktop gain or reduced bytes/request count. Do not call these fixes a resolution
of the entire #67 performance report or a verified deployed improvement.
Use separate issue branches from a verified integration base containing the
current deployed behavior; preserve old accepted candidates and shared dirty work.
Dev owns image components/helpers and their tests; Dev 2 owns shell/navigation
and route-data paths; QA owns common measurement fixtures. Agree shared config,
query, script or test edits directly before overlapping them. Runtime/dependency
changes, caching and image transformations need evidence and existing gates;
production settings and release remain DevOps-owned, outside its one-save task.
No paid provider calls, asset mutations, financial tests, new paid infrastructure
or production load tests are included. Do not spend the owner's zero-cost Brand
save authority on performance experiments. Production browser measurement waits
for an available owned session with mutation guards; use isolated fixtures meanwhile.
Do not create a new profiling platform or repeat completed broad audits. Report
measured before/after results, functionality checks, limitations and an exact commit.

Exact repaired allowance source is `be0e800e50f798552a499f134f91eee75f109465`,
integrated with Billing placement and canonical schema at cdff882; #55 follows
at 107367a. PR61 pins the #49 migration SHA256
`f333f70cb60e6c57a126e53694b0b8a5cf32e074a7846eb4657077749997fa13`.
Use DevOps' exact target/migration receipt for application status; do not replay
an already-applied migration based on older board text.
DevOps owns shared integration, canonical schema and production execution.
#54/#60/#59 and #57 are deployed; preserve them during subsequent integration.
Report source/CI, deployment, visible frontend and real provider/transaction
evidence separately. Coordinate any shared helper contract directly;
do not edit another worker's worktree or mutate shared services.

For the frontend walkthrough, use a genuinely visible authenticated page, not
another hidden-tab reload loop. Check document visibility and actual viewport;
request only the missing sign-in/foreground action if needed, never secret input.
No admin/provider console navigation or raw account/customer screenshots in
public receipts. If #59 is reachable, exercise unsaved close/reopen without
Save draft or Prepare review; verify duplicate-variant names/selection only where
the existing data supports it, otherwise state the gap. Billing visibility and
consent gating do not prove a charge, signed webhook or bank settlement. #54 paid
generation/recovery remains unexercised unless separately authorized. Preserve
the existing source acceptance even when environment/session evidence is incomplete.

These follow-up scopes are not new dependencies for DevOps' frozen release.
#49 spend-evidence source is 90ada778977b819689cb49d151f93df32879c6ba at
/tmp/adbrain-issue-49-spend-evidence; #52 source is
004fd5f6e5e74ca689d1c049680bc48f604f344c at /tmp/adbrain-issue-52.
Keep those review candidates unchanged except for concrete review repairs.
Dev owns #63 BrandForm and Dev 2 owns #65 BrandAssets; coordinate directly if
both need a shared test file, preserving both regressions. QA owns independent
verification, not application edits. Use separate allocations and existing
fixtures; do not alter QA's detached overlays or worker services. Blocking
integration/review findings take priority over the new small fixes. Broad cleanup
issue #66 remains deferred. Assignments do not automatically resume any chat.

Next milestone, agreed by the owner September 27: after this release and the
current assigned work, complete [one verified managed pilot](ROADMAP.md#pilot-completion).
Solaride is now selected in the owner-specified AdBrain account; it remains an
internal pilot, not proof of an external paying customer. Pilot acceptance covers payment capture and
signed delivery, separate settlement, safe reviewed ad delivery, service/enquiry
outcomes and operational support/refunds. This agreement does not authorize a
charge, refund, paid generation or ad activation; verify the selected workspace
and establish transaction and spending limits first. Queue actual pilot blockers, not a broad
new feature batch.

Provider cap compatibility with the approved offer, operator-attested costs and
in-flight recovery limits remain explicit #49 limitations, not automatic funding
requirements or a reason to raise the customer's allowance. A released balance
display is not permission to spend or proof of a provider hard cap.

Current production authority and pre-customer verification scope override earlier
approval-pending and elaborate rehearsal requirements in receipts/issue comments.
Historical findings remain evidence, not a new mandatory process. Begin bounded
target/preflight checks and required CI, make recoverable migrations, deploy and
check the real workflow. Stop only for an actual safety/correctness failure,
missing credential/capability or an unapproved financial/destructive action.

Latest source: shared dev `cafb2cf9de2b12ed16093939dfaf877cd8ba18c5` has green
required CI and the complete corrected documentation packet. DevOps' SQL-only
fallback check passed for ce899768 after the six pinned migrations; it is not
a hosted rollback, maintenance rehearsal or production backup. Payment candidate
5f0998f is published separately from base 672eb13: its handoff reports 426 focused
tests, local fresh/upgrade/concurrency SQL and synthetic browser checks passing.
Independent payment acceptance, integration/CI and enabled-live evidence are pending.

The earlier c344bac documentation integration is included in current dev above.
The separate, unchanged selective application candidate is
`273cbf80422f8c89b851dfc2fcfa85bff878104f` on
`release/db-a-enquiry-preflight-20260926`. These supersede earlier dev/assembly
checkpoints below, not the last verified production release. QA has
[conditionally accepted its source/dependency scope](https://github.com/vanshulgoyal101/adbrain/issues/43#issuecomment-5847998087)
without blocking findings. At that verdict the exact candidate had zero hosted
check runs; required CI and rollout gates remain open, and it is not deployed.
Main 6291dc2 is not a safe
rollback after the proposed grant revocations; the SQL-tested ce899768 fallback
still needs a built, verified deployment and transition plan.
Local rehearsal does not establish a current production backup or grant approval
for downtime, data repair or schema application.

QA [accepted c85ba25](https://github.com/vanshulgoyal101/adbrain/pull/38#issuecomment-5847909211)
and [accepted #40 correction 6917f87](https://github.com/vanshulgoyal101/adbrain/issues/40#issuecomment-5847909342).
The 503-after-committed-pages coverage lead is closed by two passing independent
existing-suite regressions in test-only overlay
`90bec0f07c0400c8b8b6d2f41d963e9e66727266` at `/tmp/adbrain-qa-enquiry-c85`.
DevOps may adopt those tests; their success is not acceptance of a different
release assembly. The complete corrected four-guide packet can now be integrated
together with assembled documentation checks/required CI.

The [DevOps release receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release)
records PR #36 deployed at `6291dc2d2691bfc8a235b2aa1b103f119b26b83e` and
shared dev at `672eb132ad57bb3ba31f118afaffddaa878b4923`. Source and production
are not equivalent: DB-A migrations/dependent callers, test payments and the
#34/#35 candidates were excluded. No production migration approval follows from
the documentation request. Preserve all existing unpublished changes.

Documentation source handoffs: Dev #40 `7c968dc17aa21e75fb9f520c0186a6a4f1bd7a4f`;
Dev 2 #41 / PR44 `1b0bb378bd5b660c40c3c58fd4402d327dfe6d0d`;
DevOps #42 `bd47fcf8bb32ec6c0649dceac7530525e555b71b`. #41 and #42 have scoped
QA acceptance conditional on assembled checks/required CI. QA's own #43 source
is local commit `00e4729bbbe82955007d84a35963aaecf1732356` in
`/tmp/adbrain-docs-43`; DevOps can consume that commit without requiring a new PR.
#40's [handoff](https://github.com/vanshulgoyal101/adbrain/issues/40#issuecomment-5847066792)
is available at `/tmp/adbrain-issue-40-docs`. QA-owned guides/checker still need
review by another worker; author tests are not self-independent acceptance.
The whole rebuild is not automatically accepted by these individual handoffs.

## Next Delivery

PR46 merged to dev `cdcf5740c26c5175228d5f7f953354607efa6c39` with candidate and
merge CI passing. Its automatic-funding contract is now superseded for new
operator-managed checkout by #48; accepted fixes for consent, verified capture,
recovery and contradictory events remain. Start from this accepted dev source or
its verified successor, not the stale shared checkout. DevOps preserves all peer
changes while resolving local synchronization; that does not block issue worktrees.

No bank-to-Meta investigation, evidence seeding or funding adapter is needed.
Use real verified customer capture as the basis for accounting; service allocation
and Meta-tax-inclusive ad allocation stay distinct. Until #49 is accepted, keep
managed customer ad activation disabled/fail-closed rather than claiming the
existing weekly cap or zero-spendable payment response supplies a funded ledger.

Payment source 5f0998f and integrated a95e622 are not accepted for collection:
QA found stale terms acceptance (P1); Dev found saved checkout bypassing changed
funding (P1) and a late failed attempt holding a valid capture (P2). Existing
test-only overlay `024f0a99145ae2c187b8fcd4b2ca13617a0bd45f` has the red consent
case and two passing recovery cases. Adopt the relevant tests with fixes, not as
an already-green candidate. The UI/backend ownership split above supersedes the
earlier blanket assignment of all three fixes to Dev 2.

Production payment implementation is delivered in #45 at 5f0998f, not yet accepted
or enabled. The next engineering steps are peer/QA findings, dependency-complete
integration and required CI. Preserve test isolation and zero test entitlement.
Enabled launch still needs approved finite commercial/invoice/tax/refund terms,
supported automatic Meta funding, exact-target schema/configuration/operator approval
and separately authorized bounded live capture/refund/settlement verification.
Author-complete software or a disabled deployment does not complete live collection.

Dev owns #35's application/schema compatibility; DevOps consumes that exact
candidate and alone owns shared integration and release assembly. Do not have
both workers independently repair the same schema or replay the same author tests.
DevOps prepares and executes the existing production backlog under the current
standing authority, without waiting for every documentation issue to close.
Record exact filenames/checksums, target, preflight, backup/restore and compatible
transition evidence before applying. The earlier code-only approval hold is
superseded; unresolved technical or financial requirements are not.
Never deploy callers before required schema or merge unfinished dev wholesale.

Rebuild guides from source, not by changing dates on old prose. Follow the
[maintenance rules](README.md#maintaining-these-docs): one canonical guide per
subject, reader-oriented examples, explicit limitations, stable links, synthetic
data and clear source/test/provider/release boundaries. Keep dated receipts and
historical plans intact; annotate supersession rather than rewriting evidence.
No documentation website or application refactor is needed.

Each owner validates links, examples and source claims. QA owns independent
factual review and a lightweight repeatable check. QA reviewed the coordinator's
recorded seven-guide snapshots; later scheduling edits are deltas, not the same
frozen source. Original roadmap, operating-assessment and payment bodies remain
preserved in dated HISTORY files. An index rewrite alone does
not complete #39. Use existing worker receipts for short handoffs and the parent
issue for coverage, not another protocol document.

Preserve the [enquiry milestone](https://github.com/vanshulgoyal101/adbrain/milestone/2):
#34 and #35 are joined in PR38 at `c85ba252cf3dd4d9e039df9409bed484fd6967db`.
Dev's clean candidate includes canonical schema and re-import/follow-up evidence;
its handoff reports 177 affected tests and focused PostgreSQL checks passing.
QA has now independently accepted that exact joined scope using the author
evidence and two focused recovery regressions. Selective release assembly and
required CI remain separate; DevOps owns integration and the production migration
approval packet. No paid/provider or production operation was included in QA's verdict.

Owner also requests live-payment rollout. The [Razorpay inspection](PAYMENTS-PLAN.md#verified-razorpay-account-status)
verified live mode, Account Access Complete, Settlements ACTIVE and website
approval. Merchant activation is not an unknown blocker. AdBrain remains test-only:
#45 implements production checkout, not a test-flag toggle. Enabled collection
still requires accepted software/schema, secure approved live configuration,
commercial/funding readiness and a separately authorized bounded live verification.
No account, credential, financial or migration mutation is authorized by #45's
local implementation assignment.

### Publication Policy Mismatch

Resolved: [#33 is closed](https://github.com/vanshulgoyal101/adbrain/issues/33).
The `**: false` repair covers nested branches; corrected SDK/query candidates
were integrated and the intended main release deployed. The [release receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release)
contains bounded hosted verification. There is no blanket publication hold.
New branches still need the corrected policy and the [release requirements](RELEASING.md).
Stop if observed behavior contradicts suppression. Historical preview evidence
does not prove retrospective absence of exposure; no preview cleanup or credential
change is included in this scope.

## Priority Filter

Start work only if it completes a core customer workflow, clears an active release
blocker, or removes a demonstrated recurring customer/operating cost. A severe
money, privacy, security or data-loss risk is high value even if uncommon.

1. Implement the production payment journey and release accepted completed work;
   finish in-flight documentation without making it a global release dependency.
2. Complete the campaign-to-enquiry journey: reviewed ads, bounded delivery,
   honest spend/status, complete enquiry import and practical follow-up.
3. Complete payment-to-funding only against a verified provider route and approved
   commercial rules. Investigate that feasibility alongside the customer journey.
4. Expand after actual usage shows what customers need next.

Use maintained libraries to deliver these outcomes, not as an end in themselves.
Defer optional polish, speculative frameworks, large-account generalization and
exhaustive rare-state automation. Big product milestones still use focused commits.
SDK adoption does not close the parked delivery/spend safety work or CONTRACT-BC.

## Decision Rights

- Owner requests regular Git checkpoints. Commit each coherent slice after its
   focused author checks and before handoff or switching tasks; do not wait for
   whole milestones, independent QA or production approval to save completed work.
   Authors commit only owned paths in their issue worktrees. DevOps checkpoints
   shared/coordinator changes and integration; do not stage another worker's edits
   or commit active failing experiments just to reduce the visible change count.
   Publication and production remain separate, with their existing gates.
- An assigned issue authorizes necessary implementation, related helpers/tests,
  issue-local dependency selection/install, local commits and a focused PR.
  No acknowledgement-only turn, per-file naming permission or allocation ceremony.
- Reuse the existing issue worktree. If none exists, the assigned owner can create
  a unique local feature worktree from dev after checking existing allocations.
  Do not wait for shared-checkout cleanup or copy production environment files.
- Developers may publish their own feature branch after its deployment policy is
   verified and release requirements are met. No extra DevOps approval is needed.
- Discuss a necessary shared interface directly with its owning worker in the
  issue/PR. Involve the coordinator only for a conflicting owner, material scope,
  product/policy decision or unavailable external authority. Choose one interface
  and implement it; do not create parallel naming proposals.
- DevOps is the single writer for integration into dev/main and production.
  Feature editing, independent installs and small tests need no global test slot.
  Coordinate only real CPU/memory contention, shared services and release writes.
- An idle worker is acceptable. Do not create work or documentation to fill capacity.

## Single-Writer Register

| Surface | Owner |
| --- | --- |
| #50 shared control components, focus CSS and focused UI tests | Dev in its isolated issue worktree; no unrelated theme or payment logic |
| #56 privacy/data-deletion content and a narrowly scoped request entry point/tests | Dev 2; agree any Settings placement with DevOps before touching shared release files |
| #55 lead-inbox component, directly related styles and existing lead-inbox tests | Dev in its own feature worktree; #49 findings take priority |
| #49 CustomerBalance placement in managed-billing and its focused integration tests | Dev 2; no allowance-module/SQL or DevOps-worktree edits |
| #34 Meta lead/form paging, sync route/modules, sync-specific migration/types and existing related tests on its new issue branch | Dev 2; no campaign mutation changes |
| #35 inbox/page/CSS, lead list/update routes, lead-row fields, follow-up migration/tests and combined schema integration on its new issue branch | Dev; no edits to Dev 2's sync implementation |
| #48 payment server/config/order/SQL/UI and payment tests | Dev 2; old #45 consent-pair reservation is released after its accepted merge |
| #49 customer-balance/reservation modules/SQL/tests, campaign admission and a separate balance component | Dev; agree payment-read/refund interfaces with Dev 2, no concurrent checkout-file edits |
| Shared Git/index/lockfile integration; CI/hosting and release mechanics | DevOps |
| Independent review, QA fixtures and e2e acceptance assertions | QA; product repairs stay with the author |
| README.md, docs/README.md, ORCHESTRATION, SPEC, ROADMAP, OPERATING-BRIEF, PAYMENTS-PLAN and root worker instructions | Coordinator, #39 |
| FEATURES, API_REFERENCE, DATA_MODEL, DEMO-RUNBOOK | Dev, #40 |
| ARCHITECTURE, AI_PIPELINE, META_CONNECT, META_APPROVAL_ACTION_PLAN; historical annotations in CREATIVE-GENERATION-PLAN and META-INSTANT-CONNECT-PLAN | Dev 2, #41 |
| QUICK_START, CONFIGURATION, DEPLOY, RELEASING, OPERATIONS, OBSERVABILITY; historical release classification | DevOps, #42 |
| TESTING, BRAND-IDENTITY, PRODUCT-DESIGN-ROADMAP classification; documentation-check scripts and issue-local package changes | QA, #43; DevOps owns shared integration/CI wiring |

Do not edit a peer's worktree, kill its process, switch the shared branch, reset
unpublished work or remove retained artifacts. Duplicate O-8 allocations and old
B copies are retained references, not additional implementation branches. If an
owner already uses another recorded copy, keep that work and identify it once.
Broader product changes need a scoped issue; this plan is not blanket write access.

## Testing Budget

| Change | Smallest sufficient verification |
| --- | --- |
| Documentation/status | Relevant format/link check only; no application suite |
| Ordinary behavior | Test the changed workflow and likely failure; applicable lint/types. Use existing suites |
| Shared logic or dependencies | Affected consumer tests and compatibility/audit checks for the changed inputs |
| Auth, tenant boundaries, money, paid execution or schema | Targeted security/financial invariants and relevant real integration/schema checks; mocks cannot prove external effects |
| Release | Current required CI on the assembled candidate plus a relevant deployed-workflow smoke and compatible rollback |

During development run focused checks, not the whole platform after every edit.
Full local suites/builds are needed only where required or where equivalent CI
evidence cannot cover the relevant source, dependencies, configuration and runtime.
Keep required GitHub checks; do not weaken assertions, skip failures or bypass
protection to speed a release. Test counts are not a productivity target.

Reuse evidence when those inputs still match. Do not repeat installs, audits,
browser journeys or whole-tree hash inventories just for a second handoff. Use
commit plus diff for routine work; manifests are for genuinely uncommitted snapshots.
When something fails, fix that slice and rerun the discriminating check before
expanding. Do not build a new harness when an existing test can express the case.

## Review and Release

1. Author delivers a useful slice, focused tests and a commit/PR. QA reviews while
   CI runs; it need not wait for the final test report to inspect the diff.
2. Fix blocking correctness, financial or security findings. Non-blocking polish
   becomes backlog, not a release hold. Review later corrections as deltas only.
3. QA may approve the exact scope conditional on green required checks. DevOps
   verifies them and proceeds without another QA session to transcribe success.
   Changed source or an actual failure reopens only the affected review.
4. DevOps batches related ready commits and uses the protected
   [release process](RELEASING.md). Never merge
   unfinished work merely to make one large release or clear a local counter.
5. Verify the deployed SHA and affected workflow, then stop. No broad production
   audit for every ordinary release; no outage injection or paid test by default.

Standing owner approval covers reviewed, tested software releases through protected
PRs and necessary AdBrain database/configuration rollout under the current
production authority above. Destructive repair, unrelated credentials, paid
services, preview enablement and live financial actions are not implied. Do not
request the same authority repeatedly or expand it beyond this project/outcome.
Reuse known-good CI/tooling; optimize actual slow steps separately, not mid-release.

## File-Based Handoffs

GitHub is the durable task/review record. A normal handoff is a short update with
issue/PR, source commit, result, concrete blocker and next owner. Link existing
evidence instead of copying it. Longer reports are for genuinely complex incidents.
Do not write a test solely to certify a status paragraph or append a new protocol
version for every update. Update the current dispatch in place.

Existing receipts: [Dev](qa/db-a-dev-a-handoff-2026-09-26.md),
[Dev 2](qa/dev2-devc-contract-o1.md), [QA](qa/qa-a-o1-handoff.md),
[DevOps](qa/ops-environment-2026-09-26.md). Read only the latest relevant section.
Before declaring a missing handoff, check its actual availability once. Then do
unblocked work or name the exact missing decision; no polling or repeated status loop.
Disclose AI-assisted reviews; using one GitHub account is not a second human approval.

The owner can say "sync workers" instead of relaying transcripts. Independent
idle chats still need a resume; this file is not an automatic dispatcher. Do not
interrupt active work just to adopt this shorter plan.

## Historical Reference

[The previous board](ORCHESTRATION-HISTORY-2026-09-26.md) preserves old dispatches,
manifests, reservations and contract details. It is reference only, not current
permission or a work queue. No full-history rereading is required.

### O-10 Fast Path

Legacy link retained for worker receipts: current rules are above. Historical
G-2 author evidence is in the [archived fast path](ORCHESTRATION-HISTORY-2026-09-26.md#o-10-fast-path).