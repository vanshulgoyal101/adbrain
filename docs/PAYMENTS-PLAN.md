# Customer Payments and Managed Advertising

Current payment decisions and implementation boundaries, reconciled September 26,
2026. Owner explicitly requests live collection as soon as possible with
operator-managed Meta payments. Repaired payment code is integrated on dev
through PR46; this is not yet enabled production collection. Rollout authority
lives in [the dispatch](https://github.com/vanshulgoyal101/adbrain/blob/dev/docs/ORCHESTRATION.md).

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
[configuration](operations/configuration-payments.md#customer-chosen-annual-amount).

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
[Meta workflow](architecture/channels/meta-connect.md). Proposed agency ownership, access and offboarding
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
is applied in production (live orders are recorded). The optional [test-order migration](../db/migrations/20260926_razorpay_test_orders.sql)
and [billing](../db/migrations/20260924_managed_billing.sql)/[event](../db/migrations/20260924_meta_billing_events.sql)
migrations exist in source; check the migration ledger before relying on them in a
target. Follow [Data Model](DATA_MODEL.md) and
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
- Allowance rule (#208): an uncapped campaign reserves 7 × daily budget + GST and
  is held when its cost evidence is older than 15 minutes. A Meta-capped run
  reserves its lifetime cap + GST instead and is bounded by attributed media plus
  that cap, so aging evidence within the bound does not hold it. Evidence above
  the bound, explicit cost holds and payment/refund holds still hold. The
  campaign guard uses the same headroom; if AdBrain cannot save `active` after
  Meta activation, the route pauses the Meta tree and records the run paused.
- Cost evidence control (#216): non-final evidence is Meta-read, not
  operator-attested. AdBrain records the campaign's lifetime spend
  (`insights?fields=spend&date_preset=maximum`) with tax at the stored GST rate
  (1800 bps by default) at activation review, at activation, and in every
  Refresh and `enforce-spend` sweep for active reserved runs. Figures never go
  down and an explicit hold is never cleared. Final evidence, refunds and
  allocations stay with the financial operator. Stale non-final evidence holds
  the balance only while the campaign has an open reservation.
- Funding modes (#245, #759): a business is **managed** (the allowance rules above;
  AdBrain holds its ad money), **operator-funded**, or **own-account**. A payment operator marks it **operator-funded**, meaning the operator pays
  Meta directly and no AdBrain payment is involved (Solaride). Only
  `operator_funding_set` with a live operator grant sets or clears the mark, with a
  reason; every change is audited, and customers cannot set it. Such a business
  activates only capped (`capDays`), and only when Meta's ad account spending limit
  minus amount spent (both media paise, excluding GST, read live), less what the account's other
  running capped runs may still spend (their `budget_remaining`, #1058), covers the cap. A cap raise in
  Edit budget uses the same rule with the edited ad set left out; its need is the new cap minus spend (#1094).
  It has no allowance, reservation, cost evidence or refund; the sweep and Refresh
  skip the allowance hold, and the weekly cap still applies. Clearing the mark
  restores the customer gate when the business is managed.
- Own-account (#759, CTO; CEO ack on the issue): an owner on their own Meta ad account
  pays Meta directly and AdBrain holds no ad money. Activation is capped only (the
  lifetime budget × days on Meta), plus the weekly cap. The account spending limit is
  checked only when the owner has set one. No allowance, reservation or sweep hold applies,
  and Settings shows no checkout or balance (they appear only for managed businesses).
- Managed child ad accounts (#522, 2-Tier, behind `MANAGED_ACCOUNTS_ENABLED`): each
  customer's child account also gets a Meta ad account spending limit
  (`src/lib/managed/spend-cap.ts`). Its media allowance is the customer's ad share net of
  advertising refunds, divided by 1 + GST and rounded down, minus media attributed on their other
  accounts. Because a new Meta limit only applies to spend after it is set, the limit is Meta's
  live `amount_spent` plus the allowance not yet spent (lifetime spend is the larger of Meta's
  figure and AdBrain's). It is raised after a payment, lowered after a refund, never below what
  Meta has spent, frozen at that amount while the balance is held, and never written as 0 (Meta's
  "no limit"): with nothing spent and no room, every campaign on the child is paused and its limit
  lowered to the smallest Meta accepts, so an older limit can't stay usable after a refund or hold.
  Meta takes the limit in rupees and reports it in paise; the write is read back, and fails closed
  if Meta's room (limit − amount spent) exceeds what the customer has left (a reset counter).
  Wiring (`src/lib/managed/spend-cap-sync.ts`, `spend-cap-wiring.ts`): a received payment webhook,
  a claimed refund and every observed capture, refund or dispute first mark the child account's
  limit stale inside the request (before processing, so a failure later can't leave it current),
  then refresh it after the response. The 15-minute `enforce-spend` sweep refreshes managed child
  accounts stale first, then oldest decision, three at a time, starting none after 45 s; the rest
  are reported deferred and lead the next run. Activation refreshes a stale limit first, or waits
  while a pass is running. Writes are serialized per child ad
  account by a writer lease in `private.managed_spend_caps`: an event that finds the lease taken
  marks the limit stale, and the holder runs again with fresh figures before releasing, so a
  stale, higher limit never lands last. "Stop" pauses every active campaign on the child, then
  tries a ₹1 limit even if a campaign couldn't be paused (that one can still spend), then marks
  AdBrain's campaigns paused with their reserve and an audit event; any failure fails the pass.
  Meta's real minimum is recorded by #527, and a refusal leaves the campaigns paused. Activation
  needs the last decision to be set or keep with room and nothing newer pending: a pass clears the
  decision when it starts and a failed pass leaves none, so nothing activates on an old limit.
- Paused-run settle (#221): a paused or finished funded run no longer blocks
  the next run until an operator acts. The `enforce-spend` sweep also visits
  businesses with a paused reservation. It first confirms on Meta that the
  campaign and every ad set and ad are stopped (own status PAUSED/ARCHIVED/
  DELETED, or effective CAMPAIGN_PAUSED/ADSET_PAUSED), then records a settle
  read of lifetime spend (`customer_ad_settle_costs`). The run is finalized and
  its reservation closed once two equal reads are at least 30 minutes apart and
  at least 3 hours after the pause; final media is never lower than earlier
  evidence. Until then only that run's own reserve stays held (stale evidence
  of a settling run does not hold the whole balance). Capped runs whose Meta end
  time has passed are paused by the sweep and then settle the same way. The
  system never issues refunds or clears explicit holds.
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

Reuse existing SDKs and helpers; do not build a generic wallet or funding-adapter
platform for this narrowed scope.

## 9. Implementation Receipt

[API Reference](api/README.md), [Configuration](operations/configuration.md) and
[Testing](TESTING.md) own current commands/contracts; historical commands are not
unconditional setup instructions.

Current source requires `PAYMENTS_TEST_ENABLED=true`, a loopback Supabase URL,
test keys, merchant identity and a separate webhook secret. Production Node mode
and all Vercel environments are rejected. The test order amount is fixed at
1,000,000 paise; records require `environment: "test"`. Captures retain
`canActivateCampaign: false` and `spendablePaise: 0`.

## 10. Primary References

- [Roadmap](roadmap.md).
- [Release and environment authority](RELEASING.md).
