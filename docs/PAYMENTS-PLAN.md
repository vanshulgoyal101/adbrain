# Customer Payments and Managed Advertising

Current payment decisions and implementation boundaries, reconciled September 26,
2026. Owner explicitly requests live collection as soon as possible with
operator-managed Meta payments. Repaired payment code is integrated on dev
through PR46; this is not yet enabled production collection. Rollout authority
lives in [the dispatch](ORCHESTRATION.md).

## Current Funding Boundary

Latest owner decision, September 26: customer payments settle through Razorpay to
the operator's bank account. The operator pays Meta separately, manually or by
bank/card arrangement. Automatic Meta funding verification and bank-to-Meta
automation are no longer checkout or release prerequisites. This explicitly
supersedes the earlier funding-first requirement and investigation.

AdBrain tracks each customer's verified captured/refunded amounts, service and
advertising allocations, reservations, attributed advertising costs and remaining
allowance. A pooled bank/Meta balance is not customer credit. Keep the agreed
INR 10,000 annual total: INR 2,000 service and INR 8,000 Meta costs including tax;
gateway fees remain an operator expense, not an extra customer charge.

Use a versioned operator-managed policy in server/config/SQL, not fake funding
evidence or rewritten old terms. New checkout must work without an automatic
funding record or completed Meta onboarding. Merchant, tenant, amount, policy
consent and test/live verification remain required. Old payment history and
reconciliation stay available; changing funding responsibility is not a refund.

Capture is not ad activation. Managed campaign approval/execution must use the
correct customer's remaining allocation with atomic reservations and existing
spend controls. Refunds/disputes/uncertain costs cannot create available money.
Meta account/campaign ownership and delivery capability still matter at launch,
but proof of how the operator pays Meta does not. No live bank/Meta operation or
automatic campaign activation is requested by this change.

Priority: remove the superseded checkout gate and complete live setup now;
deliver customer accounting/spend controls in parallel. Do not enable managed
ad spending until those controls are present and checked. Do not describe a
disabled deployment as completion of the owner's live-collection request.

## Approved Initial Offer

Owner explicitly approved this initial live-checkout policy on September 26, 2026:

- INR 10,000 total for 12 months; one business, one offer/service area, up to two
  creatives and one capped Meta campaign.
- INR 2,000 service allocation; INR 8,000 advertising allocation including Meta
  taxes. Gateway fees are absorbed; no extra checkout charge or automatic renewal.
- No promise of year-round ad delivery, a lead count, sales or other guaranteed result.
- Full refund before work starts. Afterward, unused advertising allocation is
  refundable after reconciling pending costs.
- The INR 2,000 service allocation is earned only after the agreed creatives and
  campaign setup are delivered; otherwise it remains refundable.
- Invoice uses the current operator's actual tax status, with no invented GST
  claim. Mandatory customer rights remain applicable.
- The operator handles Meta payments externally. Approval does not initiate a
  charge, refund, bank operation or campaign activation.

Implement these as versioned terms shown before customer consent. Do not mark
service allocation earned at capture, or charge a fee on top of the total.
This is an approved commercial policy, not a determination of the operator's tax
registration. Preserve the actual approval reference and original order terms.

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
| Customer payment | Approved initial offer above: INR 10,000 total for 12 months | Versioned terms and explicit customer acceptance; no automatic renewal |
| Allocation | INR 2,000 service; INR 8,000 Meta media including applicable Meta taxes | Versioned approved quote and accounting rules; do not silently add customer tax |
| Gateway fees | Absorbed by AdBrain | Verify economics after fees, fee taxes, support, refunds and disputes |
| Delivery funding | Operator pays Meta externally, manually or by bank/card arrangement | No automatic-funding proof before checkout; enforce each customer's paid advertising allowance inside AdBrain |
| Proposed account model | Separate Solaride-owned customer ad accounts for future managed delivery | Legal relationship, capacity, consent, access, ownership disclosure and offboarding; not a live-checkout prerequisite |

The allocation is a restricted service obligation, not a general-purpose wallet,
arbitrary forwarding service or proof of cash already at Meta. Operator-managed
Meta payment is now explicitly chosen. Customer-direct Meta billing has not been
selected; the operator's external bank/card setup is outside application scope.
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
The operator handles Meta payment outside the app, and attributed delivery costs
consume the correct customer's allocation. Refunds/disputes and revenue recognition
are separate. AdBrain must not report an allocation as a completed transfer to Meta.

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
| [Production workflow](../src/lib/payments/production-checkout.ts) and Billing checkout | Live-capable durable orders, verified captures, signed webhooks, reconciliation and refunds; three known defects fixed and merged on dev | PR46 is dev integration only; production collection flags remain off until issue48 rollout/configuration |
| [Test workflow](../src/lib/payments/test-checkout.ts) and [UI](../src/components/test-checkout.tsx) | Separate stored test orders, callback verification and reload recovery | Test environment only; every capture remains non-spendable |
| [Funding assessment](../src/lib/payments/meta-funding.ts) and [store](../src/lib/payments/meta-funding-store.ts) | Account-bound evidence, expiry/revocation and conflict handling | Not a proven automatic funding adapter or cash ledger |
| [Campaign creation](../src/lib/campaign/create-service.ts) | Reviewed paused creation and durable operation recovery | Not a general payment ledger or atomic activation reservation |

The [production payment migration](../db/migrations/20260926_production_payment_orders.sql)
is integrated in dev with the managed-billing and Meta-event schema. Its current
hash and rollout dependencies are in the [payment release packet](qa/ops-environment-2026-09-26.md#separate-payment-integration-and-rollout-packet).
It has not been applied to production. The optional [test-order migration](../db/migrations/20260926_razorpay_test_orders.sql)
and [billing](../db/migrations/20260924_managed_billing.sql)/[event](../db/migrations/20260924_meta_billing_events.sql)
migrations exist in source. Their production application is not established by
the code-only release. Follow [Data Model](DATA_MODEL.md) and
[Releasing](RELEASING.md) for target-specific prerequisites and approval.

Live order/capture/webhook/reconciliation/refund behavior and the three identified
payment fixes are implemented in dev. Customer liability/reservation accounting
and campaign admission remain #49 work. Use safe integer minor units,
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

The operator-managed decision removes outbound funding feasibility from the
critical path. Collection and customer accounting can ship without a bank-to-Meta
adapter; ad spending still requires the customer-specific controls below.

| Phase | Complete when |
| --- | --- |
| Contract and operator-managed policy | Operator, annual scope/tax/refund terms and external Meta-payment responsibility are explicit; no automatic-funding evidence gate |
| Operator-managed collection | New-mode orders do not depend on automatic Meta-funding evidence; existing order history remains readable and recoverable |
| Production financial core | Dev candidate has durable live orders/events and immutable quotes with consent/funding-replay/stale-attempt fixes; customer-level ad balance remains #49 |
| Gateway deployment | Apply exact payment migration, securely configure live merchant/account/project/webhook binding, enable flags only for the reviewed production main deployment; test records cannot cross the boundary |
| Delivery and refunds | Verified customer allocations, atomic reservations, attributed costs, bounded consent, pause/reconciliation and refund holds work together |
| Bounded live verification | Exact authorized transaction, settlement/refund and delivery evidence reconcile on the approved production candidate and schema |

The [earlier M0-M7 design](PAYMENTS-HISTORY-2026-09-26.md#8-delivery-phases-and-acceptance-gates)
preserves detailed proposed tables, routes and cases. Its old source baseline,
onboarding gaps, automatic-funding requirement and worker sequence are not current
dispatch or proof of deployed contracts. Reuse existing SDKs and helpers; do not
build a generic wallet or funding-adapter platform for this narrowed scope.

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
