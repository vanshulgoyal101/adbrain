# Testing and Verification

Tests prove only the conditions they exercise. Keep local unit evidence, database
transaction tests, browser fixtures, hosted CI, live provider checks, and production
deployment receipts separate. Current run counts belong in dated [QA records](qa/),
not setup promises. Start with [Quick Start](QUICK_START.md).

This guide describes checked-out source at `672eb13`, not a production rollout.
Enquiry candidate commands are marked separately below. For release identity and
provider evidence, use the dated [DevOps receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release),
not an aggregate test count.

## Isolation First

The existing `.env.local` can point at production. Plain localhost, a demo login,
or a blocked browser request does not isolate server-side Supabase/Meta/AI calls.
Use disposable local services or a separately authorized test environment. Never
load production secrets into a test merely to make it pass.

Unit tests use mocked dependencies and synthetic fixtures.
[tests/setup.ts](../tests/setup.ts) registers DOM matchers; it does **not** block
network access or replace production configuration. Check each script before
executing it: package scripts have very
different side effects. Do not invoke database seeding, image generation, or a
spend-enforcement route as a generic smoke test.

## Command Reference

Run from the application root. Environment diagnostics and scripts may require
tools beyond Node; inspect their prerequisites before executing.

| Package script | Purpose and side effects |
| --- | --- |
| `dev` | Memory-limited Next development server; uses configured services |
| `build` | Production build; writes `.next`, uses build-time public configuration |
| `start` | Serves an existing production build; real routes remain live |
| `lint` | ESLint, no automatic fixes by default |
| `typecheck` | TypeScript no-emit check; Next generated types may need a build first |
| `docs:check` | Read-only local Markdown, links, JSON examples, command names and source inventories; no application imports or external requests |
| `audit:dependencies` | npm registry advisory check, fails at high severity; requires network |
| `test` | One Vitest run in Node, components opt into jsdom |
| `test:watch` | Persistent Vitest watcher; stop it when finished |
| `test:coverage` | V8 coverage, two thread workers, threshold gate and artifacts |
| `test:meta-db` | Temporary local PostgreSQL cluster with synthetic auth/storage schemas |
| `test:workspace-browser` | Playwright suite; explicitly loads `.env.local` if present, can access real accounts |
| `test:workspace-ux` | Workspace audit script; also loads `.env.local`, not an automatically isolated test |
| `test:scroll-layout` | Offline React/CSS fixtures in Chromium and WebKit; no server, credentials or external requests |
| `env:doctor` | Shell diagnostics for configuration/tooling; not proof of provider authorization |
| `env:doctor:strict` | Strict diagnostic variant |
| `db:push` | Applies schema to configured database; requires explicit target verification/authorization |
| `db:migrate` | Migration runner; inspect its target and preview/apply flags before use; not an automatic test |
| `worker:campaigns` | Executes queued campaign work against configured services; can mutate Meta and the database |
| `seed:demo-clinic` | Writes demo data; use only on the approved target |
| `generate:icons` | Regenerates local icon assets |
| `eval:creative` | Sends fixture copy to Google judge model; consumes provider quota/cost |

### Focused Local Loop

Use Node 24 and installed dependencies. From an environment-file-free worktree,
run a selected mocked test with inherited service credentials removed:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp CI=1 RUN_PAID_CREATIVE_EVAL=0 \
	NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
	NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
	npm test -- tests/spend.test.ts --maxWorkers=1
```

Keep the same synthetic environment for affected lint/type checks. Scrubbing
variables is not an OS network sandbox: test doubles or the optional
[unit network guard](../scripts/qa-unit-network-guard.mjs) must prevent unintended
transport. Do not attach the blanket guard to browser/database tests that need
their explicitly isolated services, or hide failures by changing assertions.

Choose an existing test file for the behavior being changed. For a shared contract,
run both its pure schema tests and affected route/component tests. Mock failure
paths as well as success: returned Supabase errors are not always thrown `Error`
instances, and HTTP 200 can represent partial work.

### CI Gates

[CI](../.github/workflows/ci.yml) runs on push/PR to `dev`/`main` with placeholder
Supabase configuration and Node 24:

```sh
npm ci
npm run audit:dependencies
npm run lint
npm run typecheck
npm run test:coverage
META_TEST_PG_BIN="$(pg_config --bindir)" npm run test:meta-db
npm run build
```

Gitleaks is a separate required job. Do not disable checks to make a release green.
Coverage thresholds in [vitest.config.mts](../vitest.config.mts) are statements 56%,
branches 52%, functions 59%, lines 56%. They are minimum regression gates, not a
claim that all customer journeys are covered. Page/layout files are excluded
from the coverage denominator; build and browser checks address other risks.

Concurrent builds share `.next` and coverage runs share output. Coordinate writers
or validate an isolated snapshot without environment files; do not delete another
session's artifacts or interpret mixed outputs as evidence for your exact change.

During editing, use the smallest check for the changed behavior. Reuse matching
source/dependency/runtime evidence; do not repeat a full suite for prose or a
second handoff. Required CI still runs on the assembled candidate. Coverage is
not an acceptance verdict for tenant isolation, money movement or paid delivery.

## Database Verification

[The harness](../scripts/check-meta-connect-db.mjs) defaults to Homebrew
PostgreSQL 17 binaries at `/opt/homebrew/opt/postgresql@17/bin`; override
`META_TEST_PG_BIN` for another installation. It creates a temporary Unix-socket
cluster, synthetic roles/auth/storage, and fresh/upgrade databases, then cleans
up. It does not require production Supabase credentials.

On macOS, a scrubbed environment may need `LC_ALL=C LANG=C` for PostgreSQL
startup. A harness setup failure is not a failed application assertion. The
harness creates and removes only its own temporary databases; never substitute
a production database URL or run schema-push commands to repair its setup.

Coverage includes grants/RLS, tenant isolation, token/attempt transitions,
idempotent claim/lease behavior, draft fences, concurrent rate limiting, usage
aggregate integrity, and product-event retention. It is not a hosted Supabase
Auth, PostgREST schema-cache, Storage delivery, or real Meta consent test.

For an integrated local environment, inspect
[scripts/local-meta-qa.mjs](../scripts/local-meta-qa.mjs) and the existing `adbrain-qa`
Colima profile documented in [Releasing](RELEASING.md). The launcher asserts
loopback Supabase targets. Do not replace its isolated settings with production
secrets to bypass setup problems.

## Browser Verification

For isolated scrollbar and conversation layout regressions:

```sh
npx playwright install chromium webkit
npm run test:scroll-layout
```

[The layout check](../scripts/check-scroll-layout.mjs) bundles the real shared
Textarea and Create assistant with application CSS. It checks 1440/390/320px
viewports, overflow thresholds, persistent painted scrollbar tracks/thumbs,
keyboard scrolling, vertical resizing, and reader position during delayed
responses. Network requests are fulfilled with fixtures or blocked; server
actions throw. Screenshots go to ignored `test-results/scroll-layout/`.
This does not replace authenticated workflow tests or real-device Safari testing.

### Enquiry Candidate Checks

The following additions belong to [PR #38](https://github.com/vanshulgoyal101/adbrain/pull/38)
at `67320272380429b003b2131bf3b2b22641b0dd67`, not this guide's dev baseline
`672eb132ad57bb3ba31f118afaffddaa878b4923`. Run them only from that candidate
or an integration that includes its scripts, tests and migrations.

For the saved-enquiry workflow, using installed Google Chrome and fully synthetic
transport (no application server, credentials or provider calls):

```sh
node scripts/check-workspace-ux.mjs --offline-leads
LC_ALL=C LANG=C node scripts/check-meta-connect-db.mjs --leads-only
npm test -- tests/leads.test.ts tests/lead-inbox.test.tsx
```

The browser check uses the real inbox/CSS at 1440/390/320px: paging, failed save
and retry, reload persistence, filters, partial sync/resume and error recovery.
Screenshots/receipt go to ignored `test-results/lead-inbox/`. The database check
creates and removes its own Unix-socket PostgreSQL cluster for fresh/upgrade
schemas, 225-row cursor ordering, defaults, re-import preservation and tenant
denials. This is not combined #34 acceptance, a production migration or live
Meta evidence. Preserve this distinction when the two enquiry candidates integrate.

[Playwright configuration](../playwright.config.ts) uses one worker, base URL
`http://localhost:3939`, and an existing production build via `npm run start`.
It reuses an existing server; verify that server's credentials and build before
running. Screenshot/video/trace are disabled by default in this suite. Review
individual [e2e tests](../e2e/) for fixtures and live dependencies.

For manual browser checks, reuse a healthy isolated server or start a temporary
one with `npm run dev -- --port <free-port>`. Stop servers you started after the
check. Wait for hydration and actual ready state before interacting; do not mask
failures with arbitrary delays.

Check populated/empty/loading/error states, keyboard focus and labels, narrow
mobile and desktop layouts, long copy, partial generation, stale revisions,
network failure and retry, approval reset on regeneration, and activation consent.
Block provider mutations at the server/mock boundary as well as in browser routes.
Mock login success does not prove Supabase email or Google OAuth delivery.

## Paid and External Evaluation

`eval:creative` reads [fixtures.jsonl](../evals/creative/fixtures.jsonl), uses the
first Google key, calls the configured judge model (script default differs from
runtime), and compares normalized mean absolute error to 0.15. It judges labeled
copy, not generated-image fidelity or campaign conversion. It bypasses application
quota/rate-limit routes and does not have an application consent/budget guard.

Before any live evaluation agree on provider, exact cases, request count, spending
cap, data consent, and stop conditions. Record actual provider cost and artifacts
without credentials. Do not repeatedly run a failing paid job until it passes.
User participation is required for real Meta consent; connect verification is not
authorization to create campaigns, activate spend, or delete assets.

Razorpay test-mode evidence is a separate layer: mocked responses, provider test
captures, production merchant activation and live collection are distinct facts.
The local test gate rejects production/Vercel and remote Supabase targets. Use
the [payment implementation receipt](PAYMENTS-PLAN.md#9-implementation-receipt)
for approved setup and remaining live-workflow limits; do not enable a test flag
to implement production payments.

## Documentation Checks

```sh
npm run docs:check
npm run docs:check -- docs/TESTING.md docs/BRAND-IDENTITY.md
npm run docs:check -- --all --json
node --test scripts/check-docs.test.mjs
```

[The checker](../scripts/check-docs.mjs) uses Markdown parsing rather than a
link-shaped regular expression. It handles reference links, parentheses in Next
route paths, images, HTML anchors, duplicate heading slugs and source line links.
Current-guide broken links, unclosed fences, malformed JSON examples, missing node scripts and
unknown `npm run` names fail the command. Historical records are inventoried but
are checked only with `--all`; their diagnostics and unavailable private evidence
are warnings, not rewritten or silently counted as current acceptance.

The JSON report lists exported API methods, statically found environment keys
(including conventional `env`/`environment` aliases and declarations in `.env.example`),
migration filenames and lexical SQL table declarations. Missing mentions in the
owning guides are review leads, not automatic failures or full schema coverage.
The checker does not fetch external links, execute shell snippets, load `.env`,
validate every CLI flag, follow dynamic environment access, run migrations, or
prove that a JSON example passes a route's authorization and Zod contract.
Inspect representative examples against those deciding implementations.

Use `--root /path/to/worktree` to inspect another explicitly selected checkout
without copying or changing it. Report the exact source and guide hashes from
the output when reviewing in-progress docs. Never infer production availability
from current source, and never copy credentials or real enquiry data into examples.