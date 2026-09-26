# Customer Payments and Managed Advertising

Current payment decisions and implementation boundaries, reconciled September 26,
2026. Owner requests live-payment rollout. Razorpay merchant readiness is verified;
AdBrain's implemented checkout remains local and test-only. This guide does not
authorize a charge, bank action, credential change, migration or ad activation.

Implementation is assigned to Dev 2 in [#45](https://github.com/vanshulgoyal101/adbrain/issues/45):
production checkout, durable orders, verified captures, webhook/reconciliation
and refund recovery using the existing SDK. It proceeds alongside documentation,
not after the documentation milestone. Delivery timing depends on the accepted
candidate and explicit rollout prerequisites, not merchant onboarding already done.

## Verified Razorpay Account Status

Authenticated read-only inspection after owner sign-in confirmed:

- The dashboard explicitly says "You are in live mode".
- Activation details show "Account Access: Complete" and activation on
  September 26, 2026 at 01:30 pm; the displayed timezone was not established.
- Bank settings show "Active bank account" and "Settlements: ACTIVE".
- `https://adbrain.vanshul.com` is listed as "Approved".

No keys were generated or viewed, settings changed, or payments/refunds/settlements
triggered by this inspection. Bank identifiers and identity documents are omitted.
Do not repeat unknown activation, bank-status or website-approval blockers.
These labels do not prove an actual settlement, a live AdBrain transaction,
automatic Meta funding or approval for every proposed future funds model.

## 1. Goal and Decisions

| Subject | Agreed direction | Still required |
| --- | --- | --- |
| Operator | Vanshul Goyal's unregistered business; permitted merchant display is Vanshul Goyal | A future Solaride arrangement needs formalization and applicable provider approval |
| Customer payment | One INR 10,000 annual total | Finite service scope, dates, invoice treatment and accepted terms; no automatic renewal |
| Allocation | INR 2,000 service; INR 8,000 Meta media including applicable Meta taxes | Versioned approved quote and accounting rules; do not silently add customer tax |
| Gateway fees | Absorbed by AdBrain | Verify economics after fees, fee taxes, support, refunds and disputes |
| Delivery funding | Automatic Meta payment, with one customer payment | A provider-supported, account-specific route and separately authorized setup/test |
| Proposed account model | Separate Solaride-owned customer ad accounts | Legal relationship, capacity, consent, access, ownership disclosure and offboarding |

The allocation is a restricted service obligation, not a general-purpose wallet,
arbitrary forwarding service or proof of cash already at Meta. Manual top-ups and
customer-direct Meta billing are alternative product models, not silent fallbacks.
Customer invoice tax treatment and principal/agent obligations need qualified
review; this document is not legal or tax advice.

### Annual Package and Illustrative Economics

If applicable Meta tax is 18%, INR 8,000 contains approximately INR 6,779.66 media
and INR 1,220.34 tax. At INR 200/day media that is about 33.9 budget days, not a
year of continuous advertising. Daily spend may vary; a configured daily budget
is not a hard cap or authorization to spend.

INR 2,000 is not profit. Gateway costs, generation/regeneration, support time,
infrastructure, refunds and reserves reduce it. The older pre-tax scenarios and
unapproved package scope remain in the [historical economics](PAYMENTS-HISTORY-2026-09-26.md#annual-package-and-illustrative-economics).
Do not copy their INR 11,800 illustration into the current INR 10,000 offer.

## 2. How Money Actually Moves

Customer capture creates a gateway receivable and a service obligation. Gateway
settlement moves net cash to the merchant bank after fees and adjustments. An
internal allocation earmarks liability; it does not transfer funds to Meta.
Meta charges through its supported billing arrangement, and delivery consumes
the approved allocation. Refunds/disputes and revenue recognition are separate.

Keep order, capture, settlement, allocated, reserved, delivered and reconciled
states distinct. A browser success callback, a paid order or an active settlement
account cannot stand in for all of them. Do not invent a Razorpay-to-Meta top-up
API or treat the internal charge-event schema as a documented Meta webhook.

## 3. Can AdBrain Create Ad Accounts?

Automated provisioning is a later, provider-gated capability, not an unconditional
checkout promise. Verify actual portfolio eligibility, remaining capacity,
permissions, end-advertiser identity, INR/timezone requirements and customer Page
consent. An account ID is not funding evidence, and a displayed limit is not a
count of unused slots. Never create portfolios/accounts to evade restrictions.

Existing-account connection remains available through the documented
[Meta workflow](META_CONNECT.md). Proposed agency ownership, access and offboarding
terms must be explicit; do not promise ownership transfer or silently rebind
existing accounts. Preserve uncertainty after a provisioning timeout rather than
blindly creating another account.

## 4. Repository Integration and Data Design

| Existing surface | Reuse | Boundary |
| --- | --- | --- |
| [Allocation](../src/lib/payments/allocation.ts) | Integer-paise arithmetic and versioned quotes | Current pre-tax-base helper is not the approved annual tax-inclusive product contract |
| [Razorpay adapter](../src/lib/payments/razorpay-test.ts) | Official SDK and validated provider results | Explicit local test gate; production/Vercel and live keys rejected |
| [Verification](../src/lib/payments/razorpay-verification.ts) | Constant-time checkout/raw-webhook signatures and captured-order matching | Signature verification alone grants no entitlement |
| [Test workflow](../src/lib/payments/test-checkout.ts) and [UI](../src/components/test-checkout.tsx) | Stored test orders, callback verification and reload recovery | Test environment only; every capture remains non-spendable |
| [Funding assessment](../src/lib/payments/meta-funding.ts) and [store](../src/lib/payments/meta-funding-store.ts) | Account-bound evidence, expiry/revocation and conflict handling | Not a proven automatic funding adapter or cash ledger |
| [Campaign creation](../src/lib/campaign/create-service.ts) | Reviewed paused creation and durable operation recovery | Not a general payment ledger or atomic activation reservation |

The optional [test-order migration](../db/migrations/20260926_razorpay_test_orders.sql)
and [billing](../db/migrations/20260924_managed_billing.sql)/[event](../db/migrations/20260924_meta_billing_events.sql)
migrations exist in source. Their production application is not established by
the code-only release. Follow [Data Model](DATA_MODEL.md) and
[Releasing](RELEASING.md) for target-specific prerequisites and approval.

Production orders, event processing, customer liabilities, reservations, refunds
and settlements remain implementation work. Use safe integer minor units,
tenant/currency invariants, immutable policy/quote versions, unique business-event
keys and server-authorized writes. Client notes must not determine tenant,
merchant, account, amount or authority. Keep raw card data and secrets out of
application storage, logs and documentation.

## 5. Payment Protocol

Required production behavior, not a claim that the test backend implements it all:

1. Resolve authenticated ownership and approved service terms; calculate an
   immutable server quote. Persist intent before creating a provider order.
2. Open hosted checkout with public configuration only. An interrupted create
   retains its identity; an ambiguous provider response is not permission to reorder.
3. Verify the callback against the stored order, then independently match captured
   amount, currency, merchant/environment and tenant binding. Authorization alone
   must not grant spendable funds.
4. Verify bounded raw webhook bytes before parsing; record durable processing
   identity and reconcile unmatched/out-of-order events. Both provider event and
   business capture identity need duplicate protection.
5. Apply financial state changes transactionally and once. Preserve refund,
   dispute and conflict holds when delayed capture events arrive.
6. Reconcile provider state, local obligations, settlements/bank and Meta costs.
   Expose unresolved liabilities instead of inventing a successful or failed result.

Test and live records/credentials must stay distinct. Do not remove test-only
guards to enable production or reinterpret existing test captures as real money.

## 6. Funding, Activation and Refund Safety

- Capture is not campaign activation. Require recorded, bounded delivery consent
  and atomic reservations that cannot be spent twice by concurrent requests.
- Missing/stale spend and uncertain provider effects are liabilities, not zero.
  Use supported limits, delivery-lag allowance and reconciliation; delayed Insights
  and weekly commitments alone cannot guarantee a prepaid hard cap.
- Direct Ads Manager changes can invalidate assumptions. Reconcile effective
  parent and child state, funding and budget drift; a failed pause is an incident.
- Serialize refunds against new reservations. Freeze affected entitlement,
  reconcile late spend and issue refunds under accepted terms. Mark completion
  only with provider evidence; spent media or gateway fees may not be recoverable.
- Service allocation is not earned cash available for immediate withdrawal.
  Revenue recognition, tax, refund/dispute reserves and bank reconciliation matter.

## 7. Customer and Operator Experience

Use the existing workspace billing location. Show the approved package, tax
treatment, payment status, receipt, allocation/reservation, delivery costs and
refund state. Do not call an internal allocation a Meta wallet balance or present
a test confirmation as a tax invoice. Closing checkout does not prove no charge.

Recovery must retain existing order identity and offer status/reconciliation,
not silently open another payment. Operator views should expose unresolved
payments, events, settlements, refunds and funding failures without raw secrets
or unnecessary personal data. Privileged corrections need a reason and audit trail.

## 8. Delivery Phases and Acceptance Gates

Owner's live-rollout request supersedes the old blanket instruction to defer all
checkout implementation. Feasibility and production integration can progress in
parallel; actual collection/delivery still needs the relevant gates below.

| Phase | Complete when |
| --- | --- |
| Contract and funding feasibility | Operator, annual scope/tax/refund terms and account-specific automatic funding route are established; actual financial setup has its own authority |
| Production financial core | Durable live orders/events and immutable quotes survive duplicate, concurrent and uncertain outcomes without duplicate entitlement |
| Gateway integration | Reused SDK/verification supports verified live context, secure configuration, public webhook processing and recovery; test records cannot cross the boundary |
| Delivery and refunds | Reservations, current funding/spend evidence, bounded consent, pause/reconciliation and refund holds work together |
| Bounded live verification | Exact authorized transaction, settlement/refund and delivery evidence reconcile on the approved production candidate and schema |

The [earlier M0-M7 design](PAYMENTS-HISTORY-2026-09-26.md#8-delivery-phases-and-acceptance-gates)
preserves detailed proposed tables, routes and cases. Its old source baseline,
onboarding gaps and worker sequence are not current dispatch or proof of deployed
contracts. Reuse suitable existing SDKs and helpers; do not build a generic billing
platform around unverified provider behavior.

## 9. Implementation Receipt

The [full implementation history](PAYMENTS-HISTORY-2026-09-26.md#9-implementation-receipt)
preserves local backend/UI tests, source-specific SDK transport details and setup
receipts. [API Reference](API_REFERENCE.md), [Configuration](CONFIGURATION.md) and
[Testing](TESTING.md) own current commands/contracts; historical commands are not
unconditional setup instructions.

Current source requires `PAYMENTS_TEST_ENABLED=true`, a loopback Supabase URL,
test keys, merchant identity and a separate webhook secret. Production Node mode
and all Vercel environments are rejected. The test order amount is fixed at
1,000,000 paise; records require `environment: "test"`. Captures retain
`canActivateCampaign: false` and `spendablePaise: 0`.

### September 26: Real Razorpay Test Transactions

The [dated provider receipt](PAYMENTS-HISTORY-2026-09-26.md#september-26-real-razorpay-test-transactions)
records two genuine Razorpay test captures and one deliberate test-bank failure,
signed callback verification, durable local capture records and reload recovery.
Incomplete attempts were preserved; they were not relabelled or replaced merely
to clear uncertainty. The receipt's tests were not replayed for this rewrite.

These checks did not prove live collection, public webhook delivery, refund
issuance, actual bank settlement or automatic Meta funding. The later merchant
status check above resolves account-readiness questions, not those transaction
and application requirements. No new provider action was performed for this guide.

## 10. Primary References

- [Current product contract](SPEC.md) and [roadmap](ROADMAP.md).
- [Exact code-only production release](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release).
- [Historical provider documentation and account investigations](PAYMENTS-HISTORY-2026-09-26.md#10-primary-references).
- [Historical automatic funding boundaries](PAYMENTS-HISTORY-2026-09-26.md#automatic-funding-boundaries).
- [Release and environment authority](RELEASING.md).
