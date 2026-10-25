# Testing and Verification

Tests prove only the conditions they exercise. Keep local unit evidence, database
transaction tests, browser fixtures, hosted CI, live provider checks, and production
deployment receipts separate. Current run counts belong in the PR
or issue, not setup promises. Start with [Quick Start](QUICK_START.md).

## Isolation First

The existing `.env.local` can point at production. Plain localhost, a demo login,
or a blocked browser request does not isolate server-side Supabase/Meta/AI calls.
Use disposable local services or a separately authorized test environment. Never
load production secrets into a test merely to make it pass.

Unit tests use mocked dependencies and synthetic fixtures.
[tests/setup.ts](../tests/setup.ts) only registers DOM matchers; it does **not**
block network access or replace configuration. Check each script before
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
| `docs:check` | Read-only Markdown links/anchors, fences, JSON examples, command names and source inventories; no application imports or external requests |
| `audit:dependencies` | npm registry advisory check; fails at high severity for runtime dependencies and critical for dev tooling (unpatched `braces` advisory GHSA-vfj7-8cjw-p6xm in ESLint tooling, #102); requires network |
| `test` | One Vitest run in Node, components opt into jsdom |
| `test:watch` | Persistent Vitest watcher; stop it when finished |
| `test:coverage` | V8 coverage, two thread workers, threshold gate and artifacts |
| `test:core` | Offline core regression gate (`tests/core`); no network, credentials or provider cost |
| `test:meta-db` | Temporary local PostgreSQL cluster with synthetic auth/storage schemas. On macOS set `LC_ALL=en_US.UTF-8`, or Postgres 17 stops with "postmaster became multithreaded during startup" |
| `test:workspace-browser` | Playwright suite; explicitly loads `.env.local` if present, can access real accounts |
| `smoke:core` | Headless production browser smoke; default signs in, views five pages, suppresses automatic sync and telemetry writes, then prepares one campaign review without sending it and deletes that draft. Opt-in flags below mutate production. |
| `test:workspace-ux` | Workspace audit script; also loads `.env.local`, not an automatically isolated test |
| `test:scroll-layout` | Offline React/CSS fixtures in Chromium and WebKit; no server, credentials or external requests |
| `env:doctor` | Shell diagnostics for configuration/tooling; not proof of provider authorization |
| `env:doctor:strict` | Strict diagnostic variant |
| `db:push` | Applies schema to configured database; requires explicit target verification/authorization |
| `db:migrate` | Applies one named migration through the checksum ledger; inspect its target first, not an automatic test |
| `worker:campaigns` | Executes queued campaign work against configured services; can mutate Meta and the database |
| `seed:demo-clinic` | Writes demo data; use only on the approved target |
| `generate:icons` | Regenerates local icon assets |
| `eval:creative` | Sends fixture copy to Google judge model; consumes provider quota/cost |
| `eval:create` | Create eval gate (#418): frozen cases through the production pipeline on OpenRouter, blind judge, compare with `tests/eval/baseline.json`; `-- --profile free` is the $0 deterministic gate (`baseline-free.json`) |

### Production Core Smoke

Run `npm run smoke:core` after a production release. It uses Playwright's headless Chromium and reads `SMOKE_EMAIL` and `SMOKE_PASSWORD` from the gitignored, mode-600 `/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke` in memory. Each page prints PASS or FAIL. A PASS for Campaigns or Enquiries in default mode means the view rendered, **not** that Meta or lead sync worked: those automatic POSTs are suppressed. Apart from password sign-in, the default mode writes only the Prepare preflight below.

The default mode then runs **Prepare preflight** (#98, #109): it opens New campaign, picks the first approved ad and lead form at ₹350/day, and clicks Prepare campaign review. That sends one audience-planner call (about 2.7k tokens, counted in the workspace's monthly LLM usage), saves one uniquely named `QA preflight smoke …` draft, reads the Meta connection and runs the preflight, which uses Meta reads only. It passes only when the review has an INR account and either no blockers with Send to Meta (paused) offered, or only the missing Brand Brain website blocker with Send withheld. Any other blocker, planner error, browser error or non-200 fails. It never clicks Send or allows `/api/campaigns/create`, and it always deletes its draft (`PASS Remove preflight draft`; on failure remove the printed name from Saved drafts). `--campaign` runs its own Prepare instead.

`npm run smoke:core -- --create` additionally interviews the user through Create, sends at most one three-ad generation request, waits for the result and prints the saved count. This is a paid provider run. Check the remaining approval in [#88](https://github.com/vanshulgoyal101/adbrain/issues/88) before running it, log the resulting count there, and do not rerun after a partial or uncertain result until saved work is reconciled.

`npm run smoke:core -- --campaign` requires the Solaride workspace, a Solaride lead form, approved creative, and a reviewed Solaride Meta account. It creates one uniquely named test campaign PAUSED, syncs, reconfirms PAUSED, and deletes only that campaign from Meta and AdBrain. A successful removal is labeled Archive in the smoke output; the product actually deletes it. On failure, reconcile by the printed campaign ID or unique test name before another run. The Resume check opens and closes the connection review only: it does not activate delivery or prove an actual status resume. The campaign mode has not been exercised against production as part of implementing this command.

### Production Traffic From the Shared Mac

All automated production browser runs from the shared Mac come from one IP address. On Oct 23 a QA measurement burst (about 100 page loads and 60 probes in 15 minutes) set off Vercel's system DDoS challenge on that address for 10 minutes ([#240](https://github.com/vanshulgoyal101/adbrain/issues/240)). During the challenge, headless Chromium gets `403` with `x-vercel-mitigated: challenge`, while curl and GitHub runners still pass. The team is on the Hobby plan, which offers no system bypass, so:

- Run one production walk at a time, with a pause of a few seconds between page loads.
- Run measurement series, and anything beyond a few dozen page loads, from GitHub Actions, not the Mac.
- On a `403` with `x-vercel-mitigated: challenge`, stop all automated traffic for 15 minutes. Read `GET /v1/security/firewall/events` (Vercel REST API) before treating it as an app failure.

### Core Regression Gate

`npm run test:core` runs `tests/core` in seconds and must pass before any change to generation, validation, prompts, models, timeouts, the planner, Meta calls or CSP merges ([#110](https://github.com/vanshulgoyal101/adbrain/issues/110)). It drives the real routes, validator, LLM routing, AI SDK and `MetaClient` against recorded responses, with deadlines in virtual time. While no virtual timer is pending, `settleInVirtualTime` waits for real IO (sharp decoding on its thread pool) and reports a stall only after 5 s of real time (`replay-clock`, #449):

- **Create** (`create-route`, `create-concept`): three ads saved from production run 4 through the production provider order, validator repair, OpenRouter overload falling back to Gemini without trying OpenRouter's other keys, and run 4's recorded OpenRouter and image latencies fitting the 270 s route deadline. Recorded and gold-labelled `evals/creative` concepts must be accepted or rejected as graded.
- **Create interview** (`create-interview`, #284): real Solaride interview replies recorded by
  `scripts/record-interview-fixtures.ts`: after a "type it below" chip with nothing typed, the
  assistant asks for the offer again instead of failing, and the replies the old claim check
  rejected for "₹10,000" against "10,000 rupees" now pass. Failed attempts name their rule.
- **Internal accounts make free images** (`internal-free-providers`, #449, #466): an internal
  account's concept (the recorded Cedar Ridge reply) comes from Haiku like a customer's, and its
  image from Pollinations without references. Three images run one at a time, waiting out
  Pollinations' recorded 402 Retry-After; a Pollinations that stays busy fails after about 90 s,
  and one that is down fails at once, never reaching the paid image model. The reviewer, the owner
  and customers keep the paid images.
- **Create when the AI is busy** (`create-busy`, #410): through the production order
  (Groq, Gemini, then the paid OpenRouter fallback), every provider rate-limited returns a 503
  "busy, try again" instead of a 500, and each refused attempt is logged as `ai.completion`
  failed with `LLM_HTTP_429`; when OpenRouter answers with the recorded Solaride reply, the
  refused free-tier attempts are still logged. OpenRouter's recorded `Key limit exceeded` 403
  (#449) stays a 500 with `ASSISTANT_HTTP_403`, so a dead key alerts instead of showing "busy".
- **Regenerate** (`create-regenerate`, #281): six real Claude Haiku replies for the Solaride ad that
  failed in production, recorded through the route's own input by
  `scripts/record-regenerate-fixtures.ts` (text only). A cited "₹10,000" backed by "10,000 rupees"
  saves on the first call. A retry that states the Brand's "10%" and "free site survey" without
  citing them saves, because each is in exactly one Brand fact. A made-up offer ("15%") returns a
  plain 422 naming it, leaves the ad untouched and releases the claim so the owner can try again.
- **Create learns from results** (`create-learns-from-results`, #371): the live #157 run's recorded
  lifetime insights and its stored campaign and ad give the exact opening line and `PAST RESULTS`
  block through the real interview route; a campaign with several ads isn't credited to one; a
  business without results gets a byte-identical prompt; a past offer dropped from the Brand still
  fails the fact check, and **More like this** keeps that ad's look and angle without its old
  "10% off … Diwali offer" sentence.
- **Create in Hindi** (`create-hindi`, #290): real Solaride replies recorded by
  `scripts/record-hindi-create-fixtures.ts` (text only) for a vague goal and the factory goal typed
  in Hindi and in Hinglish. The assistant asks in the owner's language and suggests that ad
  language; the Hindi factory ad saves 3/3 with Hindi post text and Latin words on the image.
  The vague-goal "pain point" ads save on the first try in both languages (#378): their rationale's
  "no-cost first step (free site survey)" and "not a guaranteed saving" are no longer claims.
  The Hinglish factory ad saves 3/3 on the first try (#418): the Brand's own "SOLARIDE", "IIT/PEC"
  and a first line leading with "10,000 rupaye per kW" no longer fail `all-caps` or `offer-below-fold`.
  A Hindi concept that writes "फ्री साइट सर्वे" without quoting the Brand or naming it in English is
  cited with the Brand's "Free site survey" (#378, seen in the #418 $0 eval): Hindi and Punjabi offer
  loanwords (साइट, सर्वे, विज़िट, …) match their English fact words from an exact list.
- **Prepare** (`campaign-prepare`, `campaign-prepare-transport`): the recorded Groq plan, planner handoffs, provider failure, and a hang that falls back at the 45 s planner deadline inside the route's 60 s limit.
- **Campaign** (`campaign-meta`): lead form, location and interests, launch entirely PAUSED, read-back, sync and pause against recorded Graph responses.
- **Cost evidence** (`cost-evidence`): lifetime spend read for customer cost evidence (#216) from two real Solaride campaigns, one never delivered (₹0) and one with ₹32.63, recorded read-only by `scripts/record-meta-spend-fixtures.ts`.
- **Managed spending limit** (`managed-spend-cap`, #522): a ₹500 annual-quote customer's child
  ad account gets a ₹338.98 limit (₹400 ad share net of 18% GST), written in rupees and read back
  in paise; a different read-back, or one whose room exceeds what the customer has left (Meta's
  counter restarted), keeps campaigns paused, and 0 is never written. The Graph
  exchange is **provisional** (Meta's documented shape) until a managed account can be recorded.
- **Managed limit follows the balance** (`managed-spend-cap-sync`, #522): through the real
  `MetaClient` on the parent token, Solaride's recorded funding read (4,237 spent) gets a ₹338.98
  limit with 29,661 room, written in rupees and read back; a held account with nothing spent has
  its live campaign paused on Meta (recorded verified pause) before a ₹1 limit, with AdBrain's
  campaign, reserve and audit updated. Derived exchanges (read-back, zero spend, one live campaign)
  are marked in the test. `npm run test:meta-db` checks the writer lease on Postgres: one writer
  of concurrent events, a rerun when an event lands mid-pass, an expired lease handed on, tenant
  and role checks, media per ad account, a payment or refund marking the limit stale before it is
  processed, and the sweep order (stale first, then oldest decision, so a cut-short run resumes).
- **Managed campaigns** (`managed-campaign`, #525): the real recorded Solaride Prepare → PAUSED
  create → sync → pause tapes, run through `withMetaConnection` for a managed business whose
  ledger row points at that ad account and Page: every call AdBrain builds carries the parent
  token, posts go only to the child ad account, no OAuth row or token is read, and a pause bound
  to another account is refused.
- **Operator funding** (`operator-funding`): the real Solaride ad account read (`spend_cap` 88983, `amount_spent` 4237 paise after the owner's ₹1,000 top-up) that gates an operator-funded capped activation (#245), recorded read-only by `scripts/record-meta-funding-fixtures.ts`.
- **Prepare speed** (`prepare-speed`, #271): real Tricity geo searches recorded with the previous one-at-a-time resolver resolve identically when searched together, and the recorded Solaride lead-form read is served from cache for ten minutes per business, Page and connection (fresh, reconnect and expiry re-read Meta).
  Preflight's form check stays uncached and reads only the chosen form, recorded read-only by
  `scripts/record-meta-form-fixtures.ts`: an active form on the Page passes; a campaign ID and an
  unknown ID are refused; synthetic edits refuse an archived form and a form on another Page.
- **Results refresh** (`results-refresh`): the scheduled results job (#258) against real insights and ad review reads from the live #157 run and a paused Solaride campaign, recorded read-only by `scripts/record-meta-results-fixtures.ts`: lifetime insights (`date_preset=maximum`, #404; the live run's 70 impressions, ₹10.69 and 1 chat), one result row per campaign per hour, GETs only, the 6-hour no-impressions flag, and a rejected-ad flag from a synthetic DISAPPROVED edit of the recorded ads response.
- **Campaign stop** (`campaign-stop`): the paused-run settle check (#221) that the whole Meta tree is stopped, from two real Solaride campaigns (a fully PAUSED tree, and ACTIVE children under a paused campaign), recorded read-only by `scripts/record-meta-stop-fixtures.ts`.
- **Launch gate** (`launch-validate`, #419): every object the launch code creates (campaign, ad set, creative, ad) for a lead-form and a WhatsApp campaign must equal a payload Meta accepted with `validate_only`. Recorded by [`record-meta-launch-validate.ts`](../scripts/record-meta-launch-validate.ts), which runs the real `createLeadCampaign`: ads are only validated, and the PAUSED campaign, empty ad set and creative it needs exist briefly and are deleted. A deliberate change to what we send Meta fails this test until the tape is re-recorded and Meta's answers reviewed.
- **Managed provisioning walk** (`test:meta-db`, #521): a fixture tenant replays, as the service role on the real migrations, every write provisioning makes: Page link, lease, a failed child step and its resume, ad account, the child system user's encrypted token reference (and a re-mint), grant, release. The owner then reads their row and 7 step events.
- **Meta call events** (`meta-call-events`, #451 L2): replays Meta's recorded Advantage+ refusal (subcode 1870189) through a real launch; every Graph call must log one `meta.graph` event with the endpoint template, status and `META_100_1870189`, and no token, ID or query value. #615: a recorded refusal also puts Meta's code, subcode, user title, `fbtrace_id` and endpoint on the `meta.<purpose>` workflow event.
- **Review warnings** (`review-warnings`, #419 2b): the live #157 run's recorded lifetime read, stored for its campaign row and read back through Create's results store, prices a chat at ₹10.69; on the launch gate's recorded ₹280 WhatsApp plan Review warns only that the ad has no 9:16, and at ₹50 a day also that Meta can't learn (about 32 chats a week). Neither blocks or changes the plan hash.
- **Plan check** (`plan-check`, #419): `npx tsx scripts/plan-check.ts [--cost-per-result 69] [plan.json]` checks a planned campaign offline against Meta's new-advertiser guidance (Advantage+ audience and placements, one ad set, budget vs the ~50 results a week learning threshold, 4:5 and 9:16 images). With no file it checks the launch gate's payloads; it exits 1 when a rule fails. Every launch also runs it on the payloads it sent (`onPlanned`): `launch-validate` pins that the check sees exactly the accepted forms, and `story-placement` that it sees the creative each ad runs on (the single image when Meta refused the placement ad), never the token.
- **WhatsApp** (`campaign-whatsapp`, `whatsapp-number`): Meta's real `validate_only` answers for the WhatsApp campaign, ad set and creative (#209), recorded with [`record-meta-whatsapp-adset.ts`](../scripts/record-meta-whatsapp-adset.ts), plus the Page and business WhatsApp number reads behind the button number (#235). The tape also holds Meta's acceptance of the #493 one-tap ask in English, for one city, in Hindi and in Punjabi ([`record-meta-whatsapp-fixtures.ts`](../scripts/record-meta-whatsapp-fixtures.ts), against a PAUSED ad set).
- **CSP** (`csp-render`): the production policy is pinned, and the Create review renders three ads whose images and requests the policy allows, without `eval`.

Fixtures in `tests/core/fixtures` come from production recordings and `evals/creative`; each file or test notes its source and any synthetic part. When a gate change is intended, update the fixture or pinned policy in the same PR and say why.

### Focused Local Loop

```sh
npm run test -- tests/spend.test.ts
npm run lint
npm run typecheck
```

To keep inherited service credentials out of a mocked test, run it from a
worktree without environment files and a scrubbed environment:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp CI=1 RUN_PAID_CREATIVE_EVAL=0 \
	NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
	NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
	npm test -- tests/spend.test.ts --maxWorkers=1
```

Scrubbing variables is not a network sandbox: test doubles or the optional
[unit network guard](../scripts/qa-unit-network-guard.mjs) must prevent
unintended transport. Do not attach that guard to browser/database checks that
need their own isolated services.

Choose an existing test file for the behavior being changed. For a shared contract,
run both its pure schema tests and affected route/component tests. Mock failure
paths as well as success: returned Supabase errors are not always thrown `Error`
instances, and HTTP 200 can represent partial work.

### CI Gates

[CI](../.github/workflows/ci.yml) runs on push/PR to `dev`/`main` with placeholder
Supabase configuration and Node 24. Every job runs in parallel after its own `npm ci`:

| Job | Runs |
|---|---|
| `build` | `npm run build` |
| `lint` | `npm run lint`, `npm run typecheck` |
| `unit` (3 shards) | `npx vitest run --shard=N/3` |
| `metadb` | `META_TEST_PG_BIN="$(pg_config --bindir)" npm run test:meta-db` |
| `test` | aggregator: fails unless `lint`, every `unit` shard and `metadb` succeeded |
| `core` | `npm run test:core`, then `test:meta-db -- --generation-only` |
| `audit` | `npm run audit:dependencies` (reports, does not block) |
| `secrets` | Gitleaks |

Required checks are `build`, `test`, `core` and `secrets`. `test` runs with
`if: always()` so a failed shard fails it instead of skipping it (a skipped required
check counts as passing). Locally, `npm test` still runs the whole suite in one
process. Do not disable checks to make a release green.
The focused configurable-payment SQL slice is `npm run test:meta-db -- --pricing-only`.
It uses disposable PostgreSQL for fresh/upgrade preservation, exact TypeScript/SQL
quote and policy parity, owner/expiry scope, concurrent one-order claims, zero
verification allowance, immutable pricing, captures, partial/full refunds and
migration-ledger replay. The default SQL harness includes this slice. It does not
contact Razorpay or establish real capture, webhook delivery or production rollout.

Coverage thresholds in [vitest.config.mts](../vitest.config.mts) are statements 56%,
branches 52%, functions 59%, lines 56%. They are minimum regression gates, not a
claim that all customer journeys are covered. Page/layout files are excluded
from the coverage denominator; build and browser checks address other risks.

Concurrent builds share `.next` and coverage runs share output. Coordinate writers
or validate an isolated snapshot without environment files; do not delete another
session's artifacts or interpret mixed outputs as evidence for your exact change.

## Database Verification

[The harness](../scripts/check-meta-connect-db.mjs) defaults to Homebrew
PostgreSQL 17 binaries at `/opt/homebrew/opt/postgresql@17/bin`; override
`META_TEST_PG_BIN` for another installation. It creates a temporary Unix-socket
cluster, synthetic roles/auth/storage, and fresh/upgrade databases, then cleans
up. It does not require production Supabase credentials.

On macOS a scrubbed environment may need `LC_ALL=C LANG=C` for PostgreSQL
startup. A harness setup failure is not a failed application assertion; never
substitute a production database URL or run schema-push commands to repair it.

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

### Enquiry Checks

For the saved-enquiry workflow, with installed Google Chrome and fully synthetic
transport (no application server, credentials or provider calls):

```sh
node scripts/check-workspace-ux.mjs --offline-leads
LC_ALL=C LANG=C node scripts/check-meta-connect-db.mjs --leads-only
npm test -- tests/leads.test.ts tests/lead-inbox.test.tsx tests/meta-connect-w2-leads-sync-route.test.ts
```

The browser check renders the real inbox and CSS at 1440/390/320px: paging,
failed save and retry, reload persistence, filters, partial sync/resume and error
recovery; screenshots go to ignored `test-results/lead-inbox/`. The database
check uses its own temporary cluster for fresh/upgrade schemas, 225-row cursor
ordering, defaults, re-import preservation and tenant denials. Neither is live
Meta evidence.

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

`eval:create` (#418) is the gate every generation change (prompt, validator, model, routing) must
match or beat. It runs the 7 frozen cases in [cases.json](../tests/eval/cases.json) (Cedar Ridge,
Solaride English/Hindi/Hinglish, two example businesses, all from committed recordings) through the
production Create pipeline with the production models pinned, and scores 3 of 3 saved, first-try
passes, offer in the first 125 characters, post text in the chosen script, cost and wall time. A
blind judge (`google/gemini-3.8-flash` on OpenRouter, calibrated first on the gold `evals/creative`
ads: MAE must stay at or under 0.15) scores the copy and the finished ad image, and lists invented
claims and garbled image text. Without `--write-baseline` it compares with
[baseline.json](../tests/eval/baseline.json) and exits 1 when a customer would see something worse:
fewer full batches or saved ads, more invented claims or garbled text, judge scores down more than
0.25, more than ₹25 per run, or Create p90 over 60 s and slower than before. About $0.05 per case;
`--cap-usd` (default 5) stops the run, and it refuses to start unless the shared OpenRouter key keeps
$2 for production after the cap (#449). `--repeat N` runs each case N times; bake-offs set
`EVAL_TEXT_MODEL`, `EVAL_IMAGE_MODEL` or `EVAL_JUDGE_MODEL`.

`--profile free` is the gate for generation changes while OpenRouter stays at its limit (CTO, Oct
25; judged runs need a CEO-approved budget). At $0, with OpenRouter switched off: copy on
`gemini-3.8-flash` (not production's Gemini model, so it never spends production's free quota) then
Groq, one concept at a time; Pollinations images; no judge unless `--judge`. It runs the two gate
cases (`cedar-ridge-en`, `solaride-factory-hi`) and compares only the deterministic copy checks with
`tests/eval/baseline-free.json` (recorded after the next daily reset): copy saved (an ad whose free image failed
still counts), first-try passes, offer in the first 125 characters, and script. Concepts no provider
answered don't count; over a third of them makes the run inconclusive (exit 1, run again later), and
such a run can't become the baseline. Free tiers are small (Gemini 20 requests per day per model,
Groq 8,000 tokens a minute, Pollinations ~1 image per 20–40 s), so run it after the daily reset
(07:00Z) and not twice in a row (#418).

Baseline (2026-10-24, `8e21d29`, anthropic/claude-haiku-5.5 + openai/gpt-image-2.5-flare):
full batches 71%, 17/21 ads, first try 71%, judge copy
4.059 / image 3.765, invented claims 0%, $0.042 per run, p50 53 s / p90 79 s.
The Solaride factory goal in Hindi and Hinglish saved 1 of 3: `all-caps` and `offer-below-fold`.

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
The local test gate rejects production/Vercel and non-loopback Supabase targets;
do not enable a test flag to exercise production payments. See the
[payment implementation receipt](PAYMENTS-PLAN.md#9-implementation-receipt).

## Documentation Checks

```sh
npm run docs:check
npm run docs:check -- docs/TESTING.md
npm run docs:check -- --all --json
node --test scripts/check-docs.test.mjs
```

[The checker](../scripts/check-docs.mjs) parses Markdown and fails current guides
on broken local links/anchors or source-line links, unclosed fences, invalid JSON
examples, missing `node scripts/...` files and unknown `npm run` names. Historical
records (`docs/qa/`, `docs/releases/`, dated history files) are checked only with
`--all`, as warnings. `--json` also lists API routes, environment keys and
migrations not mentioned in their owning guides; these are review leads, not
contract validation. `--root <worktree>` inspects another checkout. It does not
fetch external links, run snippets, load `.env` or validate route schemas.

When changing a route, environment field, migration, or lifecycle, update the
corresponding reference in the same change. Check API inventory against exported
handlers, configuration against `env.ts` plus direct environment reads, tables
against SQL, and commands against `package.json`. Parse JSON examples and validate
schema-bound examples against the actual imported schema when practical.

Check relative links/anchors and balanced code fences. Label dated experiments as
history, preserve external verification gaps, and never paste a recent test count
into a permanent product guarantee.