# API and Mutation Reference

This is the current application API, not a versioned public integration service.
Paths are relative to the configured app origin. Examples use synthetic IDs;
replace them only in an authorized isolated environment. Source: [route handlers](../src/app/api/),
[campaign schemas](../src/lib/campaign/connect-contracts.ts),
[connection schemas](../src/lib/meta/connect-contracts.ts).

## Product Analytics Ingestion

`POST /api/events` requires an authenticated same-origin session; identity and
business context come from the server. The strict payload always includes a known
workspace `page` and optionally `viewport` (`compact`, `medium`, `wide`). Existing
names `page.view`, `client.error` and `client.rejection` remain supported.
`ui.action` additionally requires an allowlisted `action`; `ui.tap` (#1242) carries only a
launch-path `page` (`/create`, `/studio`, `/campaigns`); `page.engagement`
requires integer `durationMs` between 1000 and 3600000. Unknown fields, arbitrary
labels and client identity overrides are rejected. No request/field content is
captured. DNT/GPC, 2 KiB body limits, rate limiting and 204 responses are preserved.
Action intent is not authoritative success. See [collection and retention](OBSERVABILITY.md)
for the fixed action catalog, privacy controls and operator-only analytics queries.

## Conventions

- Workspace endpoints normally require the Supabase session cookie and enforce
  business ownership. There is no general application API-key authentication.
- `id` in a URL is usually an **AdBrain database ID**, not a Meta ID. Provider IDs
  remain strings. `businessId` is the application UUID; ad account IDs use `act_`.
- JSON requests use `Content-Type: application/json`. Do not stringify numbers or
  booleans; query strings are parsed separately. Strict schemas reject unknown
  fields where noted. Not every older route uses a strict schema.
- Money is whole INR rupees at the application boundary unless specified. Budget
  estimates are not invoices or guaranteed spend.
- HTTP 200 alone does not prove a business operation completed. Inspect `ready`,
  blockers, partial failures, and operation state.
- Retain request IDs for diagnosis, never tokens/cookies or sensitive bodies.
  Instrumented routes expose `X-Request-Id` where the response is mutable.

### Response Families

Connection, draft, preflight, and creation-operation APIs use a typed envelope:

```json
{
  "ok": false,
  "error": {
    "code": "CONFLICT",
    "message": "Draft changed in another tab. Reload before saving.",
    "retryable": true
  },
  "requestId": "00000000-0000-4000-8000-000000000001"
}
```

Success is `{ "ok": true, "data": <documented value>, "requestId": <UUID> }`.
Older APIs use plain objects, often `{error: string}` on failure. ZIP/Markdown
routes return files. Events can return an empty body. Do not apply one parser to
every endpoint. A `retryable` error can still require re-reading state before retry.

Common statuses: 400 invalid/blocked input, 401 unauthenticated, 403 forbidden,
404 unavailable owner-scoped resource, 409 stale/recovery conflict, 410 retired,
422 semantic input rejection, 429 quota/rate limit, 502 provider failure, 503
dependency unavailable. Exact mapping is route-specific; some legacy ownership
failures use 400. A 404 does not reveal another tenant's existence.

### Recovery Identities

| Value | Scope and correct recovery |
| --- | --- |
| Generation UUID | Claims one generation request; GET it before considering another paid POST |
| Draft ID/version | Versioned saved input; reload on conflict, save, then review again |
| `planHash` | Server review of current inputs, creatives and verified binding; never synthesize it |
| Connection generation | Invalidates stale binding-dependent work after the connection changes |
| Attempt revision | Optimistic concurrency for one consent/discovery attempt, not a campaign version |
| Creation `idempotencyKey` | Durable operation identity; keep it across ambiguous create responses |
| Activation digest | Confirms current activation inputs; not a creation key or spend reservation |
| Lead `syncId` | Resumes one lead import run under the same connection binding |
| Payment `idempotencyKey` | Reuse for the same live or test order after an unknown create result |
| Cursor | Continues only its own list or provider scan; campaign list, Meta discovery and enquiry cursors are not interchangeable |

A mutation timeout is ambiguous. Inspect persisted/provider evidence using the
same identity; do not change a key or clear local recovery data to force progress.

## Route Inventory

`Envelope` means the typed family above; `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| POST | `/api/brand/autofill` | `{url}` or (#1317) `{text}`: an Instagram bio, Google listing or catalogue text pasted by hand (30+ letters, ≤ 6000 chars; nothing fetched, phone read from the text). URL -> plain extraction; `name` (#1379) comes from the page's `og:site_name`/title or the text's first words, never the model | Website fetch + model call, no brand save |
| POST | `/api/creatives/assistant` | Interview -> question/brief | Model call |
| POST | `/api/creatives/generate` | Generation input -> saved variants/failures | Paid work + Storage/DB |
| GET | `/api/creatives/generate` | Business/group/count -> saved status | DB lookup/unknown-ID fence, no generation |
| POST | `/api/creatives/[id]/regenerate` | No body -> `{creative}` | Paid work, overwrite, reset approval |
| POST | `/api/creatives/[id]/picture` | `{headline,subhead,phone,ctaLabel,showCta?}` -> `{creative,liveNotice?}` | Re-renders the overlay, no AI; new `image_url`, status kept. `showCta` paints the button on the picture (off for new ads, #760); omitted keeps it as is |
| POST | `/api/creatives/[id]/background` | `{instruction}` (3-300) or `{photoUrl}` -> `{creative,liveNotice?}` | Paid image (like Regenerate) or the owner's Brand photo (free), same claim; keeps copy, overlay words and status |
| POST | `/api/creatives/export` | IDs -> ZIP; a sales prospect's account (internal `+prospect` address, #1317) gets every picture with a 'Sample: not live' band and a SAMPLE note atop copy.txt, which ends with the WhatsApp follow-up and `/for/<segment>` link when the Brand category is solar, IELTS/study-abroad or interiors (#1582); a picture that can't be marked is left out (`X-Images-Skipped`) | Downloads selected media |
| GET | `/api/campaign-drafts` | `businessId` -> envelope draft array | Owner-scoped read |
| POST | `/api/campaign-drafts` | DraftInput -> envelope draft | DB write, no model or Meta creation |
| GET | `/api/campaign-drafts/[id]` | Path ID -> envelope draft | Read |
| PUT | `/api/campaign-drafts/[id]` | Version + input -> envelope draft | Versioned write |
| DELETE | `/api/campaign-drafts/[id]` | `version` query -> envelope `{deleted:true}` | Retention-aware delete |
| POST | `/api/campaigns/plan` | Goal/answers/optional audience draft -> plain result | Model; can save a draft |
| POST | `/api/campaigns/preflight` | Draft ID/version/business -> envelope review | Provider verification, no campaign creation |
| POST | `/api/campaigns/create` | Reviewed identifiers -> envelope operation | Worker mode enqueues (202); inline mode creates paused remote objects |
| GET | `/api/campaigns/list` | `businessId`, optional opaque `cursor`, `query` (max 200), `status` -> `{campaigns,results,nextCursor}` | Owner-scoped, at most 50 rows; latest stored result per returned campaign |
| GET | `/api/campaigns/operations` | Business/key -> envelope operation or null | Recovery read; can expire stale leases |
| GET | `/api/campaigns/operations/[id]` | Path ID -> envelope operation | Recovery read; can expire stale leases |
| GET | `/api/campaigns/[id]` | Path ID -> `{delivery,funding?,learning,keptPaused?}` | Owner-scoped, uncached Meta campaign/ad-set/ad review; no spend reservation or mutation. `learning` (`costPerResultRupees`, `pausedAt`, either null) feeds the learning-restart notes (#419) and is not part of the digest. `keptPaused`: ids of the ads the owner paused from the card (#1055); turning the campaign on leaves them paused (an uncapped resume doesn't require them ACTIVE, before or after the write; a capped resume copies only the other originals, via Meta's `source_ad_id`; refused if every ad is paused) |
| PATCH | `/api/campaigns/[id]` | Pause/activation input -> `{ok,status,delivery,pause}` | Live Meta mutation (pause: campaign, ad sets and ads) + local mirror; activation uses customer reservation. Turning on answers **409** `code: switch_pending` while a new-audience copy waits, before any Meta write or reservation (#1518); pausing is never refused |
| POST | `/api/campaigns/[id]/audience` | `{change:{location?,excludedLocation?,age?,gender?,languages?,areaExclusions?},preview?,copy?,idempotencyKey}` -> `{ok,preview}` or `{ok,result:{adSets,count,consequence,awaitingSwitch?,replay}}`; **409** `code: needs_copy` for a running campaign whose ad sets need a rebuild, sent without `copy` ("Meta doesn't allow this change on a running campaign. We'll make a fresh copy…"), **409** `code: switch_pending` while a copy waits or a paused one with a live ad set ("Part of this campaign is still running…"), **429** `retryable` on Meta's 30 s limit (#773) | Paused or running campaigns (#765: a running ad set is patched in place when Meta allows it, and learning restarts; a running WhatsApp or interest ad set gets a PAUSED copy with `copy: true`, preview reports it as mode `copy`, the old one keeps running and the row waits as `awaiting_switch` with `awaitingSwitch:{operationId,pending}`; the mirror moves only at the switch). Reads the tree from Meta, edits every ad set (patch, or rebuild when it has interests or is a WhatsApp ad set, #912; `preview` runs `validate_only` on rebuilds), mirrors the new ids after Meta confirms; envelope row in `campaign_edit_operations`, replay by key returns the stored result; exclusions only grow. `languages` are Meta ad locale keys from `src/lib/meta/locales.ts` (`[]` removes the limit). `areaExclusions: true` adds #741's out-of-area exclusions for each ad set's current area (a campaign built before #741, which activation refuses; ad sets that already have them are left alone, **409** when none lacks them or for a country-wide area; not with `location`). UI: a paused or running AdBrain campaign's More menu → Edit audience (`edit-audience-dialog.tsx`): check with Meta, read the consequence, save with the same key |
| POST | `/api/campaigns/[id]/audience/switch` | `{operationId,action:"switch"\|"cancel"}` -> `{ok,result:{action,adSets:[{adSetId,previousAdSetId}],replay}}`; **409** `retryable` when Meta refused and the old ad set runs again, **404** for another campaign's operation | #765 (b). `switch` (activate purpose on a running campaign): validate_only activation of the copy → pause the old ad set → the copy takes the old one's budget as it is now (a capped copy what is left of its total, an uncapped one its daily budget, and its end date, #1146) → copy's ads (except ones paused from the card, which stay PAUSED and keep their pause under the new id, #1146) and ad set ACTIVE → both read back → old archived; never two ACTIVE; then the mirror moves to the copy. On a paused campaign the copy just takes the old one's place. A failure that couldn't resume the old ad set is `needs_reconciliation`. `cancel` (delete purpose) deletes only the copy; the row becomes `cancelled`. UI: the card's 'New audience ready' strip (`audience-switch-strip.tsx`); other edits are hidden while it waits |
| POST | `/api/campaigns/[id]/budget` | `{change:{dailyRupees?,capRupees?,endTime?},preview?,idempotencyKey,confirmationDigest?}` -> `{ok,preview:{before,after,needsConfirmation,confirmationDigest,notices}}` or `{ok,result:{before,after,notices,replay}}`; **409** `"Confirm the new amount first…"` for a raise above what the owner approved (a higher daily or cap, or a capped run whose pace, cap − spent over the days left, goes above both the approved and today's pace) without the preview's digest, **409** for a running campaign's daily change ("Pause the campaign to change its daily budget…": its AdBrain reservation holds the daily amount; resuming re-reserves and checks the weekly limit), **422** for a money-rule refusal (#833/#867: funding room, which for a cap raise is the room left after the account's other live capped runs' `budget_remaining`, the edited ad set left out, and names them and any uncapped daily spend, #1094; a running capped run's faster pace past the weekly limit, cap at or below spend, no cap on an uncapped run, daily budget on a capped run, managed cap raise), **429** `retryable` on Meta's 30 s limit (#774), **409** while a new audience waits to be switched on or cancelled (#1146) | Running or paused AdBrain campaigns. Reads the budgets from Meta; a capped run (#157) changes its lifetime ad set's `lifetime_budget`/`end_time`, an uncapped one its daily ad sets' `daily_budget` (split evenly, paused only) and `end_time`. `preview` runs the money rules and Meta's `validate_only`; Meta counts that in its 30 s per-ad-set limit, so save at least 30 s later. Save writes in place, reads back, then mirrors `daily_budget` or `raw.cap` (re-read) only after Meta confirms; envelope row (kind `budget`) in `campaign_edit_operations`, replay by key, audit `campaign.edit` with before/after. Raising spend on a running campaign needs Meta's activation access |
| PATCH | `/api/campaigns/[id]/ads/[adId]` | `{change:{headline?,message?,description?},idempotencyKey}` -> `{ok,result:{adId,previousCreativeId,creativeId,consequence,replay}}`; **422** for a claim the Brand doesn't support (same checks as Studio copy) or Meta's refusal, **404** for an ad outside the campaign, **429** `retryable` on Meta's 30 s ad-edit limit (#775), **409** while a new audience waits to be switched on or cancelled (#1146) | Paused or running campaigns. Makes a new creative from the one Meta stores (images, 9:16 rules kept), `validate_only` first, swaps it onto the ad and reads it back; the old creative stays for rollback. The ad goes back to Meta review. Envelope row (`kind: ad_creative`) in `campaign_edit_operations`: `transmitted` turns true only before the first real write; a failed swap after the creative exists is `needs_reconciliation` with `result.new_creative_id`; mirror `raw.adCreatives[adId]` and the changed words into `raw.adWords[adId]` (the editor opens on them) after Meta confirms |
| DELETE | `/api/campaigns/[id]` | No body -> `{ok,metaDeleted}` | Live deletion then local deletion; a duplicate of another business's Meta campaign (#1138) is removed locally only (`metaDeleted:false`) |
| POST | `/api/campaigns/[id]/refresh` | No body -> insights/result/summary/review/autoPaused/protectionConfirmed; `?ifStale=1` (#1003, the card and Home opening) -> `{result,fresh:true}` from the stored row with no Meta call while the newest result is ≤ 10 min old; **410** `{error,gone:"DELETED"\|"ARCHIVED",campaign}` when Meta deleted or archived it (the row becomes `completed` with `raw.metaStatus`, #721; the card says "Deleted/Archived in Meta" on every page, Home leaves it out and Campaigns folds it under "Deleted (n)" from the next visit, #1150) | Provider read, DB write, possible auto-pause; with `AD_RESULTS_ENABLED` also stores per-ad results (best effort, #783) |
| GET | `/api/campaigns/[id]/ads` | No body -> `{ok,syncedAt,ads:[{adId,name,delivered,replaced,best,creative,earlier,status,impressions,results,spend,costPerResult}]}` (results = chats for WhatsApp, enquiries otherwise; `best` only at ≥ 5 results and ≥ 30% cheaper than the next ad; archived ads are `replaced`, never best; `status` is Meta's effective status at the last refresh; `creative` is `{headline,imageUrl}` of the AdBrain creative the ad was launched from, by the campaign's stored launch layout, or null for an ad it can't link; `earlier` marks an ad outside a capped run's latest ad set, and such an ad that never delivered is left out); **404** while `AD_RESULTS_ENABLED` is off (#783) | RLS read of `campaigns`, `ad_results` and `creatives`; no Meta call |
| GET | `/api/campaigns/[id]/rerun` | No body -> `{ok,prefill:{name,goal,creativeIds,dailyBudgetRupees,destination?,leadFormId,whatsappNumber?,whatsappLanguage?,whatsappMessage?,targeting?,abTest,dropped,source}}`; **409** when none of its ads is still approved; **404** for a campaign outside the business (#1050) | "Run this again": the New campaign prefill copied from the campaign's launch draft (its succeeded `campaign_operations` row), else from the campaign row (`source: campaign`, no targeting). Only approved ads, the Best ad's creative first (via `campaign_ads`, when `AD_RESULTS_ENABLED`). RLS reads only; no Meta call, nothing created |
| POST | `/api/campaigns/[id]/ads/[adId]/status` | `{action:"pause"|"undo", reason?}` -> `{ok,result:{adId,status,effectiveStatus}}`. #1045: pauses one ad of a running campaign from the card, or undoes AdBrain's own pause (**409** for an ad AdBrain didn't pause); the ad must be the campaign's (launched or in its stored results) and Meta must read back the new status; recorded in `campaigns.raw.adPauses` and the #588 ledger; **404** while `AD_RESULTS_ENABLED` is off; **409** while a new audience waits to be switched on or cancelled (#1146) | Meta: verify binding, read the ad (campaign_id), write that ad's status only, read back |
| POST | `/api/campaigns/sync` | Optional `after` -> campaigns/skipped/skippedCampaigns/nextCursor/pageCursor | Provider read + local imports; `skippedCampaigns` names each campaign left unchanged with a reason (`not_running`, `other_account`, `other_page`, `other_connection`, `other_business`, `lifetime_budget`, `capped`, `unsupported`); a Meta campaign belongs to one business: the one that launched it, else the first to import it (#1057, read with the service role), and others skip it as `other_business`; `nextCursor` continues Meta discovery, `pageCursor` continues the bounded display list |
| GET | `/api/campaigns/lead-forms` | No body -> `{forms}` | Active forms on bound Page; cached 10 min per business, Page and connection generation, `?fresh=1` re-reads Meta (#271) |
| GET | `/api/campaigns/report` | No body -> Markdown attachment | Stored performance read |
| GET | `/api/leads` | Filters/cursor -> `{leads,total,nextCursor}` | Owned saved enquiries only; Meta's test leads are listed but left out of `total` (#1149); no provider sync |
| POST | `/api/campaigns/[id]/enquiries` | Optional `name` (<=200), `phone` (<=40), `note` (<=2000), `customer: true` (#798: logged already marked "customer") -> 201 `{id,enquiries,customers}` | Logs one real enquiry from an owned WhatsApp campaign's chats into Enquiries (`source` `whatsapp_manual`); 400 for other destinations, 404 when not owned, 30 per 5 min (#335) |
| DELETE | `/api/campaigns/[id]/enquiries?lead=<uuid>` | No body -> `{enquiries,customers}`; **404** unless the lead is a `whatsapp_manual` enquiry of this campaign | #798 Undo for a one-tap customer: removes only an owner-logged WhatsApp enquiry, never a Meta form enquiry; RLS-scoped |
| PATCH | `/api/leads/[id]` | `workflow_status` and/or `follow_up_note`, or `{contacted:true}` (#1049: the server sets `first_contacted_at` once, only while the enquiry is `new`, and moves it to `contacted` (#1140); a time can't be sent) -> `{lead}` | Owned local follow-up only; no outreach or provider write |
| POST | `/api/leads/sync` | Empty body or `{syncId}` -> `{leads,imported,failedForms,sync}`; failed Meta reads return 502 with saved rows and a resumable `sync.id` | Bounded provider pages + atomic per-business deduplicated inserts/checkpoints; incomplete runs are not up to date |
| GET | `/api/leads/unseen` | `since` (ISO viewed time) -> `{count}` | Authenticated owner business only; exact count of locally imported leads after `since`, Meta's test leads excluded (#1149), private no-store; no provider sync. The sidebar badge polls it every 2 min while visible, waits out a 429's Retry-After and stops on 401 (`usePoll`, #1541) |
| POST | `/api/spend-limits` | Complete settings -> `{ok:true}` | DB write |
| GET | `/api/preferences` | `businessId` -> `{enabled,epoch,notes}` | Authenticated owner-scoped read, no cache |
| POST | `/api/preferences` | Versioned mutation -> `{enabled,epoch,notes}` | Owner-scoped opt-in/save/forget/pause/clear |
| GET | `/api/privacy-requests` | No body -> `{requests}` (latest 20) | Authenticated owner-only export/deletion status, no cache |
| POST | `/api/privacy-requests` | Same-origin `{kind:"export"|"delete"}` -> `{request}` (201) | Owner-scoped request; one open request per kind, no export/deletion |
| GET | `/api/privacy-requests/operator` | No body -> `{requests}` (oldest 100 open requests); `?check=1` -> `{allowed:true}` without loading the queue | Verified privacy operator only; server-only queue read |
| PATCH | `/api/privacy-requests/operator` | Same-origin `{id,expectedStatus,status}` -> `{request}` | Verified privacy operator only; status and handler audit, no export/deletion |
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
| GET/POST | `/api/payments/live/orders` | Owner-scoped order read / accepted terms and idempotent create | Requires enabled production collection; no ad activation |
| POST | `/api/payments/live/verify` | Signed provider payment proof | Reconcile capture; no ad activation |
| POST | `/api/payments/live/webhook` | Signed Razorpay event | Idempotent capture/refund reconciliation |
| GET/POST | `/api/payments/live/reconcile` | Owner-scoped recovery | Reconcile uncertain provider state |
| GET/POST | `/api/payments/live/operator` | Operator-authorized refund/review | Financial action; separate authorization required |
| GET/POST | `/api/payments/customer-balance` | Owner balance/review or operator accounting evidence | No provider charge, refund or ad activation |
| GET/POST | `/api/payments/test/orders` | Test order read/create | Nonproduction only; isolated test gateway |
| POST | `/api/payments/test/verify` | Test payment proof | Nonproduction only |
| POST | `/api/payments/test/webhook` | Test signed event | Nonproduction only |
| POST | `/api/events` | Fixed client event | Optional telemetry, normally 204 |
| POST | `/api/auth/outcome` | How a browser sign-in step ended: `{method: password\|email_link\|google, outcome: success\|started}` or `{…, outcome: failed, code}` (Supabase code from a fixed list, else `other`) | Signed-out allowed; same origin, strict body ≤ 512 bytes, 20/min per address (`x-real-ip`) and 600/min overall; a `success` counts only with a session; 204, never the email (#451 L4) |
| GET | `/api/cron/keepalive` | Cron Bearer auth | DB health and optional telemetry pruning |
| GET | `/api/cron/enforce-spend` | Cron Bearer auth | Can pause live campaigns; `{ok,at,swept,unverified,reauth,managedSpendCaps}`, `reauth: [{key,since,activeCampaigns}]` for dead owner tokens, which don't fail the run (#758) |
| GET | `/api/cron/sync-leads` | Cron Bearer auth | Imports new Meta leads for every connected business (read-only on Meta); dead owner tokens go to `reauth` instead of failing the run (#758); with `OWNER_ALERTS_ENABLED`, then WhatsApps opted-in owners one alert per new lead under 24 h old (#701) |
| GET | `/api/cron/refresh-results` | Cron Bearer auth | Every 15-min run per active campaign (at most every 14 min, #992): Meta insights and ad review (read-only), one result row and `raw.health` flags. A paused bound campaign gets results only (no review, no health): one read at AdBrain's pause + 1 d and + 7 d (Meta's attribution window), then final; one lifetime read when it has no row (imported) (#1003). `{ok,refreshed,pausedReads,skipped,failed,hasMore,alerts:[{kind,key}],reauth:[{key,since,activeCampaigns}]}`, never pauses (#258, #758) |
| GET | `/api/cron/owner-daily-results` | Cron Bearer auth | #1022: the daily WhatsApp results line. Acts only with `OWNER_ALERTS_ENABLED` and between 09:00 and 12:00 IST; at most one line per opted-in owner per day (yesterday in IST, #783's per-ad numbers, read-only on Meta); `{ok,day,sent,outcomes:[{businessId,result}]}` or `{ok,skipped}`; a per-owner failure doesn't fail the run |
| GET | `/api/cron/payment-health` | Cron Bearer auth | Razorpay webhook counts for the live account (`events7d`, `unprocessed`, `capturedWithoutEvent`); `ok:false` when a capture lacks its webhook event; read-only |
| GET | `/api/cron/scheduler-health` | Cron Bearer auth | Read-only watchdog (#274): per job (`enforce-spend`, `sync-leads` every 15 min; `refresh-results` must succeed hourly) minutes since the last run and last successful run, from logged `http.request` events; `overdue` after twice the interval without a success; `ok:false` when any job is overdue |
| GET | `/api/cron/meta-parent-health` | Cron Bearer auth | Read-only 2-Tier parent token check (#520): `GET /me` and the parent business with `META_PARENT_SYSTEM_TOKEN`; `{ok:true, configured:false}` when unset, `{configured, enabled, ok, businessVerified}` when it works, 503 with a Meta `errorCode` only when refused |
| GET | `/api/cron/managed-health` | Cron Bearer auth | Read-only 2-Tier watchdog (#527): `{ok, accounts, byState, stuck:[{state, minutes, key}]}`; stuck = a non-final state (not `ready`/`offboarded`; `failed` included) unchanged for over 30 min; opaque 12-hex keys, no IDs |
| GET | `/api/cron/campaign-reconciliation` | Cron Bearer auth | Read-only Launch watchdog (#734): `{ok, waiting, stuck:[{key, minutes}]}`; stuck = a `campaign_operations` row in `needs_reconciliation` for over 30 min; opaque 12-hex keys (sha256 of the id), no IDs; 503 without details |
| GET | `/api/cron/access-requests` | Cron Bearer auth | Read-only (#692, #725): outside owners who asked for Facebook access in the last 7 days (the `meta.access_request` audit record, plus the older `ui.action` beacon), listed team ids excluded; at most 10 account lookups a run, newest first: `{ok, requests:[{key, hours}], more}` (`more` = outside requests left for the next run); one opaque 12-hex key per user (sha256 of the user id), no IDs |
| POST | `/api/meta/access-request` | Signed-in owner | **Ask for Facebook access** (#725): `{businessId}` → writes a `meta.access_request` audit record (owner checked by `append_verified_audit_event`), once per user per UTC day → `{ok:true}`; the page says "Request sent" only after this; 400 bad body, 401, 404 not your business, 503 not recorded (retry) |
| GET | `/api/cron/core-scoreboard` | Cron Bearer auth | Read-only daily core scoreboard (#681): `?hours=` 1–168 (default 24) -> `{ok, hours, since, until, excluded:{events, aiCalls}, rows:[{step, now, target, met}], markdown}`; smoke left out by `smokeUserIds` in `src/lib/internal-accounts.json` (user first, the businesses it owns for background rows); aggregates only, no IDs; 400 bad window, 503 without details |
| GET | `/api/cron/llm-credit` | Cron Bearer auth | Read-only OpenRouter credit (#449): `{ok, keys:[{index, limitUsd, remainingUsd, error?}], minRemainingUsd, thresholdUsd:1, low, health:[{name, provider, status, detail}], dead:[name]}` (#1569: every configured AI key probed on a free endpoint, by env name); never returns keys; 503 when OpenRouter refuses a key |
| POST | `/api/internal/meta-traffic` | Bounded runner options | Allowlisted diagnostic reads; creation mode disabled |

**One owner per Meta campaign (#1138).** The routes above that can write to Meta (`[id]` PATCH, `refresh`, `audience`, `audience/switch`, `budget`, `ads/[adId]` and `ads/[adId]/status`) answer **409** `{error, code:"owned_elsewhere"}` before any Meta call when the row's Meta campaign belongs to another AdBrain business (the sync rule above, read with the service role), and **503** when that can't be read.

### Configurable Live Payments

**Customer-chosen annual amount (#212).** GET `/api/payments/live/orders` accepts
`amountPaise` (integer, 50000-1000000) for a read-only annual quote and returns
`annualAmountRange: {minPaise:50000,maxPaise:1000000}` (null for verification or
legacy terms). Without it, the quote follows the business's open unpaid annual
order, else the configured default. POST accepts `amountPaise` with the returned
`termsHash`; anything outside the range is 400, and terms accepted for another
amount are 409. The stored quote splits floor(total/5) to service and the rest to
ad money; responses carry only the customer view (`totalPaise`, no `*AllocationPaise`),
and `policy`/order `terms` carry only the accepted text, hash and `fundingMode` (#1235). A new amount replaces the business's unpaid annual order, which stays in
the list with `status: "superseded"` and `checkout: null`; paid, held or
event-pending orders are never replaced (the request fails until reconciled).
Paid orders accumulate; each is its own order with its own capture. A replaced
order paid later is captured and credited once.

The effective quote is returned by the order-list route; each saved order retains
its own `quote` and accepted policy. `amountPaise` and provider checkout `amount`
equal the saved `quote.totalPaise`, even after configuration changes. Normal
annual quotes retain their original allocation; pilot verification quotes carry
zero service/ad allocation and a `verificationAllocationPaise` equal to the total.
The eligible owner may refresh a verification quote before creating an order,
but an existing order cannot be repriced or replaced while unresolved. Captures
and refunds use saved amounts, and the one-time verification order remains visible
ahead of recent annual orders. See [configuration and restoration](CONFIGURATION.md#configurable-live-amounts).

For an eligible pilot without a saved verification order, GET returns
`verificationAmountRange: {minPaise:100,maxPaise:<configured ceiling>}`; otherwise
it is null. GET accepts optional `verificationAmountPaise` for a read-only quote
within that range. POST accepts the same integer alongside the returned
`termsHash` and explicit acceptance. Owner, expiry, ceiling and consent changes
fail closed; a saved
verification order cannot be repriced. Without an amount parameter, reads recover
the saved eligible verification quote rather than replacing it with the default.

Live routes return 404 unless `PAYMENTS_LIVE_ENABLED=true` on a production `main`
deployment without test configuration; order creation also needs
`PAYMENTS_LIVE_COLLECTION_ENABLED=true` (409 when blocked). Authenticated writes
require the exact configured origin (403 otherwise). Create is strict
`{businessId,idempotencyKey,termsHash,acceptTerms:true}` plus the optional
verification amount; amounts are integer paise. A changed `termsHash` is 409 and
an unconfirmed provider create is 503 `needs_reconciliation`: retry with the same
key. Every order response keeps `spendablePaise: 0` and `canActivateCampaign: false`.

### Local Test Payments

The `/api/payments/test/*` routes return 404 unless `PAYMENTS_TEST_ENABLED=true`,
the process is not production Node or any Vercel environment, and Supabase is a
loopback URL; they also need the optional
[test-order migration](../db/migrations/20260926_razorpay_test_orders.sql).
Responses are no-store and always carry `spendablePaise: 0` and
`canActivateCampaign: false`.

- Create (POST `orders`) accepts only `{businessId: UUID, idempotencyKey: UUID}`;
  the amount is fixed at 1,000,000 paise. It returns 201 for a new provider order,
  200 for an idempotent replay, and `checkout` only while `status` is `created`.
  An unconfirmed provider create returns 503 with the local `orderId`.
- Read (GET `orders?orderId=<uuid>`) returns the owned order.
- Verify accepts `{orderId, paymentId, signature, providerOrderId?}`; the HMAC
  uses the stored provider order ID and a mismatched `providerOrderId` is 400.
  The server then fetches provider payment/order state with test keys.
- The webhook reads at most 65,536 bytes, verifies `X-Razorpay-Signature` on the
  raw body and `account_id`, and handles `payment.captured`, `payment.authorized`,
  `payment.failed`, `refund.processed` and `order.paid` (others are acknowledged
  as ignored); handled events need `X-Razorpay-Event-Id` and a payment reference.

States are `creating`, `created`, `captured` and `needs_reconciliation`.
Mutations other than the webhook require a same-origin request (403). A changed
test merchant is 409; storage or provider uncertainty is 503. Nothing here issues
refunds, moves real money or grants advertising credit.

### Customer Advertising Allowance

The additive [customer allowance migration](../db/migrations/20260926_customer_ad_allowance.sql)
does not enable collection or authorize Meta spending. Test payments give no
credit. Owners can review their balance with `GET /api/payments/customer-balance`
using `businessId` and optional `campaignId`. With `campaignId`, optional
`capDays` (integer 1–7) reviews a capped run at `daily × capDays` + GST instead
of 7 × daily; the activation PATCH still enforces the days the owner approves.
The GET response is the customer view: no `capturedPaise`, `serviceAllocationPaise`,
`advertisingAllocationPaise` or `advertisingRefundedPaise`, so AdBrain's margin never reaches the browser (#1235).
Financial operators can submit
strict `costs` or `refund-allocation` actions with
`POST /api/payments/customer-balance`; authority is rechecked in SQL. See the
[shared contracts](../src/lib/payments/customer-balance-contracts.ts).

Cost evidence uses integer paise, immutable UUIDs and cumulative lifetime
media/tax figures; stale or conflicting figures hold funds. A capped run reserves
its Meta lifetime cap plus GST instead of 7 × daily and is bounded by attributed
media plus that cap; its aging non-final figures do not hold funds, but figures
above the bound do (#208). AdBrain itself records non-final evidence from Meta's
lifetime campaign spend (`customer_ad_observe_costs`, service role only) during
the activation review, activation, Refresh and the `enforce-spend` sweep, so no
operator is needed to start or keep a funded run; final evidence stays
operator-only (#216). For paused runs the sweep confirms the whole Meta tree
is stopped and records settle reads (`customer_ad_settle_costs`); two equal
reads 30 minutes apart, at least 3 hours after the pause, finalize the run and
close its reservation without an operator. Capped runs past their Meta end time
are paused by the sweep first (#221). Capturing payment
does not earn service fees or activate ads. Review precedes an atomic reservation
for one campaign. Before ACTIVE, the Meta cap must be written and read back
within the reserved media allowance; unsupported or rejected caps block
activation. Provider capability for the INR 8,000 tax-inclusive offer remains
unverified. Pausing does not release a reservation: final reconciliation needs
the exact reservation UUID, a settled activation outcome and fresh cumulative
costs after confirmed pause. Uncertain outcomes retain a hold for audited
recovery, never automatic expiry.

### Authentication Handlers

These sit outside `/api` and return redirects rather than the API envelope:

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| GET | `/auth/callback` | `code` or `token_hash` + `type`; optional `redirect`; `via=email\|google` (which sign-in started it, #1562) | Exchanges/validates Supabase credentials, then redirects to safe local destination; failure -> `/login?error=<reason>` (`link_expired`, `other_browser`, `link_other_browser` for an email link opened in another browser, `cancelled`, `auth`; #1414) |
| GET | `/auth/dev-login` | No body | Disabled -> login; enabled development tries configured real login, otherwise a seven-day offline development cookie |
| GET | `/auth/dev-logout` | No body | Clears offline development cookie and redirects to login; not a general Supabase sign-out API |

If both completion forms are supplied, `code` takes precedence. Never put callback
codes/token hashes in example URLs, logs or screenshots. Development cookie access
does not satisfy real API ownership/authentication. Normal login methods use
Supabase Auth client APIs rather than an invented `/api/login` endpoint.

## Creative Requests

### Website Autofill

`POST /api/brand/autofill`: `{url: string, businessId?: uuid}`; trimmed length 1-2048, or (#1317) `{text: string, businessId?: uuid}` with text pasted by hand (an Instagram bio, a Google listing; at least 30 letters, read up to 6000 characters, never fetched; 400 'Paste a little more…' when too short). Public URL
policy and redirect/DNS checks apply. Returns `{extraction}` with suggested brand
fields; the caller must review and save separately. Blocked URL: 400; fetch/model
failure: 502; no readable text: 422. Extraction is a model result, not a factual
verification. `extraction.locations` (#1037): up to 5 service areas the page itself names (never a
country or a compass region like "North India"); with a Meta connection, only ones Meta's location
resolver can place. `extraction.phone` comes only from the page's first `tel:` link in
international `+` format (never from the model). Website fetch deadline is 10 seconds; route duration setting is 30.
Every provider attempt (and a response-cache hit, as a zero-token row) is logged as usage with
route `brand.autofill` on `businessId` when the owner's session can read that business; on
first Brand setup there is no business yet, so only the `ai.completion` product event is kept (#650). Each
autofill the owner waited for (not 400/401/429) also records a `brand.autofill` workflow event with its
outcome and whole-request duration, which the #681 scoreboard Brand row counts (calls, failed, p90; #1025).

### Interview

`POST /api/creatives/assistant` uses a strict object:

| Field | Contract |
| --- | --- |
| `businessId` | Trimmed nonempty string, maximum 100; owner-scoped lookup |
| `goal` | Trimmed 1-2000 characters |
| `answers` | Default `[]`, at most 12 records for history compatibility |
| `answers[].question` | Trimmed 1-300 characters |
| `answers[].answer` | Trimmed 1-1000 characters |
| `answers[].questionId` | Optional trimmed 1-80 characters |
| `answers[].field` | Optional `objective`, `audience`, `offer`, `visual`, `tone`, `language`, `location`, `constraints` |
| `answers[].options` | Optional at most 6 strings, each 1-160 characters |
| `recentGoals` | Default `[]`, at most 6 strings, each 1-500 characters |
| `referenceBrief` | Optional trimmed 1-2000 characters for follow-up context |

The interview asks no more than three new decisions, despite accepting longer
historical input. Returns either `{ready:false, question, promptVersion}` or
`{ready:true, brief, language?, angleId?, recommendations?, promptVersion}`.
Questions carry `id`, `field`, `question`, optional help, options and input flags.
When no AI provider answers because of load (rate limits, provider 5xx, timeouts or
the 45 s deadline), it returns `503 {error, code: "AI_BUSY"}` with `Retry-After: 10`;
the page shows the message with a one-tap Try again (#410). A refused key or request
(401, 403, 400, such as a key over its spending limit, #449) stays a 500 so it alerts.
Optional recommendations contain 2-3 distinct `{label,prompt}` records.
Invalid/repetitive output receives at most one repair within a shared 45-second
deadline, then fails; it does not silently proceed to generation.

Example interview input for a synthetic business:

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "goal": "Promote our saved rooftop survey offer to homeowners in Jaipur",
  "answers": [],
  "recentGoals": []
}
```

### Generate and Recover

`POST /api/creatives/generate`:

| Field | Contract |
| --- | --- |
| `businessId` | Trimmed nonempty string; owner-scoped lookup |
| `brief` | Trimmed 1-2000 characters |
| `count` | Integer 1-6, default 3 |
| `generationId` | Optional UUID; use a client-known UUID before the first POST |
| `language` | Optional string normalized through language helpers |
| `sourceFacts` | Optional array of up to 12 explicit user-authored facts, each up to 2000 characters (6000 combined); never copy an AI-generated brief or advisory preferences here |
| `format` | `portrait` (default), `square`, `story`, `landscape` |

Example paid-generation input, submitted after the owner starts Create (after the brief review, or straight from any goal on a complete Brand, #858/#1004):

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "brief": "Invite Jaipur homeowners to enquire about our saved rooftop survey offer. Use only verified brand facts and contact details.",
  "sourceFacts": ["We offer rooftop surveys in Jaipur."],
  "count": 3,
  "generationId": "22222222-2222-4222-8222-222222222222",
  "language": "en",
  "format": "portrait"
}
```

Returns `{variantGroup, creatives, failures}`. Individual saved variants survive
other failures. If none save, returns 502 with an error/failure list. Missing
generation schema or unavailable admission blocks before work with 503.
No configured text keys can return 400/`NO_LLM_KEYS`; exceeded quota returns
429/`LLM_MONTHLY_QUOTA_EXCEEDED`. Generation/regeneration declare a 300-second
route duration; host execution limits still apply.

Live progress (Create): send `Accept: application/x-ndjson`. A request rejected
before admission still gets its normal JSON status. After admission the route
answers 200 `application/x-ndjson`, one JSON object per line:
`{type:"progress", angleId, angleName, stage, at}` (stage `queued`, `writing`,
`checking`, `fixing`, `image`, `ready` or `failed`; angles run concurrently; an
`image` line with `slowPictures: true` means that ad's picture fell back to the slower
free provider, and the page says "Pictures are taking longer today", #1542),
`{type:"creative", angleId, creative}` once that ad is saved (before its
`ready`), and last `{type:"result", status, body}` carrying the status and body
the JSON mode would have returned. A blank line arrives every 15 s as a
heartbeat; skip it. A stream that ends without `result`, or that goes silent
(the page allows 60 s once it has seen a heartbeat, else 330 s), must be
treated as unconfirmed and recovered with the GET below.

POST atomically claims the
generation UUID and normalized request inputs before paid work. Repeating the
same ID returns 202 with `{variantGroup, status, creatives: [], count: 0,
expectedCount}` and never starts another producer. A changed brief, count,
language, format or nonempty `sourceFacts` for that ID returns 409; another business
or owner gets 404. Omitting `sourceFacts` keeps the prior hash format for existing
requests. The validator uses Brand facts, saved instructions and `sourceFacts` as
quote evidence, not the potentially model-derived `brief`. Studio submits its
directly authored brief as user evidence; Create submits the original goal and
free-text answers, excluding model-suggested options and the generated brief.
The accepted facts are stored in the generation receipt for regeneration. Existing
creatives without that field regenerate with no separate user-fact evidence.
The route reserves monthly quota for text and images, counts recorded tokens,
and retains an allowance of 10,000 quota units per completed image. This is
**not** measured image billing or a USD spend limit: image usage may lack a known
cost. Uncertain provider, usage or result writes retain their reservation until
an operator can reconcile them. A definitive whole-request pre-provider failure
can free unused quota after the batch has settled; one failed angle cannot free
its still-running siblings' hold. The failed UUID remains non-reusable. Omitted `generationId` gets
a new server UUID and cannot be replayed safely after a lost response.

Recovery uses `GET /api/creatives/generate?businessId=...&generationId=...&expectedCount=3`.
`generationId` must be UUID; optional `expectedCount` is integer 1-6 and, if
provided, must match the claimed count (409 otherwise). The source candidate
returns `{status, creatives, count, expectedCount}` based on the persisted
intent and saved rows. Status may be `processing`, `partial`, `complete`,
`failed`, `unresolved` (including stale processing after five minutes) or `ended`
(#1407: the batch finished short, as its closing `creatives.generate` audit row shows;
no more ads are coming).
Unknown/foreign ID returns 404; unavailable status or row lookup returns 503.
An owner lookup returning 404 permanently fences that UUID with a zero-quota
no-spend record; a delayed original POST cannot start generation afterward.
Recovery lookups are limited to 30 per user per five minutes (429 when exceeded).
`processing` does not prove a worker is running. Inspect saved results after a
timeout; `unresolved` requires investigation, not another paid request.

`POST /api/creatives/[id]/regenerate` has no request body. It uses saved generation
settings and current business context, replaces the creative, and sets `draft`.
After the [regeneration claims migration](../db/migrations/20261001_creative_regeneration_claims.sql)
is applied, the server claims the owned creative before paid work. A concurrent
attempt or unresolved previous attempt returns 409 without another provider call;
unavailable admission returns 503 before paid work. A confirmed save or pre-provider
failure releases the claim. So does a fact-check rejection whose text attempts all
completed and were receipted: it returns 422 with a plain message naming any
uncited claim (for example "10%, free"), and the creative is unchanged (#281).
An uncertain paid failure returns 502 and retains the claim for operator review.

`POST /api/creatives/[id]/picture` redraws the words printed on the picture
(headline up to 40, offer line up to 64, phone, a Meta button label) over the
ad's stored background, with no AI call (#280). It uses the saved `design` spec,
or rebuilds one from the Brand for older ads. The background is `generation.photoUrl`,
or for older ads the newest `<angle>-<uuid>` file stored no later than the finished
picture in the ad's folder. If neither exists it returns 409 `no_background`.
The new picture gets a new versioned path; status is unchanged. It returns 409
when overlays are off or the ad is image-only, and rate-limits at 30 per 5 minutes.
With `preview: true` in the body it only renders the words for the editor's live
preview (#387) and returns `{previewUrl}` (a 720 px WebP data URL): no upload, no row
update, no audit event, own rate limit (120 per 5 minutes).

`POST /api/creatives/[id]/background` makes one new background image from the
owner's short description (the owner's direction wins over the ad's earlier visual
direction) and redraws the same overlay words on it (#280). It shares Regenerate's
rate limit, monthly AI limit and `creative_regeneration_claim`, so only one paid job
runs per ad. Usage is recorded as `creatives.background`. The copy, overlay words
and status are kept; the receipt gets the new `photoUrl`, `imagePrompt`, image usage
and `backgroundInstruction`. If the provider confirms every attempt failed, the claim
is released with a retry message. Any other failure (OpenRouter reports `unknown`)
holds the claim as `unresolved` with a 502, exactly like Regenerate.
With `{photoUrl}` instead, the URL must be one of the business's `product_photo`
Brand assets (else 400 before the claim). There is no image call, no usage row and
no monthly-limit check; the photo is copied through the guarded downloader, the
receipt records `ownerPhoto`, and a failure releases the claim.
The claim's attempt UUID is the request ID in usage receipts. It does not expire
automatically, and there is no customer-facing regeneration recovery endpoint.

### Export

`POST /api/creatives/export`: `{creativeIds: UUID[]}`, 1-50 entries before
deduplication. All distinct selections must be accessible (404 otherwise); DB
lookup failure is 503. Approved status is not a route requirement.

Downloads are sequential, capped at 40 MiB aggregate accepted image bytes and a
45-second shared deadline. ZIP includes `copy.txt`; missing/invalid/over-limit
images are skipped with an explanatory note. Header `X-Images-Skipped` gives the
count; filename is `adbrain-ad-pack.zip`. No raw HTML is accepted as an image.

## Campaign Draft Contract

`DraftInput` is strict and used by draft POST, update `input`, and optional planner
`audienceDraft`. A saved draft is intentionally less restrictive than preflight.

| Field | Contract |
| --- | --- |
| `businessId` | UUID |
| `name` | Trimmed 1-120 characters |
| `goal` | Trimmed 1-2000 characters |
| `mode` | `manual` or `guided` |
| `creativeIds` | UUID array, 0-50; preflight requires nonempty unique approved selections |
| `dailyBudgetRupees` | Finite integer 0-10000000; preflight requires positive |
| `leadFormId` | Null or trimmed string 1-128; instant-form preflight requires an active bound form and an own business website (not Facebook/Instagram), which Meta requires for lead ads |
| `destination` | Optional `instant_form` or `whatsapp`; absent means instant form |
| `whatsappNumber` | Optional WhatsApp button number: E.164 or the masked form from `/api/meta/whatsapp` ("+91 ••••• 4842"). Preflight resolves it to the Page's number or one on the ad account business's WhatsApp Business Accounts; a mask must match exactly one |
| `targeting` | Strict object below; `{}` can be saved but is not launch-ready |
| `abTest` | Required boolean; true produces two age-band ad sets |

### Targeting

Top-level `gender`, `location`, `age` and `audience` are optional for persistence:

| Field | Contract |
| --- | --- |
| `gender` | Optional `all`, `men`, `women` |
| `location.mode` | Optional `ai` or `manual` |
| `location.cityScope` | Optional `city_only` or `radius` |
| `location.included`, `location.excluded` | Optional arrays, maximum 50 objects each |
| Location item `key` | Trimmed provider string 1-128 |
| Location item `name` | Trimmed string, maximum 200 |
| Location item `type` | `city`, `region`, `country` |
| Location item `radiusKm` | Optional finite integer 5-80; city preflight requires 17-80 |
| `location.includedNames`, `location.excludedNames` | Optional arrays, maximum 50 trimmed strings of 1-200 characters |
| `location.radiusKm` | Optional finite integer 5-80; preflight requires 17-80 |
| `age.mode` | Optional `ai` or `manual` |
| `age.min`, `age.max` | Optional integers 18-65; preflight needs explicit ordered values and no unresolved AI mode |
| `audience.interestNames` | Required if audience supplied; 0-5 trimmed strings of 1-100 characters |
| `audience.rationale` | Required if audience supplied; trimmed 1-2000 characters |

`audience` and the top-level targeting object are strict. Interest names are not
Meta IDs. Preflight resolves them and checks targeting-option status. The plan
route drops AI interests Meta has no exact match for; if none match, an audience
recommendation returns `fallback: true` with no interests and a rationale saying
so. When only some match, the rationale drops the model's sentences about
interests and ends with "Meta couldn't match: …. Interests targeted: …".
No silent nationwide fallback is promised for missing or unresolved service areas.

Draft DTO: `{draftId, version, expiresAt, input}`. New version is 1, expiry seven
days from creation, cap 50 active editable drafts. PUT requires
`{expectedVersion, input}`; version is a nonnegative safe integer and must match.
Successful update increments it without renewing expiry. DELETE requires query
`version` >= 1. Operation-linked drafts are retained (409 on restricted delete).
Expired reads return 404. A failed/stale write does not imply local editor changes
were saved.

### Safe Incomplete Draft Example

This JSON is valid to **save**, not valid to create a campaign:

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "name": "Service-area enquiries",
  "goal": "Invite enquiries about our local service",
  "mode": "manual",
  "creativeIds": [],
  "dailyBudgetRupees": 0,
  "leadFormId": null,
  "targeting": {},
  "abTest": false
}
```

### Planner

`POST /api/campaigns/plan` uses the primary business. Actual route fields:
`goal` trimmed 1-2000; optional `answers` string up to 12000 or array up to 30
`{question,answer}` records (maximum 1000/2000 characters); optional `audienceDraft`.
Structured answers also accept `questionId` (1-80 characters), a fixed `topic`
(`location`, `radius`, `budget`, `offer`, `audience`, `exclusions`, `creative`,
`lead_form`, `compliance`) and `disposition` (`answered` or `deferred`). A deferred
answer must have empty text. Unknown answer fields are rejected; serialized history
is capped at 12000 characters. Legacy text answers remain accepted, with wording-
based repeat checks but without the new topic identity guarantees.
This route schema differs from the older exported `planRequestSchema`; use the
handler's contract, not that unused declaration, for integration.

Returns `{ready:false,questions}` when more input/setup is needed. Without
`audienceDraft`, success is `{ready:true,draft}` and saves a guided draft. With
`audienceDraft`, success is `{ready:true,targeting}` for review, preserving manual
choices; it does not create a campaign. No approved creatives produces an
informational question without invoking generation. Model deadline is 45 seconds.

The v5 campaign interview filters covered topics and repeats, returns at most two
new questions and stops asking after six supplied decisions. One bounded correction
is allowed for invalid/no-progress model output; each attempt is accounted for.
When the interview cannot progress, it returns HTTP 200 with
`{ready:false,questions:[],handoff:{reason,message}}`, where `reason` is
`no_progress` or `interview_limit`. This response performs no draft save or Meta
mutation. Both guided and manual-audience callers surface it without losing their
existing context. Explicit audience-editor radius values are retained. See
[campaign interview and framework choice](AI_PIPELINE.md#campaign-interview).

## Review and Durable Creation

Preflight request is strict: `{businessId: UUID, draftId: UUID, draftVersion:
nonnegative-safe-integer}`. Review data includes:

| Field | Meaning |
| --- | --- |
| `draftId`, `draftVersion`, `connectionGeneration` | Reviewed concurrency identity |
| `canCreatePaused`, `blockers` | Gate and actionable blocker list; each Review blocker has a stable `reason` (`REVIEW_NO_WEBSITE`, `REVIEW_NO_LEAD_FORM`, … in `reviewBlockerReasons`) besides its API `code` |
| `serviceArea` | Optional, display only (#741): `excludedCities` (names), `keptStates`, `excludedStateCount`: the out-of-area exclusions launch adds; not part of `planHash` |
| `planHash` | 64 lowercase hex characters, or null while blocked |
| `creativeHash` | Optional content hash used by current execution |
| `currency` | `INR` |
| `perAdSetDailyBudgetRupees`, `adSetCount`, `totalDailyBudgetRupees` | Explicit budget multiplication |
| `selected` | Verified Meta assets or null |
| `resolvedAreaLabel`, `resolvedLocation`, `resolvedExcludedLocation` | Human label and provider-resolved geography |
| `audienceInterests` | Resolved `{id,name}` entries, up to five |
| `destination`, `whatsappNumber` | Optional destination and nullable E.164 number (`+` and 7-15 digits) |

Create body: `businessId`, `draftId` (UUIDs), `draftVersion`,
`connectionGeneration` (nonnegative safe integers), `planHash` (64 lowercase hex),
`idempotencyKey` (trimmed 8-200 characters). Never fabricate the hash or derive it
from an old draft; use a fresh review.

The server reruns review, claims a 60-second operation lease, checkpoints remote
IDs, and finalizes a paused local campaign. It returns an operation envelope, not
the old direct campaign result. New execution returns 200 for success or 202 for
an unresolved/failed execution result; terminal replays can return 200. Inspect
the operation `state`, not just the HTTP status. With `CAMPAIGN_EXECUTION_MODE=worker`
the route enqueues the persisted operation and returns 202; a queue failure is 503
with no inline fallback, and any mode other than `inline`/`worker` is 503. Worker
mode needs the [worker migration](DATA_MODEL.md#migration-map) and a running
`worker:campaigns` process.

| State | Client action |
| --- | --- |
| `pending`, `running` | Keep identity; poll, do not generate a new key |
| `succeeded` | Use `campaignId`; still paused until separate activation |
| `failed` | Inspect blockers and confirm safe recovery before new intent |
| `needs_reconciliation` | Stop automatic writes; operator/provider reconciliation required |

Operation DTO also has `operationId`, `businessId`, nullable `campaignId`, and
`blockers`. Lookup by key requires `businessId` UUID and `idempotencyKey` 1-200
characters; returns null when absent. Lookup by operation ID returns 404 if
unavailable. Status reads may durably expire an abandoned lease. A reused key
with changed request hash/generation conflicts; in-flight duplicates also conflict.

### Activation, Pause, Delete

Pause: strict `{ "status": "paused" }`.
Activation: strict `{status:"active", confirmationDigest:<64 lowercase hex>,
connectionGeneration:<nonnegative-safe-integer>}`. The digest is derived from
[the activation payload](../src/lib/campaign/activation.ts) after the owner reviews
current assets/budget and exact Meta campaign/ad-set/ad delivery snapshot from
`GET /api/campaigns/[id]`. It is not interchangeable with `planHash`. Only a campaign
AdBrain launched (stored ad sets and ads plus account, Page and connection binding,
`reviewableCampaign`) can be reviewed; synced, legacy or incomplete rows get a 409
"AdBrain can only resume campaigns it launched. Resume this one in Ads Manager." and
the route does not guess. The Campaigns card uses the same check to offer "Resume in
Ads Manager" instead of Resume (#662).
GET and PATCH verify business ownership before reporting binding or child
reconciliation details.

Activation checks projected weekly cap (422 if exceeded; 503 if unreadable),
stored binding/generation, live capability, positive budget/INR currency, digest,
and exact remote child membership, settings and requested ACTIVE states before
the #49 customer reservation and again after requesting parent ACTIVE. Paused or
unexpected children and stale review return 409 before reservation. Success is
`{ok:true,status,delivery}`; `status:"active"` is a requested parent state,
not proof of effective delivery or Meta eligibility. An uncertain post-request
result holds the reservation for reconciliation. Pause/delete also verify binding.

Capped activation (#157): add `capDays` (integer 1-7); the digest then also covers
`{days,totalPaise}` with total = daily budget × days. Every reviewed child must be
PAUSED (409 otherwise, before reservation). After the #49 reservation (409 if the
total exceeds its media limit), AdBrain creates a PAUSED ad set with
`lifetime_budget` = total and `end_time` = now + days, copies the reviewed ads into
it PAUSED, and reads both back (mismatch deletes it and refuses). The capped IDs are
saved into the campaign's stored children before any ACTIVE write, so Pause covers
them. It then re-reads the cap and writes ACTIVE to the copies, the capped ad set and
the campaign only, and reads them back; if that fails the whole tree is paused and
the reservation stays uncertain. Success adds `cap:{campaign,adSet,ads}`; original
ad sets stay PAUSED.
Repeat capped runs (#197): every capped ad set id is kept in `raw.cappedAdSetIds`
(the first run's `raw.cap.adSetId` also counts). Review, activation and sync accept a
lifetime budget only on those ad sets; their daily budget must be 0 and they are left
out of the daily total and the bound `meta_adset_id`. A new run still needs every
child PAUSED (Pause first), then copies only the original ads into a new capped ad
set; earlier capped sets stay PAUSED.
Businesses funded on Meta: operator-funded (#245) and own-account (#759, any
business that is neither operator-funded nor managed). The review GET adds
`funding:{spendCapPaise,amountSpentPaise,roomPaise,prepay,committed:{runs,remainingPaise,uncapped:{adSets,dailyPaise}}}` read live from
`act_<id>?fields=id,spend_cap,amount_spent,is_prepay_account,currency` and, for `committed` (#1058),
`act_<id>/adsets?fields=id,effective_status,lifetime_budget,budget_remaining,daily_budget&effective_status=["ACTIVE","IN_PROCESS","WITH_ISSUES"]`
(the account's running capped runs' `budget_remaining`, counting ad sets Meta is processing or has flagged; daily-budget ad sets are named in `uncapped`, never subtracted;
an unreadable or paged listing fails closed), and
`spendLimitRequired` (true only for operator-funded), and the client skips the
customer-balance review. Activation requires `capDays` (409 otherwise) and INR.
Operator-funded needs a spending limit above 0; for both, a set limit must have
room (limit minus amount spent, minus `committed.remainingPaise`) of at least the cap; the 409 names
the other live runs. All checks run before any Meta write (409).
Only managed businesses (AdBrain holds ad money) use the allowance reservation. It then runs the capped flow
above with no reservation, cost evidence or confirmation; the compensating pause
still applies. 503 when the funding mode cannot be read.
When Meta refuses the owner's token (Graph 190, any subcode; #757), the connection
is marked `reauth_required` (it then reads `expired`) and PATCH answers 409
`{error, code:"META_REAUTH"}`. The error names the manual step ("Pause it in Ads Manager
now") for a pause or an active campaign, and the card links to the campaign in Ads Manager.
Pause writes PAUSED to the campaign, then its stored ad sets and ads (one retry
after Meta's 613 status rate limit), and reads all three levels back; `pause` is
`{confirmed,objects:[{id,level,status,effectiveStatus}]}`. It is saved locally only
when the campaign itself reads back PAUSED; otherwise 409 asks the owner to pause
in Ads Manager. `confirmed:false` means a child did not read back PAUSED.
Deletion preserves the local row when remote deletion cannot be confirmed.
Remote success followed by local failure is possible; inspect before retrying.

## Sync, Insights, Leads, and Settings

Campaign sync accepts optional query `after` of 1-2000 characters. Returns
`{campaigns,skipped,nextCursor,pageCursor}`. `nextCursor` continues Meta discovery;
`pageCursor` continues the bounded saved list. It processes one provider page, verifies bindings
and budgets, and imports only ACTIVE/PAUSED status. Local unsupported/unmatched
records remain unchanged. No remote-deletion pruning occurs. Concurrent insert
failure is not a successful import; partial writes before an error can exist.
Failed Meta binding reads return a generic 502 before local imports; only a
confirmed unmatched binding counts as skipped.

Refresh returns `{result,summary,insights,review,autoPaused,protectionConfirmed}`.
`review` is Meta's per-ad review (`[{adId,state,effectiveStatus,reasons}]`, state
`in_review|approved|rejected|issues|unknown`, reasons as Meta wrote them) or
`null` when the review read failed; it does not fail the refresh. **This
can invoke an LLM summary and pause live campaigns through spend enforcement**; it
is not a read-only smoke test. `autoPaused` lists only confirmed remote and local
pauses. `protectionConfirmed:false` means the spend decision or a required pause
could not be verified; inspect the bound campaign in Meta, since a local error
does not prove remote delivery stopped. Provider refresh failures can still attempt
protective pauses. An unsaved result returns 503 before summary and enforcement
(`Could not save refreshed results. Retry the refresh.`, `protectionConfirmed:false`);
a successful retry can still trigger the summary and protective pauses.

Saved campaigns are read with `GET /api/campaigns/list`. `businessId` is an owned
UUID; `query` is at most 200 characters; `status` is `draft`, `active`, `paused`
or `completed` (omit it for all; `status=all` is invalid). Rows are ordered by
creation time then ID, descending, 50 per page, with `nextCursor` null at the end.
There is no global total, and the route runs no provider sync.

Lead sync returns `{leads,imported,failedForms,sync,error}`; each failed form has
`id,name` and `sync` is `{id,state:"complete"|"partial",hasMore}`. An empty POST
starts or resumes the unfinished run for the current connection binding;
`{syncId}` resumes that run. Business, owner, Page, ad account and connection
generation are derived and rechecked on each save: a foreign or missing run is
404 and a changed binding or stale writer is 409 (start again with an empty POST
after reconnecting). Continue with the same ID while `hasMore` is true.

Each request reads at most 24 provider pages of 200 items, at most three forms
concurrently, within a 40-second provider deadline; checkpoints time out after
three seconds. Only opaque `after` cursors are saved. Successful pages stay saved
when another form or page fails; failed forms stay queued and are listed in
`failedForms`. A failed provider read returns 502 and unverifiable progress 503,
both with the known `imported`/`sync`. `imported` counts rows newly inserted by
this request; duplicates are ignored and keep their campaign and follow-up fields.
`leads` is a snapshot of at most 200 newest saved rows, not the inbox list; a
failed reload after import returns 503 even though rows were saved. Report export returns
`text/markdown` with dated attachment filename and uses stored primary-business
performance; it does not refresh Meta.

The saved inbox uses `GET /api/leads` for the primary business. Strict filters:
`query` (trimmed, up to 200 characters; matches name, phone, email, city, form),
`status` (`all`, `new`, `contacted`, `qualified`, `booked`, `closed`), `contact`
(`all`, `ready`, `missing`), `sort` (`newest`, `oldest`, `name`), `limit` (1-100,
default 50) and an opaque `cursor`. Cursors are bound to the business, query,
status, contact and sort; changed scope rejects them. `total` counts every
matching saved row. Ordering is deterministic keyset paging (missing values last,
UUID tie-break), not a frozen snapshot. Responses are private/no-store; invalid
filters or cursor are 400, no business is 404 and unavailable reads are 503.

`PATCH /api/leads/[id]` takes a UUID path and a nonempty strict body with
`workflow_status` (one of the five statuses) and/or `follow_up_note` (at most
2000 characters); other fields are 400. The update is scoped to the owned
business: missing or foreign rows are 404 and failed saves 503. It sends no
outreach and changes no provider data.

Spend settings are strict and complete:

```json
{"weeklyCapRupees": 5000, "alertPct": 80, "autoPause": false}
```

Cap is null or a positive integer <= 2147483647; threshold integer 1-100; autoPause
boolean. Missing fields, zero, and fractional caps return 422. Only null means
unlimited. Success `{ok:true}` does not assert that Meta account limits changed.

Preference reads require `GET /api/preferences?businessId=<owned UUID>`. The
uncached response is `{enabled,epoch,notes}`; each note has `category`, `value`,
`version` and `updated_at`. Notes stay visible to their owner while paused but
are not included in creative or campaign-planning prompts. An unconfigured
business returns `enabled:false`, `epoch:0`, and no notes.

Mutations use `POST /api/preferences` with a JSON object containing `businessId`,
`operation` (`enable`, `pause`, `save`, `forget`, `clear`), and `expectedEpoch` from
the latest read. `save` requires a category and 1-160 character value; `forget`
requires a category. The fixed categories are `copy_length`, `tone`, `language`,
`visual_style`, `layout_density`, `creative_dislikes`, and `workflow`. One current
value per category is retained. Successful mutations return the updated state.
The database rejects sensitive/financial content and unauthorized businesses;
failed content is 400, lost ownership is 403, a stale epoch is 409, and database
or reload failures are 503. A failed reload after a committed mutation may require
a refresh to determine what was saved; no best-effort memory write is reported
as confirmed.

Geo search trims `q`, truncates to 100 characters, and returns an empty array below
two characters. Up to eight results have `key,name,type,region,countryCode`.

## Connection API

Detailed lifecycle: [Meta Connection](META_CONNECT.md). Start requires nonempty
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

## Jobs and Telemetry

Cron endpoints require `Authorization: Bearer <CRON_SECRET>`; absent configured
secret disables them with 404. Keepalive checks DB availability and, when enabled,
bounded event retention. Enforce-spend can mutate Meta and reports incomplete
enforcement as 503 (`ok:false`) even when some campaigns were paused; failure to
read the limit list returns 502; failure to scan active campaigns returns 503.
`swept` lists only confirmed remote and local
pauses, not a guarantee that every campaign stopped. Do not invoke either against
production without authority.

Internal traffic options: numeric `rounds` clamped to 1/configured maximum
(default 5), boolean `createDraftCampaigns` (true rejected with 400), numeric
`campaignsPerRound` clamped 1-3 (default 1; no creation while disabled). Production
requires an email allowlist. Return includes per-round read counts/errors; at least
one successful call yields 200, none yields 502. Partial success is not full health.

Events body is strict `{name,page}`. Name: `page.view`, `client.error`, or
`client.rejection`; page: one of the eight workspace paths in the workflow guide.
Requires authenticated same-origin request; honors DNT/GPC. Limit 2 KiB streaming
body (413 if exceeded), 60/minute/user. Normally 204; disabled logging also returns
204. Client events are untrusted signals, not evidence of a server mutation.

## Rate Limits and Timeouts

| Route family | Per-user request limit |
| --- | --- |
| Autofill | 15 / 5 minutes |
| Interview | 40 / 5 minutes |
| Generation | 20 / 5 minutes |
| Regeneration | 30 / 5 minutes |
| Planner | 40 / 5 minutes |
| ZIP export | 10 / 5 minutes |
| Internal traffic | 10 / 10 minutes |
| Client events | 60 / minute |
| Customer balance reads | 60 / minute |
| Customer accounting evidence | 20 / 5 minutes |
| Test order creation | 10 / 5 minutes |
| Test order read / verification | 60 / 5 minutes, per action |

Shared DB enforcement returns 429/Retry-After for saturation and fails closed in
production if unavailable. These are not blanket limits on every route. Quota
checks and provider deadlines are separate. A timeout on a mutation is an
ambiguous result, not authorization to repeat it.

## Server Actions and Direct Persistence

These are React/Next server actions, not stable manually callable REST endpoints:

| Action | Input / behavior |
| --- | --- |
| `saveBusiness` | FormData with optional `id`, required `name`, profile/contact/brand fields; newline-delimited languages, locations, USPs, offers; owner comes from session |
| `saveInstruction` | Optional `id`; `businessId,title,content,isActive`; nonempty trimmed title; update scoped to business |
| `deleteInstruction` | `id,businessId`; affected-row confirmation required |
| `setCreativeStatus` | `id`, `draft` or `approved`; affected-row confirmation required |
| `updateCreativeCopy` | `id`, `{headline,primary_text,description,cta}` with Create's limits (description may be empty); no AI call, status unchanged; description saved in `generation.concept.description`; returns `warnings` (claims the Brand doesn't back, never blocking), the saved fields and `liveNotice` when the ad is in a launched campaign |
| `deleteCreative` | `id`; local record deletion, not remote-ad deletion |

Actions return `{ok:boolean,error?:string}` and revalidate relevant pages.
Brand field validation lives in [validation](../src/lib/brand/validation.ts);
list parsing preserves commas in place names. Asset upload/delete and selection
also use browser Supabase/Storage APIs under RLS; see [Data Model](DATA_MODEL.md).
Do not document an invented upload REST route.