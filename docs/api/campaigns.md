# Campaigns API

Drafts, the planner, review, durable creation, activation, pause, delete and per-campaign edits. Conventions: [API reference](README.md).

## Routes

`Envelope` means the typed family in [Response Families](README.md#response-families); `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
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
| PATCH | `/api/campaigns/[id]` | Pause/activation input -> `{ok,status,delivery,pause}` | Live Meta mutation (pause: campaign, ad sets and ads) + local mirror; activation uses customer reservation. Turning on answers **409** `code: switch_pending` while a new-audience copy waits, before any Meta write or reservation (#1518); an uncapped managed run whose allowance is under the account's live `min_campaign_group_spend_cap` (₹5,000 for INR) answers **409** naming that minimum; `customer_ad_reserve` refuses it in the same transaction, so nothing is held and Meta is not written (#1799); pausing is never refused |
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

**One owner per Meta campaign (#1138).** The routes above that can write to Meta (`[id]` PATCH, `refresh`, `audience`, `audience/switch`, `budget`, `ads/[adId]` and `ads/[adId]/status`) answer **409** `{error, code:"owned_elsewhere"}` before any Meta call when the row's Meta campaign belongs to another AdBrain business (the sync rule above, read with the service role), and **503** when that can't be read.

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
[campaign interview and framework choice](../AI_PIPELINE.md#campaign-interview).

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
mode needs the [worker migration](../DATA_MODEL.md#migration-map) and a running
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
[the activation payload](../../src/lib/campaign/activation.ts) after the owner reviews
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
