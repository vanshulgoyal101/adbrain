# AdBrain Documentation

AdBrain combines a business profile, reviewed AI creative generation, and
owner-scoped Meta campaign management. Campaign creation is paused by default;
activation is a separate operation with financial consequences.

This documentation describes the checked-out source as of 2026-09-18. Local
implementation, automated tests, production deployment, and real-provider
approval are separate kinds of evidence. Consult release receipts for deployment
status, not an undated feature claim.

## Start Here

| Reader | Read first | Then read |
| --- | --- | --- |
| New developer | [Quick start](QUICK_START.md) | [Architecture](ARCHITECTURE.md) |
| Product or support | [Features and workflows](FEATURES.md) | [Demo runbook](DEMO-RUNBOOK.md) |
| Operator | [Deployment configuration](DEPLOY.md) | [Release policy](RELEASING.md) |
| Debugging engineer | [Observability](OBSERVABILITY.md) | [Verification records](qa/) |
| Product planner | [Product vision](SPEC.md) | [Roadmap](ROADMAP.md) |

## Reference Library

| Guide | Questions it answers |
| --- | --- |
| [Features and workflows](FEATURES.md) | What can owners do, and where are the limits? |
| [API reference](API_REFERENCE.md) | Which routes/actions exist, which parameters are accepted, and what do failures mean? |
| [Configuration](CONFIGURATION.md) | Which variables are required, what are their defaults, and which changes cost money or require a restart? |
| [Architecture](ARCHITECTURE.md) | Where is behavior owned, and how do requests cross trust boundaries? |
| [Data model](DATA_MODEL.md) | Which tables, relationships, grants, RPCs, buckets and migrations support the app? |
| [AI pipeline](AI_PIPELINE.md) | How do interviews, concepts, images, composition, retries, cache and accounting work? |
| [Meta connection](META_CONNECT.md) | How do consent, selection, capabilities, paused creation and activation work? |
| [Testing](TESTING.md) | Which commands are safe locally and what does each verification layer prove? |
| [Operations](OPERATIONS.md) | How do we diagnose partial work, stale spend, provider failures and retention problems? |
| [Observability](OBSERVABILITY.md) | What is logged, how is it correlated, and what must never be collected? |
| [Deployment](DEPLOY.md) | How is a target environment configured and smoke-tested? |
| [Release policy](RELEASING.md) | What approvals and checks govern remote changes? |
| [Demo runbook](DEMO-RUNBOOK.md) | How do we demonstrate real value without unintended spending or false claims? |
| [Meta approval readiness](META_APPROVAL_ACTION_PLAN.md) | What external review evidence must be prepared and verified? |

## Terminology

| Term | Meaning |
| --- | --- |
| Business / Brand Brain | Local owner-scoped workspace and saved brand context, not a Meta business portfolio |
| Creative | Local image/copy record, draft or approved; not necessarily a published Meta ad |
| Generation UUID | Groups recoverable creative results; not durable paid-request idempotency |
| Campaign draft | Versioned local launch intent with expiry, no remote creation on save |
| Preflight / plan hash | Review of exact launch inputs; hash becomes stale when material inputs change |
| Connection generation | Fence against publishing through an obsolete account/Page/credential selection |
| Attempt revision | Concurrency version for one short-lived Meta connection attempt |
| Operation / idempotency key | Durable external campaign-creation identity and recovery evidence |
| Activation digest | Confirmation of the reviewed activation state, distinct from draft preflight |
| Snapshot | Stored observation of provider metrics, not an incremental accounting transaction |

## Authority and Scope

- Runtime schemas, route handlers, database constraints, and tests define the
  current contract. Documentation explains them; it does not override them.
- [Release policy](RELEASING.md) governs publication and production changes.
- [QA records](qa/) and [release receipts](releases/) are dated evidence, not
  general-purpose installation instructions.
- [Creative generation plan](CREATIVE-GENERATION-PLAN.md),
  [Meta connection plan](META-INSTANT-CONNECT-PLAN.md), and
  [product design roadmap](PRODUCT-DESIGN-ROADMAP.md) preserve design intent and
  implementation history. Their proposals must not be confused with shipped
  behavior.
- [Brand identity](BRAND-IDENTITY.md) covers product presentation;
  [project history](how-we-got-here.md) explains earlier decisions.

## Safety Before Setup

A localhost server can use production Supabase, paid model keys, and a real Meta
account. A demo label does not make writes harmless. Use isolated credentials for
development. Do not invoke paid generation, campaign activation, cleanup scripts,
or database migrations merely to verify installation.

Never place access tokens, passwords, cookies, personal lead data, or raw provider
responses in documentation or screenshots. Use synthetic examples.

## Maintaining These Docs

Update the owning reference alongside any changed schema, route, environment
field, workflow or migration. Keep runtime behavior here and dated test/deployment
evidence in records. Preserve old receipts, but label superseded assumptions in
design plans so they cannot be mistaken for current setup instructions.

Validate examples against actual handler schemas, not unused exported types or
comments. Check local links/anchors, API and configuration inventories, command
coverage and migration coverage. Do not state live deployment, provider approval,
or measured quality solely from source inspection. Documentation cannot cure a
known implementation gap: describe the limitation and put the fix on the roadmap.