# Demo Runbook

Demonstrate the owner journey without silently buying provider work, touching
customer contacts or changing remote delivery. The default is a saved-artifact
walkthrough, not a live provider test. A business called "demo" can still share a
real Meta account and incur costs.

This runbook is grounded in dev `672eb132ad57bb3ba31f118afaffddaa878b4923`.
[Features: availability](FEATURES.md#source-and-availability) identifies the
recorded production release and the separate #34/#35 enquiry candidates. Do not
present branch-only behavior as deployed, or source/test evidence as live consent,
delivery or settlement evidence.

## Prepare

Choose the mode and record it before opening the app:

| Mode | Prerequisites | Allowed demonstration |
| --- | --- | --- |
| Saved artifacts (default) | Synthetic/consented screenshots and exports, with source/fixture labels | Explain the sequence without app mutations or provider requests |
| Isolated local workflow | Known source SHA, disposable database, compatible migrations, synthetic owner/business and explicit local-write scope | Save/review local records and show recovery; provider actions remain disabled unless separately approved |
| Authorized provider check | Named target account/Page, operation, request count, cost ceiling and approval | Only that operation; activation, migration, payment and cleanup are not implied |

Follow [Quick Start](QUICK_START.md) for isolated setup and [Data Model](DATA_MODEL.md#migration-map)
for prerequisites. The shared workspace's environment can target production
Supabase: **do not copy or load it into a demo/test worktree**. Confirm identifiers
without printing credentials. A development-login cookie is not real API ownership.

Prepare one synthetic brand with name, industry, service locations, languages,
current offer and usable reference images, plus three saved creative examples.
Use only supported claims; do not invent discounts, testimonials or savings.
Have a prepared brief, campaign review, empty-state example and export ready for
an outage. Avoid personal contact data, tokens, callback proof and raw provider
responses in screens or recordings.

Campaign creation requires INR compatibility. Multi-industry creative support
does not imply multi-currency launch support. For #34/#35 screens, name the exact
candidate and migration state; combined acceptance is still separate.

## Customer Sequence

In artifact mode, show each prepared state rather than clicking a live action.

1. Show Brand Brain facts and references. Use a synthetic goal such as "Invite
   Jaipur homeowners to ask about our saved rooftop survey offer."
2. Show the interview and editable brief. The interview can call paid text AI;
   reviewing a prepared brief does not require rerunning it.
3. Compare saved variants for image fidelity, headline, primary copy, link
   description, CTA and factual accuracy. Generate only within the approved scope.
4. Show creative approval and inspect an export. Approval is local status, not
   Meta approval or permission to spend. ZIP success can omit unavailable images.
5. Show a saved manual/guided draft, version and recovery state. Explain that an
   incomplete draft can be saved but cannot pass publication review.
6. Inspect account/Page, destination, geography, ages/interests and total daily
   budget. Instant forms need an active form; WhatsApp needs verified Page linkage.
   Two INR 200/day ad sets total INR 400/day, not a split INR 200 budget.
7. Show review blockers or a valid review. If paused creation is authorized,
   retain its key and inspect the durable operation result before claiming success.
   Do not activate as a convenience step after creation.
8. Show stored results and enquiries. Label WhatsApp conversations separately
   from leads/sales. Show a genuine empty state or a clearly synthetic fixture.
   Candidate follow-up/pagination must be labeled #35, not production behavior.

For an authorized candidate inbox demo, show next-page loading, a filtered total,
a failed save retaining its note, explicit retry and reload persistence. Show a
partial sync with continuation, not an invented "up-to-date" result. Use synthetic
contacts; no outreach is required. [API recovery identities](API_REFERENCE.md#recovery-identities)
explain why generation, draft, connection, operation and activation values differ.

## Provider and Cost Plan

| Action | Side effect to approve |
| --- | --- |
| Website autofill, interview, AI planning | Website/provider reads and potentially paid text AI; planning may save a draft |
| Generate/regenerate | Paid text/image work, Storage and database writes; cancellation does not guarantee no charge |
| Consent/preflight/recheck | External authorization or capability checks; not permission to create or activate |
| Create paused | Real Meta objects and durable local operation evidence, even with no delivery |
| Activate | Delivery and spending; separate current confirmation required |
| Refresh / scheduled enforcement | Refresh can call an LLM and auto-pause; enforcement can mutate delivery |
| Sync | Provider reads and local imports; not a purely visual action |
| Test checkout | Explicit isolated test-only configuration; no live collection, ad credit or settlement |
| Delete/disconnect/cleanup | Local or remote state changes; disconnect does not stop remote delivery |

Provider defaults and fallback controls belong in [Configuration](CONFIGURATION.md)
and [AI Pipeline](AI_PIPELINE.md). Agree an exact small request count and budget,
use provider-side caps where available, and inspect actual usage. API generation
accepts 1-6 variants; retries/repair/fallback can add cost. Usage estimates and
non-atomic token quotas are not invoices or hard image-dollar spending caps.

Never run migration, cron, traffic-generation or seeding commands against an
unverified target as demo preparation. A failed remote mutation does not authorize
cleanup. [Operations](OPERATIONS.md) owns reconciliation and [Release Workflow](RELEASING.md)
owns environment changes.

## Failure Paths

| Failure | Demo response |
| --- | --- |
| Interview unavailable | Show a prepared brief and existing reviewed creative; do not claim live generation succeeded |
| Partial generation | Keep successful variants; explain the failed portion and use saved examples |
| Uncertain generation | GET saved rows by generation UUID; `processing` does not prove a worker is running; do not automatically repeat the paid POST |
| Draft conflict or expiry | Reload the confirmed draft or save a new reviewed intent; do not pretend unsaved edits survived |
| Meta consent unavailable | Show saved draft/review and explain the external permission gate |
| Create response lost | Look up the existing operation/key; `needs_reconciliation` stops automatic writes |
| Activation or local mirror save fails | Check remote/local evidence; HTTP failure is not proof Meta did nothing |
| Candidate follow-up save fails | Retain the edited note and confirmed state, then retry explicitly |
| Partial enquiry import | Show partial status and available continuation; do not replace the list with a partial response |
| No leads/results | Show the genuine empty state or clearly labeled synthetic fixture |
| Network/provider outage | Use saved artifacts and reschedule live verification |

## Demo Acceptance Checklist

- [ ] Mode, source SHA, migration state, owner and consent are recorded.
- [ ] Shared production environment was not copied; no credentials/contact data are exposed.
- [ ] Brand Brain and product images are accurate and usable.
- [ ] Saved fallback artifacts load without a provider generation request.
- [ ] Brief review, creative comparison, local approval and export are distinguished.
- [ ] Exact audience, account/Page, form and total budget are visible before creation.
- [ ] Any authorized created campaign is confirmed paused, with operation evidence.
- [ ] No activation occurs without a separate explicit spending decision.
- [ ] Lead/result data is genuine or visibly synthetic; no unsupported performance claim.
- [ ] Branch candidates, local tests, live provider evidence and production behavior are labeled separately.
- [ ] Objections, requested integrations and next customer action are recorded safely.

## Commercial Readiness

Merchant account approval does not implement live AdBrain checkout. Dev's
Razorpay UI/routes are local test-only and always deny spendable credit/activation;
do not demonstrate live collection by toggling a test flag. [Payment Plan](PAYMENTS-PLAN.md)
owns commercial and implementation readiness.

There is no universal customer Meta consent, automatic WhatsApp outreach or
guaranteed conversion improvement. Spend checks do not imply scheduled lead or
insight synchronization. Use [Scope](SPEC.md) and [Roadmap](ROADMAP.md) for product
commitments. End with the actual outcome, failed/unverified steps and next owner,
not a claim that a polished walkthrough proves production readiness.
