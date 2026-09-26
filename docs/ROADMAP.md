# Roadmap

This guide describes priorities and unfinished outcomes, not delivery promises.
The [current dispatch](ORCHESTRATION.md#current-dispatch) owns assignments;
[Features](FEATURES.md) describes source behavior. Deployment and provider claims
require dated evidence. Status below was reconciled on September 26, 2026.

## Current Priorities

| Outcome | State | Next acceptance boundary |
| --- | --- | --- |
| Documentation a new developer can trust | [#39](https://github.com/vanshulgoyal101/adbrain/issues/39), with four assigned worker packets | Current core guides, preserved history, accurate examples and independent documentation QA |
| Complete enquiry import and practical follow-up | [#34 / PR37](https://github.com/vanshulgoyal101/adbrain/pull/37) and [#35 / PR38](https://github.com/vanshulgoyal101/adbrain/pull/38) are feature candidates | Combined schema/workflow acceptance, required checks and separately authorized migration-dependent rollout |
| Live customer payments for the managed service | Dev 2 assigned [#45](https://github.com/vanshulgoyal101/adbrain/issues/45) now; merchant activation and website approval verified; application remains test-only | Production payment lifecycle, approved terms, account-specific automatic funding and a bounded authorized live verification |
| Reliable delivery within approved exposure | Earlier QA documents unresolved activation, spend and recovery cases | Accepted fixes against the actual candidate; no timeout, stale snapshot or parent status may substitute for financial/provider evidence |

Work in the current dispatch takes precedence over old pilot task queues. Preserve
completed feature candidates while documentation is rebuilt; do not reopen their
unchanged tests. Ready application releases and #45 implementation do not wait for
unrelated documentation completion. Production migration decisions remain separate.

## Delivered Baseline

The [SDK/query release receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release)
records production `6291dc2d2691bfc8a235b2aa1b103f119b26b83e` through PR36,
including AI SDK provider integration and TanStack Query campaign reads. Earlier
releases delivered instruction-read failure handling and Studio browser recovery.

The shared dev baseline `672eb132ad57bb3ba31f118afaffddaa878b4923` also contains
preserved backlog that was deliberately excluded from production. In particular,
database hardening and its dependent callers, local test payments and the enquiry
candidates must not be advertised as deployed by the code-only release.
The nested-branch deployment-policy incident [#33](https://github.com/vanshulgoyal101/adbrain/issues/33)
is closed; new work still follows [RELEASING](RELEASING.md).

## Current Focus: One Verified Managed Customer

The intended journey is offer -> approved creative -> one customer payment ->
funded, reviewed delivery -> useful enquiries -> follow-up and reconciled costs.
The [product specification](SPEC.md) defines scope, while the
[payment plan](PAYMENTS-PLAN.md) owns commercial decisions and money-flow gates.

Current operator: Vanshul Goyal's unregistered business. Solaride remains an
internal pilot and a proposed future operating arrangement, not the established
operator or proof of repeatable customer onboarding. The saved pilot campaign,
ad set and ad were OFF when verified. A configured daily budget is not spending
permission, a hard daily cap or a year-long delivery plan.

Razorpay account access, active settlements and the AdBrain website are verified.
Do not ask the owner to repeat onboarding because an earlier plan said no account
existed. Actual live collection, bank reconciliation, refunds and automatic Meta
funding are separate from those account-status checks.

## Release and Customer Gates

| Gate | Required evidence |
| --- | --- |
| Software and schema | Exact dependency-complete source, independent acceptance, required CI, compatible schema and rollout/rollback plan |
| Customer access | Actual consent, correct Page/account selection and capabilities; administrator repair and mocked consent are not substitutes |
| Commercial service | Approved operator, scope, invoice/tax/refund terms and measured cost assumptions |
| Payment and funding | Verified capture and allocation, settlement/refund reconciliation, supported automatic funding and bounded delivery authority |
| Customer value | Qualified enquiries, acknowledged follow-up, actual media/tax/service costs and a continue/change/stop decision |

Production migrations remain separately scoped. Documentation work, successful
tests and a general request to ship are not approval to mutate a production
database, create a mandate, charge a customer or activate ads.

## Reliability and Workflow

Prioritize these open risks within existing customer workflows:

- Durable generation intent and atomic quota admission; browser recovery does
  not guarantee exactly-once paid execution across requests or devices.
- Activation reservations and uncertain-outcome reconciliation; provider success
  followed by a failed local save must not invite blind duplicate mutation.
- Complete, fresh spend observations and protective pause/recovery behavior;
  missing observations are not zero liability.
- Complete enquiry import, stable inbox paging and preserved follow-up state;
  branch implementation still needs combined acceptance and migration rollout.
- Public-media lifecycle, deletion/support operations, alert ownership and
  recoverability demonstrated with safe, attributable evidence.

Earlier failures are recorded in [QA](qa/), not asserted to have been reproduced
on every later release. Close them with exact-candidate evidence, not a renamed
helper, schema agreement or unrelated green suite.

## Commercial and Growth

Measure useful outcomes before expanding channels or automation. Automatic Meta
funding and one customer payment are explicit requirements; manual top-ups or
customer-direct Meta billing need a product decision, not a silent substitution.
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

Finish assigned documentation and preserve existing candidate handoffs. Then
integrate dependency-complete customer outcomes through the existing acceptance
and release process. Provider feasibility can progress alongside implementation;
real financial execution waits for its concrete verified route and authority.

## Historical Pilot and Backlog

The [September 26 snapshot](ROADMAP-HISTORY-2026-09-26.md) preserves the earlier
P1-P6 task queue, approved Solaride copy/form, paused Meta object evidence, billing
investigations and older backlog. Those records retain their original dates and
scope. Their waiting instructions and old account-readiness claims do not control
current work.
