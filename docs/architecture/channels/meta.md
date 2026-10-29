# Meta

Part of [Channels](README.md). Current facts as of 2026-10-29. When one changes, change
it here and in its source in the same PR. How connecting works:
[Meta connection](meta-connect.md); the App Review packet:
[Meta approval plan](../../plans/meta-approval.md).

## API Version

| Fact | Value | Source |
| --- | --- | --- |
| Graph API version | `v26.0` | `GRAPH_VERSION` in `src/lib/meta/graph-version.ts` |
| Recorders | Pin `v26.0` themselves; bump them with the app | `scripts/record-meta-*.ts` |
| OAuth dialog | `https://www.facebook.com/v26.0/dialog/oauth` | `src/lib/meta/oauth.ts` |

## Access and App Review

| Fact | Status | Source |
| --- | --- | --- |
| Marketing API Access Tier (Meta renamed "Ads Management Standard Access"; tiers Limited/Full) | Approved Aug 25; renewal in review since Oct 28 | #156 (CEO read, Oct 28), #2049 |
| Advanced access for the 7 login permissions | "Review in progress" since Oct 28; Meta says most reviews finish within 20 days | #156 |
| Access Verification as a Tech Provider | "In Review" (about 5 days) | #156, #517 |
| Business verification, Data Use Checkup, app Published | Done | [Owner checklist](../../plans/meta-approval.md#owner-checklist-one-sitting) |

Until review passes, only people with a role on the app can connect. Approval is
Meta's decision: never create campaigns or calls to raise API activity.

## Permissions

The seven `META_LOGIN_SCOPES` in `src/lib/meta/oauth.ts`: `ads_management`, `ads_read`,
`leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`,
`business_management`. All are used; why each one is needed:
[App Review](meta-app-review.md#app-review-156). After connect, the granted list
decides what is available (`src/lib/meta/capability-verification.ts`): insights need
`ads_read` or `ads_management`; leads need `leads_retrieval` and
`pages_read_engagement`; advertising needs `ads_management` and `pages_manage_ads`.

## Rate Limits

| Fact | Value | Source |
| --- | --- | --- |
| Limited tier budget | 60 points per ad account per 5 minutes; a write costs 3 | [Provider access prerequisites](../../ARCHITECTURE.md#provider-access-prerequisites) |
| Throttle codes | `4` app; `17`, `613`, `80000`–`80014` user or ad account; `32` Page | `isThrottleCode` in `src/lib/meta/client.ts` |
| Wait | Meta's estimate from `x-business-use-case-usage` (minutes) or `x-ad-account-usage` (seconds), else 15 minutes | `throttleWaitMs`, same file; tape from `scripts/record-meta-throttle-headers.ts` |
| Behaviour | `MetaThrottledError` (`reason: "rate_limited"`, scope app/account/page). The results-refresh and lead-sync crons skip a throttled account and stop on an app throttle; a person's pause or activation is still tried | `src/app/api/cron/refresh-results/route.ts`, `src/app/api/cron/sync-leads/route.ts` |
| Open work | #1838 (slices #1950, #2033) | #1838 |

Parallel campaign builds share one account's budget; none may assume it is its own.

## Recorded Provider Behaviour

Recorded from Meta, not guessed. Map errors by code and subcode, never by message text:
the text follows the token owner's locale (#185).

| Behaviour | Recorded answer | Tape or issue |
| --- | --- | --- |
| Advantage+ audience (`advantage_audience: 1`, default on from v23) | Hard `age_min` above 25 refused (subcode `1870188`); hard `age_max` below 65 refused (`1870189`). Send the owner's range as `age_range` | `advantage-audience-validate.json` |
| Stories/Reels placement creative | Refused with `1772103` ("Instagram account is missing") unless `object_story_spec.instagram_user_id` is the Page's Instagram account | #333, #447 |
| WhatsApp destination | A WhatsApp Business number in `promoted_object.whatsapp_phone_number` is accepted with the Page's `whatsapp_number` empty | #209 |
| WhatsApp number status | A number reading `DISCONNECTED`/`NOT_VERIFIED` still delivered and got chats; don't require `CONNECTED` | #286 |
| Listings | Lists can be newest-first (bind by stored ID, #197); default listings hide archived ads unless the status filter is passed (#188) | #188, #197 |
| Learning phase | About 50 optimisation events in 7 days after the last significant edit; a significant edit restarts it, so never edit a live run | `scripts/plan-check.ts` |

## Fixtures and Gates

- Tapes: `tests/core/fixtures/meta/` (60 recorded responses, scrubbed of tokens and IDs).
- Recorders: `scripts/record-meta-*.ts` (30), run with
  `npx tsx --env-file=<.env.local> <script>`. They call the real account: read each
  script's header before running it, and record new create paths with `validate_only`.
- Launch gate: `tests/core/launch-validate.test.ts` requires every create POST to equal a
  payload Meta accepted with `validate_only` (`launch-validate.json`). Part of `test:core`.
- Campaigns are created PAUSED and activated as a separate step; see
  [Review and go live](../../product/review.md).

## Adapter Boundary

ADR-001 (#1805, proposed) moves these calls behind a channel adapter. Today they live in
`src/lib/meta/`; `MetaThrottledError.reason` already maps to the adapter's
`ChannelError` code `rate_limited`
([Architecture](../../ARCHITECTURE.md)).
