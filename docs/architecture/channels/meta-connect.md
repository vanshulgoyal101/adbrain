# Meta Connection and Publishing

Part of [Channels](README.md). Meta's App Review packet: [Meta App Review](meta-app-review.md).

AdBrain binds each local business to one selected Meta ad account and Facebook
Page. Application login and Meta authorization are separate. A Google login to
AdBrain does not grant access to Facebook assets, and matching email addresses
do not establish ownership. See [API Reference](../../api/README.md) for exact bodies.

## Prerequisites

- A real authenticated owner of the local business.
- Correct Meta app ID, secret, optional Login for Business configuration ID for
   the configured login flow, and exact callback URL `/api/meta/oauth/callback`
   on the configured site origin.
- Stable server-only token encryption key, service-role access, and applied
  connection/campaign migrations.
- Appropriate Meta roles, asset tasks, permissions, account state, and billing.
- Rollout permission: `enabled` allows users, `pilot` matches the configured user
  UUID, `disabled` denies, and unset permits only non-production. Unknown values
  fail closed. Read/pause/delete access to existing bound campaigns is treated
  separately from opening new publishing access.

Do not populate global `META_SYSTEM_USER_TOKEN`, `META_AD_ACCOUNT_ID`, or
`META_PAGE_ID` and assume a tenant is connected. Current publishing resolves the
business-bound encrypted credential. Public customer access also depends on Meta's
external review process; see [App Review](meta-app-review.md#app-review-156).

## Attempt Lifecycle

```mermaid
sequenceDiagram
  participant Browser
  participant App
  participant Meta
  participant DB
  Browser->>App: Start with business + intent
  App->>DB: Persist attempt, state hash, browser binding, expected generation
  App-->>Browser: Authorization URL + binding cookie
  Browser->>Meta: User consent
  Meta->>App: Callback code + signed state
  App->>DB: Claim owner/browser-bound attempt
  App->>Meta: Exchange and validate token, discover assets
  App->>DB: Store encrypted token and discovery result
  App-->>Browser: Resume attempt
   Browser->>App: Confirm selection when a choice or replacement is required
  App->>DB: Atomically commit selection against expected generation
  App-->>Browser: Connection DTO and independent capabilities
```

An attempt expires after ten minutes. Status is one of `authorizing`,
`discovering`, `selection_required`, `action_required`, `connected`, `cancelled`,
`expired`, or `failed`. Expiry is a validity boundary, not a promise that a worker
will finish the attempt. The browser binding is HttpOnly, SameSite=Lax and secure
in production; a copied callback URL is not a reusable connection grant.

The persisted intent is `setup`, `prepare_campaign` with draft/version, or
`review_activation` with campaign ID. It describes where to resume, not permission
to activate or spend on callback. Consent cancellation leaves the existing
business connection intact rather than guessing another asset pair.

Discovery follows bounded pagination; account and Page listing stop after at most
20 pages each. An incomplete discovery result cannot be treated as a complete list
for silent selection. Candidates and their pair IDs are server-issued; submitting
arbitrary account/Page IDs through the retired connect route is not supported.

After complete discovery, the selection policy retains an eligible existing pair
or automatically links the sole eligible pair. Multiple eligible pairs require a
choice; none leads to guided setup. Eligibility requires an active account,
verified account/Page relationship, supported currency, timezone and Page tasks.
Automatic linking still does not create or activate a campaign; replacement and
generation fences apply when committing the connection.

Selection uses the current attempt revision and explicit replacement confirmation.
An obsolete revision or changed business generation returns conflict. Reload the
attempt/status and review again; do not overwrite newer choices. Retry is for
retryable `failed`/`action_required` attempts with their current revision. Expired
attempts require a new authorization flow.

## Four Independent Capabilities

Each capability is `available`, `blocked`, or `unknown`, with structured blockers
and recovery actions. Unknown is not permission. Status is a stored snapshot;
recheck can refresh provider evidence but does not itself create a campaign.

| Capability | Current verification |
| --- | --- |
| `canReadInsights` | Successful insight probe and granted `ads_read` or `ads_management` |
| `canReadLeads` | Page-token form probe plus `leads_retrieval` and `pages_read_engagement` |
| `canCreatePaused` | Matching active account, INR currency, matching timezone, account and Page `ADVERTISE`/`MANAGE` tasks, `ads_management` and `pages_manage_ads` |
| `canActivate` | Create requirements plus verified funding-source ID |

The verifier uses bounded 15-second requests and settles probes independently.
Permission lookup failure leaves capabilities unknown. Its task lookup reads up
to 200 Pages in that probe; a large account can require investigation rather than
assuming absent evidence means the user has no Page. Meta permissions, Graph
version behavior, and account restrictions can change outside AdBrain.

Recovery actions are `reconnect`, `retry_check`, `choose_assets`, `contact_admin`,
`open_brand` (the Prepare website blocker links to Brand Brain), or `open_meta`
with a validated HTTPS destination. Account/billing changes happen
in Meta; the current workflow does not automatically provision accounts or forms.

## Token Security

[Token storage](../../../src/lib/meta/token-store.ts) uses AES-256-GCM, a fresh 12-byte
nonce and 16-byte tag. The base64 environment key must decode to 32 bytes.
Authenticated additional data binds ciphertext to `v1:tokenId:businessId`, so
moving it to another row/business cannot decrypt successfully. Key ID is currently
`meta-token-v1`; this is not an implemented multi-key rotation service.

Private token/attempt tables are accessed through narrowly granted RPCs. Browser
responses contain connection DTOs, never token material. Access checks reject
revoked, expired, or data-access-expired credentials and re-read the connection
before executing to detect concurrent changes. Keep keys out of logs and never
paste a token into a support ticket.

Changing the encryption key without migration makes existing ciphertext unreadable.
Plan an authorized decrypt/re-encrypt or owner reauthorization process; preserve
the old key in approved secret storage until rollback/recovery is complete.

## From Draft to Campaign

1. Save manual/guided intent. Incomplete drafts are allowed; saving does not
   create Meta objects. Drafts last seven days and edits increment version.
2. Resolve geography/interests and select approved, accessible creatives plus an
   active lead form. No implicit nationwide or WhatsApp-to-form substitution.
3. Request preflight for the exact draft/version. Review account/Page, form,
   audience, content, per-ad-set budget, ad-set count, and total daily budget.
4. Submit the review hash, connection generation, and a stable idempotency key.
   The server repeats preflight and rejects changed inputs before mutation.
5. Poll or look up the durable operation. It checkpoints external IDs and creates
   the local campaign only after the external sequence completes successfully.
6. Inspect the paused result. Activation is a separate confirmed action with a
   fresh capability/binding/spend check and confirmation digest.

For example, INR 300 per day with the two-ad-set option is INR 600 total per day,
not INR 300 shared. The option splits age bands; it is not a Meta Experiments
randomized A/B testing integration. Actual remote billing remains controlled by Meta.

Draft version, attempt revision, connection generation, review hash, activation
digest, and idempotency key are different controls. Never substitute one for
another or recompute server hashes in an integration. See [Architecture](../overview.md).

[Activation review and PATCH](../../../src/app/api/campaigns/[id]/route.ts) verify
stored child IDs, binding, generation, account/Page/budget and current Meta
campaign, ad-set and ad settings. A fresh delivery snapshot joins the
confirmation digest; changed, paused or unexpected children block #49 reservation
and the parent ACTIVE request. The route requests ACTIVE on the parent only,
checks intended children again, then mirrors a **requested** active state locally.
Effective delivery/eligibility is not certified. #49 reservation remains uncertain
when the parent request or post-request verification is ambiguous; reconcile
before retrying. Creation idempotency does not make activation atomic with Meta.
[Operations](../../operations/README.md) owns incident procedures and
[Release Policy](../../operations/releasing.md) owns authorization for live changes.

## Lead Import and Follow-Up

Import covers accessible instant-form enquiries on the selected Page, not WhatsApp
conversations, call logs or other Pages. The [sync route](../../../src/app/api/leads/sync/route.ts)
requires `read_leads` connection access and runs the resumable importer
`syncMetaLeads` in [lead sync](../../../src/lib/leads/sync.ts).

An empty POST resumes the newest unfinished run for the current binding or starts
a new one; `{"syncId":"11111111-1111-4111-8111-111111111111"}` resumes that run.
The POST reads Meta and writes local rows; it is not an offline diagnostic. The
response is `{leads,imported,failedForms,sync:{id,state,hasMore},error?}`.
`imported` counts new inserts in this request only; a repeated Meta lead ID is
ignored, so owner follow-up fields stay untouched. `state: "partial"` /
`hasMore: true` means saved continuation, not "up to date". `leads` is the newest
200 saved rows, not the whole inbox.

Each request makes at most 24 Graph page reads (forms and leads, 200 items per
page), reads up to three forms concurrently, and stops at a 40-second deadline.
Each page commits rows and progress together through `lead_sync_checkpoint`
(3-second timeout), so a later failure keeps earlier saves. A failed read or a
repeated/malformed cursor marks that form failed; it stays queued for the next run
while other forms proceed, and the response is 502 with `failedForms` and the saved
`sync.id`. Only opaque `after` cursors are stored; `paging.next` URLs are not
followed. Campaign attribution is not inferred from form names.

A foreign or unknown `syncId` returns 404. A changed binding/generation or a
concurrent writer returns 409; after reconnecting, an empty POST starts a fresh
run. Other checkpoint failures return 503; retry to resume. Keep the sync ID and
saved rows rather than clearing the inbox after a partial or uncertain result.

[Scheduled lead sync](../../../src/app/api/cron/sync-leads/route.ts) runs the same import
for every business with a connected account and Page, without a `syncId`. It
requires the `CRON_SECRET` bearer, allows 20 seconds per business within a
45-second run, and returns per-business outcomes (503 if any failed). Supabase
`pg_cron` calls it every 15 minutes (#274); the
[scheduled jobs workflow](../../../.github/workflows/scheduled-jobs.yml) is the backup.

The saved inbox (`GET /api/leads`) pages up to 100 enquiries with search, status,
contact and sort filters. `PATCH /api/leads/[id]` saves `workflow_status` (`new`,
`contacted`, `qualified`, `booked`, `closed`) and/or a `follow_up_note` of at most
2000 characters. See [API Reference](../../api/leads-and-settings.md#sync-insights-leads-and-settings).
The [lead sync migration](../../../db/migrations/20260926_lead_sync_progress.sql) adds
`lead_sync_runs`, `lead_sync_start` and `lead_sync_checkpoint`, granted only to the
service role; the [follow-up migration](../../../db/migrations/20260926_lead_follow_up.sql)
adds the follow-up columns and `get_lead_page`. Both are in the fresh schema.

## Managed Accounts (2-Tier, #518)

Behind `MANAGED_ACCOUNTS_ENABLED`. AdBrain provisions each customer a child business under
the AdBrain business portfolio (`META_PARENT_BUSINESS_ID`, no default; unset is `NOT_CONFIGURED`,
#2357), tracked in `managed_meta_accounts` (#519). The customer links a Page they administer
(#523). [`provisionManagedAccount`](../../../src/lib/meta/managed-provision.ts) (#521) then creates the
child business (`POST /{parent}/owned_businesses` with `shared_page_id`, `page_permitted_tasks`,
timezone 71, `vertical` from the Brand's category (solar `ENERGY_AND_UTILITIES`, IELTS
`EDUCATION`, interiors `PROFESSIONAL_SERVICES`, else `OTHER`) and `child_business_external_id` = the AdBrain business ID) and its INR ad account
(`POST /{child}/adaccount`, `end_advertiser` = the Page), then assigns the managing system user
to it (`POST /{act}/assigned_users`, MANAGE/ADVERTISE/ANALYZE, `business` = the child; checked
first with `GET /{act}/assigned_users?business=`). Every step reads before it creates: every
page of the parent's children by external ID (it stops if any child lacks one,
`CHILD_LOOKUP_UNVERIFIED`); the child's only ad account (several is `AD_ACCOUNT_AMBIGUOUS`); the
existing assignment. So a lost response never creates twice, and a failed grant retries only
the grant. Meta
errors become owner codes (`PAGE_ADMIN_REQUIRED`, `PAGE_IN_OTHER_BUSINESS`, `NOT_PERMITTED`,
`META_BUSY`, `META_TIMEOUT`) and leave the row `failed` to resume. Its tests use Meta's
documented shapes, marked provisional until App Review and Access Verification pass and real
responses are recorded.

Wiring (CTO decisions on #521): `POST /api/meta/managed/provision` runs it inside the business's
ledger lease (`managed_meta_account_claim`, database time), so two runs never both create. The
customer's own Facebook token (from their Connect attempt) creates the child; the parent system
user's token provisions; each child's **own system user** manages its ad account: minted with
`POST /{child}/access_token` (parent token), found with `GET /me` (child token), its token
encrypted into `private.meta_tokens` (kind `business_system_user`) and referenced from the ledger
by `manager_token_id` (same business only), then assigned to the ad account and the shared Page
(`ADVERTISE`, `ANALYZE`, `MESSAGING`: the tasks shared with the child) with its own token. It is
minted with `ads_management,business_management,pages_read_engagement,pages_manage_ads,pages_show_list,leads_retrieval`
because campaigns, sync, spend caps and the WhatsApp check run on it (#624); a token stored before
that scope (no `step_keys.manager_scope`) is minted again. An account already set up (`funded`,
`whatsapp_linked`, `ready`) can be repaired the same way (re-mint, grants) without changing its
state; a failed repair keeps the state and records `last_error`, so only set-up runs reach `failed`. One customer's token can't reach another's account. Every
provisioning Graph call carries `appsecret_proof` (HMAC-SHA256 of its token with `META_APP_SECRET`;
Meta rejects the child-token mint without it), so a missing secret is `NOT_CONFIGURED`. A token
the ledger no longer references (replaced, or saved before a failed update) is deleted.

**The customer's own card (#2357, #2359).** Each customer pays Meta with their own payment method
on their child ad account; AdBrain's card is never shared to it. Meta has no API to add a card, so
[`managed-billing`](../../../src/lib/meta/managed-billing.ts) (via `POST /api/managed/billing`) does
three things with the child's own token once the ad account and its grant exist: **invite**
(`POST /{child}/business_users`, `role=EMPLOYEE`, after reading `business_users` and
`pending_users` so a person is never invited twice; the email is validated before any call and
goes to Meta only, never into the ledger or logs; `step_keys.payer_invite` records that it ran);
**grant** each person who has joined the child `MANAGE` on its ad account (`MANAGE` includes
billing; `act_/assigned_users` has no billing-only task); and **read**
`GET /{act}?fields=account_status,funding_source_details`. The ledger moves
`ad_account_created → funded` (`funding_state=card_attached`) only when that read shows
`account_status=1` and a funding source whose `type` isn't 0 (UNSET) or 14 (FS_NULL), never on a
click. A prepaid `STORED_BALANCE` (20) stays not funded until a walk records its real shape (an
empty balance won't deliver); statuses 3/8 (payment due), 7 (risk review), 9 (grace period),
2 (disabled) and 100/101/202 (closed) each get a plain reason. An unaccepted invite reads as
"waiting for your person", not an error. If the Page's WhatsApp was recorded while the account
waited, it moves on to `whatsapp_linked`. Least privilege (EMPLOYEE + MANAGE), whether a child
made with `owned_businesses` accepts people, and the Billing deep link are confirmed on the
first internal child's walk; until then the screen says "Business Settings → Billing &
payments". The funding tests use Meta's documented shapes, provisional until that walk's tape.

## Recovery and Destructive Actions

| Situation | Safe action |
| --- | --- |
| Browser loses create response | Look up the original idempotency key/operation before retrying |
| `running` with a live lease | Poll; a conflicting create does not mean it failed |
| `needs_reconciliation` | Preserve all external IDs and inspect Meta/local state; do not issue a new-key create |
| Connection changed after review | Reopen the draft/review against the new generation |
| Campaign binding differs | Do not rewrite account/Page fields to bypass safety checks |
| Capability unknown | Recheck; investigate provider/permission evidence if persistent |
| Wrong account selected | Confirm intended replacement; existing campaigns retain their original binding |
| Disconnect requested | Confirm the business; existing remote campaigns are **not paused or deleted** |
| Meta deauthorization | Signed callback revokes matching subject credentials; owner must reauthorize |

Pause/delete are delivery-reducing operations, but still require original binding,
connection generation, and management permission. Manual mutation routes verify
remote binding. Do not assume the scheduled enforcement path performs every same
remote check; it relies on stored binding and current connection fences.

Deletion confirms the Meta operation before deleting the local mirror; external
success and local persistence are not a distributed transaction. Sync imports
supported ACTIVE/PAUSED campaigns page by page, reports skips, and does not prune
all local rows absent from a page. Use [Operations](../../operations/README.md) for incidents.
