# Customer Payments and Managed Advertising

Part of [Plans](README.md). [Decisions and protocol](payments.md) · [Safety, experience and delivery](payments-safety.md).

**Status:** active: checkout is built behind flags; go-live or removal is a CEO decision due November 11, 2026 (#1171).

Current payment decisions and implementation boundaries, reconciled September 26,
2026. Owner explicitly requests live collection as soon as possible with
operator-managed Meta payments. Repaired payment code is integrated on dev
through PR46; this is not yet enabled production collection. Rollout authority
lives in [the dispatch](../team/orchestration.md).

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

Owner decision (Oct 23, #212): customers are not asked for INR 10,000 at once.
They choose an amount from INR 500 to INR 10,000, see the 80% ad money
(including Meta GST) and 20% service split first, and can pay again at any time;
ad money from every captured payment adds up. The same approved terms apply
with the chosen amount filled in. An unpaid order of another amount is replaced
(kept, marked superseded, no Pay button); a paid order is never touched, and a
late payment on a replaced order is credited once. See
[configuration](../operations/configuration-payments.md#customer-chosen-annual-amount).

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

**Customer wording (#1235, CEO, Oct 28):** customers never see AdBrain's share. New
checkouts use terms `operator-managed-priced-v2`: "₹X for 12 months for one business,
one offer and one service area, including up to two ads and one capped Meta
campaign. It includes your ad budget, with Meta's GST…" and "Full refund before we
start work. After that, your unused ad budget is refundable once pending Meta costs
are settled." The internal split and accounting above are unchanged; v1 orders keep
their v1 terms.

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
| WhatsApp number boundary | Managed ad accounts require #253: a managed customer's ads send chats only to their Page's own number or a number Meta verified for them, never another number on the shared parent's WhatsApp accounts | `whatsapp_number_bindings`; no binding by pick for managed accounts |

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
infrastructure, refunds and reserves reduce it. Older pre-tax scenarios are in git history;
do not reuse their INR 11,800 illustration.

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
[Meta workflow](../architecture/channels/meta-connect.md). Proposed agency ownership, access and offboarding
terms must be explicit; do not promise ownership transfer or silently rebind
existing accounts. Preserve uncertainty after a provisioning timeout rather than
blindly creating another account.

## 4. Repository Integration and Data Design

| Existing surface | Reuse | Boundary |
| --- | --- | --- |
| [Allocation](../../src/lib/payments/allocation.ts) | Integer-paise arithmetic and versioned quotes | Current pre-tax-base helper is not the approved annual tax-inclusive product contract |
| [Razorpay adapter](../../src/lib/payments/razorpay-test.ts) | Official SDK and validated provider results | Explicit local test gate; production/Vercel and live keys rejected |
| [Verification](../../src/lib/payments/razorpay-verification.ts) | Constant-time checkout/raw-webhook signatures and captured-order matching | Signature verification alone grants no entitlement |
| [Production workflow](../../src/lib/payments/production-checkout.ts) and Billing checkout | Live-capable durable orders, verified captures, signed webhooks, reconciliation and refunds; three known defects fixed and merged on dev | PR46 is dev integration only; production collection flags remain off until issue48 rollout/configuration |
| [Test workflow](../../src/lib/payments/test-checkout.ts) and [UI](../../src/components/test-checkout.tsx) | Separate stored test orders, callback verification and reload recovery | Test environment only; every capture remains non-spendable |
| [Funding assessment](../../src/lib/payments/meta-funding.ts) and [store](../../src/lib/payments/meta-funding-store.ts) | Account-bound evidence, expiry/revocation and conflict handling | Not a proven automatic funding adapter or cash ledger |
| [Campaign creation](../../src/lib/campaign/create-service.ts) | Reviewed paused creation and durable operation recovery | Not a general payment ledger or atomic activation reservation |

The [production payment migration](../../db/migrations/20260926_production_payment_orders.sql)
is applied in production (live orders are recorded). The optional [test-order migration](../../db/migrations/20260926_razorpay_test_orders.sql)
and [billing](../../db/migrations/20260924_managed_billing.sql)/[event](../../db/migrations/20260924_meta_billing_events.sql)
migrations exist in source; check the migration ledger before relying on them in a
target. Follow [Data Model](../architecture/data-model.md) and
[Releasing](../operations/releasing.md) for target-specific prerequisites and approval.

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
