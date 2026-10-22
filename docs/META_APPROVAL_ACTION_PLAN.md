# Meta Approval Readiness

This is an operator checklist, not an approval guarantee. Earlier versions of this
page prescribed daily synthetic campaign creation and promised approval after a
fixed period. Those instructions are withdrawn: traffic volume, elapsed time,
code tests and own-account success do not establish permission to serve arbitrary
customers. Do not create disposable campaigns merely to inflate API activity.

## Separate the Gates

Meta app configuration, app mode/roles, permission access level, business
verification, Marketing API access tier, account/Page tasks, billing and individual
ad review are distinct. The exact applicable requirements are determined by the
current Meta dashboard and official documentation for the intended use case.

AdBrain's local capability probes check specific runtime access; they neither
submit reviews nor override provider decisions. Read [Meta Connect](META_CONNECT.md)
for the implemented connection and publishing path.

## Submission Checklist

1. Identify the intended customer flow and exact permissions requested. Map every
   permission to a real visible operation; avoid collecting broader access merely
   because an old script requested it.
2. Verify application identity, domains, Login for Business configuration, exact
   callback URL, privacy policy, data-deletion instructions and monitored contact.
3. Confirm the app/business prerequisites shown in the provider dashboard. Record
   the date and external status without storing tokens or reviewer credentials in Git.
4. Prepare a consented reviewer/test environment with realistic safe assets and
   clear step-by-step access instructions through an approved secure channel.
5. Record the actual flow: AdBrain login, business ownership, Meta consent,
   discovered asset selection, independent capability results, reviewed paused
   creation if required and authorized, and disconnect/deauthorization handling.
6. Explain data use, retention, public creative media, deletion and support
   accurately. Database metadata RLS does not make public Storage images private.
7. Submit only demonstrated functionality. Keep unresolved provider behaviors
   explicit, respond to review feedback, and record a new dated receipt.

## Permission Evidence

The current verifier examines `ads_read`/`ads_management`, `pages_manage_ads`,
`pages_read_engagement`, and `leads_retrieval` alongside successful probes and
asset tasks. This is not an exhaustive recommendation to request every scope:
discovery/configuration requirements and approved access depend on the provider.
Review [OAuth code](../src/lib/meta/oauth.ts) and current dashboard configuration
together; requested scopes are not proof of granted scopes.

Useful evidence includes exact app identity, dated review feedback, affected
permission/use case, request category and sanitized correlation identifiers.
Private leads, access tokens, secret URLs and credentials do not belong in public
review recordings, tickets or repository docs.

## App Review Packet (#156, 22 Oct 2026)

Login uses Facebook Login, Graph v21.0, redirect
`https://adbrain.vanshul.com/api/meta/oauth/callback`. Scopes come from
`META_LOGIN_SCOPES` in [oauth.ts](../src/lib/meta/oauth.ts). All seven are used;
none can be dropped without breaking the core loop.

| Permission | Why AdBrain needs it | Where the reviewer sees it |
| --- | --- | --- |
| `ads_management` | Upload images, create creatives, create the campaign/ad set/ads paused, pause and sync | `/campaigns` → Send to Meta (paused), Pause, Sync from Meta |
| `ads_read` | List ad accounts (`me/adaccounts`) and read campaign insights | `/settings` → Connect Meta → ad account picker; `/campaigns` results |
| `leads_retrieval` | Read the leads submitted to the customer's own lead forms | `/leads` → Sync leads |
| `pages_show_list` | List the Pages the user manages (`me/accounts`) | `/settings` → Connect Meta → Page picker |
| `pages_read_engagement` | Read lead forms and the Page's WhatsApp number for the ad destination | `/campaigns` → lead form dropdown; WhatsApp destination |
| `pages_manage_ads` | Run ads and lead forms on behalf of the selected Page | `/campaigns` → Launch with the selected Page |
| `business_management` | Read the owning Business of each ad account and Page so only valid account/Page pairs are offered | `/settings` → Connect Meta → paired account/Page choices |

### Dashboard URLs

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

### Screencast Script (one recording per permission, English UI, no secrets)

Common opening for every recording: open `https://adbrain.vanshul.com`, sign in
as the reviewer account, open `/settings`, click **Connect Meta**, show the Meta
consent dialog listing the permission, approve it, and return to AdBrain.

1. `pages_show_list`, `business_management`, `ads_read`: on return, show the ad
   account and Page pickers filled from Meta. Choose one pair and save it.
2. `ads_management`, `pages_manage_ads`: on `/studio`, approve ads and click
   **Create campaign**. In `/campaigns`, pick the Page, audience and budget,
   review the plan and click **Send to Meta (paused)**. Show the campaign
   arriving **paused** in Meta Ads Manager, then **Sync from Meta** and
   **Pause** in AdBrain. Do not activate or spend.
3. `pages_read_engagement`: in the campaign composer, open the lead form dropdown
   so it lists the Page's forms (and the WhatsApp destination if the Page has a number).
4. `leads_retrieval`: on `/leads`, click **Sync leads** and show a test lead
   (submitted with Meta's Lead Ads Testing Tool) appear in the inbox.
5. Close each recording with **Disconnect** in `/settings`.

### Owner Checklist (one sitting)

1. **Business verification** (Business Settings → Security Center): legal business
   name, address, phone, website `adbrain.vanshul.com`, a verified domain or email,
   and one official document showing the legal name and address (e.g. GST
   certificate, certificate of incorporation or a recent utility bill).
2. **App settings → Basic**: icon (1024×1024), category, contact email, and the
   URLs in the table above. Save and confirm there are no red warnings.
3. **Facebook Login → Settings**: redirect URI and deauthorize callback as above.
4. **App Review → Permissions and Features**: request advanced access for each
   of the seven permissions (and Ads Management Standard Access if it is listed).
   For each one, paste the "Why" text from the table, attach its screencast,
   and give the reviewer login through the dashboard's secure test-credentials field.
5. Complete **Data Use Checkup** and any Access Verification the dashboard asks
   for, then click **Submit**.
6. Wait: Meta usually answers within days to a few weeks. Business verification
   can add more time. Reply to the feedback point by point.

## After Submission

There is no repository-defined minimum call count or guaranteed approval date.
Operate legitimate, consented workflows within current access. If rejected,
address the specific feedback rather than manufacturing activity. Own-account or
app-role tests cannot substitute for a real external customer's consent evidence.

The internal traffic endpoint is bounded and access-controlled; its draft-creation
mode is disabled. It is not a customer onboarding API, a review bypass, or proof
of production readiness. Do not run it without a defined diagnostic purpose.

Official starting points: [Meta app dashboard](https://developers.facebook.com/apps/),
[Marketing API](https://developers.facebook.com/docs/marketing-apis/),
[App Review](https://developers.facebook.com/docs/app-review/), and
[Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/).
Recheck current requirements there before making an external-process claim.