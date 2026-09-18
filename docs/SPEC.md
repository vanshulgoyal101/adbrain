# Product Specification

AdBrain helps a local business turn its real brand and offer into reviewed ad
creative and controlled Meta lead campaigns. Solaride is a historical dogfood
case, not a restriction to solar businesses or proof that generated ads outperform
a baseline. Current behavior is specified in [Features](FEATURES.md), contracts in
[API Reference](API_REFERENCE.md), and internals in [Architecture](ARCHITECTURE.md).

## Product Boundaries

The primary user is the owner of a local business who needs reusable brand context,
usable creative, understandable targeting/budgets, and a way to see enquiries and
results. The local business UUID is the tenancy boundary. Teams, agency roles and
arbitrary workspace switching are not implemented merely because the database
permits multiple owned businesses.

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
| Learn | Genuine leads, stored metrics and plain-language interpretation | No fabricated results, transparent freshness and data limitations |

The reviewed campaign path supports INR instant-form lead campaigns. Do not claim
universal WhatsApp/call destinations, multi-currency launch, automated account
provisioning, or an all-in-one CRM. Image export remains useful independently of
Meta connection, but no ad format guarantees delivery or conversion.

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

No in-product billing, team roles, Google Ads integration, video generation,
autonomous winner scaling, scheduled activation, instant lead notifications,
automatic WhatsApp messaging, durable queued creative workers, or general
multi-key token rotation. These require separate product/security/operating design.
See [Roadmap](ROADMAP.md) for priorities rather than treating this list as a promise.

## Design Records

The [creative plan](CREATIVE-GENERATION-PLAN.md),
[Meta connection plan](META-INSTANT-CONNECT-PLAN.md), and
[product design plan](PRODUCT-DESIGN-ROADMAP.md) explain decisions and historical
acceptance criteria. Earlier solar-only architecture, plaintext credential shapes,
global-token fallback, guessed SDK/provider choices and approval timelines are not
current implementation instructions. Use [Data Model](DATA_MODEL.md) and
[Configuration](CONFIGURATION.md) for the actual persistence and integration model.