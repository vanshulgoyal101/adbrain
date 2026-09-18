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

Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Supabase Auth/Postgres/
Storage, rotating text-model providers, configurable image providers, and Meta
Marketing API. Vitest covers unit/component contracts; Playwright covers browser
flows; a disposable PostgreSQL harness covers database/RPC invariants.

## Local Development

Use an isolated Supabase project. Follow the quick start before configuring
credentials or applying a schema.

```sh
npm ci
cp .env.example .env.local
# Configure the isolated project, then:
npm run dev
```

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`localhost` does not make provider calls or database writes harmless. Image
generation can cost money. Demo accounts can be connected to real ad accounts.
Never run migrations, seeds, cleanup scripts, or ad activation as casual setup
checks. Do not commit credentials or generated private artifacts.

## Current Boundaries

- Tenant ownership and encrypted business-specific Meta connections govern
  publishing; global environment credentials are not a tenant fallback.
- Saved drafts, fresh preflight, durable operation recovery, and activation
  confirmation are distinct stages. Repeated POSTs are not a recovery strategy.
- Lead sync and report exports exist; automatic WhatsApp delivery, billing,
  team roles, Google Ads, and general automated optimisation are not implemented
  product workflows.
- Read [known limitations](docs/FEATURES.md#known-limits) before making availability,
  spend-control, or provider-readiness claims.
