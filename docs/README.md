# AdBrain Documentation

AdBrain combines a business profile, reviewed AI creative generation, and
owner-scoped Meta campaign management. Campaign creation is paused by default;
activation is a separate operation with financial consequences.

This is the entry point for product, engineering and operations documentation.
References explain the checked-out source; plans describe intended work; dated
receipts establish what was tested or deployed. These are different claims.
Never infer production availability from a feature branch or a passing local test.

The documentation is being rebuilt against current source and release evidence
starting September 26, 2026. The [current dispatch](ORCHESTRATION.md#current-dispatch)
tracks section ownership and review. This index is not a blanket certification
that every linked guide has already been refreshed.

## Start Here

| Reader | Read first | Then read |
| --- | --- | --- |
| Owner or coordinating worker | [Worker orchestration](ORCHESTRATION.md) | [Roadmap](ROADMAP.md) |
| New developer | [Quick start](QUICK_START.md) | [Architecture](ARCHITECTURE.md) |
| Product or support | [Features and workflows](FEATURES.md) | [Demo runbook](DEMO-RUNBOOK.md) |
| Operator | [Deployment configuration](DEPLOY.md) | [Release policy](RELEASING.md) |
| Debugging engineer | [Observability](OBSERVABILITY.md) | [Verification records](qa/) |
| Product planner | [Product scope](SPEC.md) | [Roadmap](ROADMAP.md) and [payment plan](PAYMENTS-PLAN.md) |

## Reference Library

| Guide | Questions it answers |
| --- | --- |
| [Worker orchestration](ORCHESTRATION.md) | Who owns each packet/file/resource, what blocks it, and what evidence permits integration? |
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
| [Payment plan and readiness](PAYMENTS-PLAN.md) | What are the agreed economics, implemented payment boundaries and remaining live-rollout requirements? |
| [Operating brief](OPERATING-BRIEF.md) | Which outcome, risk decisions and evidence should guide operation of the product? |
| [Brand identity](BRAND-IDENTITY.md) | Which presentation and terminology conventions should the product follow? |

## Plans and Records

Keep current instructions in the reference library above. Use the following
documents for intent, context or evidence, not as alternative setup guides.

| Material | Purpose |
| --- | --- |
| [Product scope](SPEC.md) and [roadmap](ROADMAP.md) | Intended customer outcomes, priorities and explicitly unfinished work |
| [Creative generation plan](CREATIVE-GENERATION-PLAN.md), [Meta connection plan](META-INSTANT-CONNECT-PLAN.md), [product design roadmap](PRODUCT-DESIGN-ROADMAP.md) | Design rationale and proposals; implementation claims require current source |
| [Original operating assessment](OPERATING-BRIEF-HISTORY-2026-09-26.md) and [product audit](PRODUCT-AUDIT-2026-09.md) | Dated assessments; findings may be superseded by later fixes |
| [Earlier roadmap and pilot](ROADMAP-HISTORY-2026-09-26.md) and [payment design/receipts](PAYMENTS-HISTORY-2026-09-26.md) | Preserved decisions, investigations and transaction evidence; use current guides for readiness and sequencing |
| [QA receipts](qa/) and [release records](releases/) | Candidate-specific acceptance, provider checks and deployment evidence |
| [Project history](how-we-got-here.md) and [orchestration history](ORCHESTRATION-HISTORY-2026-09-26.md) | Historical context, not current work assignments or operational authority |

Preserve evidence at its existing path when other records link to it. Consolidate
duplicate guidance into its owning reference; retain a short redirect when a
published document moves. Historical receipts should not be rewritten to appear
current.

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

Use one canonical guide per subject. Link to shared definitions instead of
copying setup commands, environment tables or release rules across documents.

1. Identify the reader and the task. Start with the supported workflow, then
  explain prerequisites, limits, failure recovery and relevant source locations.
2. Verify claims against deciding code: handler validation, authorization,
  provider adapters, database constraints and focused tests. Types or comments
  alone are not proof of runtime behavior.
3. Mark branch-only, migration-dependent, test-only and planned capabilities
  explicitly. Date external account evidence and link deployment receipts.
4. Use synthetic examples. Identify commands that write data, contact providers,
  spend money or require approval before presenting them as executable steps.
5. Update the owning guide in the same change as a public route, schema,
  configuration, dependency boundary or customer workflow change.
6. Check relative links and anchors, command names, API/configuration inventories
  and migration prerequisites. Review factual changes independently; a prose-only
  change does not need a duplicate application build or provider test.

Write concise, task-oriented prose with descriptive headings and examples that
match current schemas. Explain important trade-offs and limitations without
copying implementation line by line. A known implementation gap belongs in both
the relevant workflow's limitations and the roadmap, not behind a success claim.