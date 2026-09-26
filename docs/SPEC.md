# Product Specification

AdBrain helps local businesses turn their offers into reviewed advertising and
useful enquiries. The product combines reusable brand context, creative review,
controlled Meta campaign operations and follow-up. The intended managed service
adds one customer payment and accountable advertising expenditure.

This document defines product intent and acceptance principles, not deployment
status. Use [Features](FEATURES.md) for implemented workflows,
[API Reference](API_REFERENCE.md) for contracts and [Roadmap](ROADMAP.md) for
current work and remaining launch requirements.

## Product Boundaries

The primary user is a local business owner, not an advertising specialist.
They need truthful brand context, usable creative, understandable targeting and
budgets, and a practical way to follow up with interested customers. Solaride is
an internal pilot, not an industry restriction or proof of commercial results.

The local business UUID is the tenancy boundary. A Meta portfolio, ad account
and Page are distinct external assets. Multiple database records do not imply
team roles, agency permissions or unrestricted workspace switching.

AdBrain controls the preparation/review workflow; Meta controls ad review,
delivery and billing. AI proposes copy and imagery; owners remain responsible
for truth, rights, regulated claims, consent and commercial decisions.

## Core Requirements

| Stage | User outcome | Required boundary |
| --- | --- | --- |
| Brand | Reusable facts, offers, instructions and media | Owner scope, validated fields, explicit save and public-media disclosure |
| Create | A reviewed brief and distinguishable image/copy variants | Bounded questions, schema checks, paid-action consent, honest partial failure |
| Review | Inspect, approve, regenerate or export work | Regeneration returns to draft; approval is not spending authorization |
| Prepare | Durable manual/guided campaign intent | Versioned edits, explicit geography, approved creative and real lead form |
| Connect | Select the intended account/Page | User consent, complete discovery, encrypted business-bound credentials |
| Publish paused | Recoverable external object creation | Current preflight hash, generation fence, stable operation identity |
| Activate | Understand and authorize delivery | Separate confirmation, verified capability/billing/binding/spend checks |
| Follow up | Find genuine enquiries and retain the owner's next action | Complete or explicitly partial import, stable paging, tenant scope and preservation of owner-managed fields |
| Learn | Understand spend, delivery and qualified outcomes | No fabricated results, transparent freshness, attribution and data limitations |

The table states required behavior. A documented requirement is not proof that
all controls are already implemented or independently accepted. In particular,
delivery/spend recovery, durable paid-generation admission and the managed
payment lifecycle retain open work on the [roadmap](ROADMAP.md).

The reviewed campaign path supports INR instant-form lead campaigns. Do not claim
universal WhatsApp/call destinations, multi-currency launch, automated account
provisioning, or an all-in-one CRM. Image export remains useful independently of
Meta connection, but no ad format guarantees delivery or conversion.

## Managed Service

The owner-selected target is one INR 10,000 annual customer payment: INR 2,000
service allocation and INR 8,000 covering Meta media plus applicable Meta taxes.
Gateway fees are absorbed by AdBrain. This is neither an automatic-renewal mandate
nor a promise of year-round ad delivery or INR 2,000 profit.

[Payments](PAYMENTS-PLAN.md) is the canonical record for operator identity,
allocation rules, provider readiness, tax/refund decisions and rollout gates.
The current operator is Vanshul Goyal's unregistered business; a future Solaride
arrangement requires formalization. One customer payment and automatic Meta
funding remain explicit requirements. Replacing them with manual top-ups or
customer-direct Meta billing requires an owner decision.

Razorpay merchant activation and website approval do not turn test captures into
spendable balances. Live orders, reconciliation, refunds and funding authorization
must be implemented and verified before offering the complete paid workflow.

## Acceptance Principles

- Demonstrate a complete customer task with realistic populated and empty states,
  keyboard interaction, mobile layouts, and actionable failure recovery.
- Separate a local implementation from tested behavior, deployed behavior and
  independently verified provider access.
- Never turn a partial result, uncertain remote mutation or unavailable quota
  check into a success claim.
- Keep identity, authorization, creative approval and financial consent separate.
- Measure quality, latency, cost and conversion with attributable evidence;
  avoid fixed performance promises based on model choice or a single demo.
- Preserve existing work and remote recovery evidence across navigation and retries.

## Explicit Non-Goals Today

Team/agency administration, Google Ads, video generation, autonomous winner
scaling, scheduled activation and automated WhatsApp outreach are not part of the
current delivery scope. Do not add a CRM, general-purpose wallet, queue platform
or billing framework merely to make the architecture look complete.

Live payments and practical enquiry follow-up are desired customer workflows,
not non-goals. Their unfinished work must remain visible rather than being
described as either already shipped or intentionally excluded.

## Product Quality

Keep common tasks short and predictable. Review surfaces must expose the actual
creative, destination, targeting and financial consequences. Preserve drafts and
recovery identities on failure; distinguish retryable reads from uncertain paid
mutations. Empty, partial, stale and unavailable states need different messages.

Match the [brand and interface conventions](BRAND-IDENTITY.md). Validate keyboard
use and compact/mobile layouts for changed workflows. Never trade tenant safety,
consent, privacy or monetary integrity for convenience. Prefer established
libraries for commodity behavior and keep custom logic focused on these business
rules; architectural detail belongs in [Architecture](ARCHITECTURE.md).

## Design Records

The [creative plan](CREATIVE-GENERATION-PLAN.md),
[Meta connection plan](META-INSTANT-CONNECT-PLAN.md), and
[product design plan](PRODUCT-DESIGN-ROADMAP.md) explain decisions and historical
acceptance criteria. Earlier solar-only architecture, plaintext credential shapes,
global-token fallback, guessed SDK/provider choices and approval timelines are not
current implementation instructions. Use [Data Model](DATA_MODEL.md) and
[Configuration](CONFIGURATION.md) for the actual persistence and integration model.