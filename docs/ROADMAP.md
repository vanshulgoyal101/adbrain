# Roadmap

This guide describes priorities and unfinished outcomes, not delivery promises.
The [current dispatch](ORCHESTRATION.md#current-dispatch) owns assignments;
[Features](FEATURES.md) describes source behavior. Deployment and provider claims
require dated evidence. The next customer milestone was agreed on September 27,
2026; dated earlier release snapshots below remain historical context.

## Current Priorities

| Outcome | State | Next acceptance boundary |
| --- | --- | --- |
| Documentation a new developer can trust | [#39](https://github.com/vanshulgoyal101/adbrain/issues/39), with four assigned worker packets | Current core guides, preserved history, accurate examples and independent documentation QA |
| Complete enquiry import and practical follow-up | Released through [PR47](https://github.com/vanshulgoyal101/adbrain/pull/47) at f639cc3; authenticated save/reload/filter smoke passed | Preserve accepted behavior; do not replay the completed release |
| Verify operator-managed customer collection | [#48 technical activation](https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5850364461) is complete; non-charge checks passed | Separately approved real payment, signed webhook processing, correct customer allocation and eventual bank settlement; none is proved by enabled flags |
| Guard each customer's advertising allocation | [#49](https://github.com/vanshulgoyal101/adbrain/issues/49), Dev | Customer-specific verified balance, atomic reservation, reconciled costs and refund holds before any managed campaign activates |
| Reliable delivery within approved exposure | Earlier QA documents unresolved activation, spend and recovery cases | Accepted fixes against the actual candidate; no timeout, stale snapshot or parent status may substitute for financial/provider evidence |

Work in the current dispatch takes precedence over old pilot task queues. Preserve
completed feature candidates while documentation is rebuilt; do not reopen their
unchanged tests. Ready payment work does not wait for unrelated documentation or
bank-to-Meta automation. Follow the current standing rollout authority and financial limits.

## Delivered Baseline

Enquiries shipped through PR47, customer allowance and follow-up retention through
PR61, and focus/delivery-state corrections through PR62. #48 collection was enabled
on main a8ec89d with non-charge evidence linked above. Subsequent release work is
tracked in the current dispatch; the snapshots below describe earlier baselines.

The [SDK/query release receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release)
records production `6291dc2d2691bfc8a235b2aa1b103f119b26b83e` through PR36,
including AI SDK provider integration and TanStack Query campaign reads. Earlier
releases delivered instruction-read failure handling and Studio browser recovery.

The shared dev history `672eb132ad57bb3ba31f118afaffddaa878b4923` was the code-only
baseline and was superseded by later releases. Do not use its exclusions to describe
current production: PR46 was a payment integration checkpoint, not the later
production deployment and technical activation recorded under #48.
The nested-branch deployment-policy incident [#33](https://github.com/vanshulgoyal101/adbrain/issues/33)
is closed; new work still follows [RELEASING](RELEASING.md).

## Current Focus: One Verified Managed Customer

The intended journey is offer -> approved creative -> one customer payment ->
funded, reviewed delivery -> useful enquiries -> follow-up and reconciled costs.
The [product specification](SPEC.md) defines scope, while the
[payment plan](PAYMENTS-PLAN.md) owns commercial decisions and money-flow gates.

The owner agreed on September 27 that this is the next milestone after the
current release and assigned reliability/UX work. Do not interrupt those packets
or add a speculative feature batch before observing the pilot's actual blockers.

### Pilot Completion

Selected September 27: Solaride in the owner-specified AdBrain account. Verify
the login/workspace privately before inspection; do not publish its login email.
This is an internal workflow pilot, not evidence of an external paying customer.
Begin with read-only readiness; the selection does not authorize money movement,
paid generation, campaign creation or activation.

1. Select one owner-approved pilot business and responsible operator. Verify the
  supported onboarding, business brief and reviewed creatives using the existing
  workflow; do not treat the internal Solaride setup as customer consent.
2. With explicit transaction authorization, verify one real payment's capture,
  signed webhook processing, receipt and correct service/ad allocation. Track
  eventual bank settlement separately. Keep the approved commercial offer;
  do not invent a discounted test charge or silently modify the quote.
3. Before any delivery, verify actual Meta spend-cap compatibility with the
  INR 8,000 tax-inclusive allocation, intended child states, required access
  and specific spending approval. A captured payment cannot activate ads.
4. Confirm a monitored support/privacy channel and an executable unused-budget
  refund/reconciliation process. Refund execution needs its own authorization;
  working code or published policy does not prove operational fulfillment.
5. Track delivered service, generation cost, media/tax costs, qualified enquiries,
  follow-up response and remaining customer allowance. Record actual results and
  a continue/change/stop decision, without promising conversions or profit.

This is approval of the next objective, not a payment, refund, paid-generation
or ad-spend authorization. Customer identity, transaction details and spending
limits must be established before those operations. Reuse the existing runbook,
issue evidence and reporting; fix demonstrated pilot blockers rather than build
a new dashboard, monitoring system or broader channel integration.

Current operator: Vanshul Goyal's unregistered business. Solaride remains an
internal pilot and a proposed future operating arrangement, not the established
operator or proof of repeatable customer onboarding. The saved pilot campaign,
ad set and ad were OFF when verified. A configured daily budget is not spending
permission, a hard daily cap or a year-long delivery plan.

Razorpay account access, active settlements and the AdBrain website are verified.
Do not ask the owner to repeat onboarding because an earlier plan said no account
existed. Live collection, bank reconciliation and refunds are separate from
account-status checks. The owner now handles Meta payment outside the application.

## Release and Customer Gates

| Gate | Required evidence |
| --- | --- |
| Software and schema | Exact dependency-complete source, independent acceptance, required CI, compatible schema and rollout/rollback plan |
| Customer access | Actual consent, correct Page/account selection and capabilities; administrator repair and mocked consent are not substitutes |
| Commercial service | Approved operator, scope, invoice/tax/refund terms and measured cost assumptions |
| Payment collection | Exact production order schema/config/webhook, approved customer terms, verified capture/refund recovery and enabled live flags |
| Customer spending | Per-business verified allocations, attributed costs, concurrent reservations and bounded campaign authorization; operator pays Meta externally |
| Customer value | Qualified enquiries, acknowledged follow-up, actual media/tax/service costs and a continue/change/stop decision |

Use the current dispatch's standing production authority for scoped software,
configuration and migration work. A document or passing test alone is not that
authority, and no arbitrary bank mandate, test charge or ad activation is implied.

## Reliability and Workflow

Prioritize these open risks within existing customer workflows:

- Durable generation intent and atomic quota admission; browser recovery does
  not guarantee exactly-once paid execution across requests or devices.
- Activation reservations and uncertain-outcome reconciliation; provider success
  followed by a failed local save must not invite blind duplicate mutation.
- Complete, fresh spend observations and protective pause/recovery behavior;
  missing observations are not zero liability.
- Preserve the released enquiry import/paging/follow-up behavior; extend tests only
  for actual changes or newly observed failures.
- Public-media lifecycle, deletion/support operations, alert ownership and
  recoverability demonstrated with safe, attributable evidence.

Earlier failures are recorded in [QA](qa/), not asserted to have been reproduced
on every later release. Close them with exact-candidate evidence, not a renamed
helper, schema agreement or unrelated green suite.

## Commercial and Growth

Measure useful outcomes before expanding channels or automation. The owner now
explicitly chooses one customer payment to AdBrain and operator-managed Meta
payment outside the app. No outbound funding adapter or evidence gate is needed.
Do not promise profit, conversion rates or a year of continuous ads from an annual
service price. Keep account ownership, access and offboarding explicit.

Google Ads, video, team/agency administration, automated outreach and autonomous
optimization are deferred. Accessibility, privacy and reliability improvements
within the existing journey remain in scope when they resolve a demonstrated need.

## Already Implemented, Still Bounded

Brand profiles, creative review/export, draft/preflight workflows, paused campaign
creation, encrypted business-bound Meta access and reporting exist in source.
Their limits belong in [Features](FEATURES.md), [Architecture](ARCHITECTURE.md)
and the [API reference](API_REFERENCE.md), not duplicated capability tables here.

## Sequencing

Finish the current accepted release and assigned reliability/UX work, preserving
candidate handoffs and required checks. Then complete the managed pilot above.
DevOps remains the release/production executor, QA independently verifies changed
behavior, and developers address demonstrated workflow blockers. Non-blocking
documentation or unrelated polish must not delay a complete customer outcome.
Real financial execution waits for its concrete verified route and authority.

## Historical Pilot and Backlog

The [September 26 snapshot](ROADMAP-HISTORY-2026-09-26.md) preserves the earlier
P1-P6 task queue, approved Solaride copy/form, paused Meta object evidence, billing
investigations and older backlog. Those records retain their original dates and
scope. Their waiting instructions and old account-readiness claims do not control
current work.
