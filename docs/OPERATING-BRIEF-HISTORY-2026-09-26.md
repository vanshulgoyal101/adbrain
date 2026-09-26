> Historical assessment preserved September 26, 2026. Original findings, counts and assignments retain their tested scope; use [the current operating brief](OPERATING-BRIEF.md) and [worker dispatch](ORCHESTRATION.md).

# AdBrain Operating Brief

Updated September 26, 2026. Working context and execution priorities for the owner,
coordinator, Dev, Dev 2, DevOps and QA. This is not a deployment or launch approval.

Current assignments, file/resource ownership, integration queue and decisions live
in [Worker Orchestration](ORCHESTRATION.md). Its current four-worker plan supersedes the
original three-worker queue. The later [independent QA receipt](qa/independent-acceptance-2026-09-26.md)
accepts DB-A and F5/F8 only for candidate B's local scope; the
[DevOps receipt](qa/ops-environment-2026-09-26.md) supplies newer environment evidence.
The initial review and verification history below retain their original scope.

## Operating Decision

Build one trustworthy, measurable customer journey before expanding the platform:
business offer -> approved creative -> approved payment/funding -> reviewed ads
that actually deliver -> qualified enquiries -> reconciled costs and customer value.

AdBrain has substantial implemented functionality. Its immediate constraint is
not a shortage of features; it is incomplete evidence and controls between campaign
preparation, spending, payment recovery and delivered outcomes. Continue improving
the useful workspace while keeping the managed paid service gated.

The coordinator owns prioritization, dependency decisions, integration review and
the outcome scorecard. QA independently challenges evidence. Dev and DevOps own
their implementation surfaces. The owner retains commercial/legal decisions,
customer and bank consent, expenditure and production-operation approval.

## Evidence and Moving Source

This review combined three read-only QA/DevOps/Dev research passes with coordinator
source inspection, current payment receipts and focused local tests. It did not
independently inspect production, provider accounts, bank records or customer data.
No claim of exhaustive security certification or complete live-platform knowledge
follows from a repository scan.

- Initial checkout: dirty `dev` at `9da5b07`, one commit behind the local
  `origin/dev` reference. No fetch, pull, branch switch or publication performed.
- Inventory during review: 229 application TS/TSX files, 43 route files, 145 unit
  and component test files, five browser spec files and 15 SQL migrations. Counts
  include uncommitted files and change as workers edit.
- Concurrent payment and database work was preserved. Campaign trusted-write and
  draft-authority changes appeared during review; their presence is not acceptance.
- Distinguish source inspection, local reproduction, another worker's dated
  receipt, hosted checks and real-provider evidence. Never relabel one as another.
- Earlier audit findings describe their tested baseline. Reproduce them against
  the assembled candidate before declaring either continued exposure or closure.

Start with [Features](FEATURES.md), [Architecture](ARCHITECTURE.md),
[Roadmap](ROADMAP.md), [Payments](PAYMENTS-PLAN.md),
[QA baseline](qa/qa-baseline-2026-09-26.md) and the
[remediation packets](qa/remediation-plan-2026-09-26.md).
The packets remain the detailed acceptance contracts; this brief prioritizes them
for the product. The orchestration board assigns the four workers without creating
another parallel implementation backlog.

## Product and Commercial Context

- Customer: a local business wanting advertising outcomes with little advertising
  operations. The initial internal pilot is a solar site-survey offer, but the
  product supports other industries through free-text brand facts.
- Current operator: Vanshul Goyal's unregistered business. Solaride is not the
  established legal operator of AdBrain. Proposed Solaride-owned customer ad
  accounts require a formal, provider-approved relationship and offboarding terms.
- Owner-selected package: INR 10,000 annually, INR 2,000 service allocation and
  INR 8,000 for Meta media plus applicable Meta taxes. Gateway charges are absorbed
  by AdBrain. No extra customer tax or automatic renewal may be silently added.
- Automatic Meta payment and one customer payment are explicit requirements.
  Manual top-ups or customer-direct Meta billing are alternatives requiring an
  owner decision, not implementation shortcuts.
- Account-specific automatic funding remains the first commercial feasibility
  gate. Gateway settlement to a bank does not prove an automatic route to Meta.
  Do not invent a gateway-to-Meta transfer API.
- The internal Solaride campaign was created directly in Ads Manager with its
  campaign, ad set and ad OFF. That receipt does not demonstrate AdBrain creation,
  delivery, customer onboarding, attribution or lead handoff. The saved INR 200/day
  budget is not spending permission or an annual delivery schedule.
- Revenue, retention, customer acquisition cost and profitable external demand
  were not established by this review. Unknown is not zero or a forecast.

### Economics to Prove

INR 2,000 is a service allocation, not profit. Measure gateway costs and their
taxes, generation and regeneration, support, operator time, infrastructure,
refund/dispute losses and reserves before choosing a contribution target.

Illustration only: with 18% applicable Meta tax, INR 8,000 contains INR 6,779.66
media and INR 1,220.34 tax. At INR 200/day media, that is approximately 33.9 budget
days, not year-round advertising; actual daily spend can vary. With an illustrative
gateway fee of 2% plus 18% tax on that fee, INR 236 comes out of the service
allocation, leaving INR 1,764 before other costs and customer-tax treatment.
These are scenarios, not verified tax advice, provider pricing or earned margin.

Keep the annual service scope finite and explicit. Start with the proposed single
offer/service area, limited creative variants and capped campaign; the owner must
approve scope, renewal, unused funds, cancellation and refund rules before selling.

## Platform Map

| Surface | Implementation and owning reference | Important boundary |
| --- | --- | --- |
| Public experience | [Marketing](../src/components/marketing-home.tsx), guides and SEO under `src/lib/seo` | Acquisition content is not measured acquisition performance |
| Identity and workspace | [Session queries](../src/lib/supabase/queries.ts), Supabase Auth and owner RLS | UI selects the oldest owned business; not a team/agency account switcher |
| Brand and assets | [Brand actions](../src/app/(app)/brand/actions.ts), instructions, public image storage | Extracted facts need review; public asset URLs are not protected by row RLS |
| Create | [Ad assistant](../src/components/ad-assistant.tsx), brief/interview and generation routes | Browser generation recovery does not guarantee once-only provider execution |
| Studio and export | [Studio](../src/components/studio.tsx), approval/regeneration/export | Creative approval is not publication; F5 browser recovery locally accepted, server once-only execution still open |
| AI execution | [Creative engine](../src/lib/creative/generate.ts), LLM pools, image providers, rendering/persistence | Quota preflight is not an atomic cost reservation; unknown provider cost stays unknown |
| Meta connection | [Connection access](../src/lib/meta/connection-access.ts), OAuth, discovery and private tokens | Signed state, capabilities and binding generations are useful protections; real customer consent is a separate gate |
| Draft and review | [Preflight](../src/lib/campaign/preflight.ts), versioned drafts and targeting | Review must bind all effective inputs, including mutable destination links |
| Paused creation | [Creation service](../src/lib/campaign/create-service.ts), operation ledger and leases | Durable create recovery exists; it is not a general delivery or payment ledger |
| Activation and pause | [Status route](../src/app/api/campaigns/[id]/route.ts), Meta client | Parent ACTIVE does not imply intended ad sets/ads are active or delivering |
| Spend and reporting | [Spend cron](../src/app/api/cron/enforce-spend/route.ts), snapshots and campaign reports | Cron currently reads stored, unpaginated evidence without freshness enforcement |
| Enquiries | [Lead sync](../src/app/api/leads/sync/route.ts), inbox and manual sharing | Form/lead cursors and exact attribution are incomplete; no verified automated recipient handoff |
| Payments | [Test workflow](../src/lib/payments/test-checkout.ts), allocation/funding foundations | Test captures create no spendable entitlement; annual settlement/refund lifecycle is not complete |
| Operations | [CI](../.github/workflows/ci.yml), Vercel, Supabase, optional campaign worker | Checked-in configuration is not proof of deployed settings, alerts, backup or worker health |
| Measurement | [Event schema](../src/lib/observability/events.ts), request correlation and usage records | Operational events are not a qualified-enquiry, revenue or financial ledger |

Preserve the strongest mechanisms: explicit creative review, paused creation,
connection-generation fences, durable external-operation checkpoints, bounded
provider input/output, SSRF protections, privacy-limited events and controlled
releases. Extend these selectively rather than replacing the platform.

## Current Risk Decisions

| Priority / packet | Evidence and status | Decision |
| --- | --- | --- |
| Commercial / BIZ-A | Automatic Meta funding, operator/agency relationship, annual tax/refund terms and normal customer consent remain unverified | Keep managed collection/delivery gated; owner/provider investigation proceeds alongside local safety fixes |
| Integrity / DB-A | Independent QA candidate B passes fresh/upgrade/legacy SQL, 13 real Auth/PostgREST controls and four draft workflows | Local scope accepted; current-candidate comparison and production legacy/grant/rollout acceptance remain separate |
| Delivery / DEV-B | Current status route still mutates the parent only; capacity check, external mutation and local persistence remain separate | Require exact-child review and durable activation/capacity reservations, not an unconditional child activation loop |
| Spend / DEV-C | Current cron lacks fresh provider observations and complete paginated reads; missing snapshots become zero | Unknown spend must not authorize new managed delivery; agree and test protective pause/escalation behavior |
| Creative / DEV-A | F5 Studio recovery and F8 instruction failures independently accepted locally on B | Durable server generation identity and atomic quota/liability remain open; queued behind DEV-C |
| Outcomes / DEV-D | Meta client ignores form/lead pagination; import does not request/save exact campaign attribution | Complete import/recovery and honest inbox paging, then prove consent-safe recipient handoff |
| Recovery / DEV-E, PAY-A | Public media lifecycle and durable payment recovery extend beyond database/browser state | Preserve unknown liabilities and references; no blind reorders or bulk orphan deletion |
| Operations / OPS-A/B, QA-A | Hosted CI has no browser journey gate; deployed isolation, restores and alert delivery need current evidence | Use read-only inventory and synthetic drills before any approved rollout |
| Public contract / DOC-A, BIZ-A | Terms say Meta bills directly; privacy promises in-app deletion; deletion page promises 30 days | Reconcile terms before managed checkout and verify deletion/contact operations; legal review is not replaced by code changes |

The authority findings are not proof of a deployed cross-tenant data breach. QA
now reproduces the activation race and uncertain-save retry through the actual
handler on B; both remain failing acceptance cases. No database transaction can atomically roll back an external Meta
request: keep transactions short, persist intent and reconcile uncertain effects.
Release reservations only on verified inactivity or reconciled liability, never
because a timeout or lease expiry merely occurred.

### Latest Payment Evidence

The [real-provider test receipt](PAYMENTS-PLAN.md#september-26-real-razorpay-test-transactions)
records two genuine Razorpay test-mode captures, an intentional test-bank failure,
signed callback verification, durable local capture records and reload recovery.
Other incomplete attempts remain unpaid/uncertain as documented. This supersedes
older roadmap and handoff text saying provider testing has not happened; it was
not independently replayed by this coordinator.

This is not live collection, bank settlement, public webhook delivery, refund
issuance, Meta funding, production deployment or commercial merchant approval.
All captured test responses retain zero spendable credit. Reuse existing test
orders/evidence for investigation; do not create replacements to clear uncertainty.

## Worker Coordination

Use [Worker Orchestration](ORCHESTRATION.md) as the single current assignment board.
Dev owns DEV-B, Dev 2 owns DEV-C, DevOps owns isolated CI/release/recovery work and
QA owns independent acceptance. Both developers first agree CONTRACT-BC. Shared
files have one writer; accepted local scopes are not automatically released.

The coordinator owns cross-worker decisions and scope, not concurrent unassigned
code changes. No additional worker is requested in the current wave. Human
accountant/provider decisions remain necessary and cannot be replaced by coding
capacity. Handoffs are document-issued until the worker acknowledges them; there
is no automatic dispatch to other chats. Production and financial actions retain
the separate approval gates in [Releasing](RELEASING.md).

## Outcome Scorecard and Launch Gate

Track evidence, not a percentage-complete estimate:

| Measure | Evidence to collect |
| --- | --- |
| Customer onboarding | Correct Page/account, actual customer consent, time and manual interventions |
| Approved creative | Time to first approved asset, rejection/regeneration count and observed AI cost |
| Delivery reliability | Reviewed child states, provider acceptance, first verified delivery and recovery outcomes |
| Spending safety | Observation age/completeness, reserved exposure, detection-to-confirmed-pause time and unknown liabilities |
| Enquiry value | Actual attributed enquiries, agreed qualification, recipient acknowledgement, surveys booked and follow-up time |
| Economics | Customer cash, settlement, gateway costs, Meta media/tax, unused liability, refunds, service effort and contribution |
| Operations | Queue age, failed pauses/reconciliation, alert delivery and measured restore results |

A bounded internal pilot needs delivery/spend controls, approved funding and
budget, final creative/targeting review and enquiry handoff. An external paid pilot
also needs real customer consent, approved terms/operator identity, the complete
payment/settlement/refund path and tested offboarding. Neither is authorized by
this document. No guaranteed lead count or sales outcome is promised.

Defer Google Ads, video, broad agency/team tooling, automatic account provisioning,
large billing abstractions and cosmetic expansion until the first journey supports
a continue/change/stop decision. Reliability, usability, accessibility and privacy
fixes within existing workflows continue; funding uncertainty is not a reason to
leave known local defects untouched.

## Changes and Verification in This Review

Fixed APP-05/F8 locally: [instruction query](../src/lib/supabase/queries.ts#L246)
now rejects database failure instead of substituting empty guidance. Successful
empty reads still work. Existing route error handling stops generation and
regeneration before paid provider calls; no new UI or response contract was added.
This does not solve Studio recovery, atomic quota reservations or instruction
truncation/selection policy.

Added five regression cases in [query tests](../tests/spend-queries.test.ts) and
[generation route tests](../tests/creative-generation-route.test.ts). The two
focused suites passed 32 tests; three adjacent assistant/planner/API suites passed
76 tests. Touched-file ESLint and editor diagnostics passed. Workspace TypeScript
initially found two errors in concurrent trusted-write work; that worker's later
change resolved them and the repeat typecheck passed without coordinator edits.

Full coverage, fresh install, database migration tests, production build, browser
journeys, hosted CI and live providers were not rerun in this review. Earlier
receipts retain their own scope and dates. No commit, push, deployment, migration,
provider transaction, credential change or dev-server start was performed here.