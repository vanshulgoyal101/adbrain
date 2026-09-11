# Meta Instant Connect and Guided Activation

Status: partially implemented locally; customer journey and release acceptance remain incomplete.
Current assessment and next milestone: [verification verdict](meta-connect-workers/VERIFICATION-2026-09-07.md).
This document records the original specification, not a fresh implementation backlog.
Prepared: 2026-09-07. Baseline: AdBrain commit `d8d7890`.

Parallel execution package: [three-worker coordination guide](meta-connect-workers/README.md),
[frozen integration contracts](meta-connect-workers/CONTRACTS.md), and
[three copy-ready worker prompts](meta-connect-workers/PROMPTS.md).
Use the package to assign implementation; this document remains the product and
security specification. Neither document authorizes deployment or live mutations.

## 1. Decision and product goal

Make connecting a business feel like one continuous task: describe a goal,
connect Meta, review the discovered business identity, and prepare a campaign.
Use Polsia as an experience reference, not as evidence of its private architecture,
permissions, provisioning arrangements, conversion results, or implementation.

**Recommended first release:** Facebook Login for Business, automatic discovery,
safe single-candidate selection, a contextual connection dialog, encrypted
server-only credentials, and guided recovery. Ship account provisioning later,
behind a capability gate proven against AdBrain's actual Meta app and customers.

Automate mechanical choices, not authority, commercial consent, or spending.
One click starts authorization; Meta may still require login, consent, asset
selection, two-factor authentication, billing, or verification. Do not promise
universal one-click creation or immediate delivery.

### Scope boundaries

- Keep the current Next.js/React, Supabase, Meta adapter, audit log, shared UI,
  DM Sans theme, and canonical AdBrain mark. No new auth system or CRM rewrite.
- Treat `businesses.id` as the current workspace/brand boundary. It is distinct
  from a Meta business portfolio ID. Team memberships remain a separate project.
- Keep Google/email authentication. Meta business authorization does not itself
  create a Supabase session or safely identify an existing AdBrain user.
- Keep creative generation available before connecting Meta. Do not make Meta
  authorization an unnecessary prerequisite to trying the product.
- Connection completion returns to campaign review; it never activates an ad.
- Do not automatically put customers under AdBrain's own paying ad account,
  credit line, or shared system user. No invented universal "sub-account" API.
- No automatic purchase, payment-card collection, business verification bypass,
  or guarantee of ad approval. No paid provider calls in routine UI tests.

## 2. Verified starting point

| Existing surface | Observed behavior | Planned change |
| --- | --- | --- |
| [OAuth helpers](../src/lib/meta/oauth.ts) | Graph v21.0, signed timestamped state, short/long-lived exchanges; first-page-only account/Page discovery | Configured Login for Business adapter, replay-safe attempts, real grants, complete bounded pagination |
| [OAuth start](../src/app/api/meta/oauth/start/route.ts) | Requires AdBrain login and the primary business; redirects away | Explicit authorized business and return intent; popup with redirect fallback |
| [OAuth callback](../src/app/api/meta/oauth/callback/route.ts) | Checks user against signed state; saves raw token; records requested scopes; preserves old selections without revalidation; redirects to Settings | Claim attempt, verify token/grants, encrypt pending credentials, rediscover and atomically commit verified selection |
| [Selection endpoint](../src/app/api/meta/connect/route.ts) | Checks returned asset IDs but not the disabled flag or a verified Page/account relationship | Revalidate operation-specific capability and compatible pairs; reject stale decisions |
| [Credential resolver](../src/lib/meta/credentials.ts) | Incomplete/expired/missing row falls back to environment credentials; read errors become missing rows | Fail closed, explicit workspace binding, distinct unavailable and disconnected states |
| [Database schema](../db/schema.sql) | One plaintext credential per business; owner policy permits all operations on credential rows | Separate private encrypted credentials from safe connection metadata; server-only writes |
| [Connection UI](../src/components/meta-connection.tsx) | Settings-oriented account/Page dropdowns; technical server configuration language; internal runner | Shared contextual wizard plus compact connection summary; operational diagnostics excluded from customer UI |
| [Campaign creation](../src/app/api/campaigns/create/route.ts) | External form read precedes business validation; creative query lacks business filter; geography can silently fall back nationwide | Authorize and bind all inputs before external calls; explicit targeting; resumable paused creation |
| [Login](../src/components/login-form.tsx) | Google, magic link, password, development bypass | Preserve identity model; authenticated setup uses Connect Business |
| [Roadmap](ROADMAP.md) | App Review and guided onboarding remain planned | Tie this work to external readiness gates and the existing safety audit |

These are source observations, not proof of the live Meta app's approval status.
See [the product audit](PRODUCT-AUDIT-2026-09.md) for additional launch risks.

## 3. Meta feasibility and external gates

Official documentation was retrieved on 2026-09-07. Pin a supported Graph API
version after testing the app's approved capabilities; do not assume the current
v21.0 implementation or a documentation example is the right release version.

| Requirement | Evidence and limits | Decision |
| --- | --- | --- |
| Business authorization | Login for Business supports configurations specifying assets, permissions, and token type | Add server-configured configuration ID; verify manual authorization-code flow and redirect URI |
| Public customer access | Documentation requires appropriate Advanced Access/App Review for external businesses | Test with a non-app-role account; configuration presence is not production readiness |
| Persistent automation | Business integration system user tokens are documented for eligible Tech Providers and client business portfolios | Evaluate separately; do not silently substitute shared provider credentials |
| Mobile | Retrieved Login for Business troubleshooting lists limitations for business system user flows on mobile | Prove supported token configuration on Safari/Chrome mobile; retain supported redirect/user-token path |
| Ad-account creation | `POST /{business_id}/adaccount` is documented, with required commercial/configuration fields and eligibility failures | Conditional provisioning only, in the customer's selected portfolio |
| Missing business portfolio | No universal create-business entitlement was established for this app | Guide through official Meta setup or a verified eligible embedded experience; then rediscover |
| Billing | Account creation documentation says ads without funding can be created but receive no delivery | Billing readiness is separate; customer adds payment information on Meta |
| Token lifetime | Meta documents varying lifetime and early invalidation | Store actual expiry/data-access expiry and observed validation, never synthesize perpetual validity |

### Phase-zero evidence checklist

Record results in a dated implementation appendix before coding provider claims:

- Meta app type, owning portfolio, Live mode, Login for Business configuration,
  token type, allowed web origins/redirect URIs, and approved permissions/features.
- Appropriate access for `ads_management`, `ads_read`, Page discovery/advertising,
  lead retrieval, and `business_management`; verify least privilege for each phase.
  Lead permissions can be requested at the lead-campaign milestone if the approved
  configuration supports a progressive experience. Do not blindly request all scopes.
- Applicable business verification, Tech Provider, access tier, compliance and
  ongoing review requirements. These are not established by this planning task.
- Actual granted assets/tasks, client portfolio identity, pagination behavior,
  personal versus business-owned accounts, shared assets, and revoked grants.
- Whether business discovery/creation edges are permitted for this token type;
  creation limits, two-factor constraints, funding, currency and timezone fields.
- Privacy, deletion, deauthorization callbacks, data retention, support contact,
  app review recording, and verified ownership of the canonical callback domain.
- Confirm scopes/version in an isolated controlled test account. Creating a Meta
  account or spending money requires explicit test authorization, not an automated CI run.

No architecture should depend on the unresolved `adsvanz.app` hostname. Use the
configured, verified `https://adbrain.vanshul.com` origin for this release.

## 4. Customer journey and UI states

### Entry points

1. After an authenticated user names a new business, show **Connect Business**
   as the primary setup action with **Create a draft first** as a secondary option.
   Store a minimal real business record; do not invent brand facts from a Meta name.
2. At first **Prepare campaign**, open the connection dialog in place if needed.
   Preserve goal, selected creatives, targeting, budget, and route before OAuth.
3. At **Run campaign**, validate current connection and preflight; reconnect in
   context if necessary, then return to an explicit final spending confirmation.
4. Settings uses the same flow for Change business, Reconnect, and Disconnect.

For anonymous visitors, persist only a short-lived local draft and use existing
AdBrain sign-in before creating an owned connection attempt. A literal
**Continue with Meta** sign-in option is a separate optional milestone: configure
Supabase's supported Facebook identity provider and test account linking and
recovery first. Never mint a session from a Marketing API token, trust a supplied
user ID, merge users by email alone, or promise one consent screen for two grants.

### Dialog design

Desktop: a compact centered native dialog; mobile: a full-width sheet with safe
viewport bounds. Reuse the shell's native-dialog pattern and shared buttons.
Use one current decision per view, not nested cards or a settings page in a modal.

| State | Customer-facing presentation | Primary action |
| --- | --- | --- |
| Disconnected | "Connect your business to Meta" | Connect Business |
| Authorization started | "Continue in the Meta window" | Continue in this tab if popup blocked |
| Discovering | "Finding your business"; real indeterminate progress | Cancel / return to draft |
| One verified pair | "Connected to Meta" with Page name and account suffix | Continue to campaign review; Change |
| Several candidates | "Which business is this campaign for?"; named Page/portfolio options and account suffix/currency | Connect selected business |
| No eligible assets | Explain the specific missing Page, account, or access | Set up on Meta / Ask your business admin |
| Provisioning eligible | "Create an ad account for [Business]" with owner, currency, timezone, and funding responsibility | Explicit Create confirmation |
| Billing or verification needed | "Your business is linked. One more step before ads can run." | Open verified Meta destination |
| Expired/revoked | "Reconnect Meta to continue"; draft retained | Reconnect |
| Transient failure | "We couldn't finish checking Meta" | Retry check |
| Completed | Small checkmark transition; respect reduced motion | Return to review |

Display account name and last four digits by default; expose full IDs only in a
support/details view. Never render access tokens, app secrets, configuration IDs,
stack traces, raw provider errors, or internal traffic tools in customer setup.
Do not hide currency, ownership, payment responsibility, budget, or consequences
under the goal of removing jargon. "Connected" is not "eligible to deliver".

Focus is trapped, Escape cancels the local view, focus returns to the trigger,
status updates use `aria-live="polite"`, errors are announced, and success never
steals focus on a timer. Closing the dialog does not imply cancellation of an
external operation; show its persisted outcome when reopened.

### Popup and redirect reliability

- Open a same-origin placeholder synchronously in the user's click handler,
  before awaiting the POST that creates the attempt. Avoid a dependency on the
  Meta JS SDK unless the chosen approved flow actually requires it.
- Use an HttpOnly Secure SameSite=Lax browser-binding cookie and a one-use random
  OAuth state stored only as a hash. Bind attempt to user, business, intent and
  expiry. Separate tabs get distinct attempt IDs; callback replay fails.
- On callback, verify state and the current user before handling success or
  cancellation. Atomically claim the attempt before exchanging a code.
- Redirect to a same-origin completion page without code/token/state in the URL.
  Completion sends at most `{ type, attemptId }`; parent verifies exact origin,
  popup window identity, and attempt ID, then refetches trusted server status.
- `postMessage` is an optional wake-up hint, never proof of connection. Polling
  the owned attempt works if COOP/opener restrictions prevent messaging.
- Check actual CSP/COOP, browser privacy settings and popup behavior. Do not
  weaken site-wide isolation or allow wildcard message origins to make OAuth work.
- Popup blocked, closed, session expired, or mobile redirect: resume from a
  server-owned allowlisted return intent. Never accept an arbitrary return URL.
- No fire-and-forget work after a serverless response; persist the next step.

## 5. Architecture and state model

```mermaid
sequenceDiagram
    participant UI as Workspace dialog
    participant API as AdBrain server
    participant DB as Supabase private storage
    participant Meta as Meta authorization/API
    participant Worker as Durable executor
    UI->>API: Start connection (business ID, return intent)
    API->>API: Authenticate and authorize business
    API->>DB: Create expiring attempt and state hash
    API-->>UI: Attempt ID and authorization URL
    UI->>Meta: Consent in popup or same tab
    Meta->>API: OAuth callback
    API->>DB: Atomically claim validated attempt
    API->>Meta: Exchange code and validate grant
    API->>DB: Save encrypted pending credential and discovery work
    Worker->>Meta: Discover all accessible candidate assets
    Worker->>DB: Save verified candidates and decision
    UI->>API: Read attempt status
    alt Exactly one eligible, compatible pair
        Worker->>DB: Commit connection using generation check
    else Choice or external setup required
        API-->>UI: Minimal choice or specific recovery action
        UI->>API: Confirm choice / recheck after Meta setup
        API->>DB: Commit only after fresh validation
    end
    UI->>API: Request campaign preflight
    API-->>UI: Reviewable plan; no automatic activation
```

Use two independent state dimensions:

- Authorization: `disconnected | authorizing | discovering | selection_required |
  connected | reauth_required | revoked | failed`.
- Operation capabilities: `canReadInsights`, `canReadLeads`, `canCreatePaused`,
  `canActivate`, each `available | blocked | unknown` plus stable blocker codes
  and `checkedAt`. Unknown is not success.

Missing payment does not necessarily prevent paused creation; a disabled account,
missing Page permission, or invalid geography can. Evaluate the exact operation.
Account active status alone cannot prove future delivery or billing eligibility.

### Owning modules and contracts

Proposed additions, not existing exports:

| Module | Responsibility |
| --- | --- |
| `src/lib/meta/connection-service.ts` | Authorize attempt lifecycle and commit/reconnect/disconnect |
| `src/lib/meta/discovery.ts` | Versioned Graph discovery, pagination, deduplication, normalized candidates |
| `src/lib/meta/selection.ts` | Pure deterministic selection rules with evidence |
| `src/lib/meta/token-store.ts` | Server-only authenticated encryption and token lifecycle |
| `src/lib/meta/capabilities.ts` | Operation-specific blockers and freshness |
| `src/lib/meta/provisioning.ts` | Disabled-by-default eligible account creation adapter |
| `src/lib/meta/recovery.ts` | Stable error code to safe copy/action mapping |
| `src/components/meta-connect/` | Dialog, progress, candidate list, recovery, connected summary |
| `src/lib/campaign/preflight.ts` | Tenant-bound review of creative, Page/form, geography, currency, budget |

Keep existing OAuth/client helpers where suitable; do not add the Business SDK
merely for its name. It wraps the same permission-limited APIs. Prefer extending
the existing typed Graph adapter unless a verified SDK capability removes real work.

### Discovery and safe auto-selection

1. Validate the returned token belongs to AdBrain's app, expected subject/token
   configuration, and client portfolio where applicable. Read granted scopes and
   granular assets, not the list originally requested by the app.
2. Fetch accessible portfolios, accounts and Pages using the verified API/token
   configuration. Candidate edges to validate include `/me/businesses`,
   `/me/adaccounts`, `/me/accounts`, and portfolio-owned/client assets. Their
   availability differs by token class; do not hardcode one identity model.
3. Follow cursors with bounded requests, deadlines, retry/backoff and deduplication.
   Build requests against the configured Graph origin; never follow arbitrary
   provider-supplied paging URLs carrying secrets. A truncated/error result is
   `incomplete`, not an empty list and not grounds for auto-selection.
4. Normalize asset tasks, active/restricted status, ownership/shared relationship,
   Page identity, account currency/timezone, and operation capabilities. Exclude
   inaccessible assets but retain human-readable explanations for blocked choices.
5. Auto-link only if complete discovery yields exactly one eligible compatible
   account/Page pair within the intended business context, with sufficient
   delegated authority. One account plus one unrelated Page is not a verified pair.
6. Preserve a previous selection only after revalidating access. Never overwrite
   a different linked business during reconnect without explicit confirmation.
7. Multiple, ambiguous, or personal assets without relationship evidence require
   a concise confirmation. Name similarity may rank choices, never grant authority.
8. Show the chosen identity after auto-linking with a Change action. Store the
   selection reason and verification timestamp; recheck before external mutation.

## 6. Proposed data model and access controls

Keep one active connection per AdBrain business initially. A separate credential
row allows reconnect/discovery to finish without replacing the working token.
No cross-business shared credential optimization in the first release.

The following is **illustrative target DDL, not a runnable migration**. Migration
work must integrate grants, helper functions, triggers, generated types, and RLS
tests with the repository schema. All external Meta IDs are text, not JS numbers.

```sql
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.meta_tokens (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  authorized_by uuid not null references auth.users(id),
  subject_id text not null,
  token_kind text not null check (token_kind in ('user', 'business_system_user', 'page')),
  ciphertext bytea not null,
  nonce bytea not null check (octet_length(nonce) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  key_id text not null,
  granted_scopes text[] not null default '{}',
  granted_assets jsonb not null default '[]',
  expires_at timestamptz,
  data_access_expires_at timestamptz,
  validated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
alter table private.meta_tokens enable row level security;
revoke all on private.meta_tokens from public, anon, authenticated;

create table public.meta_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  token_id uuid,
  meta_business_id text,
  ad_account_id text,
  page_id text,
  account_name text,
  page_name text,
  currency text,
  timezone_name text,
  authorization_status text not null default 'disconnected',
  capabilities jsonb not null default '{}',
  selection_reason text,
  generation bigint not null default 0,
  last_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (business_id, token_id)
    references private.meta_tokens(business_id, id)
);
alter table public.meta_connections enable row level security;
revoke all on public.meta_connections from public, anon, authenticated;

create table private.meta_connection_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  token_id uuid,
  state_hash text not null unique,
  browser_binding_hash text not null,
  status text not null,
  intent jsonb not null,
  expected_generation bigint not null,
  discovered_assets jsonb,
  discovery_complete boolean not null default false,
  error_code text,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (business_id, token_id)
    references private.meta_tokens(business_id, id)
);
alter table private.meta_connection_attempts enable row level security;
revoke all on private.meta_connection_attempts from public, anon, authenticated;
```

Use safe server DTO endpoints for connection reads in v1; do not expose the
private schema through PostgREST. If authenticated direct metadata reads become
necessary, grant only safe columns and add an owner-select RLS policy. No client
write policy for connections. Explicitly secure sequences, functions, default
privileges and service-role/RPC access; RLS alone is not encryption or a grant.

Use a dedicated server DB role or narrow server-only transaction RPCs with fixed
search paths and explicit execute grants. Every service-role operation must
receive an already-authorized business context; bypassing RLS is not authorization.
Atomic RPCs must independently verify user/business ownership. Never add a generic
"decrypt token" RPC executable by authenticated users.

### Durable work and campaign binding

Add a server-only `meta_operations` table when introducing asynchronous discovery
or provisioning. Required fields: UUID, business ID, attempt ID where applicable,
operation kind, idempotency key, canonical request hash, connection generation,
status, phase, attempt count, next-attempt time, lease expiry, sanitized error code,
external IDs, timestamps. Unique `(business_id, kind, idempotency_key)`; same key
with a different request hash is a conflict. Composite FKs enforce tenant parity.

Never put decrypted tokens in job payloads. Store credential references and
revalidate access at execution. Transactionally persist the job/outbox with state
updates. Use leased claims and compare-and-swap transitions for multiple workers.

Campaigns must record the connection/account/Page identity used at creation.
Changing the workspace's default account must not route an existing campaign's
pause/delete/insights calls through a different account. If its original grant is
gone, expose a reconnect requirement for that campaign rather than using a new one.

Use a minimal server-owned draft/intent record for redirect resumption if session
drafts cannot survive the chosen browser path: owner, business, validated intent,
draft version, expiry. Store no provider credentials or arbitrary navigation URL.
Do not create a second full campaign model just for modal navigation.

### Encryption and lifecycle

- AES-256-GCM through Node crypto, a fresh cryptographic 12-byte nonce per write,
  authenticated additional data binding token ID, business ID and format version.
  Store key ID, nonce, tag, ciphertext; never persist the master key beside them.
- First deployment can use a secret-managed versioned 32-byte key ring available
  only to server functions/workers. A KMS-backed envelope can replace it later
  when operational needs justify it. Do not use the Meta app secret as this key.
- Validate key lengths at startup; fail closed on missing keys or decrypt errors.
  Encrypt before any DB write. Redact tokens, codes, OAuth state, and secret-bearing
  URLs from errors, telemetry, callback access logs and audit data.
- Query-based token exchange parameters, when required by Meta, must stay
  server-side and be redacted in tracing. Prefer authorization headers and
  appsecret_proof on supported Graph calls; never assume all endpoints accept POST.
- Rotation: write with new key ID, read old/new temporarily, re-encrypt in audited
  batches, verify counts/decryptability, retire old key after recovery window.
- Reauthorization creates a candidate token. Validate and atomically swap using
  expected generation; failed reconnect leaves the previous usable connection intact.
- Do not invent an OAuth refresh token. Use supported exchanges for the chosen
  token type; otherwise request reauthorization. Non-expiring does not mean irrevocable.
- Disconnect removes local authority immediately and fences pending jobs. Explain
  that disconnecting does not itself pause ads already running in Meta. Offer a
  separate explicit pause action before disconnect. Test provider revocation scope
  so revoking one workspace cannot unknowingly disconnect others under the same grant.
- Verify deauthorization/data-deletion signed requests, invalidate all affected
  subject/app grants, stop pending operations, and provide deletion confirmation.
  Retain only minimum audit evidence under the documented retention policy.
- Suggested operational TTLs: OAuth attempt 10 minutes, candidate snapshots 24
  hours, pending resume intents 7 days; review actual retention and cleanup cadence
  before release. Failed/expired attempts must not accumulate indefinitely.

### Migration sequence

1. Audit current credential grants without printing tokens. Back up with restricted
   access, and inventory all resolver consumers, cron jobs, seed scripts and APIs.
2. Create private encrypted storage, metadata tables, restricted grants and typed
   server services. Add database integration tests before any public wizard rollout.
3. Encrypt existing rows in bounded batches, preserving business mapping and actual
   token type/expiry. Do not mark legacy requested scopes as verified granted scopes.
4. Explicitly migrate any authorized single-tenant environment account to its named
   business. Never auto-assign it to other businesses or infer ownership by name.
5. Switch all readers/writers and jobs to the encrypted resolver. Deny browser
   access to the old table immediately during a coordinated cutover; no public
   plaintext compatibility endpoint or indefinite dual-write period.
6. Verify row counts, read/decrypt, tenant denial, reconnect, campaign binding and
   audit redaction; remove plaintext columns/table and obsolete policies. Backups
   and old logs follow a restricted expiration/remediation policy too.
7. Rollback disables the new UI/jobs while retaining the encrypted storage and
   fail-closed resolver. Never roll back to shared fallback or client-readable secrets.

## 7. API contract

Proposed routes use explicit business context. Existing endpoints can forward
temporarily after adopting the same authorization and response contracts.

| Route | Contract |
| --- | --- |
| `POST /api/meta/connections/start` | `{ businessId, intent }`; authenticate, owner-check, CSRF/origin-check, rate-limit; create attempt; return `{ attemptId, authorizationUrl }` |
| `GET /api/meta/oauth/callback` | Validate and claim attempt; exchange/validate/encrypt; persist discovery operation; redirect to clean completion page |
| `GET /api/meta/connections/attempts/[id]` | Owner and business-authorized redacted status/candidates; no-store |
| `POST /api/meta/connections/attempts/[id]/select` | Selected IDs and candidate revision; revalidate pair and atomically commit |
| `POST /api/meta/connections/attempts/[id]/retry` | Retry failed read/discovery only; no automatic create retry |
| `GET /api/meta/connections/status?businessId=...` | Explicit authorized metadata and operation capabilities |
| `POST /api/meta/connections/recheck` | Revalidate after external billing/setup; idempotent reads |
| `POST /api/meta/connections/disconnect` | Fence jobs, clear local authority, audited revocation policy |
| `POST /api/meta/provisioning/eligibility` | Validated context returns `api_create`, `meta_setup`, or `admin_required` |
| `POST /api/meta/provisioning` | Explicit consent, approved fields, idempotency key; eligible-only durable operation; HTTP 202 |
| `GET /api/meta/operations/[id]` | Owned operation state; no raw Graph response or tokens |
| `POST /api/campaigns/preflight` | Validate business/creative/form/account/geography/budget and return blockers plus review digest |

Use Zod schemas, request size limits, same-origin mutation protections, stable
application error codes, Retry-After where relevant, and correlation IDs. Reject
unknown ownership before any Graph call. Cookie authentication needs CSRF defenses;
RLS and OAuth state do not replace them on other mutation routes.

### Illustrative TypeScript contracts

These sketches express intended boundaries; helper names are proposed, not
implemented APIs or copy-paste-ready production code.

```ts
type ConnectIntent =
  | { kind: "setup" }
  | { kind: "prepare_campaign"; draftId: string; draftVersion: number }
  | { kind: "review_activation"; campaignId: string };

type ConnectView =
  | { state: "authorizing" | "discovering"; attemptId: string }
  | { state: "selection_required"; attemptId: string; revision: number; pairs: SafePair[] }
  | { state: "connected"; accountLabel: string; pageName: string; capabilities: Capabilities }
  | { state: "action_required"; code: RecoveryCode; action: RecoveryAction }
  | { state: "failed"; code: RecoveryCode; retryable: boolean };

function decideSelection(snapshot: VerifiedDiscovery): SelectionDecision {
  if (!snapshot.complete) return { kind: "retry_discovery" };
  const eligible = snapshot.pairs.filter(pair =>
    pair.relationshipVerified && pair.authorityVerified && pair.canLink,
  );
  if (snapshot.existingSelection) {
    const existing = eligible.find(pair => pair.id === snapshot.existingSelection);
    if (existing) return { kind: "keep_verified", pair: existing };
    return { kind: "confirm_replacement", pairs: eligible };
  }
  if (eligible.length === 1) return { kind: "auto_link", pair: eligible[0] };
  return eligible.length ? { kind: "choose", pairs: eligible } : { kind: "guided_setup" };
}
```

```tsx
async function beginConnect() {
  const popup = window.open("/connect/meta/waiting", "_blank", "popup,width=560,height=720");
  try {
    const result = await api.startConnection({ businessId, intent });
    setAttemptId(result.attemptId);
    setPhase("authorizing");
    if (popup) popup.location.replace(result.authorizationUrl);
    else window.location.assign(result.authorizationUrl);
  } catch (error) {
    popup?.close();
    setRecovery(toSafeRecovery(error));
  }
}
```

The final component needs an attempt-scoped effect that polls with AbortController,
backs off, stops on terminal state/unmount/deadline, and ignores responses from an
old business or attempt. Disable duplicate starts and preserve focus. Keep popup
references local; do not put tokens in React state, storage, URL, or messages.
The same-tab completion page loads the owned return intent from the server.

```ts
async function completeCallback(request: NextRequest) {
  const user = await requireUser(request);
  const attempt = await attempts.claimOnce({
    state: request.nextUrl.searchParams.get("state"),
    browserBinding: readSecureBinding(request),
    userId: user.id,
  });
  await requireBusinessOwner(user.id, attempt.businessId);
  if (request.nextUrl.searchParams.has("error")) {
    await attempts.markCancelled(attempt.id);
    return redirectToCleanCompletion(attempt.id);
  }
  const grant = await oauth.exchangeAndValidateCode(request, attempt);
  const encrypted = tokenStore.encrypt(grant, attempt.businessId);
  await repository.savePendingTokenAndDiscoveryOperation(attempt, encrypted, grant.safeMetadata);
  return redirectToCleanCompletion(attempt.id);
}
```

Exchange failures and process crashes must transition the claimed attempt to
recoverable failure; consumed codes are not reused. Atomic finalization verifies
attempt ownership, expiry, discovery revision, and connection generation. A user
disconnecting or choosing a different account while a worker runs fences its commit.

```ts
async function prepareCampaign(input: PrepareInput, user: AuthenticatedUser) {
  const business = await requireBusinessOwner(user.id, input.businessId);
  const creatives = await requireApprovedCreatives(business.id, input.creativeIds);
  const connection = await requireBusinessConnection(business.id);
  const review = await preflight.verify({ business, creatives, connection, input });
  if (!review.canCreatePaused) return { kind: "blocked", blockers: review.blockers };
  return operations.enqueuePausedCampaign({
    businessId: business.id,
    connectionGeneration: connection.generation,
    idempotencyKey: input.idempotencyKey,
    reviewedPlanHash: review.planHash,
  });
}
```

Final activation is a distinct authorized action with a fresh preflight and
explicit confirmation of account, currency, total budget, placements and area.
Reconnecting must never replay activation from a saved intent.

## 8. Provisioning fallback: staged, explicit, recoverable

### Decision tree

1. Eligible active account exists: connect it; do not create another.
2. Account exists but user lacks access: request access from its owner. Never
   interpret missing discovery permission as proof no account exists.
3. Customer portfolio exists and proven API creation capability is available:
   show inline review, then **Create ad account for [Business]**.
4. No portfolio, unsupported token/app capability, account limit, restricted
   business, or uncertain authority: use guided official Meta setup with **I've
   finished setup** / **Check again**. Preserve the AdBrain draft and session.
5. Missing Page, payment or verification: show the next specific step, not a
   generic "connection failed" or repeat account creation.

Creation form must confirm legal owning portfolio, account name, supported
currency, Meta timezone mapping, advertiser/agency/partner relationship, and who
pays. The retrieved endpoint requires `name`, `currency`, `timezone_id`,
`end_advertiser`, `media_agency`, and `partner`. Resolve and validate their allowed
values for the selected version; do not fill relationship fields with guessed IDs
or placeholder sentinels without an applicable documented reason.

The current app is INR-oriented. Initially connect non-INR accounts for supported
reads but block campaign budgeting/provisioning in unsupported currency with a
clear explanation. Do not relabel INR values as the account currency. General
multi-currency support requires an explicit additional implementation phase.

```ts
async function requestProvisioning(input: ProvisionInput, user: AuthenticatedUser) {
  const business = await requireBusinessOwner(user.id, input.businessId);
  const capability = await provisioning.checkCurrentEligibility(business, input.metaBusinessId);
  if (capability.kind !== "api_create") return capability.recovery;
  const plan = provisioning.validateConfirmedPlan(input, capability);
  return operations.createOnce({
    kind: "provision_account",
    businessId: business.id,
    idempotencyKey: input.idempotencyKey,
    requestHash: hashCanonicalPlan(plan),
    payload: plan,
  });
}
```

No Graph create snippet is presented as universally usable: endpoint eligibility
is a release gate, and the SDK cannot bypass it. Implement the provider POST only
after the controlled proof establishes permissions and required parameters.

### Idempotency and uncertain results

- Persist the operation before any external mutation and its returned ID promptly.
  Local uniqueness prevents repeat clicks but does not prove exactly-once Meta creation.
- On timeout after request transmission, mark `needs_reconciliation`; do not blindly
  retry creation. Rediscover and use a documented provider correlation mechanism
  if available; name matching alone cannot safely resolve duplicate ownership.
- If reconciliation remains ambiguous, keep an actionable support state rather
  than creating another account. Do not invent unsupported idempotency headers.
- Account creation is not necessarily reversibly deletable. Never promise rollback
  by deleting the new account; record the external object for manual recovery.
- Campaign creation similarly records each external object and its paused state;
  partial failures cannot be treated as no-op retries or silently orphaned assets.

### Execution infrastructure

Choose one maintained durable job runner only if measured request budgets require
it. Evaluate a managed HTTP queue/workflow integration against the current Vercel
plan, retries, authenticated delivery, transaction/outbox recovery, cost, and
data retention. Do not build a queue framework or assume paid infrastructure exists.
Fast discovery may run in a bounded request with persisted resumable stages.
Provisioning/campaign operations require durable recovery before general release.
The current Hobby daily cron cannot provide instant retry scheduling; keep its
existing contract or explicitly approve a different executor/plan. Browser polling
observes work and must not be the sole mechanism keeping it alive.

## 9. Recovery and customer-safe errors

Preserve structured provider code, subcode, transient classification and trace ID
only in redacted operational records. Customer messages come from a tested mapping,
not string matching or raw Graph text. HTTP status alone is not a Meta reason code.

| Condition | UI and action | Server behavior |
| --- | --- | --- |
| Consent declined | "Connection cancelled. Your draft is saved." / Try again | End attempt; no retry loop |
| Invalid/expired grant (e.g. code 190) | Reconnect Meta | Invalidate capabilities, prevent writes; retain draft |
| Missing permission | "Allow access to your Page to continue" | Request only missing authorized capability via approved flow |
| Asset not shared | "Ask your business admin for access" | Never broaden access or create a replacement account automatically |
| Two-factor required (creation docs: 415) | Complete security check on Meta | Stop mutation until revalidated |
| Business/account restricted or unverified | Review account on Meta | Show actual blocker only when verified; unknown remains unknown |
| No payment method / payment failure | Add or update payment on Meta | Distinguish paused creation from ability to run |
| Creation limit (3979) | Choose an existing account / contact Meta | No repeated create retries |
| Portfolio accounts in bad standing (3980) | Review business accounts | Do not evade restriction with new account |
| Rate limit/transient failure | "Meta is taking longer than usual" | Bounded jittered retry for reads; Retry-After and deadline |
| DB persistence failure | "We couldn't save the connection" | Never claim success; reconcile any external result |
| Discovery incomplete | "We couldn't check all your businesses" | No auto-link; retry or explicit supported selection |
| Unsupported currency | "Campaigns in this currency aren't supported yet" | Never charge using INR assumptions |

Action URLs come from a small server-side registry of current official Meta
destinations, verified during implementation; encode validated asset IDs, allowlist
hosts, and use safe external-link attributes. If a stable deep link is unavailable,
say "Open Meta settings" rather than inventing a one-click repair. Completing an
external action triggers recheck, not automatic success or activation.

## 10. Implementation sequence and exit gates

| Phase | Deliverables | Exit gate |
| --- | --- | --- |
| 0: Feasibility | Dated app capability matrix, token strategy, test identities, approved Graph version, provisioning decision | Supported public/mobile flow demonstrated; unsupported provisioning remains off |
| 1: Secure foundation | Private encrypted tokens, migration, restricted grants, fail-closed resolver, explicit authorized business context, one-use state | No browser credential access; tenant/replay/rotation tests pass; environment fallback removed |
| 2: Discovery service | Full pagination, real grants/tasks, compatible-pair rules, reauth staging, safe DTOs | Single/multiple/zero/partial/disabled/shared cases pass with deterministic outcomes |
| 3: Contextual UX | Shared modal, popup/redirect recovery, persisted intent, settings summary, first-run CTA | Desktop/mobile/keyboard checks; no lost drafts; no technical diagnostics exposed |
| 4: Campaign integration | JIT connection gate, preflight, campaign-account binding, total budgets, geography failure handling, durable paused creation | No external calls before authorization; no cross-brand creatives; no silent geographic expansion or duplicate external writes |
| 5: Guided fallback | Official Meta setup/billing/access actions, recheck, missing Page handling | Zero assets never dead-ends; honest connected-versus-ready states |
| 6: Conditional provisioning | Eligibility-flagged adapter, consent review, operation ledger, reconciliation | Controlled test proves supported account creation; denial/timeout paths safe; no automatic billing |
| 7: Rollout | Instrumented beta, support runbook, migration evidence, app review proof, staged enablement | Agreed success metrics improve with zero safety-invariant violations |

Phases 0 and App Review can proceed together. Phases 1-5 are the first product
release; phase 6 is not a prerequisite if Meta eligibility is unavailable. Estimate
after phase 0; approval lead times are external and should not be represented as
engineering completion dates.

### Existing files to update during implementation

- OAuth start/callback, accounts, connect and disconnect routes; `oauth.ts`,
  `credentials.ts`, `client.ts`, environment schema and server DB helpers.
- Database migration, consolidated schema, generated `Database` types, seed and
  demo workflows; credentials remain inaccessible through browser SDKs.
- `meta-connection.tsx`, workspace creation/brand setup, `campaigns.tsx`,
  `campaign-chat.tsx`, onboarding/work queue, Settings and relevant route loaders.
- Campaign create/plan/activation/refresh/sync/report paths and scheduled jobs:
  use the same authorized connection and operation-specific preflight services.
- Audit labels, redaction, deletion/deauthorization endpoints, monitoring and docs.

Do not leave the guided planner as a bypass around manual campaign review. Both
paths must submit the same validated, explicitly reviewed paused-creation plan.

## 11. Verification strategy

### Pure and component tests

- Extend existing `meta-oauth`, `meta-credentials`, `meta-client`,
  `meta-connection`, and `onboarding` tests; add selection/recovery/token-store tests.
- State tampering, future timestamps if retained, replay, two tabs, expired attempt,
  canceled consent, wrong user/business, CSRF, open redirect and popup-message spoofing.
- Encryption round trip, AAD tenant/row swap rejection, modified ciphertext/tag,
  invalid nonce, missing key, key rotation, no token data in logs or JSON responses.
- Complete pagination beyond 200 assets, provider limit, malformed responses,
  partial discovery, duplicate assets, account disabled, insufficient Page tasks,
  unrelated single pair, shared assets and stale existing selection.
- Selection/reconnect generation races; canceled attempt cannot overwrite a new
  selection; reconnect failure preserves the current valid connection.
- Every UI state, reduced motion, clear error recovery, draft retention, multi-line
  goals, narrow account labels and absence of technical secret terminology.

### Database and integration tests

- Real local/test Postgres policies using owner A, owner B, anonymous and authenticated
  roles. Assert all token-table reads/writes and unauthorized metadata writes denied.
- Same owner, different businesses: credentials, Pages/forms, creatives, attempts,
  campaigns and operation IDs cannot be crossed. Service-role workers enforce context.
- Atomic attempt claim, token swap and operation claims; lease expiry; disconnect
  racing a job; changed payload with same idempotency key; retry after external timeout.
- Migration counts, decryptability, old-table grants removed, no secret fields in
  view/RPC definitions or client bundles; legacy connection cannot silently fallback.

### Browser and controlled Meta validation

- Playwright fixtures for first business, returning owner, multiple portfolios,
  no account, no Page, missing grants, billing needed, stale grant, blocked popup,
  popup close, redirect, expired AdBrain session, browser back, reload and offline.
- 1440/1024/768/390 widths, native dialog focus/Escape, keyboard-only, iOS Safari
  and Android Chrome real OAuth smoke checks for the chosen configuration.
- API mocks intercept mutation and paid generation. Screenshots contain fixtures
  or private ignored test output, never customer data in committed public docs.
- Separate explicitly approved test-tenant OAuth smoke proves actual grants and
  supported discovery. Provisioning and activation have opt-in test authorization;
  routine CI never creates accounts or spends money.
- Required repository gates: lint, typecheck, coverage, build, existing
  Home-to-Review and workspace UX tests, updated public/brand checks if affected.
- Production: verify exact deployment commit, callback domain/headers, safe status
  DTO, read-only existing-connection behavior, and no plaintext/secret log leakage.

### Acceptance criteria

- Eligible one-pair users make no ad-account/Page dropdown choice and see the
  linked business identity; all ambiguity produces a deliberate minimal choice.
- No-assets users have a working setup/access route and can resume their draft.
- Connecting never loses or silently submits a campaign; activation always requires
  a fresh explicit spending confirmation.
- Connected status is committed only after durable persistence and required
  validation; read errors, partial discovery and unknown eligibility never mean ready.
- No external request occurs for an unauthorized business and no credential is
  reachable from a browser client or shared-fallback resolver.
- Repeated/replayed callbacks, duplicate clicks, worker retries and account switching
  cannot cross tenants, create unchecked duplicates, or change campaign account binding.
- Every recoverable failure offers an honest action; unsupported provider cases
  are visible and measurable rather than disguised as magical automation.

## 12. Measurement, rollout and rollback

Instrument a consent-aware funnel: eligible setup viewed, connect started,
authorization returned, discovery completed, auto-linked/selection required,
external setup required, preflight passed, paused campaign created, activation
confirmed. Track drop-off by blocker and entry point, not just OAuth success.

Measure user-active time separately from Meta wait time, p50/p95 discovery,
connection-to-review conversion, reconnect rate, wrong-selection corrections,
duplicate operations, support requests and provider cost. Do not invent a Polsia
conversion benchmark. Establish a baseline first, then agree target improvement.
Zero wrong-business writes, exposed credentials, and unapproved spend are hard gates,
not acceptable funnel tradeoffs. Exclude app-role QA traffic from product metrics.

Rollout flags: contextual UI, deterministic auto-selection, provisioning. Enforce
capability/feature flags server-side. Start with authorized internal test businesses,
then a small consented external cohort after App Review, then gradually broaden.
Do not run the plaintext path and new path in parallel to A/B security guarantees.

Rollback disables auto-selection/provisioning and returns to explicit selection
through the same secure services. Retain encrypted credentials and existing linked
campaign mappings. Stop queued mutations, surface uncertain external outcomes,
and preserve audit events. No rollback to client-readable tokens or shared credentials.

## 13. Open decisions before implementation

1. Actual Meta configuration and eligibility: User versus Business Integration
   System User flow; public access approvals; mobile constraints; provisioning proof.
2. Is Meta-as-AdBrain-sign-in needed in the first release, or is Connect Business
   immediately after existing sign-in sufficient? Recommended: the latter first.
3. Who owns/pays for created accounts? Recommended: customer portfolio/customer
   billing only; provider-managed agency arrangements need separate contracts.
4. Supported country/currency policy. Recommended: honest INR launch support first,
   no silent conversion or default nationwide targeting.
5. Durable executor and key custody under the existing hosting budget; measured
   volume before selecting a service. No new paid services authorized by this plan.
6. Retention, deletion semantics, support SLA and handling of live campaigns during
   disconnect/account switching; verify provider-wide revocation blast radius.

Start implementation with phase 0 evidence and phase 1 security tests, not a
cosmetic modal. This document is the planning deliverable; approval of a phase
starts coding, migration and deployment work separately.

## 14. Official references

Retrieved 2026-09-07; revalidate version-specific behavior during phase 0:

- [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/): configurations, grants, token classes, public access requirements and mobile caveats.
- [Business Manager API](https://developers.facebook.com/docs/marketing-api/businessmanager/): asset management and conditional account automation.
- [Business Adaccount creation](https://developers.facebook.com/docs/marketing-api/reference/business/adaccount/): create edge, required fields, funding limitation and documented error codes.
- [Access Tokens for Meta Technologies](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/): token classes, Page tasks, expiration and invalidation.
- [Manual login flow](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow): implementation reference to verify during phase 0; linked from retrieved Login for Business documentation.

No inspection of Polsia's private implementation, AdBrain's Meta App Dashboard,
production credentials, or real account provisioning was performed for this plan.