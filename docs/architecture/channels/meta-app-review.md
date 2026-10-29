# Meta App Review

Part of [Channels](README.md). Connection, publishing and recovery: [Meta Connection](meta-connect.md).

## App Review (#156)

Serving businesses outside the app's roles needs Meta's App Review (advanced access per
permission, #156) and Access Verification as a Tech Provider (#517). Submission status, the
screencast script and the owner's dashboard checklist live on #156. Approval is Meta's decision:
no call volume, elapsed time or own-account success substitutes for it, so don't create
disposable campaigns to raise API activity.

Login uses Facebook Login, Graph `GRAPH_VERSION` (src/lib/meta/graph-version.ts, v26.0), redirect
`https://adbrain.vanshul.com/api/meta/oauth/callback`. Scopes come from
`META_LOGIN_SCOPES` in [oauth.ts](../../../src/lib/meta/oauth.ts). All seven are used;
none can be dropped without breaking the core loop.

| Permission | Why AdBrain needs it | Where the reviewer sees it |
| --- | --- | --- |
| `ads_management` | Upload images, create creatives, create the campaign/ad set/ads paused, pause and sync | `/campaigns` → Send to Meta (paused), Pause, Sync from Meta |
| `ads_read` | List ad accounts (`me/adaccounts`) and read campaign insights | `/settings` → Connect Meta → ad account picker; `/campaigns` results |
| `leads_retrieval` | Read the leads submitted to the customer's own lead forms | `/leads` → Check for enquiries |
| `pages_show_list` | List the Pages the user manages (`me/accounts`) | `/settings` → Connect Meta → Page picker |
| `pages_read_engagement` | Read lead forms and the Page's WhatsApp number for the ad destination | `/campaigns` → lead form dropdown; WhatsApp destination |
| `pages_manage_ads` | Run ads and lead forms on behalf of the selected Page | `/campaigns` → Launch with the selected Page |
| `business_management` | Read the owning Business of each ad account and Page so only valid account/Page pairs are offered | `/settings` → Connect Meta → paired account/Page choices |

Beyond the seven permissions, the submission also covers the **Marketing API Access Tier**
feature (Meta's new name for *Ads Management Standard Access*). Limited allows about 60 points per
5 minutes per ad account, and one campaign build uses about half of that; Full needs 500 calls in
15 days plus this review. Current status: [channels/meta.md](meta.md).

### App Dashboard URLs

| Dashboard field | Value |
| --- | --- |
| Privacy Policy URL | `https://adbrain.vanshul.com/privacy` |
| Terms of Service URL | `https://adbrain.vanshul.com/terms` |
| Data deletion callback URL | `https://adbrain.vanshul.com/api/meta/deauthorize` (returns `{url, confirmation_code}`) |
| Deauthorize callback URL (Facebook Login settings) | `https://adbrain.vanshul.com/api/meta/deauthorize` |
| Valid OAuth redirect URI | `https://adbrain.vanshul.com/api/meta/oauth/callback` |
| App domain / site URL | `adbrain.vanshul.com` / `https://adbrain.vanshul.com` |

If the dashboard prefers an instructions URL instead of a callback, use
`https://adbrain.vanshul.com/data-deletion`. All four pages are public.
