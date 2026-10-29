# Sign In and Connect Meta

Part of [Features and workflows](README.md).

## Sign In

Magic link, Google OAuth, and email/password use Supabase Auth. Provider setup and
email delivery are external prerequisites. Pending states prevent competing form
submissions; failures preserve the form and permit retry. Destinations must be
safe local paths. Signing in with a new address creates the account. The app has
no built-in team invitation, password-reset, or subscription entitlement workflow.

The sign-in page uses the workspace typography, shared form controls and brand
asset, with persistent Home and legal navigation. Email/password share one form;
password visibility can be toggled without submitting. Magic links validate only
the email address. The email confirmation can return to sign-in with the address
and safe destination preserved, focus restored, and the password cleared.

### Hand-over from a rep (#1783)

A rep can prepare a business and its ads on a prospect (`+prospect`) account, then
hand it to the owner from Settings ("Hand this account to the owner",
[prospect-hand-over.tsx](../../src/components/prospect-hand-over.tsx)). The checks
must pass first: "No Meta account connected", "No campaigns made" and nothing else
set up (WhatsApp alerts, payments); [transfer.ts](../../src/lib/prospect/transfer.ts)
words each blocker. The rep types the owner's email and taps "Hand to owner",
which opens a 30-minute transfer to that address. No link is sent, and the rep can
"Cancel hand-over".

The owner signs in with that email on their own phone. Before an empty business
is started, Home shows "Make [business] yours?" with up to three ad thumbnails
([claim-business.tsx](../../src/components/claim-business.tsx)). "Make it mine"
moves the business to the owner, signs everyone else out of it and lands on Home
with "It's yours. The 'Sample' mark is off your ads. Nothing runs until you tap Go
live." The owner then connects their own Meta and pays Meta themselves. "This
isn't my business" declines, and the rep sees the decline. Team accounts can't
accept: "Sign in with the owner's own email, not a team account." Owner-facing
steps are in [Your first ad on a phone](first-ad.md#if-someone-from-adbrain-set-it-up-for-you).

## Connect Meta

Settings opens the shared connection flow. The owner authorizes Meta, discovery
finds eligible account/Page pairs, and a verified selection is committed. Partial
discovery must not auto-select. Existing selection replacement requires explicit
confirmation. Account currency, permissions, billing, and restrictions can block
individual capabilities after authentication succeeds.

Capabilities are independent: read insights, read leads, create paused, activate.
An `unknown` capability is not permission to proceed. Expired/revoked credentials
require reconnect; other blockers may require action in Meta. Details are in
[Meta Connection](../architecture/channels/meta-connect.md).

Behind `META_SETUP_CHECKLIST` (#1016, #795 slice 1), Settings shows "Ready to launch on Meta"
under an owner's own connection: business portfolio, ad account in rupees (active), Facebook Page,
WhatsApp on the Page (the Page's number or one on the portfolio's WhatsApp Business account) and a
payment method (`funding_source_details`). Each row is a tick or one Meta link with an English and a
Hindi line. GET reads only (`MetaClient.setupReads`), recorded by
`scripts/record-meta-setup-checklist.ts`; never shown for AdBrain-managed accounts.

An ad account that isn't active (#1943) gets one plain line and action, from Meta's `account_status`
(`src/lib/meta/account-status.ts`), on the checklist row, the Connect account picker and Review's blockers:
2 disabled → Ask Meta to review (Account quality); 3/8/9 unpaid → Pay in Meta; 7 new account in review →
nothing to do yet; 100/101 closed → Connect another account; anything else → Open Account quality.
Every status but 1 blocks Go live. The words never say risk, policy violation or flagged.

Disconnect revokes the app's stored binding; **it does not stop remote delivery**.
Pause intended campaigns before disconnecting, or manage them in Meta afterward.
