# Customer Payments: Safety, Experience and Delivery

Part of [Plans](README.md). [Decisions and protocol](payments.md) · [Safety, experience and delivery](payments-safety.md).

**Status:** active: checkout is built behind flags; go-live or removal is a CEO decision due November 11, 2026 (#1171).

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

[API Reference](../api/README.md), [Configuration](../operations/configuration.md) and
[Testing](../team/testing.md) own current commands/contracts; historical commands are not
unconditional setup instructions.

Current source requires `PAYMENTS_TEST_ENABLED=true`, a loopback Supabase URL,
test keys, merchant identity and a separate webhook secret. Production Node mode
and all Vercel environments are rejected. The test order amount is fixed at
1,000,000 paise; records require `environment: "test"`. Captures retain
`canActivateCampaign: false` and `spendablePaise: 0`.

## 10. Primary References

- [Roadmap](../roadmap.md).
- [Release and environment authority](../operations/releasing.md).
