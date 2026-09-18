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