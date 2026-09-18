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