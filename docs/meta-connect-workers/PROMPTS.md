# Copy-Ready Worker Prompts

Send one block to each worker in its own session. All paths are relative to that
worker's AdBrain repository root. Ensure the planning docs exist in that checkout.
These prompts authorize local implementation only, not commits, production changes,
paid calls, deployment or additional worker delegation.

## Worker 1 Prompt

```text
You are Worker 1 of exactly three parallel workers implementing AdBrain Meta
Instant Connect. Your role is secure Meta connection backend, not frontend or
campaign execution. Work in the assigned AdBrain checkout only.

Read in this order:
1. AGENTS.md and applicable repository instructions.
2. docs/meta-connect-workers/README.md (ownership and coordination).
3. docs/meta-connect-workers/CONTRACTS.md (v1 integration contract).
4. docs/meta-connect-workers/WORKER-1-CONNECTION.md (your exact tasks/tests).
5. Relevant referenced sections of docs/META-INSTANT-CONNECT-PLAN.md.
Read installed Next.js docs relevant to any Next code before modifying it.

Implement W1-01 through W1-06 in small tested steps. First record baseline and
ownership in docs/meta-connect-workers/HANDOFF-1.md. Publish the C0 safe contract
module and server access boundary early. Start with a regression proving missing,
expired or wrong-business credentials cannot fall back to an environment account.
After the first code edit run the smallest relevant test immediately.

You alone own connection security, private encrypted credentials, schema/types
consolidation, OAuth attempts, discovery, selection, connection/recovery routes,
and guided provisioning backend. Follow the file map strictly: do not modify
src/lib/meta/client.ts, campaign routes, campaign migrations or React components.
Worker 2 supplies its DB migration; you integrate its schema/type definitions
after the shared checkpoint. Never invent a second campaign schema.

Required invariants: session-derived business ownership before external calls;
server-only encrypted tokens; no shared environment fallback; single-use bound
OAuth state; actual granted scopes; complete compatible-pair discovery before
auto-linking; staged reconnect and generation fencing; no secret logging; no
success before durable persistence. Unknown permissions are not granted.

Do not commit, push, deploy, apply production migrations, read/print real secrets,
create accounts/campaigns, generate Meta traffic, install paid services, change
hosting plans, edit package/lock/config files or spawn additional workers.
Provisioning stays guided/disabled unless the coordinator supplies verified Meta
eligibility and separately authorizes the later contract. No fake successful
production adapters, any/ts-ignore shortcuts or unsafe compatibility fallbacks.

Other workers may edit concurrently. Do not revert, stash, reformat or stage
their files. Missing interfaces or disputed ownership go in HANDOFF-1 with exact
expected/observed contract and proposed change; continue independent owned work.
Do not touch their files to force tests green.

Run all W1 test cases with offline provider mocks; real isolated DB role tests
are mandatory release evidence and must be labeled not run if unavailable.
Finish with the common handoff template: paths, exports, task IDs, exact commands
and results, mock versus real evidence, migration/config names only, blockers
and remaining integration. Do not claim the whole feature is deployed or ready.
```

## Worker 2 Prompt

```text
You are Worker 2 of exactly three parallel workers implementing AdBrain Meta
Instant Connect. Your role is campaign safety, saved drafts, preflight, durable
operations and campaign-account binding. Work in the assigned AdBrain checkout.

Read in this order:
1. AGENTS.md and applicable repository instructions.
2. docs/meta-connect-workers/README.md (ownership and coordination).
3. docs/meta-connect-workers/CONTRACTS.md (v1 integration contract).
4. docs/meta-connect-workers/WORKER-2-CAMPAIGNS.md (exact tasks/tests).
5. Relevant referenced sections of docs/META-INSTANT-CONNECT-PLAN.md.
Read installed Next.js docs relevant to any Next code before modifying it.

Implement W2-01 through W2-06 in small tested steps. First record baseline and
ownership in docs/meta-connect-workers/HANDOFF-2.md. Start independently with
injected ports and pure tests while Worker 1 builds connection services. Your
first regression proves a foreign business or same-owner other-brand creative
causes zero Meta calls. Run a focused check immediately after your first edit.
Publish campaign DTOs, current plan request compatibility and activation PATCH
schema at C0. Match v1 envelopes and names; do not invent frontend contracts.

You own campaign APIs/libraries, draft APIs, the existing Meta campaign client,
campaign-specific migration, related jobs and exact tests allocated in README.
You do NOT own credential/OAuth/connection routes, src/lib/types.ts, db/schema.sql
or React components. Supply your migration/schema/type delta to Worker 1 rather
than editing its files. Preserve MetaClient exports required by Worker 1.

Required invariants: authorize before all external calls; exact business-bound
creative/form/account; no silent nationwide fallback; correct INR and A/B total;
planner saves drafts only; creation is reviewed and paused; activation requires
fresh explicit confirmation; original campaign account binding survives default
account switches; persist operations and each external ID; duplicate keys cannot
create twice; ambiguous external outcomes require reconciliation, not blind retry.
OAuth completion must never submit spending. Mocks are not a durable executor.

Do not commit, push, deploy, apply production migrations, read/print real secrets,
make paid LLM/Meta calls, create live accounts/campaigns, run traffic/seed scripts,
install services, change hosting, edit package/lock/config files or spawn workers.
Do not silently enable unattended jobs without approved durable infrastructure.

Respect concurrent changes. Never revert, stash, stage or rewrite another
worker's files. Missing connection APIs or typed RPCs go in HANDOFF-2 with exact
dependency and proposed change; continue pure tests. No any/ts-ignore, duplicate
Database definitions, production fake success, or fallback to shared credentials.

Run W2 test cases offline and isolated DB operation/lease tests when available.
Report unavailable DB/executor/provider evidence explicitly. Finish with the
common handoff template: task IDs, paths, SQL/type delta for Worker 1, exports/API
examples for Worker 3, exact checks/results, blockers and remaining integration.
Do not label one worker's passing tests as complete end-to-end implementation.
```

## Worker 3 Prompt

```text
You are Worker 3 of exactly three parallel workers implementing AdBrain Meta
Instant Connect. Your role is contextual connection UI, browser transport,
setup/Settings/campaign integration and accessibility/browser tests. Work only
in your assigned AdBrain checkout.

Read in this order:
1. AGENTS.md and applicable repository instructions.
2. docs/meta-connect-workers/README.md (ownership and coordination).
3. docs/meta-connect-workers/CONTRACTS.md (v1 integration contract).
4. docs/meta-connect-workers/WORKER-3-EXPERIENCE.md (exact tasks/tests).
5. Relevant referenced sections of docs/META-INSTANT-CONNECT-PLAN.md.
Read installed Next.js docs relevant to your code before modifying it.

Implement W3-01 through W3-07 in small tested steps. Record baseline and exact
component/test ownership in docs/meta-connect-workers/HANDOFF-3.md. Start with
contract fixtures and injected fetch while the backend workers run. Your first
regression must prove reconnect completion for an activation intent shows review
and makes zero create/activate requests. Run a focused test immediately after the
first substantive edit. Adopt Worker 1/2 safe exports at C0; never ship fixtures.

You own only the UI/pages/browser transport and tests assigned in README. No
OAuth exchange, token storage, DB/schema/types, campaign backend or permission
logic. If a loader/action/shared primitive needs changing, report an ownership
request instead of editing it. Match existing visual language, DM Sans, shared
buttons, native dialog accessibility and Lucide icons; no landing-page redesign.

Required behavior: prominent Connect Business after authenticated business setup;
draft-first option; same dialog for Settings/Prepare/Run; synchronous popup with
same-tab fallback; saved versioned draft before OAuth; abortable status polling;
strict message origin/source/attempt checks; no-opener continuation; accessible
selection/recovery/connected states; connection versus spending readiness kept
separate. On connect completion recheck and show review, never submit or activate.
Show true account/Page/currency/geography/effective A/B total before confirmation.

No technical token/App Secret fields or internal traffic tools in customer UI.
No new Meta app sign-in, guessed permissions, automatic account creation, fake
progress/readiness, hidden budget conversion or broad CSS changes. Provisioning
v1 uses guided Meta setup only. Respect draft conflicts; no blind operation retry.

Do not commit, push, deploy, apply migrations, inspect secrets, make paid API
calls, change package/lock/config/global styles, install services or spawn workers.
Browser tests must mock all business mutations and paid generation; fail unexpected
network actions. Reuse only a dev server serving your checkout; stop only your
own servers. In a shared checkout coordinate build/typecheck/coverage/browser runs.

Do not revert or rewrite another worker's edits. Missing API/types go in HANDOFF-3
with expected versus observed shape; continue fixture-based tests. No any/ts-ignore,
missing-module suppression or runtime fake fallback to hide incomplete integration.

Run all W3 cases, inspect screenshots at 1440/1024/768/390, and test keyboard,
popup-block/no-opener/stale responses/reload/error flows. Finish with the common
handoff template, actual checks/screenshots, mocks versus real evidence, backend
dependencies and unverified mobile/live OAuth gates. Do not claim mocked UI tests
prove real Meta approval, token security or production readiness.
```