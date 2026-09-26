# AdBrain Operating Brief

Owner and coordinator context, reconciled September 26, 2026. This brief explains
the outcome, decisions and evidence needed to operate the product. It is not a
deployment approval, financial authorization or another worker task queue.

## Operating Decision

Complete one trustworthy customer journey: business offer -> approved creative ->
authorized payment/funding -> reviewed delivery -> qualified enquiries -> follow-up
and reconciled costs. Improve useful existing workflows before adding channels,
agency administration or generalized automation.

The immediate assignment is the [documentation rebuild](ORCHESTRATION.md#current-dispatch).
All four workers have distinct packets. Existing enquiry and database candidates
remain preserved; rewriting their documentation does not accept or deploy them.

## Evidence and Moving Source

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Deciding code and constraints | Implemented contract in an identified checkout | Deployed schema, working provider access or customer outcomes |
| Focused local tests | Behavior of the tested candidate and fixtures | A real payment, consent flow or production operation |
| Independent QA | Acceptance of the reviewed scope and exact source | Acceptance of unrelated changes or later candidates |
| Required CI | Hosted gates for that source | Correct production target or provider approval |
| Deployment receipt | Exact deployed source and the stated smoke checks | Untested journeys, historical isolation or future availability |
| Provider/bank evidence | The specific account, transaction and observation | A complete financial lifecycle or permission for another action |

The [PR36 release receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release)
records production `6291dc2d2691bfc8a235b2aa1b103f119b26b83e`. Shared dev
`672eb132ad57bb3ba31f118afaffddaa878b4923` contains additional preserved backlog.
DB-A migrations/dependent callers, test payments and #34/#35 were excluded from
that code-only promotion. Consult a newer exact receipt before changing this baseline.

## Product and Commercial Context

The customer is a local business owner who wants useful advertising without
becoming an ad-operations specialist. Solaride is the internal pilot, not the
only supported industry or proof of external demand.

Vanshul Goyal's unregistered business is the current operator. Solaride ownership
and agency-account plans require formalization. The agreed annual allocation,
fees, tax questions and funding model live in [Payments](PAYMENTS-PLAN.md#1-goal-and-decisions).
The requirement is one customer payment with automatic Meta funding; changing it
requires an owner decision. Gateway settlement alone does not prove that route.

### Economics to Prove

Service allocation is not profit. Measure gateway fees/taxes, generation,
regeneration, support time, infrastructure, refunds/disputes and reserves. Define
finite service scope, ad schedule and unused-fund treatment before selling.
Use the [illustrative economics](PAYMENTS-PLAN.md#annual-package-and-illustrative-economics)
as scenarios, not tax advice or a verified margin forecast.

## Platform Map

| Reader's question | Canonical guide |
| --- | --- |
| What can the customer do? | [Features](FEATURES.md) and [product scope](SPEC.md) |
| Where does behavior and authority live? | [Architecture](ARCHITECTURE.md), [API](API_REFERENCE.md) and [data model](DATA_MODEL.md) |
| How do AI and Meta operations recover? | [AI pipeline](AI_PIPELINE.md) and [Meta connection](META_CONNECT.md) |
| How do we configure, observe and release it? | [Configuration](CONFIGURATION.md), [operations](OPERATIONS.md) and [releasing](RELEASING.md) |
| What is unfinished or commercially gated? | [Roadmap](ROADMAP.md) and [payments](PAYMENTS-PLAN.md) |

## Current Risk Decisions

| Area | Decision and remaining acceptance |
| --- | --- |
| Database authority | Preserve accepted local DB-A evidence; production legacy data, grants and migration rollout still require target-specific acceptance |
| Delivery and spend | Keep unresolved activation-race, uncertain-save and stale-spend findings visible; require exact-candidate remedies before claiming bounded managed delivery |
| Creative execution | Instruction-read failure handling and Studio browser recovery shipped; neither proves server-side exactly-once execution or atomic paid quota admission |
| Enquiries | #34/PR37 and #35/PR38 need combined workflow/schema acceptance; do not infer exact attribution or automated recipient handoff |
| Payments | Merchant status is verified, but the application remains test-only; capture, settlement, entitlement, funding and activation are separate states |
| Public contract and operations | Reconcile service terms, privacy/deletion promises, support, alerts and recovery with actual operating capability before paid launch |

Historical QA failures are evidence about their tested baseline, not proof of a
deployed breach or a claim that every later candidate has the same defect.
Preserve uncertain external liabilities until reconciled; a timeout or expired
lease does not prove that a provider did nothing.

### Latest Payment Evidence

[Read-only Razorpay verification](PAYMENTS-PLAN.md#verified-razorpay-account-status)
confirmed live mode, complete account access, active settlements and the approved
AdBrain website. Earlier real-provider test receipts record two test captures and
one deliberate test-bank failure. No live collection, bank settlement, public
webhook delivery, refund issuance or automatic Meta funding is established by
those checks. Test captures remain non-spendable.

## Worker Coordination

The [current board](ORCHESTRATION.md) owns scheduling and file boundaries;
GitHub issues own scope and acceptance. Authors own implementation and focused
checks, QA owns independent acceptance, DevOps owns shared integration/release,
and the coordinator resolves priority and material cross-owner decisions.
Do not duplicate assignments in this brief or read historical holds as current.

## Outcome Scorecard and Launch Gate

| Outcome | Measure with attributable evidence |
| --- | --- |
| Onboarding | Correct assets and consent, elapsed time and manual interventions |
| Creative | Time to approved work, rejection/regeneration count and actual AI cost |
| Delivery | Reviewed child states, first delivery, uncertain operations and confirmed recovery |
| Spend | Observation freshness/completeness, reserved exposure and detection-to-pause time |
| Enquiries | Qualification, recipient acknowledgement, booked outcomes and follow-up effort |
| Economics | Customer cash, settlement, media/tax, unused liabilities, refunds and service effort |
| Operations | Job/backlog age, escalation delivery and measured restore results |

A paid external pilot needs real customer consent, reviewed scope and terms,
verified payment/funding, bounded delivery, follow-up, refunds and offboarding.
The historical paused Solaride campaign is not proof of these outcomes. No
guaranteed lead count, sales result or new spending approval is implied here.

## Changes and Verification in This Review

The [original operating assessment](OPERATING-BRIEF-HISTORY-2026-09-26.md)
preserves the initial audit, candidate-B findings and coordinator F8 test receipt.
Its inventory counts, assignments and local-only release descriptions are dated
history. Current implementation references and later release evidence supersede
them where explicitly verified; old receipts themselves remain unchanged.
