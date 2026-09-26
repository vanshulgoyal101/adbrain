# Meta Approval Readiness

This is an operator checklist, not an approval guarantee. Earlier versions of this
page prescribed daily synthetic campaign creation and promised approval after a
fixed period. Those instructions are withdrawn: traffic volume, elapsed time,
code tests and own-account success do not establish permission to serve arbitrary
customers. Do not create disposable campaigns merely to inflate API activity.

Use this guide to assemble a truthful submission and identify the next missing
external decision. Source inspected September 26, 2026 at development
`672eb132ad57bb3ba31f118afaffddaa878b4923`; no Meta dashboard approval status was
reverified and no provider call was made for this rewrite. Do not substitute the
Razorpay merchant's activation status for Meta app or advertising approval.

## Separate the Gates

Meta app configuration, app mode/roles, permission access level, business
verification, Marketing API access tier, account/Page tasks, billing and individual
ad review are distinct. The exact applicable requirements are determined by the
current Meta dashboard and official documentation for the intended use case.

AdBrain's local capability probes check specific runtime access; they neither
submit reviews nor override provider decisions. Read [Meta Connect](META_CONNECT.md)
for the implemented connection and publishing path.

| Gate | Evidence to record | What does not satisfy it |
| --- | --- | --- |
| App configuration and callback | Intended app identity, origin/callback match and Login configuration | A reachable AdBrain home page |
| Roles, app mode and permission access | Current dashboard status for each requested use case | An app administrator's successful API call |
| Business verification / API tier | The applicable provider requirement and dated decision | Repeated synthetic traffic or an elapsed-time target |
| Customer consent and asset tasks | Consented external owner completes callback, sees the correct pair, returns to saved work | Mocked OAuth, a copied token or matching login email |
| Runtime capability | Current independent probes and granted scopes for that binding | A global "connected" label |
| Activation and ad review | Explicit owner intent, current delivery/billing/ad eligibility and app guardrails | Paused creation, a funding-source ID alone, or a passing source test |

### Existing Evidence Boundary

The [September 7 connection verification](meta-connect-workers/VERIFICATION-2026-09-07.md)
records local Auth/draft/database/browser work with mocked Meta consent and a
real login attempt that did not complete a callback. Preserve that scope; it is
not proof of non-app-role customer access. The
[September 26 SDK/query release](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release)
records a deployed software change and bounded application checks, not a fresh
Meta review decision. #34/#35 are feature candidates and supply no new live
consent or lead-download evidence. A newer provider decision needs its own dated,
sanitized receipt before this guide can claim it.

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

A useful recording follows one consented owner from saved draft to consent,
correct asset selection and return to that same draft. Show blocked or unknown
capabilities honestly. Consent alone must not create or activate an ad. A separate
paused-creation demonstration still mutates Meta and needs scoped authorization;
activation spends money and is not required just to prove callback recovery.

## Permission Evidence

[OAuth code](../src/lib/meta/oauth.ts) builds a Graph v21.0 login URL and currently
requests these scopes. The configured Login for Business flow and provider's
current rules must be reviewed separately; this table describes source, not
permission approval or a recommendation to request unnecessary access.

| Requested scope | Source use to demonstrate |
| --- | --- |
| `ads_read` | Account insights; the verifier also accepts granted `ads_management` for that read |
| `ads_management` | Reviewed paused creation and separately authorized campaign status/deletion operations |
| `leads_retrieval` | Authorized Page enquiry import |
| `pages_show_list` | Discover the owner's accessible Pages |
| `pages_read_engagement` | Page access evidence used with the form/lead capability probe |
| `pages_manage_ads` | Page advertising capability alongside asset tasks |
| `business_management` | Business/asset relationship discovery |

Compare requested scopes with granted scopes from token inspection and the
[capability verifier](../src/lib/meta/capability-verification.ts). Inspect denied,
expired or unavailable scopes rather than bypassing the guard with a system-user
token. Changing scope requests/configuration is implementation/configuration work,
not an edit authorized by this documentation task.

Useful evidence includes exact app identity, dated review feedback, affected
permission/use case, request category and sanitized correlation identifiers.
Private leads, access tokens, secret URLs and credentials do not belong in public
review recordings, tickets or repository docs.

For a synthetic evidence entry, record: app alias `review-fixture`, reviewed
source SHA, UTC observation time, intended permission/use case, actor class
(`app-role` or `external-owner`), expected/observed result, sanitized request ID,
and the specific unresolved decision. Store reviewer access material only through
the approved private channel, never in this entry or a URL query string.

## After Submission

There is no repository-defined minimum call count or guaranteed approval date.
Operate legitimate, consented workflows within current access. If rejected,
address the specific feedback rather than manufacturing activity. Own-account or
app-role tests cannot substitute for a real external customer's consent evidence.

The internal traffic endpoint is bounded and access-controlled; its draft-creation
mode is disabled. It is not a customer onboarding API, a review bypass, or proof
of production readiness. Do not run it without a defined diagnostic purpose.

If consent fails, distinguish callback/state/configuration failures from asset
discovery, missing tasks and provider review restrictions. Use
[Meta recovery guidance](META_CONNECT.md#attempt-lifecycle) for the app path and
the exact provider feedback for an appeal/resubmission. Do not remove owner,
capability, paused-creation or spending protections to make a recording succeed.

Official starting points: [Meta app dashboard](https://developers.facebook.com/apps/),
[Marketing API](https://developers.facebook.com/docs/marketing-apis/),
[App Review](https://developers.facebook.com/docs/app-review/), and
[Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/).
Recheck current requirements there before making an external-process claim.