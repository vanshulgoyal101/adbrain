# Meta Connection API

Consent, account selection, managed accounts, disconnect and the WhatsApp webhook. Conventions: [API reference](README.md).

## Routes

`Envelope` means the typed family in [Response Families](README.md#response-families); `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| GET | `/api/meta/geo-search` | `q` -> `{results}` | Provider search |
| GET | `/api/meta/whatsapp` | `businessId` -> `{state: "ready", numbers: [{masked, source: "page" \| "business"}]} \| {state: "not_linked" \| "unavailable"}` | Owned business only; read-only Graph; numbers leave the server masked ("+91 ••••• 4842"); 20 per 5 min (#235) |
| POST | `/api/meta/connections/start` | Business/intent -> envelope authorization URL | New connection attempt/cookie |
| POST | `/api/meta/connections/change` | Business/intent -> envelope attempt (or 409 `REAUTH_REQUIRED`) | 'Change': lists the pairs the saved grant allows, no new Facebook login; commit via `select` |
| GET | `/api/meta/connections/status` | `businessId` -> envelope connection | Current binding/capabilities |
| GET | `/api/meta/connections/attempts/[id]` | Path ID -> envelope attempt | Poll owned attempt |
| POST | `/api/meta/connections/attempts/[id]/retry` | `revision` -> envelope attempt | Retry eligible failed discovery |
| GET | `/api/meta/managed/page` | `attemptId` -> envelope `{pages, createUrl, linked}` | #523 2-Tier: Pages the owner administers from that attempt's discovery; off unless `MANAGED_ACCOUNTS_ENABLED` |
| POST | `/api/meta/managed/page` | `{attemptId, pageId}` -> envelope `{state, pageId}` | #523: link an admin Page (`page_linked` in `managed_meta_accounts`); `PAGE_NOT_ADMIN` / `PAGE_LOCKED` / `PAGE_TAKEN` 409 |
| POST | `/api/meta/managed/provision` | `{attemptId}` -> envelope `{state, adAccountId}` | #521 2-Tier: create the caller's child business, INR ad account and its manager; owner-worded 409/503 codes; off unless `MANAGED_ACCOUNTS_ENABLED` |
| GET | `/api/managed/onboarding` | `businessId` -> envelope `{row, paid}` | #526 2-Tier onboarding progress (owner's `managed_meta_accounts` row; `paid` = captured payments net of refunds, unreadable counts as not paid); behind the managed-route gate (`managedRouteUser`, #625: managed accounts on for the user (404), signed in (401), Meta Connect open (403)). Polled every 5 s by `/onboarding` |
| POST | `/api/managed/whatsapp` | `{businessId}` -> envelope `{status: linked (masked) \| not_linked \| waiting_setup \| taken \| unavailable}` | #524 v1: reads the number linked to the customer's Page (the child's own token, #624, needs the child ad account), records `whatsapp_number_e164` (funded → `whatsapp_linked`), binds it `page_link` and unbinds the business's other `page_link` numbers; `unavailable` for failed/offboarding accounts; behind the managed-route gate (`managedRouteUser`, #625: managed accounts on for the user (404), signed in (401), Meta Connect open (403)) |
| POST | `/api/meta/connections/attempts/[id]/select` | Pair/revision/confirmation -> envelope result | Commit verified connection |
| POST | `/api/meta/connections/recheck` | Business/optional generation -> envelope connection | Live capability recheck |
| POST | `/api/meta/disconnect` | Explicit business, or legacy empty body -> `{ok:true}` | Disconnect stored binding, not running ads. First, best effort (#1649): `DELETE /{meta-user}/permissions` for a user token whose Meta user connects no other live business (never a system user or the smoke account); the outcome is a `meta.revoke` event and never blocks the disconnect |
| GET | `/api/meta/oauth/start` | Retired | 410; use contextual start |
| GET | `/api/meta/oauth/callback` | Provider callback | Signed/bound OAuth completion and redirect |
| GET | `/api/meta/accounts` | Owned `businessId` | Retired discovery, 410 after validation |
| POST | `/api/meta/connect` | Business/account/Page | Retired selection, 410 after validation |
| POST | `/api/meta/deauthorize` | Verified `signed_request` | Revoke subject's connections and file a deletion request for the privacy operator; returns Meta's `{url, confirmation_code}` (live status at `/data-deletion?code=`) |
| GET | `/api/whatsapp/webhook` | `hub.verify_token` = `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta's subscribe handshake for AdBrain's alerts number (#701); echoes `hub.challenge`, else 403 |
| POST | `/api/whatsapp/webhook` | `X-Hub-Signature-256` (HMAC with `META_APP_SECRET`) | #701: text messages to the alerts number. "START <10-hex code>" binds the sender's number to that business's alerts (`owner_alert_confirm`); "STOP"/"बंद" turns both off for that number (`owner_alert_stop`). Other messages are ignored; text is never logged. #1139: a `template_category_update` that moves a template out of UTILITY, or will within 24 h (`correct_category`), blocks it (`owner_alert_template_block`), so `owner_alert_claim` refuses it. 401 bad signature, 503 if not recorded (Meta retries) |

## Connection API

Detailed lifecycle: [Meta Connection](../architecture/channels/meta-connect.md). Start requires nonempty
`businessId` and `intent`: `{kind:"setup"}`, `{kind:"prepare_campaign",draftId,
draftVersion}`, or `{kind:"review_activation",campaignId}`. Draft/campaign IDs are
UUIDs and version is a nonnegative safe integer. Start returns
`{attemptId,authorizationUrl,expiresAt}` and an HttpOnly browser-binding cookie.
An explicit Origin must match the configured site origin.

Example setup input (authorization does not create or activate a campaign):

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "intent": { "kind": "setup" }
}
```

Poll attempt ID; select with `{pairId,revision,confirmReplacement?}`. `pairId` must
come from server candidates; revision must be a safe integer and current.
Replacement confirmation is honored only when exactly true. Retry accepts
`{revision}` for current `failed`/`action_required` attempts. Stale/ineligible
attempts return 409. Recheck accepts `{businessId,expectedGeneration?}` and returns
current connection or freshly verified capabilities; generation mismatch is 409.

Status DTO: `businessId`, `generation`, `authorization`, nullable `selected`,
`capabilities`, nullable `checkedAt`. Authorization: `disconnected`, `connected`,
`reauth_required`, `revoked`. Selected assets: `metaBusinessId` (nullable),
`adAccountId`, `accountName`, `pageId`, `pageName`, `currency`, `timezoneName`.
Each capability has `state: available|blocked|unknown` and blockers. Blockers have
`code,message,action` (Review blockers add `reason`); recovery actions include reconnect, retry check, choose
assets, contact admin, or an HTTPS Meta link. No tokens appear in these DTOs.

Disconnect accepts `{businessId: UUID}`. A truly empty body retains primary-business
compatibility. Any supplied malformed/invalid body returns 400 with no fallback.
It returns plain `{ok:true}`, not an envelope, and does not pause remote ads.

Deauthorization is a Meta callback, not session-authenticated owner JSON. It accepts
`signed_request` via form or JSON, verifies the signature, revokes the subject,
records a deletion request under the confirmation code (#730), and returns
`{url:<data-deletion-page>, confirmation_code}`. Invalid signature: 400; persistence: 503 (Meta retries).

Retired routes are not compatibility creation paths: OAuth start returns 410;
accounts requires an owned business before 410; connect validates nonempty
business/account/Page strings up to 128 characters before 410. OAuth callback
remains active for the contextual signed/bound flow.

### Managed Page (#523, 2-Tier)

Off (404 `NOT_ENABLED`) unless `MANAGED_ACCOUNTS_ENABLED`, except for internal accounts (#523: `managedAccountsEnabledFor`; the same gate covers `/onboarding`, `/api/managed/*` and provision). Signed-in, Meta-connect users only; the
`attemptId` must be the caller's own connection attempt (else 404). `GET` returns the Pages from
that attempt's discovery where the owner has Meta's `MANAGE` task (Meta requires Page admin for a
child business's `shared_page_id`), Meta's Page creator URL (Pages can't be created by API), and
the linked Page if any. `POST` links an admin Page: the business's `managed_meta_accounts` row
reaches `page_linked` and a `page` step is logged. Another Page can be chosen until the child
business exists (`PAGE_LOCKED` after); a Page another active business uses is `PAGE_TAKEN`
(#533 unique index). New rows start at `requested`, then move to `page_linked`. A Page created on Meta appears after the attempt's
discovery retry (`/api/meta/connections/attempts/[id]/retry`).

### Managed Provisioning (#521, 2-Tier)

`POST /api/meta/managed/provision` `{attemptId}`: same attempt checks as the Managed Page route
(the caller's own, unexpired attempt; business still theirs; flag on). Runs provisioning for that
business inside its ledger lease (`PROVISIONING_IN_PROGRESS` 409 while another run holds it) with
the attempt's own Facebook token. Owner-worded errors: 409 for what the owner must do
(`CUSTOMER_REAUTH_REQUIRED`, `PAGE_NOT_LINKED`, `PAGE_ADMIN_REQUIRED`, `PAGE_IN_OTHER_BUSINESS`, …),
503 for Meta being busy or the feature not configured. `maxDuration` 60 s.
