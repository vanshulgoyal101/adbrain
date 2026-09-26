# AdBrain

AdBrain is a marketing workspace for local businesses: save a Brand Brain,
review AI-generated image/copy variants, approve creatives, prepare a Meta lead
campaign, and track enquiries and results. Campaigns are created **paused**;
activation is a separate, explicitly confirmed spending action.

Production: [adbrain.vanshul.com](https://adbrain.vanshul.com).
Source documentation is not a deployment or Meta-approval guarantee.

## Documentation

Start at the [documentation index](docs/README.md).

| Goal | Guide |
| --- | --- |
| Install and run safely | [Developer quick start](docs/QUICK_START.md) |
| Understand the product | [Features and workflows](docs/FEATURES.md) |
| Learn the codebase | [Architecture](docs/ARCHITECTURE.md) |
| Integrate or debug requests | [API reference](docs/API_REFERENCE.md) |
| Configure providers and limits | [Configuration](docs/CONFIGURATION.md) |
| Understand storage and upgrades | [Data model](docs/DATA_MODEL.md) |
| Validate changes | [Testing](docs/TESTING.md) |
| Diagnose production | [Operations](docs/OPERATIONS.md) and [observability](docs/OBSERVABILITY.md) |
| Release safely | [Release workflow](docs/RELEASING.md) |

## Stack

| Concern | Implementation |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript and Tailwind 4 |
| Identity and persistence | Supabase Auth, PostgreSQL and Storage |
| AI | AI SDK provider adapters, application routing/accounting and configurable image providers |
| Campaign reads | TanStack Query with tenant-scoped keys and controlled refetching |
| Advertising | Meta Marketing API behind business-bound credentials and reviewed operations |
| Payment foundations | Razorpay SDK; the current checkout implementation is test-only |
| Verification | Vitest, Playwright and a disposable PostgreSQL/RPC harness |

Exact dependency versions and commands live in [package.json](package.json).
See the [architecture guide](docs/ARCHITECTURE.md) for ownership and trust boundaries.

## Local Development

Start with the [quick start](docs/QUICK_START.md), then the
[configuration reference](docs/CONFIGURATION.md). Use isolated credentials and
confirm the database target before starting the application. An existing
`.env.local` may point to production; do not overwrite it or copy it into a test
worktree. The repository's shared development environment is not a sandbox.

The [testing guide](docs/TESTING.md) owns validation commands and safe test
environments. The [release guide](docs/RELEASING.md) owns branch, migration and
deployment procedures. Follow those guides instead of using production setup
commands as installation checks.

`localhost` does not make provider calls or database writes harmless. Image
generation can cost money. Demo accounts can be connected to real ad accounts.
Never run migrations, seeds, cleanup scripts, or ad activation as casual setup
checks. Do not commit credentials or generated private artifacts.

## Current Boundaries

- Tenant ownership and encrypted business-specific Meta connections govern
  publishing; global environment credentials are not a tenant fallback.
- Saved drafts, fresh preflight, durable operation recovery, and activation
  confirmation are distinct stages. Repeated POSTs are not a recovery strategy.
- Lead sync and report exports exist. Resumable imports and saved follow-up work
  have separate feature candidates and database prerequisites; consult the
  [roadmap](docs/ROADMAP.md) and exact release receipt before claiming deployment.
- Razorpay account activation and website approval are verified, but AdBrain's
  test checkout is not a live payment-to-ad-funding workflow. See
  [payment readiness](docs/PAYMENTS-PLAN.md#verified-razorpay-account-status).
- Automatic WhatsApp delivery, team roles, Google Ads and general autonomous
  optimisation are not established product workflows.
- Read [known limitations](docs/FEATURES.md#known-limits) before making availability,
  spend-control, or provider-readiness claims.

## Working on AdBrain

Read [AGENTS.md](AGENTS.md) and the [current dispatch](docs/ORCHESTRATION.md#current-dispatch)
before editing shared resources. Make focused changes at the owning abstraction,
reuse maintained dependencies, test meaningful risks and update the corresponding
reference guide. Documentation standards and the distinction between current
guides, plans and evidence are in the [documentation index](docs/README.md).
