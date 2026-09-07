# Integration Contracts v1

Status: proposed frozen coordination contract for these workers. Read alongside
[the parent plan](../META-INSTANT-CONNECT-PLAN.md) and [ownership rules](README.md).
This refines illustrative parent snippets, not the parent's security requirements.
Workers may not silently rename fields or create alternative success envelopes.

## 1. Common serialization

Use camelCase JSON, ISO-8601 UTC timestamps, UUID strings for AdBrain entities,
text for Meta identifiers, and account IDs normalized as `act_<digits>` at the
Graph adapter boundary. A display suffix is never an API identity. Versions are
nonnegative safe integers; reject overflow. JSON never includes undefined values.

Worker 1 owns the browser-safe `src/lib/meta/connect-contracts.ts`. It imports no
server-only module, Node crypto, environment reader, DB client or Meta token type.
Use strict Zod schemas plus inferred/exported TypeScript types for the following.

```ts
type ApiResult<Value> =
  | { ok: true; data: Value; requestId: string }
  | { ok: false; error: { code: ErrorCode; message: string; retryable: boolean }; requestId: string };

type ErrorCode =
  | "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT"
  | "CONFLICT" | "RATE_LIMITED" | "UNAVAILABLE" | "REAUTH_REQUIRED"
  | "ATTEMPT_EXPIRED" | "DISCOVERY_INCOMPLETE" | "MISSING_PERMISSION"
  | "ACCOUNT_RESTRICTED" | "BILLING_REQUIRED" | "UNSUPPORTED_CURRENCY"
  | "SETUP_REQUIRED" | "PREFLIGHT_BLOCKED" | "RECONCILIATION_REQUIRED";

type ConnectIntent =
  | { kind: "setup" }
  | { kind: "prepare_campaign"; draftId: string; draftVersion: number }
  | { kind: "review_activation"; campaignId: string };

type RecoveryAction =
  | { kind: "reconnect" | "retry_check" | "choose_assets" | "contact_admin" }
  | { kind: "open_meta"; url: string; label: string };

type Blocker = { code: ErrorCode; message: string; action: RecoveryAction | null };
type Capability = { state: "available" | "blocked" | "unknown"; blockers: Blocker[] };
type Capabilities = {
  canReadInsights: Capability;
  canReadLeads: Capability;
  canCreatePaused: Capability;
  canActivate: Capability;
};

type SelectedAssets = {
  metaBusinessId: string | null;
  adAccountId: string;
  accountName: string;
  pageId: string;
  pageName: string;
  currency: string;
  timezoneName: string;
};

type ConnectionDTO = {
  businessId: string;
  generation: number;
  authorization: "disconnected" | "connected" | "reauth_required" | "revoked";
  selected: SelectedAssets | null;
  capabilities: Capabilities;
  checkedAt: string | null;
};

type CandidateDTO = {
  pairId: string;
  assets: SelectedAssets;
  eligible: boolean;
  blockers: Blocker[];
};

type AttemptDTO = {
  attemptId: string;
  businessId: string;
  intent: ConnectIntent;
  expiresAt: string;
  revision: number;
  state: "authorizing" | "discovering" | "selection_required" | "action_required"
    | "connected" | "cancelled" | "expired" | "failed";
  discoveryComplete: boolean;
  candidates: CandidateDTO[];
  connection: ConnectionDTO | null;
  blockers: Blocker[];
  retryAfterMs: number | null;
};
```

Validation refinements: connected attempt requires a persisted connected DTO;
selection_required requires a complete discovery snapshot; retryAfterMs is bounded
positive or null; `available` has no blockers. Connection identity and attempt
business must agree. Metadata may be stale, so even available capability is not
an activation authorization. `open_meta.url` is server-allowlisted HTTPS; do not
accept it from a client-supplied object. Error messages are safe fixed copy.

ConnectionDTO describes committed state; AttemptDTO describes in-progress state.
A reconnecting user may have an authorizing attempt and a still-working committed
connection. Do not erase the latter to force both objects into one status enum.

## 2. HTTP surface owned by Worker 1

Every JSON result uses ApiResult. Status GETs require authorization and no-store.
Mutations require same-origin/CSRF checks and size/rate limits. Use 401 for missing
session, 404 for unavailable/unowned entity without enumeration, 400 invalid input,
409 stale revision/changed idempotency payload, 429 rate limit, 503 dependency down.
Do not return 200 with a fake connected result on a provider/DB error.

| Method and path | Request | Success data |
| --- | --- | --- |
| POST `/api/meta/connections/start` | `{businessId, intent}` | `{attemptId, authorizationUrl, expiresAt}` |
| GET `/api/meta/connections/status?businessId=...` | No body | ConnectionDTO |
| GET `/api/meta/connections/attempts/[id]` | No body | AttemptDTO |
| POST `/api/meta/connections/attempts/[id]/select` | `{pairId, revision, confirmReplacement: boolean}` | AttemptDTO |
| POST `/api/meta/connections/attempts/[id]/retry` | `{revision}` | AttemptDTO |
| POST `/api/meta/connections/recheck` | `{businessId, expectedGeneration}` | ConnectionDTO |
| POST `/api/meta/connections/disconnect` | `{businessId, expectedGeneration}` | ConnectionDTO with no selected assets |
| POST `/api/meta/provisioning/eligibility` | `{businessId, metaBusinessId}` | `{mode: "meta_setup" | "admin_required", blockers: Blocker[]}` in initial release |
| GET `/api/meta/oauth/callback` | Provider state/code or error | 303 clean completion page; no JSON token |

Provision creation is deliberately not in v1's usable surface. Its optional adapter
may be tested under an injected capability but the deployed route must deny creation
until a coordinator-approved v2 contract specifies verified fields and operations.
Do not show an enabled Create Account button merely because an env flag is true.

Callback redirects to `/connect/meta/complete?attemptId=<uuid>`; ID alone grants no
access. Waiting page is `/connect/meta/waiting`. Completion page/message contains
no OAuth code/state. Message hint: `{type: "adbrain.meta.complete", attemptId}`;
the parent checks same origin and actual popup reference and refetches status.
No-opener path uses status polling and a server-validated same-tab return.

`start` saves and validates intent before issuing state. Setup returns to the
existing setup/Settings destination chosen server-side. Prepare intent resolves
owned draft to campaign review; activation resolves owned campaign to review.
No request field accepts an arbitrary returnUrl. Distinguish AdBrain UUID from
Meta portfolio ID in validation, logs and labels.

## 3. Server connection interface owned by Worker 1

Publish `src/lib/meta/connection-access.ts`. It is server-only. Concrete
AuthorizedBusiness construction is private; callers cannot authorize by type cast.

```ts
type ConnectionPurpose = "read_insights" | "read_leads" | "create_paused" | "activate";
type Binding = { adAccountId: string; pageId: string };

declare function requireOwnedBusiness(businessId: string): Promise<AuthorizedBusiness>;
declare function getConnectionStatus(context: AuthorizedBusiness): Promise<ConnectionDTO>;
declare function withMetaConnection<Result>(
  context: AuthorizedBusiness,
  options: { purpose: ConnectionPurpose; binding?: Binding; expectedGeneration?: number },
  execute: (client: MetaClient, connection: ConnectionDTO) => Promise<Result>,
): Promise<Result>;
```

Worker 2 imports these; Worker 3 never does in client code. Worker 1 may keep
existing public resolver signatures temporarily for read compatibility, but they
must authorize/fail closed; they cannot remain a bypass for old campaign routes.
Errors are typed and mapped at route boundaries, not swallowed as null.

For Worker 3's completion server page, Worker 1 additionally exports
`getOwnedConnectionAttempt(attemptId: string): Promise<AttemptDTO>` from the same
server-only module. It authenticates internally and validates attempt owner,
business and expiry; there is no unauthenticated lookup by UUID. The completion
page may import it only from a server component and pass its safe DTO to client
UI. Start/complete must check Worker 2's owned draft or campaign reference before
resumption. If that schema is absent, setup intent may work but prepare/activation
intents return UNAVAILABLE; they cannot skip ownership validation.

C0 means real safe DTO schemas and agreed dependency signatures, not a requirement
to publish fake function bodies. Server implementation may arrive at C1. Until
then use injected test ports, keep dependent route integration pending, and report
the missing export precisely. The coordinator can distribute the small contract
files between isolated worktrees; workers do not independently cherry-pick or edit
another worker's copies. At C2, only the owning worker's module is integrated.

`binding` means operate on the campaign's original verified asset pair. It is not
permission to substitute a different workspace account or an arbitrary Page. If
the current grant cannot operate on that binding, fail with REAUTH_REQUIRED.
Generation mismatch fails CONFLICT. Check authority before fetching/decrypting
private token data and again at mutation lease/commit boundaries as appropriate.

Cron cannot call a session helper. Worker 1 also publishes a separate server-only
`requireScheduledBusiness(businessId, verifiedJobContext)` plus the same connection
executor. The verified job context is constructed by an authenticated scheduler
entrypoint, never a client body or public boolean. Document that trust boundary
and test forgery denial; no optional `skipAuth` parameter.

No shared Graph-client rewrite: Worker 1 uses its own discovery HTTP adapter and
the existing MetaClient constructor. Worker 2 alone changes campaign client methods
and must preserve existing exports or request a contract revision.

## 4. Campaign API owned by Worker 2

Publish browser-safe schemas in `src/lib/campaign/connect-contracts.ts`, importing
only safe connection contract types and existing safe targeting schemas/types.
Reuse the current creative ID, targeting and budget representation with strict
validation; do not invent a second targeting language or store an LLM transcript.

```ts
type DraftInput = {
  businessId: string;
  name: string;
  goal: string;
  mode: "manual" | "guided";
  creativeIds: string[];
  dailyBudgetRupees: number;
  leadFormId: string | null;
  targeting: TargetingInput;
  abTest: boolean;
};
type DraftDTO = {
  draftId: string;
  version: number;
  expiresAt: string;
  input: DraftInput;
};
type ReviewDTO = {
  draftId: string;
  draftVersion: number;
  connectionGeneration: number;
  canCreatePaused: boolean;
  blockers: Blocker[];
  planHash: string | null;
  currency: "INR";
  perAdSetDailyBudgetRupees: number;
  adSetCount: number;
  totalDailyBudgetRupees: number;
  resolvedAreaLabel: string | null;
  selected: SelectedAssets | null;
};
type OperationDTO = {
  operationId: string;
  businessId: string;
  state: "pending" | "running" | "succeeded" | "failed" | "needs_reconciliation";
  campaignId: string | null;
  blockers: Blocker[];
};
```

Incomplete drafts permit empty creatives, unselected form and zero budget while
editing; preparation rejects those values. Missing connection/unsupported currency
produces blocked review, not a fabricated INR account. Numeric fields are finite,
bounded, validated in integer minor units for money calculations, and displayed
in current rupee units. Reject other currencies for writes; never silently convert.

| Method and path | Request | Success data |
| --- | --- | --- |
| POST `/api/campaign-drafts` | DraftInput | DraftDTO |
| PUT `/api/campaign-drafts/[id]` | `{expectedVersion, input: DraftInput}` | DraftDTO |
| GET `/api/campaign-drafts/[id]` | No body | DraftDTO |
| POST `/api/campaigns/preflight` | `{businessId, draftId, draftVersion}` | ReviewDTO |
| POST `/api/campaigns/create` | `{businessId, draftId, draftVersion, planHash, connectionGeneration, idempotencyKey}` | OperationDTO; 202 while running, 200 replayed terminal outcome |
| GET `/api/campaigns/operations/[id]` | No body | OperationDTO |

Parent plan's generic Meta operation ledger is split into a Worker 1 connection
attempt ledger and a Worker 2 campaign operation ledger for v1. Do not have both
workers create a table or route named `meta_operations`. Optional provisioning
operations are reserved to Worker 1 for a later approved contract revision.

Guided `POST /api/campaigns/plan` becomes plan-only: validate proposed content and
save an owned DraftDTO, never create Meta objects. Worker 2 publishes exact retained
input fields after reading the current planner; Worker 3 consumes its DraftDTO.
If current request needs changing, record it at C0 rather than guessing on each side.

Activation retains the existing campaign PATCH route, adds an explicit reviewed
confirmation digest and connection generation, and executes fresh preflight.
Worker 2 publishes the exact PATCH schema at C0; Worker 3 must use that exported
schema. Pause, delete, refresh, sync and report retain existing shapes unless a
security defect requires an approved change. Active ads are never resumed because
OAuth succeeded. A stale review requires review again, not implicit acceptance.

## 5. Campaign persistence boundary

Worker 2 supplies a separate ordered migration for private draft and operation
tables and campaign binding columns. Worker 1 integrates it into schema/types;
Worker 2 owns SQL/RPC behavior and associated DB tests for these entities.

- Draft: id, business_id, owner_id, version, validated input JSON, expires_at,
  created_at, updated_at; private server access, ownership rechecked on every use.
- Campaign operation: id, business_id, draft_id/version, connection_generation,
  idempotency_key, request_hash, state, phase, lease_until, attempt_count,
  sanitized payload/result, external IDs, timestamps. Unique business+kind+key.
- Campaign binding: `meta_ad_account_id`, `meta_page_id`,
  `meta_connection_generation` on existing campaigns; old unknown mappings remain
  blocked for writes until proven. Never infer by current workspace default.
- Strict status constraints, indexes for owned reads and lease recovery, tenant
  consistency FKs/checks, revocation/expiry semantics, and restricted RPC grants.
- Worker 1 validates prepare intents through an owned, unexpired draft lookup;
  this is the explicit W1-to-W2 schema dependency. No shared draft copying.

Define three checkpoints on server attempts/operations: claim with expected
revision/generation, persist external outcome, commit result with fencing. A DB
transaction cannot roll back a Meta API mutation. Unknown outcomes go to
needs_reconciliation; exactly-once delivery is not asserted.

## 6. UI component boundary owned by Worker 3

`MetaConnectDialog` receives `businessId`, `intent`, `open`, `onClose`, and
`onConnected(connection: ConnectionDTO)`. onConnected is a notification to refetch
preflight and show review, never a callback that creates/activates a campaign.

Browser transport in `src/lib/meta-connect-ui/client.ts` takes optional fetch
injection for tests. Same-origin requests only; validate ApiResult on receipt;
propagate AbortSignal. Production default is real fetch with same-origin cookies,
never a fixture that claims success when the server fails.

Read contract fixture truth table:

| Fixture | Expected UI/consumer decision |
| --- | --- |
| disconnected + unknown capabilities | Connect; no create/run |
| discovering + incomplete | Progress/retry; no auto-select |
| selection_required + two eligible pairs | Explicit selection |
| connected + billing blocker for activation | Can review/create paused if separately allowed; cannot run |
| connected + all capabilities unknown | Recheck; no assumption of readiness |
| expired/cancelled attempt + valid old connection | Show attempt outcome, retain old connection summary |
| operation needs_reconciliation | Do not resubmit create; show support/recovery |
| reconnect complete after activation intent | Show review, zero automatic activation requests |

## 7. Change control and limits

This contract defines names and semantics, not verified provider eligibility.
Worker 1 cannot claim App Review or billing success from static configuration.
Each worker adds serialization/validation tests for producer and consumer fixtures.
At C0 the coordinator checks the exports agree before runtime integration.
If a required interface is missing, report a dependency, not a fabricated stub.