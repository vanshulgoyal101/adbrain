# Payments API

Live and test checkout and the customer advertising allowance. Conventions: [API reference](README.md).

## Routes

`Envelope` means the typed family in [Response Families](README.md#response-families); `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| GET/POST | `/api/payments/live/orders` | Owner-scoped order read / accepted terms and idempotent create | Requires enabled production collection; no ad activation |
| POST | `/api/payments/live/verify` | Signed provider payment proof | Reconcile capture; no ad activation |
| POST | `/api/payments/live/webhook` | Signed Razorpay event | Idempotent capture/refund reconciliation. `payment_link.paid/expired/cancelled` settle a ₹999 plan month (#718, re-checked with Razorpay); payments with `notes.purpose = adbrain_plan` skip the ad-money ledger |
| GET/POST | `/api/payments/live/reconcile` | Owner-scoped recovery | Reconcile uncertain provider state |
| GET/POST | `/api/payments/live/operator` | Operator-authorized refund/review | Financial action; separate authorization required |
| GET/POST | `/api/payments/customer-balance` | Owner balance/review or operator accounting evidence | No provider charge, refund or ad activation |
| GET/POST | `/api/payments/test/orders` | Test order read/create | Nonproduction only; isolated test gateway |
| POST | `/api/payments/test/verify` | Test payment proof | Nonproduction only |
| POST | `/api/payments/test/webhook` | Test signed event | Nonproduction only |

### Configurable Live Payments

**Customer-chosen annual amount (#212).** GET `/api/payments/live/orders` accepts
`amountPaise` (integer, 50000-1000000) for a read-only annual quote and returns
`annualAmountRange: {minPaise:50000,maxPaise:1000000}` (null for verification or
legacy terms). Without it, the quote follows the business's open unpaid annual
order, else the configured default. POST accepts `amountPaise` with the returned
`termsHash`; anything outside the range is 400, and terms accepted for another
amount are 409. The stored quote splits floor(total/5) to service and the rest to
ad money; responses carry only the customer view (`totalPaise`, no `*AllocationPaise`),
and `policy`/order `terms` carry only the accepted text, hash and `fundingMode` (#1235). A new amount replaces the business's unpaid annual order, which stays in
the list with `status: "superseded"` and `checkout: null`; paid, held or
event-pending orders are never replaced (the request fails until reconciled).
Paid orders accumulate; each is its own order with its own capture. A replaced
order paid later is captured and credited once.

The effective quote is returned by the order-list route; each saved order retains
its own `quote` and accepted policy. `amountPaise` and provider checkout `amount`
equal the saved `quote.totalPaise`, even after configuration changes. Normal
annual quotes retain their original allocation; pilot verification quotes carry
zero service/ad allocation and a `verificationAllocationPaise` equal to the total.
The eligible owner may refresh a verification quote before creating an order,
but an existing order cannot be repriced or replaced while unresolved. Captures
and refunds use saved amounts, and the one-time verification order remains visible
ahead of recent annual orders. See [configuration and restoration](../CONFIGURATION.md#configurable-live-amounts).

For an eligible pilot without a saved verification order, GET returns
`verificationAmountRange: {minPaise:100,maxPaise:<configured ceiling>}`; otherwise
it is null. GET accepts optional `verificationAmountPaise` for a read-only quote
within that range. POST accepts the same integer alongside the returned
`termsHash` and explicit acceptance. Owner, expiry, ceiling and consent changes
fail closed; a saved
verification order cannot be repriced. Without an amount parameter, reads recover
the saved eligible verification quote rather than replacing it with the default.

Live routes return 404 unless `PAYMENTS_LIVE_ENABLED=true` on a production `main`
deployment without test configuration; order creation also needs
`PAYMENTS_LIVE_COLLECTION_ENABLED=true` (409 when blocked). Authenticated writes
require the exact configured origin (403 otherwise). Create is strict
`{businessId,idempotencyKey,termsHash,acceptTerms:true}` plus the optional
verification amount; amounts are integer paise. A changed `termsHash` is 409 and
an unconfirmed provider create is 503 `needs_reconciliation`: retry with the same
key. Every order response keeps `spendablePaise: 0` and `canActivateCampaign: false`.

### Local Test Payments

The `/api/payments/test/*` routes return 404 unless `PAYMENTS_TEST_ENABLED=true`,
the process is not production Node or any Vercel environment, and Supabase is a
loopback URL; they also need the optional
[test-order migration](../../db/migrations/20260926_razorpay_test_orders.sql).
Responses are no-store and always carry `spendablePaise: 0` and
`canActivateCampaign: false`.

- Create (POST `orders`) accepts only `{businessId: UUID, idempotencyKey: UUID}`;
  the amount is fixed at 1,000,000 paise. It returns 201 for a new provider order,
  200 for an idempotent replay, and `checkout` only while `status` is `created`.
  An unconfirmed provider create returns 503 with the local `orderId`.
- Read (GET `orders?orderId=<uuid>`) returns the owned order.
- Verify accepts `{orderId, paymentId, signature, providerOrderId?}`; the HMAC
  uses the stored provider order ID and a mismatched `providerOrderId` is 400.
  The server then fetches provider payment/order state with test keys.
- The webhook reads at most 65,536 bytes, verifies `X-Razorpay-Signature` on the
  raw body and `account_id`, and handles `payment.captured`, `payment.authorized`,
  `payment.failed`, `refund.processed` and `order.paid` (others are acknowledged
  as ignored); handled events need `X-Razorpay-Event-Id` and a payment reference.

States are `creating`, `created`, `captured` and `needs_reconciliation`.
Mutations other than the webhook require a same-origin request (403). A changed
test merchant is 409; storage or provider uncertainty is 503. Nothing here issues
refunds, moves real money or grants advertising credit.

### Customer Advertising Allowance

The additive [customer allowance migration](../../db/migrations/20260926_customer_ad_allowance.sql)
does not enable collection or authorize Meta spending. Test payments give no
credit. Owners can review their balance with `GET /api/payments/customer-balance`
using `businessId` and optional `campaignId`. With `campaignId`, optional
`capDays` (integer 1–7) reviews a capped run at `daily × capDays` + GST instead
of 7 × daily; the activation PATCH still enforces the days the owner approves.
The GET response is the customer view: no `capturedPaise`, `serviceAllocationPaise`,
`advertisingAllocationPaise` or `advertisingRefundedPaise`, so AdBrain's margin never reaches the browser (#1235).
Financial operators can submit
strict `costs` or `refund-allocation` actions with
`POST /api/payments/customer-balance`; authority is rechecked in SQL. See the
[shared contracts](../../src/lib/payments/customer-balance-contracts.ts).

Cost evidence uses integer paise, immutable UUIDs and cumulative lifetime
media/tax figures; stale or conflicting figures hold funds. A capped run reserves
its Meta lifetime cap plus GST instead of 7 × daily and is bounded by attributed
media plus that cap; its aging non-final figures do not hold funds, but figures
above the bound do (#208). AdBrain itself records non-final evidence from Meta's
lifetime campaign spend (`customer_ad_observe_costs`, service role only) during
the activation review, activation, Refresh and the `enforce-spend` sweep, so no
operator is needed to start or keep a funded run; final evidence stays
operator-only (#216). For paused runs the sweep confirms the whole Meta tree
is stopped and records settle reads (`customer_ad_settle_costs`); two equal
reads 30 minutes apart, at least 3 hours after the pause, finalize the run and
close its reservation without an operator. Capped runs past their Meta end time
are paused by the sweep first (#221). Capturing payment
does not earn service fees or activate ads. Review precedes an atomic reservation
for one campaign. Before ACTIVE, the Meta cap must be written and read back
within the reserved media allowance; unsupported or rejected caps block
activation. Provider capability for the INR 8,000 tax-inclusive offer remains
unverified. Pausing does not release a reservation: final reconciliation needs
the exact reservation UUID, a settled activation outcome and fresh cumulative
costs after confirmed pause. Uncertain outcomes retain a hold for audited
recovery, never automatic expiry.
