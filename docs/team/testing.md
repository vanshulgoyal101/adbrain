# Testing and Verification

Part of [Team](README.md). Database, browser, paid and documentation checks: [Verification](testing-verification.md).

Tests prove only the conditions they exercise. Keep local unit evidence, database
transaction tests, browser fixtures, hosted CI, live provider checks, and production
deployment receipts separate. Current run counts belong in the PR
or issue, not setup promises. Start with [Quick Start](../QUICK_START.md).

## Isolation First

The existing `.env.local` can point at production. Plain localhost, a demo login,
or a blocked browser request does not isolate server-side Supabase/Meta/AI calls.
Use disposable local services or a separately authorized test environment. Never
load production secrets into a test merely to make it pass.

Unit tests use mocked dependencies and synthetic fixtures.
[tests/setup.ts](../../tests/setup.ts) only registers DOM matchers; it does **not**
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

The default mode then runs **Prepare preflight** (#98, #109): it opens New campaign, picks the first approved ad and lead form at ₹350/day, and clicks Check my campaign (nothing spends). That sends one audience-planner call (about 2.7k tokens, counted in the workspace's monthly LLM usage), saves one uniquely named `QA preflight smoke …` draft (or, since #1151, updates the smoke workspace's saved draft for exactly that one ad), reads the Meta connection and runs the preflight, which uses Meta reads only. It passes only when the review has an INR account and either no blockers with Send to Meta (paused) offered, or only the missing Brand Brain website blocker with Send withheld. Any other blocker, planner error, browser error or non-200 fails. It never clicks Send or allows `/api/campaigns/create`, and it always deletes its draft (`PASS Remove preflight draft`; on failure remove the printed name from Saved drafts). `--campaign` runs its own Prepare instead.

`npm run smoke:core -- --create` additionally interviews the user through Create, sends at most one three-ad generation request, waits for the result and prints the saved count. This is a paid provider run. Check the remaining approval in [#88](https://github.com/vanshulgoyal101/adbrain/issues/88) before running it, log the resulting count there, and do not rerun after a partial or uncertain result until saved work is reconciled.

`npm run smoke:core -- --campaign` requires the Solaride workspace (signed in as its owner: since #1324 a smoke-owned business can only read, validate and pause on Meta unless its ad account is in `testAdAccountIds`), a Solaride lead form, approved creative, and a reviewed Solaride Meta account. It creates one uniquely named test campaign PAUSED, syncs, reconfirms PAUSED, and deletes only that campaign from Meta and AdBrain. A successful removal is labeled Archive in the smoke output; the product actually deletes it. On failure, reconcile by the printed campaign ID or unique test name before another run. The Resume check opens and closes the connection review only: it does not activate delivery or prove an actual status resume. The campaign mode has not been exercised against production as part of implementing this command.

### Production Traffic From the Shared Mac

All automated production browser runs from the shared Mac come from one IP address. On Oct 23 a QA measurement burst (about 100 page loads and 60 probes in 15 minutes) set off Vercel's system DDoS challenge on that address for 10 minutes ([#240](https://github.com/vanshulgoyal101/adbrain/issues/240)). During the challenge, headless Chromium gets `403` with `x-vercel-mitigated: challenge`, while curl and GitHub runners still pass. The team is on the Hobby plan, which offers no system bypass, so:

- Run one production walk at a time, with a pause of a few seconds between page loads.
- Run measurement series, and anything beyond a few dozen page loads, from GitHub Actions, not the Mac.
- On a `403` with `x-vercel-mitigated: challenge`, stop all automated traffic for 15 minutes. Read `GET /v1/security/firewall/events` (Vercel REST API) before treating it as an app failure.

### Core Regression Gate

Recorded Meta tapes go through `metaScrubber()` (`scripts/lib/scrub-meta.ts`, #1040) before they are committed: the ad account and Page are pinned to `act_9000000000000001` and `900000000000002`, the account and Page the tests connect as. `fixtures-no-real-ids` fails if any fixture holds a number that hashes to the real account or Page (#1101).

`npm run test:core` runs `tests/core` in seconds and must pass before any change to generation, validation, prompts, models, timeouts, the planner, Meta calls or CSP merges ([#110](https://github.com/vanshulgoyal101/adbrain/issues/110)). It drives the real routes, validator, LLM routing, AI SDK and `MetaClient` against recorded responses, with deadlines in virtual time. While no virtual timer is pending, `settleInVirtualTime` waits for real IO (sharp decoding on its thread pool) and reports a stall only after 5 s of real time (`replay-clock`, #449):


- **Create** (`create-route`, `create-concept`): three ads saved from production run 4 through the production provider order, validator repair, OpenRouter overload falling back to Gemini without trying OpenRouter's other keys, and run 4's recorded OpenRouter and image latencies fitting the 270 s route deadline. Recorded and gold-labelled `evals/creative` concepts must be accepted or rejected as graded.
- **Create interview** (`create-interview`, #284): real Solaride interview replies recorded by
  `scripts/record-interview-fixtures.ts`: after a "type it below" chip with nothing typed, the
  assistant asks for the offer again instead of failing, and the replies the old claim check
  rejected for "₹10,000" against "10,000 rupees" now pass. Failed attempts name their rule.
- **Brand autofill** (`brand-autofill`, #650): Solaride's real home page and the real Groq
  extraction reply, recorded by `scripts/record-brand-autofill-fixtures.ts`, drive the real route:
  description, vertical, USPs and languages come from the reply, the phone from the page's `tel:`
  link, and no offer is invented. Unsafe URLs (metadata IP, localhost, private ranges, `file:`,
  credentials) are refused before any fetch; a provider outage or a non-JSON reply gives the
  documented 502, and every attempt, a cache hit included, is a `brand.autofill` usage row.
- **Internal accounts make free images** (`internal-free-providers`, #449, #466): an internal
  account's concept (the recorded Cedar Ridge reply) comes from Haiku like a customer's, and its
  image from Pollinations without references. Three images run one at a time, waiting out
  Pollinations' recorded 402 Retry-After (at least 15 s, since its 45 s free limit says
  Retry-After: 1, and a fast 404 counts as busy, #634); a Pollinations that stays busy fails after about 90 s,
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
- **Prepare** (`campaign-prepare`, `campaign-prepare-transport`): the recorded Groq plan, planner handoffs, provider failure, and a hang that falls back at the 45 s planner deadline inside the route's 60 s limit. #612: every free provider answering 429 still ends in a plan on the paid last resort; after a burst that parked every provider, the next Prepare waits out the shortest cooldown (≤ 20 s) and plans with AI targeting; an audience plan that falls back to default targeting is logged `partial`, not `failed`, since the owner can still launch.
- **Campaign** (`campaign-meta`): lead form, location and interests, launch entirely PAUSED, read-back, sync and pause against recorded Graph responses.
- **Launch routes** (`launch-routes`, #648): `POST /api/campaigns/preflight` and `POST /api/campaigns/create`, inline and through the queued worker, on the same recorded Graph answers with only Supabase in memory (OAuth token decrypted for real). A business without a website reviews as 200 with `canCreatePaused: false`, no planHash and an `open_brand` blocker, and create refuses it. A ready review gets a planHash, and create sends only PAUSED objects on the connected account and Page and ends `succeeded` with the recorded campaign. An older draft version, connection generation or plan is refused before any Meta write. Sending the same request again replays the finished operation.
**Recorder write gate (#1324):** every `scripts/record-meta-*.ts` imports `scripts/lib/meta-write-gate.ts` first, so any non-GET Graph call (validate_only checks included) is refused unless the shell sets `ADBRAIN_ALLOW_META_WRITES=1`. Read-only recorders run without it.

- **Cost evidence** (`cost-evidence`): lifetime spend read for customer cost evidence (#216) from two real Solaride campaigns, one never delivered (₹0) and one with ₹32.63, recorded read-only by `scripts/record-meta-spend-fixtures.ts`.
- **Managed spending limit** (`managed-spend-cap`, #522): a ₹500 annual-quote customer's child
  ad account gets a ₹338.98 limit (₹400 ad share net of 18% GST), written in rupees and read back
  in paise; a different read-back, or one whose room exceeds what the customer has left (Meta's
  counter restarted), keeps campaigns paused, and 0 is never written. The Graph
  exchange is **provisional** (Meta's documented shape) until a managed account can be recorded.
- **Managed limit follows the balance** (`managed-spend-cap-sync`, #522): through the real
  `MetaClient` on the child's own token (#624), Solaride's recorded funding read (4,237 spent) gets a ₹338.98
  limit with 29,661 room, written in rupees and read back; a held account with nothing spent has
  its live campaign paused on Meta (recorded verified pause) before a ₹1 limit, with AdBrain's
  campaign, reserve and audit updated. Derived exchanges (read-back, zero spend, one live campaign)
  are marked in the test. `npm run test:meta-db` checks the writer lease on Postgres: one writer
  of concurrent events, a rerun when an event lands mid-pass, an expired lease handed on, tenant
  and role checks, media per ad account, a payment or refund marking the limit stale before it is
  processed, and the sweep order (stale first, then oldest decision, so a cut-short run resumes).
- **Managed campaigns** (`managed-campaign`, #525): the real recorded Solaride Prepare → PAUSED
  create → sync → pause tapes, run through `withMetaConnection` for a managed business whose
  ledger row points at that ad account and Page: every call AdBrain builds carries the child's own
  system-user token (#624), posts go only to the child ad account, no OAuth row or token is read, and
  a pause bound to another account is refused. A missing, deleted, revoked, expired or other
  business's child token fails closed for create, read and pause without any Meta call.
- **Operator funding** (`operator-funding`): the real Solaride ad account read (`spend_cap` 88983, `amount_spent` 4237 paise after the owner's ₹1,000 top-up) that gates an operator-funded capped activation (#245), recorded read-only by `scripts/record-meta-funding-fixtures.ts`.
- **Prepare speed** (`prepare-speed`, #271): real Tricity geo searches recorded with the previous one-at-a-time resolver resolve identically when searched together, and the recorded Solaride lead-form read is served from cache for ten minutes per business, Page and connection (fresh, reconnect and expiry re-read Meta).
  Preflight's form check stays uncached and reads only the chosen form, recorded read-only by
  `scripts/record-meta-form-fixtures.ts`: an active form on the Page passes; a campaign ID and an
  unknown ID are refused; synthetic edits refuse an archived form and a form on another Page.
- **Results refresh** (`results-refresh`): the scheduled results job (#258) against real insights and ad review reads from the live #157 run and a paused Solaride campaign, recorded read-only by `scripts/record-meta-results-fixtures.ts`: lifetime insights (`date_preset=maximum`, #404; the live run's 70 impressions, ₹10.69 and 1 chat), one result row per campaign per hour, GETs only, the 6-hour no-impressions flag, and a rejected-ad flag from a synthetic DISAPPROVED edit of the recorded ads response. Ad review reads send `locale=en_US`: `meta-safety` replays a real rejected ad recorded both ways (Oct 25), and the reason reads in English although the token user's Facebook is in Hindi (#635).
- **Free image watermark** (`pollinations-watermark`, #661): a real anonymous Pollinations image (686×858, logo at rows ~828–850) comes out of `downloadImage` trimmed above the logo with its 4:5 shape; other sources are untouched.
- **Manage routes** (`manage-routes`, #649): `PATCH /api/campaigns/[id]` (pause), `POST /api/campaigns/sync` and `POST /api/campaigns/[id]/refresh` through their real handlers, connection access, trusted writes, spend enforcement and audit; only Supabase (in-memory) and the LLM are stubbed. Pause replays the recorded #157 tree (three PAUSED writes, the connection's token) and refuses another account, Page, stale generation or missing binding before any Meta call; sync imports only the campaign bound to the connected account and Page and skips another account, a capped #157 tree and stored rows on another account or Page; refresh writes one result row from `results.json`; signed out is 401 and another owner's business is refused, with no Meta call. Activation review (`GET /api/campaigns/[id]`) returns the recorded delivery (`delivery.json`) and, operator-funded, the account funding (`account-funding.json`); `PATCH` "active" is refused for a stale confirmation digest (after only the recorded reads), another connection generation and the weekly cap (before any Meta call), an operator-funded capped run above the recorded funding room, and uncapped paused children, never with a Graph write. The capability re-check is stubbed (its reads were never recorded) and the success path (spend cap and ACTIVE writes) is still unrecorded. A recorded Graph 190 (`token-revoked.json`, malformed token, read-only) on the first pause read must answer `META_REAUTH`, write nothing, and mark the connection `reauth_required` (#757).
- **Edit audience** (`edit-audience`, #773): `MetaClient.editAdSetTargeting` replays responses recorded by `scripts/record-meta-edit-audience.ts` on PAUSED Solaride test campaigns (archived afterwards). An ad set with interests is **rebuilt**: validate_only, a new PAUSED ad set with launch's Advantage+ age rule (`age_min` 25, `age_max` 65, `age_range` [30,60]), the ads copied PAUSED, the old ad set archived. One without interests is **patched** in place and read back. Meta's one-update-per-30-s limit (613) is recorded too. A language-only change (English (All) + Hindi) is recorded on both paths; Meta stores English (All) `1001` as `[6, 24]`, which the read-back accepts. The pre-#741 fix (`areaExclusions`) is recorded on a test ad set stripped of its exclusions: the area lookup, validate_only, the patch with 35 state exclusions, read back. Nothing is ever set ACTIVE.
- **Rejected ads in plain words** (`ad-rejection-copy`, #1305): `MetaClient.readAdReview` replays Meta's real, read-only answer for Solaride's one disapproved ad, recorded by `scripts/record-meta-ad-review.ts` (GET only, ids scrubbed). `adReviewState` keeps each `{policy, message}` pair; `rejectionCopy` maps the CPO's 10 policies (#1299) by key, then by words in Meta's message, and quotes Meta when nothing matches. The recorded sample (`Lead Ads`, a generic message) takes that fallback; the other keys come from Meta's Advertising Standards until more real rejections are recorded. #1645: the Brand's category tailors the words for the IELTS and interiors pilots (`segmentForCategory`): IELTS gets its own misleading example, a 'Failed IELTS?' personal-attributes line and a `job_or_visa_offer` row with a licence-number hint for the editor; interiors' property reading is fixed by **Edit the words**. Cases replay recorded-style feedback in `fixtures/meta/ad-review-segments.json`; a solar business reads every other row unchanged.
- **Campaign stop** (`campaign-stop`): the paused-run settle check (#221) that the whole Meta tree is stopped, from two real Solaride campaigns (a fully PAUSED tree, and ACTIVE children under a paused campaign), recorded read-only by `scripts/record-meta-stop-fixtures.ts`.
- **Launch gate** (`launch-validate`, #419): every object the launch code creates (campaign, ad set, creative, ad) for a lead-form and a WhatsApp campaign must equal a payload Meta accepted with `validate_only`. Recorded by [`record-meta-launch-validate.ts`](../../scripts/record-meta-launch-validate.ts), which runs the real `createLeadCampaign`: ads are only validated, and the PAUSED campaign, empty ad set and creative it needs exist briefly and are deleted. A deliberate change to what we send Meta fails this test until the tape is re-recorded and Meta's answers reviewed.
- **Managed provisioning walk** (`test:meta-db`, #521): a fixture tenant replays, as the service role on the real migrations, every write provisioning makes: Page link, lease, a failed child step and its resume, ad account, the child system user's encrypted token reference (and a re-mint), grant, release. The owner then reads their row and 7 step events.
- **First-load JS** (CI `ui-gate`, #1850): `scripts/first-load-js.mjs` sums the gzipped `/_next/static` scripts that `/`, `/login` and `/for/solar` load, on the base and the PR builds, and fails above 10% (and 5 KB) growth. Next 16 no longer prints First Load JS. Intended growth: label the PR `bundle-growth-ok`, then re-run the job. It also runs when `package.json`, the lockfile or `next.config` change.
- **Smoke data guard** (`smoke-data-guard`, #1809): the production smoke business's saved inputs (`fixtures/smoke-business.json`) go through Prepare's own checks (`resolveDraftTargeting` over Meta's recorded place search in `geo-smoke.json`, then `runPreflight`). A rule change that breaks the smoke's data fails CI, not the production guard (#1745). Change the snapshot and the production row together; re-record with `scripts/record-meta-geo-smoke.ts` (read-only).
- **Meta call events** (`meta-call-events`, #451 L2): replays Meta's recorded Advantage+ refusal (subcode 1870189) through a real launch; every Graph call must log one `meta.graph` event with the endpoint template, status and `META_100_1870189`, and no token, ID or query value. #615: a recorded refusal also puts Meta's code, subcode, user title, `fbtrace_id` and endpoint on the `meta.<purpose>` workflow event.
- **Review warnings** (`review-warnings`, #419 2b): the live #157 run's recorded lifetime read, stored for its campaign row and read back through Create's results store, prices a chat at ₹10.69; on the launch gate's recorded ₹280 WhatsApp plan Review warns only that the ad has no 9:16, and at ₹50 a day also that Meta can't learn (about 32 chats a week). Neither blocks or changes the plan hash. On activation (#419 item 2), at the same ₹10.69 a ₹280 × 3-day capped run (about 78 chats) gets no note, ₹50 × 3 days (about 14) gets the new-ad-set learning note, and resuming after a 10-day pause gets the restart note; 3 days paused gets none.
- **Plan check** (`plan-check`, #419): `npx tsx scripts/plan-check.ts [--cost-per-result 69] [plan.json]` checks a planned campaign offline against Meta's new-advertiser guidance (Advantage+ audience and placements, one ad set, budget vs the ~50 results a week learning threshold, 4:5 and 9:16 images). With no file it checks the launch gate's payloads; it exits 1 when a rule fails. Every launch also runs it on the payloads it sent (`onPlanned`): `launch-validate` pins that the check sees exactly the accepted forms, and `story-placement` that it sees the creative each ad runs on (the single image when Meta refused the placement ad), never the token.
- **WhatsApp** (`campaign-whatsapp`, `whatsapp-number`): Meta's real `validate_only` answers for the WhatsApp campaign, ad set and creative (#209), recorded with [`record-meta-whatsapp-adset.ts`](../../scripts/record-meta-whatsapp-adset.ts), plus the Page and business WhatsApp number reads behind the button number (#235). #615: Meta's recorded 403 (code 200) on the business's WhatsApp accounts means "no business numbers", so the Page's number and the status card still show; any other error still fails the read. The tape also holds Meta's acceptance of the #493 one-tap ask in English, for one city, in Hindi and in Punjabi ([`record-meta-whatsapp-fixtures.ts`](../../scripts/record-meta-whatsapp-fixtures.ts), against a PAUSED ad set).
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
[unit network guard](../../scripts/qa-unit-network-guard.mjs) must prevent
unintended transport. Do not attach that guard to browser/database checks that
need their own isolated services.

Choose an existing test file for the behavior being changed. For a shared contract,
run both its pure schema tests and affected route/component tests. Mock failure
paths as well as success: returned Supabase errors are not always thrown `Error`
instances, and HTTP 200 can represent partial work.

### CI Gates

[CI](../../.github/workflows/ci.yml) runs on push/PR to `dev`/`main` with placeholder
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
| `boundaries` | `npm run boundaries -- --base origin/<base>`: ADR-001 import rules (`.dependency-cruiser.mjs`). A new edge fails; a fixed edge fails until `npm run boundaries -- --write-baseline` drops it from `scripts/boundaries-baseline.json`, which may only shrink (#2070) |
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

Coverage thresholds in [vitest.config.mts](../../vitest.config.mts) are statements 56%,
branches 52%, functions 59%, lines 56%. They are minimum regression gates, not a
claim that all customer journeys are covered. Page/layout files are excluded
from the coverage denominator; build and browser checks address other risks.

Concurrent builds share `.next` and coverage runs share output. Coordinate writers
or validate an isolated snapshot without environment files; do not delete another
session's artifacts or interpret mixed outputs as evidence for your exact change.
