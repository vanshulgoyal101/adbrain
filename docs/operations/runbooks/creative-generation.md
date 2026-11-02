# Creative Generation Runbook

Part of the [incident playbooks](README.md#incident-playbooks).

### Creative Generation Reconciliation

The `creative_generation_reconcile` RPC is installed in Production under migration
checksum `99d1be625171c48dee4cbe7bec71d749169742a2a49b2c113dd1cd36c2f6f681`. Only an
authorized service operator may call it, after identifying the exact owner,
business and generation UUID and confirming all provider text/image attempts
against per-generation provider evidence. A 502, absent ID, missing usage row,
zero-token error receipt or expired request is not proof of zero spend or finality.
The caller must verify the provider total and final outcome, check saved creative
count, and supply a sanitized evidence reference, operator reference and the
currently observed accounted/reserved counters. No raw provider export, API key,
prompt, customer data or signed URL belongs in the evidence reference.

The RPC checks tenant, state, receipt version, current counters, recorded usage
and saved count; it appends missing verified usage before releasing the uncertain
reservation, audits the transition and blocks duplicate or late mutation. It
also rejects later generation-linked usage or newly saved creatives; existing
creative content may still be edited. It does not infer finality from local data
or offer a customer-facing repair action.
Pre-instrumentation intents, including the held September 29 #54 request, remain
blocked. Verify the migration ledger and grants in any other environment; an
operator must obtain external evidence for each eligible intent before calling
the RPC. Evidence for the held September 29 request cannot make it eligible.

### Creative Regeneration Claims

Before deploying the regeneration claim caller, apply the reviewed
`20261001_creative_regeneration_claims.sql` migration to the verified target and
independently confirm its ledger checksum, private table RLS, and service-role-only
execute grants on both claim and finish RPCs. Do not replay the canonical schema.
An overlapping request receives 409. After
`20261029_creative_regeneration_stale_claims.sql`, a `processing` claim untouched
for 15 minutes (a request killed past `maxDuration` or by a deploy) is taken over
by the next attempt (#2219); an `unresolved` claim never expires or authorizes
another paid attempt. A free-picture failure (Pollinations, Cloudflare) is a known
$0 outcome and no longer creates an `unresolved` claim. The finish RPC releases only a
`processing` claim with a known outcome; it cannot clear an `unresolved` claim.
A fact-check rejection is a known outcome when every text attempt completed and its
usage receipt saved: the route releases it and returns 422 (#281).

For an uncertain regeneration, retain the creative, business, owner and original
attempt ID (the request ID). Compare the saved creative and usage receipts with
administrator-level provider evidence for every text and image attempt before
proposing recovery. A 502, missing receipt or zero-token error is not proof of
zero spend. Keep the claim and block retries until the outcome is established;
there is no customer-facing or automatic claim-clearing action. Any repair of an
`unresolved` row needs separately reviewed operator authority, a scoped verified
before-state and an exact-identity transaction. Never delete claims merely to
unblock a retry or use this procedure to clear the older #54 generation hold.
