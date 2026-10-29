---
name: payment-state-reconciliation
description: "Use when hosted checkout, saved orders, callbacks/webhooks, changing consent or funding prerequisites, refunds and delayed payment attempts share one workflow."
---

<!-- Generated from vanshulgoyal101/skills@eb9e65d skills/payment-state-reconciliation.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Payment State Reconciliation

## Trigger

Use when hosted checkout, saved orders, callbacks/webhooks, changing consent or
funding prerequisites, refunds and delayed payment attempts share one workflow.

## Invariant

An immutable order identifies the intended merchant, environment, tenant, amount,
currency and accepted policy. New collection requires current authorization;
recovery preserves existing liabilities even when collection is suspended. Test
captures, signatures and order status alone never grant spend or activation authority.

## Failure pattern

Three distinct failures were reproduced in an isolated payment implementation:

- A user accepts terms A; a status refresh replaces them with B while the checkbox
  stays checked. Checkout submits B without the user accepting it.
- An unpaid saved order bypasses funding expiry/revocation or connection-generation
  checks because the replay/read path returns before the new-order prerequisite.
- An older failed attempt arrives after a different attempt captured the order.
  It is mistaken for contradictory capture evidence and creates a permanent refund hold.

Other uncertainty comes from lost callback responses, duplicate delivery, queued
webhooks and out-of-order refund evidence. A successful happy path does not cover it.

## Recommended method

1. Reuse the maintained provider SDK and documented APIs. Keep tenant validation,
   local persistence, consent and financial state transitions in the application.
2. Persist intent and local idempotency identity before provider creation. Preserve
   an uncertain create/refund instead of blindly issuing a replacement operation.
3. Compute an immutable server quote in checked integer minor units. Version policy
   semantics; do not reinterpret an existing pre-tax contract as a tax-inclusive one.
4. Bind consent to the displayed policy identity/hash. Changed or unavailable terms
   invalidate acceptance; renewed acceptance must submit the new identity explicitly.
5. Revalidate prerequisites required by the order's policy before exposing or
  reopening checkout, including saved reads and same/new-key replay. Funding
  evidence is mandatory only for policies that require it; preserve the checks
  on historical orders when a new operating policy removes that prerequisite.
   Keep the original order/evidence immutable. No checkout is different from no history.
6. Authenticate callbacks against the stored order and verify actual provider capture,
   amount, currency, account and environment. Bound raw webhook bodies and verify
   signatures before trusting parsed data. Never infer a tenant from client notes.
7. Deduplicate both provider delivery and the underlying business effect. Different
   event IDs can describe the same capture. Serialize claims/posting/refunds and
   preserve unmatched conflicts for later reconciliation.
8. Distinguish order identity from payment-attempt identity. A late distinct failed
   attempt must not poison a verified capture. Reconcile the actual unique capture
   where needed; retain holds for same-payment contradictions, refunds or disputes.
9. Keep status/reconciliation usable when new collection is blocked. Closing the
   modal, timing out or losing a response does not prove that money did not move.
10. Separate allocation, reservation, provider funding, delivery, settlement and
    refunds. A ledger entry is not a transfer, and a merchant activation banner is
    not a settled transaction or permission to advertise with customer funds.

### Spend observations and protection scope

- Financial-hold protection must reach the same at-risk campaigns from scheduled
  and on-demand paths. An optional weekly budget preference must not filter those
  businesses out of the scheduled hold sweep.
- Require explicit valid spend, matching currency/period and complete relevant
  observations. Missing metrics are unknown, not zero; a dated response alone
  does not prove the requested amount was supplied.
- Exclude only provably unlaunched drafts from provider-spend coverage. Preserve
  paused-but-spent, launched/uncertain and missing-active-binding cases rather
  than filtering to whichever records have convenient observations.
- Report partial pagination and uncertain remote/local pause separately from
  confirmed protection. A daily job is not a real-time provider hard cap, and
  reporting snapshots are not audited lifetime cost/tax/finality evidence.

## Discriminating checks

- Accept A, refresh to B/unavailable, and assert checkout stays unavailable until
  renewed consent; verify that the submitted policy hash is B.
- Revoke/expire funding or change account generation after order creation. Read
  and replay the saved order: no usable checkout, unchanged identity, readable history.
- Capture with one payment ID, then deliver an older distinct failed attempt.
  Assert no new conflict hold; contradictory evidence about the capture still holds.
- Lose verification's response, repeat a callback, dismiss and reload. Recover the
  same order without a new order/refund or fabricated success.
- Queue an event during storage/provider failure, suspend collection, then reconcile
  as the owner. Verify captured history without granting activation or duplicate credit.
- Race order/refund claims, send wrong tenant/account/environment amounts, and deliver
  refund-before-capture or unmatched conflicts. Verify transaction-safe denials and holds.
- Disable optional weekly protection while an active campaign has held funds;
  the scheduled scope must still examine it. Omit spend from an otherwise dated
  weekly response; it must not become a verified zero-spend observation. Add an
  unrelated unlaunched draft; it must not cause a needless active-campaign pause.

## Common traps

- Replacing a test-key prefix or removing a test gate and calling the result production.
- Treating current-policy equality as proof that current funding is still valid.
- Treating every delayed failed attempt as a contradiction about the captured payment.
- Letting a late capture erase a refund/dispute hold.
- Calling synthetic hosted-checkout UI or signed test captures live settlement evidence.
- Using software-deployment authority as consent for live charges, refunds or mandates.
- Reading a credited order as proof of webhook delivery. Reconciliation can
  record a capture while the signed-event table stays empty; check both. Bank
  settlement confirms the money, not that the backup webhook path works.
- Assuming a missing webhook was never sent. Read the route's logged status codes
  first: a month of deliveries had failed as 400 signature mismatches (#178, #190).

## Related methods

[Database invariants](database-invariants.md), [async lifecycle guards](async-lifecycle-guards.md)
and [verification gates](verification-gates.md) cover the storage, ownership and
evidence boundaries. These cases are based on reproduced local failures and
passing targeted repairs; they do not certify a provider's live settlement path.


## AdBrain lessons (Oct 28–29)

- Margin leaks hide in JSON, not just screens: strip responses with a strict view schema
  at the boundary and pin derived numbers to literals so a test fails if one returns
  (#1497).
- Show money totals from the same helper the server's check uses, so the screen and the
  refusal can't disagree (#1271).
- A pending snapshot means every writer to the live object must refuse while it waits;
  grep for the shared guard before review (#1146).
- Hashed, versioned terms can't be reworded; retire the old version for new payments
  instead (#1536).
