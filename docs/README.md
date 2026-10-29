# AdBrain Documentation

AdBrain combines a business profile, reviewed AI creative generation, and
owner-scoped Meta campaign management. Campaign creation is paused by default;
activation is a separate operation with financial consequences.

This is the entry point for product, engineering and operations documentation.
Every guide here describes current truth. Dated receipts, audits and handoffs are
not kept as files: evidence goes in the issue or PR, and git history keeps
everything that was removed (#260). Never infer production availability from a
feature branch or a passing local test.

## Start Here

| Reader | Read first | Then read |
| --- | --- | --- |
| Pilot, sales or new team role | [How AdBrain works](product/how-adbrain-works.md) | [Features and workflows](product/README.md) |
| Owner or coordinating worker | [Worker orchestration](ORCHESTRATION.md) | [Roadmap](roadmap.md) |
| New developer | [Quick start](QUICK_START.md) | [Architecture](ARCHITECTURE.md) |
| Product or support | [Features and workflows](product/README.md) | [Roadmap](roadmap.md) |
| Operator | [Deployment configuration](operations/deploy.md) | [Release policy](RELEASING.md) |
| Debugging engineer | [Observability](OBSERVABILITY.md) | [Operations](operations/README.md) |
| Product planner | [Roadmap](roadmap.md) | [Payment plan](PAYMENTS-PLAN.md) |

## Reference Library

| Guide | Questions it answers |
| --- | --- |
| [Worker orchestration](ORCHESTRATION.md) | Who owns each packet/file/resource, what blocks it, and what evidence permits integration? |
| [Features and workflows](product/README.md) | What can owners do, and where are the limits? |
| [API reference](api/README.md) | Which routes/actions exist, which parameters are accepted, and what do failures mean? |
| [Configuration](CONFIGURATION.md) | Which variables are required, what are their defaults, and which changes cost money or require a restart? |
| [Architecture](ARCHITECTURE.md) | Where is behavior owned, and how do requests cross trust boundaries? |
| [Architecture decisions](architecture/README.md) | Which cross-cutting decisions (ADRs) bind the code, and how do we record a new one? |
| [Data model](DATA_MODEL.md) | Which tables, relationships, grants, RPCs, buckets and migrations support the app? |
| [AI pipeline](AI_PIPELINE.md) | How do interviews, concepts, images, composition, retries, cache and accounting work? |
| [Meta connection](META_CONNECT.md) | How do consent, selection, capabilities, paused creation and activation work, and what does Meta's App Review need? |
| [Testing](TESTING.md) | Which commands are safe locally and what does each verification layer prove? |
| [Operations](operations/README.md) | How do we diagnose partial work, stale spend, provider failures and retention problems? |
| [Observability](OBSERVABILITY.md) | What is logged, how is it correlated, and what must never be collected? |
| [Deployment](operations/deploy.md) | How is a target environment configured and smoke-tested? |
| [Release policy](RELEASING.md) | What approvals and checks govern remote changes? |
| [Meta approval readiness](META_APPROVAL_ACTION_PLAN.md) | What external review evidence must be prepared and verified? |
| [Payment plan and readiness](PAYMENTS-PLAN.md) | What are the agreed economics, implemented payment boundaries and remaining live-rollout requirements? |
| [Brand identity](BRAND-IDENTITY.md) | Which presentation and terminology conventions should the product follow? |

## Plans and Records

[Roadmap](roadmap.md) and the [payment plan](PAYMENTS-PLAN.md) hold intent and
decisions; the [worker dispatch](ORCHESTRATION.md) holds current assignments.
Consolidate guidance into its owning reference instead of adding dated documents.

## Moved (#1851)

The flat guides are moving into `product/`, `architecture/`, `api/`,
`operations/` and `team/`, verbatim. This table goes away two weeks after the
last move.

| Old file | Now |
| --- | --- |
| `API_REFERENCE.md` | [api/](api/README.md): one page per route group |
| `FEATURES.md` | [product/](product/README.md): one page per product area |
| `OPERATIONS.md` | [operations/](operations/README.md) and [operations/runbooks/](operations/runbooks/README.md) |
| `DEPLOY.md` | [operations/deploy.md](operations/deploy.md) |
| `ROADMAP.md` | [roadmap.md](roadmap.md) (lower case, like the folders) |

## Terminology

| Term | Meaning |
| --- | --- |
| Business / Brand Brain | Local owner-scoped workspace and saved brand context, not a Meta business portfolio |
| Creative | Local image/copy record, draft or approved; not necessarily a published Meta ad |
| Generation UUID | Groups recoverable results; the #54 source candidate adds a durable paid-request claim after its migration is applied, not yet a production claim |
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
- [Brand identity](BRAND-IDENTITY.md) covers product presentation.

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