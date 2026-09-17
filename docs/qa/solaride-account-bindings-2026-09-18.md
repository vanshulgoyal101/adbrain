# Solaride Account Binding Repair

## Confirmed Cause

Both requested owners had businesses but no `meta_connections` rows. The demo
business remained Cedar Ridge Chiropractic; the Gmail owner's business remained
solar energy. The business-scoped credential resolver correctly refused to use a
shared environment fallback. This was missing connection provisioning, not an
expired Meta token or a reason to remove tenant isolation.

## Authorized Repair

The owner requested that both the demo login and `vanshulg101@gmail.com` connect
to Solaride. Verified the existing system-user token with Meta: valid, matching
the configured app, access to active account `act_2398686420592052` (Solaride 101,
INR, Asia/Kolkata), business `1158100643072508` (Solaride), and Page
`885223068001054` (Solaride Energy).

The dry-run-first `scripts/bind-solaride-accounts.mjs` is an operation-specific
repair, not general account provisioning. Run through `tsx` with existing local
Meta/Supabase settings, `SUPABASE_ACCESS_TOKEN` and `PRODUCTION_ENV_FILE` supplied
securely. Its apply mode additionally requires `--apply` and
`META_BINDING_CONFIRM=BIND_TWO_SOLARIDE_ACCOUNTS`. It refuses to overwrite any
connection, verifies exact owner/business identities under row locks, and stores
two separately encrypted credentials and connection rows in one transaction.
Generation 1 fences older generation-0 connection attempts. The existing
production AES-GCM key was used without rotation; plaintext tokens were neither
logged nor stored in the repository. Re-running after success is intentionally
rejected, not treated as permission to replace working credentials.

No business profile, password, campaign, draft or budget was changed. The demo
profile still describes a clinic but now has real Solaride publishing access as
requested. Do not publish demo clinic creative to Solaride without reviewing that
business/account mismatch. Both logins can now act on the same external account;
their AdBrain business records remain isolated.

## Capability Checker Defect

The capability checker probed `leadgen_forms` with the system-user token. Meta
returned code 190: this method requires a Page Access Token. The existing
`MetaClient.listLeadForms` already used the correct Page-token sequence.

Updated only the capability probe to retrieve the selected Page's token first
and use it in the Authorization header for the forms request. Missing Page tokens
leave lead access unknown, without an account-token fallback. Tokens remain out
of URLs and responses. Regression coverage verifies the correct header, the
additional GET and the missing-token failure path.

## Evidence and Limits

- Production Settings displayed Connected for the demo account.
- Isolated authenticated sessions for both owners returned the selected Solaride
  account/Page from the production status endpoint and four active lead forms
  from the existing production client. Session creation sent no email and changed
  no password; verification sessions were signed out locally afterwards.
- Each owner received 404 for the other business's connection status.
- Corrected capability verification against Meta returned available for insights,
  lead access, paused creation and activation. These are read-only permission
  checks, not a campaign creation or activation test.
- Focused capability/client suite: 27 passing tests; TypeScript passed.
- No Meta mutation, lead download, paid generation or ad spend occurred. This
  administrator-provisioned system-user connection does not establish that the
  separate customer-facing Facebook consent flow has passed App Review.

For recovery, use the application's explicit disconnect action for the intended
business. Do not rotate the shared encryption key or restore a shared-token
fallback. The release PR records deployment and post-release capability evidence.