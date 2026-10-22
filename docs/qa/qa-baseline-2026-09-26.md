# QA Baseline: September 26, 2026

## Assessment

AdBrain is an implemented advertising workspace with substantial local regression
coverage. Its proposed annual managed advertising service is not yet verified
end to end. The critical gap is between preparing ads and reliably delivering
customer value within an agreed financial authority, not a lack of screens.

This baseline records product intent, development context, implementation owners,
known defects and acceptance gates for ongoing QA. It supplements the detailed
[September 25 findings](repository-audit-2026-09-25.md), not a new authorization to
fix, publish, migrate, collect money, provision accounts or activate advertising.

## Evidence Boundary

- Current checkout: dirty `dev`, HEAD `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`.
  Local main/dev references matched at inspection; remote freshness and deployed
  aliases were not checked in this audit. Existing work was preserved.
- Inventoried 514 existing tracked/untracked nonignored files, including 228
  application TypeScript files, 43 route files with 49 exported HTTP handlers,
  145 unit/component test files, five browser spec files and 12 SQL migrations.
- Parsed every application TypeScript file for syntax and route exports. Manually
  traced critical paths and neighboring tests across identity, brand/assets,
  creative generation, Meta connection, campaign preparation/creation/activation,
  spending, leads, reporting, payments, security, operations and release controls.
- Reviewed the complete local non-merge commit sequence, current development
  changes, product/history documents and selected dated QA/release receipts.
- This is not exhaustive manual inspection of every line, dependency, binary
  asset or historical revision. No full-history secret scan was performed.
  Environment secrets and private lead data were not copied into this report.
- No application code, external objects, credentials or deployments were changed.
  Local checks generated ignored artifacts. The production build used a temporary
  current-source copy, excluding environment files; that copy was removed.
- No authenticated browser journey or live provider transaction was executed.
  Existing localhost/browser sessions were not treated as isolated test services.

## Product Intent

The customer is a local business owner who wants useful enquiries without becoming
an advertising operator. The intended journey is:

**Business facts and offer -> approved creative -> reviewed campaign -> verified
payment/funding -> bounded delivery -> attributable enquiries -> understandable
results and reconciled costs.**

The original solar-first wedge used warm access and Solaride as customer zero.
August development generalized the engine to other industries. The product's
differentiation remains creative quality, business context, simplicity and useful
outcomes; Meta supplies delivery infrastructure. Historical idea exploration is
in [How We Got Here](../how-we-got-here.md), not the current commercial contract.

The controlling [Roadmap](../ROADMAP.md) now prioritizes one verified managed
customer: one INR 10,000 annual payment, INR 2,000 service allocation and INR 8,000
covering Meta media plus applicable Meta taxes. Gateway costs are absorbed in
AdBrain's economics. Do not silently add tax to the requested total, assume
automatic annual renewal, or interpret INR 200/day pilot settings as year-round
delivery. Customer invoice treatment, service scope, refunds and margin still
need professional/provider review.

The latest operator clarification names Vanshul Goyal's unregistered business,
not Solaride, as AdBrain's current operator. The proposed Solaride-owned dedicated
customer accounts and a future Solaride arrangement must be reconciled with that
identity before launch. Existing Meta asset bindings are not changed by a billing
label correction.

Automatic outbound Meta payment remains first priority, identified as P2 in the
roadmap. A one-off UPI QR or generic support response is not recurring enrollment.
The September 26 exception permits isolated Razorpay test-mode development in
parallel, not live collection or a substitute manual-top-up business model.

## Development Context

| Period | Development and purpose | QA implication |
| --- | --- | --- |
| August 2 | Brand Brain, assets, creative generation, paused Meta creation, planner and results | Distinguish approval, local persistence and remote publication |
| August 12-17 | Geography, leads/digests, reports, A/B ad sets, languages, guided creation, industry generalization and spend guards | Verify actual payloads, total multi-ad-set budgets and non-solar workflows |
| August 22-September 5 | Hydration/navigation, downloads, sign-in/compliance, input controls, workflow UI, paid usage and security | Preserve work through navigation; test error/empty states and real user tasks |
| September 6-13 | Validated creative concepts, image runtime/Flare evidence, protected releases, encrypted Meta connection, draft and operation recovery | Paid quality evidence is distinct from mocks; connection and creation need concurrency fences |
| September 16-18 | DNS/media hardening, trusted quotas/limits, owner binding repair, contextual interviews, reviewed audiences and telemetry | Verify tenant identity and failure behavior; credential repair is not customer consent |
| September 19-20 | Audience controls, reporting identity, optional worker, cancellation/recovery, responsiveness, sign-in and verified-number WhatsApp publishing | Test late responses, interrupted operations and destination-specific results |
| September 24-25 | Allocation/signature helpers, managed-funding evidence and charge observations; funding-first pilot reset | Foundations are not a customer ledger, automatic payment route or live service |
| September 26, uncommitted | Razorpay SDK/test order routes, private migration, gated Settings checkout/CSP, recovery and operator clarification | Validate disabled production behavior and test-state recovery; do not infer release from local success |

Historical release branches are not separate product environments. Current source
contains the earlier campaign and connection work. A branch name, localhost URL,
merged migration or passing build does not establish deployment or isolation.

## Workstream Map

| Area and intended outcome | Owning implementation | Present capability and remaining QA boundary |
| --- | --- | --- |
| Identity: the correct owner sees the correct business | [Session guard](../../src/lib/supabase/middleware.ts), [queries](../../src/lib/supabase/queries.ts), [connection access](../../src/lib/meta/connection-access.ts) | Supabase auth/RLS; most UI uses oldest owned business. No general agency/team workflow. Dev identity is not API authorization |
| Brand: reusable facts, constraints and real product assets | [Brand actions](../../src/app/(app)/brand/actions.ts), [asset UI](../../src/components/brand-assets.tsx), [validation](../../src/lib/brand/validation.ts) | Editable facts, autofill, uploads and instructions. Check edits during extraction, partial storage writes and missing-versus-failed reads |
| Create: minimal questions and an explicit approved brief | [Assistant](../../src/components/ad-assistant.tsx), [interview](../../src/lib/creative/interview.ts) | Bounded interview, editable brief and generation-ID recovery. No durable exactly-once server generation claim |
| Studio: inspect, approve and reuse credible creative | [Studio](../../src/components/studio.tsx), [generation route](../../src/app/api/creatives/generate/route.ts), [creative pipeline](../../src/lib/creative/generate.ts) | Per-variant persistence, repair, formats/languages, regeneration and export. Studio recovery differs from Create; human factual/visual review remains necessary |
| AI/media: bounded provider work with provenance | [Text routing](../../src/lib/llm/index.ts), [image routing](../../src/lib/imageGen/index.ts), [raster validation](../../src/lib/imageGen/raster.ts), [persistence](../../src/lib/creative/persist.ts) | Provider pools, deadlines, explicit fallback and usage receipts. Token quota is non-atomic; image costs and best-effort logging are not a hard financial cap |
| Meta connect: consent to the intended Page/account | [OAuth callback](../../src/app/api/meta/oauth/callback/route.ts), [OAuth](../../src/lib/meta/oauth.ts), [token store](../../src/lib/meta/token-store.ts) | Signed/browser-bound/replay-protected attempts, encrypted private tokens, discovery and independent capabilities. Real external-customer consent remains an evidence gate |
| Campaign preparation: publish exactly what was reviewed | [Preflight](../../src/lib/campaign/preflight.ts), [preflight service](../../src/lib/campaign/preflight-service.ts), [draft store](../../src/lib/campaign/draft-store.ts) | Versioned drafts, resolved geography/interests, approved creative hash, destination and connection generation. Review is not permission to spend |
| Campaign creation: survive uncertain external writes | [Create route](../../src/app/api/campaigns/create/route.ts), [execution service](../../src/lib/campaign/create-service.ts), [operations](../../src/lib/campaign/operations.ts) | Durable unique claims, leases and external checkpoints; objects created PAUSED. Uncertain writes require reconciliation, not a new key |
| Worker: execute outside short HTTP lifetimes | [Worker](../../src/lib/campaign/worker.ts), [runner](../../scripts/campaign-worker.ts) | Optional persistent executor sharing the service, current ownership/review rechecks. Hosting, supervision, rollout and alerts are separate from source existence |
| Delivery/spend: only intended ads run within authority | [Status route](../../src/app/api/campaigns/[id]/route.ts), [Meta client](../../src/lib/meta/client.ts), [spend cron](../../src/app/api/cron/enforce-spend/route.ts) | Explicit activation review and binding checks, but parent-only activation, non-atomic capacity checks and stale spend remain open |
| Reporting: useful, correctly attributed outcome summaries | [Insights decoder](../../src/lib/meta/insights.ts), [refresh](../../src/app/api/campaigns/[id]/refresh/route.ts), [reports](../../src/lib/campaign/report.ts) | Destination/period-aware snapshots; conversations distinct from leads. Snapshots are not ledger deltas or intrinsically current-week spending |
| Enquiries: collect and hand off actionable responses | [Lead sync](../../src/app/api/leads/sync/route.ts), [inbox](../../src/components/lead-inbox.tsx) | Manual instant-form sync, deduplication, search and sharing. No complete provider pagination, campaign attribution or automatic assigned handoff |
| Customer payments: prove a payment without granting unintended authority | [Test adapter](../../src/lib/payments/razorpay-test.ts), [checkout service](../../src/lib/payments/test-checkout.ts), [checkout UI](../../src/components/test-checkout.tsx) | Local-only fixed test amount, server verification and durable recovery. Every returned order has zero spendable credit and cannot activate campaigns |
| Managed finance: establish evidence before automation | [Allocation](../../src/lib/payments/allocation.ts), [funding assessment](../../src/lib/payments/meta-funding.ts), [billing observations](../../src/lib/payments/meta-billing-events.ts) | Versioned arithmetic and evidence checks. No annual contract/entitlement ledger, settlement reconciliation, refund issuance or automatic account funding |
| Security/privacy/operations: constrain abuse and diagnose failures | [SSRF](../../src/lib/security/ssrf.ts), [limiter](../../src/lib/security/rate-limit.ts), [telemetry](../../src/lib/observability/logger.ts), [operations](../OPERATIONS.md) | DNS-bound public fetches, bounded media, fail-closed production limiter and sanitized events. Public media, manual deletion, backups and alert ownership need operational evidence |
| Public experience: explain actual capability honestly | [Marketing](../../src/components/marketing-home.tsx), [design intent](../PRODUCT-DESIGN-ROADMAP.md), [deletion policy](../../src/app/data-deletion/page.tsx) | Public examples/guides/legal pages exist. Demo artwork is not customer performance; a deletion promise needs verified operational execution |

## Open Defects

The existing F1-F9 identifiers below refer to the [detailed audit](repository-audit-2026-09-25.md).
All remain open; no fixes were applied in this session.

| Finding | Current evidence | Acceptance needed |
| --- | --- | --- |
| F1, high: parent-only activation leaves children paused | Reproduced with actual Meta client and an in-memory Graph stub: campaign ACTIVE, ad set PAUSED, ad PAUSED | Reviewed exact-child lifecycle plus durable partial-outcome reconciliation; never indiscriminately activate imported children |
| F2, high: scheduled cap enforcement uses stale/missing spend | Source rechecked: stored snapshots only, no freshness guard, missing spend becomes zero | Fresh, period-defined observations, explicit unknown state and separately verified provider limits |
| F3, high: capacity checks and activation mirror are not atomic | Source rechecked; executable arithmetic shows two INR 200/day requests each pass an empty INR 2,000/week cap, while combined commitment is INR 2,800 | Concurrent request test, serialized/reserved capacity and provider-success/local-failure recovery |
| F4: cron reads can omit rows at scale | Limits/campaigns/results reads remain unpaginated; unlike complete application reads | Multi-page/row-cap tests proving no silent omissions |
| F5: Studio can repeat paid work after a lost response | Studio POST lacks Create's generation ID and reconciliation behavior | Disconnect-after-save and reload tests preserving original generation identity |
| F6: leads/forms stop at first provider page | Provider reads ignore paging; inbox initially limited to 200 | Second-page-only new lead, bounded resumable import, honest partial status and older-row browsing |
| F7: accepted bare websites reach Meta unchanged | Actual validator accepts `example.com`; stubbed creative payload retains it; execution reads mutable business website outside the review payload | Normalize/validate the effective link before mutation and bind it to review |
| F8: instruction read errors become empty guidance | Query discards DB error; generation then proceeds without active instructions | Inject a DB read error and prove no paid generation starts |
| F9: daily activity script can claim false success | Cookie-auth routes called with bearer auth, nonexistent leads route, curl does not fail on HTTP errors | Retire or repair contract/status checks; never use synthetic traffic as approval proof |

The activation probe made zero network calls. The capacity probe is arithmetic,
not a reproduced concurrent HTTP interleaving. Meta's real rejection of a bare
link was not exercised. F2/F4-F6/F8/F9 were source-reconfirmed here, not newly
reproduced against hosted services.

Additional important boundaries: saved results are not bank accounting; monthly
AI checks do not reserve headroom; generation row deletion does not fully delete
public media; disconnect does not pause remote ads; raw provider state can change
outside AdBrain. These are acceptance risks, not newly discovered regressions.

## Test Evidence

| Check run against current source | Result |
| --- | --- |
| Unit/component suite with scrubbed environment, placeholder Supabase and paid evaluation disabled | 144 files passed, one skipped; 1,790 tests passed, one skipped |
| Coverage | Statements 81.14%, branches 74.78%, functions 80.51%, lines 83.64% |
| ESLint | Passed without fixes |
| TypeScript, incremental disabled | Passed |
| Disposable PostgreSQL fresh-plus-migrations and ordered upgrade | Passed, including test-payment claims, tenant restrictions, event conflicts, rate-limit races, token/operation permissions and stale OAuth/draft fences |
| Dependency advisories | Zero reported vulnerabilities |
| Isolated production build | Passed; 58 static-generation tasks. Current edited source, cloned installed dependencies, no environment files, placeholder public configuration |
| Application AST parse | 228 files, no syntax diagnostics |
| Focused behavioral probes | Confirmed F1, bare-domain payload for F7, and F3 capacity arithmetic |

The build was not a fresh `npm ci`, Linux/Vercel runtime test, provider test or
deployment. Database tests use synthetic auth/storage schemas, not hosted
Supabase Auth/PostgREST/Storage behavior. No new browser, paid creative, OAuth,
gateway transaction, Meta funding, delivery, lead-handoff or restore test is
claimed by this run.

### Coverage Gaps

The CI gates are only 56% statements, 52% branches, 59% functions and 56% lines,
well below current measurements. Pages/layouts are excluded. CI runs no browser
suite. Treat that as a protection gap, not a reason to inflate test counts.

Current V8 results identify these high-value follow-up surfaces:

- Campaign UI: 192 uncovered executable lines; approximately 63% branch coverage.
- Supabase query helpers: 68 uncovered lines; approximately 38% branches.
- Connection repository: 38 uncovered lines; approximately 22% branches.
- Connection dialog: 44 uncovered lines; approximately 66% branches.
- Draft route branches: approximately 22-24%.
- Connection status/recheck, legacy callback and operation-list wrappers show no
  line execution in this run. Indirect/SQL/source-contract tests do not replace
  executing their HTTP failure paths.

Existing browser specs cover Create/review, saved draft lifecycle, connection
recovery and ambiguous campaign creation. They mix fixture interception with
actual authentication/database setup. Their existence is not a safe invitation
to run them using the workspace's environment file.

## Acceptance Board

| Gate | Required evidence before calling it complete |
| --- | --- |
| Automatic Meta funding, roadmap P2/payment M0 | Account-specific supported automatic payment route; explicit owner consent; separately authorized bounded charge matched to the right account; failure/limit behavior |
| Commercial model, P3/M1 | Correct operator/merchant, approved total/tax/service scope, unused funds/refund/renewal terms, viable fee and support economics |
| Real customer onboarding, P4 | External customer's actual consent; correct customer Page and dedicated agency account; permissions, account capacity and offboarding responsibilities |
| Gateway test lifecycle | Verified isolated database, test merchant and optional migration; actual hosted capture, callback/webhook retry, refund observation and lost-response recovery |
| Financial core, M2-M4 | Durable idempotent orders/events, conserved integer-paise ledger, settlement evidence, reservations, refund/dispute holds and verified Meta charge sources |
| Bounded delivery, P1/M5 | Resolve F1-F4; exact reviewed objects/schedule; fresh spend and stop conditions; recovery from provider success/local failure; no activation from test credit |
| Enquiry outcome | Intended operator can receive and securely hand off a consented test enquiry; response responsibility established; complete imports and attribution |
| Pilot, P6/M7 | Separately approved scope/budget; reconcile customer/gateway/bank/Meta amounts; measure qualified enquiries, service effort and contribution margin |
| Release | Dependency-complete immutable candidate; local and hosted required checks; exact migration/env/rollback plan; approved promotion and affected-workflow deployment verification |

For each change, choose tests around: authorization, wrong tenant, wrong asset,
stale version/generation, duplicate/concurrent request, provider success with lost
response, local write failure, partial pagination, cancellation/reload, and
mobile/keyboard use. Financial changes additionally need rounding/overflow,
duplicate/out-of-order events, refunds/disputes, stale evidence and conservation.

## Pilot and Documentation Cautions

- The documented Solaride free-site-survey form was published, and its new
  campaign/ad set/ad were published OFF directly in Ads Manager. This is historical
  pilot evidence, not current live verification or an AdBrain create-operation receipt.
  Application import, handoff and separately approved activation remain gates.
- The right application business, Meta portfolio, ad account and Page are distinct
  identities. Do not use a name-only lookup or a demo workspace as proof of the
  intended customer's binding.
- Payment documents retain older no-account/local-only/Solaride-operator wording
  below newer updates. Supplied terminal context shows later read-only provider
  lookups; this audit did not execute or independently certify them. Neither
  authentication nor available payment methods prove capture/refund or funding.
- The release guide's latest-release heading still points at September 18 even
  though local HEAD contains September 25 PR #24. The operations refresh-error
  row contradicts the current route, which rejects failed result persistence.
- The execution board's OAuth fixture publication task is stale relative to
  commit `0159d71` already present in HEAD. Use exact commits and dated receipts.
- Follow [Releasing](../RELEASING.md) and [Testing](../TESTING.md). The workspace's
  production environment file is not QA configuration. A loopback tunnel or
  browser interception does not isolate backend calls. No live financial action,
  migration, provider mutation or deployment is implied by this QA assignment.

## Next QA Work

The subsequent [remediation plan](remediation-plan-2026-09-26.md) adds locally
reproduced database integrity findings, sequenced Development/DevOps/QA packets,
and explicit acceptance and rollout gates. Use it to route implementation work;
this baseline remains the dated context and verification record.

Keep the funding-first product decision visible while treating the delivery and
spend defects as mandatory gates before any paid pilot. The smallest useful next
QA packet is a verified isolated gateway lifecycle plus an account-specific Meta
funding evidence plan, not additional generic dashboards. Fixes and live tests
should each have their own scoped authorization and acceptance evidence.

Before future work, recheck the dirty tree, exact candidate source, environment
target and newest owner decisions. Use this baseline for orientation, not as a
permanent claim that the current code or external services remain unchanged.