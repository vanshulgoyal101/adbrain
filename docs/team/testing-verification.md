# Database, Browser, Paid and Documentation Verification

Part of [Team](README.md). Commands, the core gate and CI: [Testing](testing.md).

## Database Verification

[The harness](../../scripts/check-meta-connect-db.mjs) defaults to Homebrew
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
[scripts/local-meta-qa.mjs](../../scripts/local-meta-qa.mjs) and the existing `adbrain-qa`
Colima profile documented in [Releasing](../operations/releasing.md). The launcher asserts
loopback Supabase targets. Do not replace its isolated settings with production
secrets to bypass setup problems.

## Browser Verification

For isolated scrollbar and conversation layout regressions:

```sh
npx playwright install chromium webkit
npm run test:scroll-layout
```

[The layout check](../../scripts/check-scroll-layout.mjs) bundles the real shared
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

[Playwright configuration](../../playwright.config.ts) uses one worker, base URL
`http://localhost:3939`, and an existing production build via `npm run start`.
It reuses an existing server; verify that server's credentials and build before
running. Screenshot/video/trace are disabled by default in this suite. Review
individual [e2e tests](../../e2e/) for fixtures and live dependencies.

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
match or beat. It runs the 7 frozen cases in [cases.json](../../tests/eval/cases.json) (Cedar Ridge,
Solaride English/Hindi/Hinglish, two example businesses, all from committed recordings) through the
production Create pipeline with the production models pinned, and scores 3 of 3 saved, first-try
passes, offer in the first 125 characters, post text in the chosen script, cost and wall time. A
blind judge (`google/gemini-3.8-flash` on OpenRouter, calibrated first on the gold `evals/creative`
ads: MAE must stay at or under 0.15) scores the copy and the finished ad image, and lists invented
claims and garbled image text. Without `--write-baseline` it compares with
[baseline.json](../../tests/eval/baseline.json) and exits 1 when a customer would see something worse:
fewer full batches or saved ads, more invented claims or garbled text, judge scores down more than
0.25, more than ₹25 per run, or Create p90 over 60 s and slower than before. About $0.05 per case;
`--cap-usd` (default 5) stops the run, and it refuses to start unless the shared OpenRouter key keeps
$2 for production after the cap (#449; `--keep-usd`, at least 0.5, lowers that only with a CEO approval naming it). `--repeat N` runs each case N times; bake-offs set
`EVAL_TEXT_MODEL`, `EVAL_IMAGE_MODEL` or `EVAL_JUDGE_MODEL`; `EVAL_SCHEDULE=serial` runs the paid
profile one concept at a time, to time production's default against parallel (#713).

`--profile free` is the gate for generation changes while OpenRouter stays at its limit (CTO, Oct
25; judged runs need a CEO-approved budget). At $0, with OpenRouter switched off: copy on
`gemini-3.8-flash` (not production's Gemini model, so it never spends production's free quota) then
Groq, one concept at a time; Pollinations images; no judge unless `--judge`. It runs the two gate
cases (`cedar-ridge-en`, `solaride-factory-hi`) and compares only the deterministic copy checks with
`tests/eval/baseline-free.json` (2026-10-26, `885899c`: 5 of 6 copy saved, 60% first try, 67% offer
in the fold, script 100%, 1 provider failure): copy saved (an ad whose free image failed
still counts), first-try passes, offer in the first 125 characters, and script. Both profiles also
report and gate the share of Latin-script ads naming a Brand place in the headline or first line
(#418 rule 1; skipped against baselines made before it), counting the copy of concepts whose free
image failed. They also report, without gating, the share whose visual direction puts a person in
the picture (#418 rule 4; a text heuristic, about 20% of recorded Haiku concepts). Concepts no provider
answered don't count; over a third of them makes the run inconclusive (exit 1, run again later), and
such a run can't become the baseline. Free tiers are small (Gemini 20 requests per day per model,
Groq 8,000 tokens a minute, Pollinations ~1 image per 20–40 s), so run it after the daily reset
(07:00Z) and not twice in a row (#418).

Baseline (2026-10-24, `8e21d29`, anthropic/claude-haiku-5.5 + openai/gpt-image-2.5-flare):
full batches 71%, 17/21 ads, first try 71%, judge copy
4.059 / image 3.765, invented claims 0%, $0.042 per run, p50 53 s / p90 79 s.
The Solaride factory goal in Hindi and Hinglish saved 1 of 3: `all-caps` and `offer-below-fold`.

`eval:creative` reads [fixtures.jsonl](../../evals/creative/fixtures.jsonl), uses the
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
[payment implementation receipt](../plans/payments-safety.md#9-implementation-receipt).

## Documentation Checks

```sh
npm run docs:check
npm run docs:check -- docs/team/testing.md
npm run docs:check -- --all --json
node --test scripts/check-docs.test.mjs
```

[The checker](../../scripts/check-docs.mjs) parses Markdown and fails current guides
on broken local links/anchors or source-line links, unclosed fences, invalid JSON
examples, missing `node scripts/...` files and unknown `npm run` names. Historical
records (`docs/qa/`, `docs/releases/`, dated history files) are checked only with
`--all`, as warnings. It also checks `AGENTS.md` and module READMEs under `src/`.

Structure rules (#1851) fail the check too: every handler in `src/app/api` has
exactly one route-inventory row (`| GET | \`/api/…\` |`) across the API pages, and
every row has a handler; every environment key appears in a configuration page;
current pages stay at most 300 lines; every folder under `docs/` has a `README.md`
that links each page and subfolder in it; new pages go in a subfolder
(`product`, `architecture`, `api`, `operations`, `team`, `plans`), not loose in `docs/`;
every page in `docs/plans/` states `**Status:** active` or `done` under its title;
and any `docs/….md` path named in `src/`, `scripts/`, `db/` (not applied migrations, which are immutable), `.github/`,
`AGENTS.md` or `.env.example` must exist.
In CI the `docs` job runs the checker and its tests; the required `test` check
fails when `docs` does (#1918), so a PR with a docs gap can't merge.
`--json` also lists migrations not mentioned in the data model guide; these are
review leads, not contract validation. `--root <worktree>` inspects another checkout. It does not
fetch external links, run snippets, load `.env` or validate route schemas.

When changing a route, environment field, migration, or lifecycle, update the
corresponding reference in the same change. Check API inventory against exported
handlers, configuration against `env.ts` plus direct environment reads, tables
against SQL, and commands against `package.json`. Parse JSON examples and validate
schema-bound examples against the actual imported schema when practical.

Check relative links/anchors and balanced code fences. Label dated experiments as
history, preserve external verification gaps, and never paste a recent test count
into a permanent product guarantee.
