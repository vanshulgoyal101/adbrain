# Payments Configuration

Part of [Operations](README.md). Every other setting: [Configuration](configuration.md).

## Live Checkout (Disabled By Default)

`PLAN_BILLING_ENABLED` defaults off. Exact `true` enables the own-account
Settings Plan card and monthly payment-link endpoint (#718), after the
`plan_periods` migration and payment-link webhook are released. Team, managed
and operator businesses are exempt. DevOps owns enabling collection; publishing
these routes does not authorize charges or change the flag.

The server-only [live configuration](../../src/lib/payments/production-config.ts)
requires `PAYMENTS_LIVE_ENABLED=true` and `PAYMENTS_LIVE_COLLECTION_ENABLED=true`
for collection, a production Vercel deployment from `main`, matching
`PAYMENTS_LIVE_PROJECT_ID`/`VERCEL_PROJECT_ID` and
`PAYMENTS_LIVE_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`, and valid
`RAZORPAY_LIVE_KEY_ID`, `RAZORPAY_LIVE_KEY_SECRET`,
`RAZORPAY_LIVE_ACCOUNT_ID`, `RAZORPAY_LIVE_WEBHOOK_SECRET` and
`PAYMENTS_LIVE_WEBHOOK_ID`. Test credentials or test checkout enabled in
production block live checkout. Do not put provider secrets in the browser or
the repository. An unset `PAYMENTS_LIVE_POLICY_JSON` uses the approved
operator-managed terms; an explicitly supplied legacy policy still requires
its historical Meta funding evidence. The v1 terms (`operator-managed-v1`,
`operator-managed-priced-v1`) name AdBrain's split, so they are refused for any
new payment and kept only to read orders accepted under them (#1235). Confirm the effective policy and webhook
registration before enabling collection. The payment schema must be migrated
first; code publication alone is not collection authorization.
`PAYMENTS_LIVE_REFUNDS_ENABLED=true` separately permits operator-initiated
refunds; reconciliation remains available while it is false. Hosting checks
also require `VERCEL_GIT_COMMIT_REF=main` and reject a nonproduction
`VERCEL_TARGET_ENV`. Generic `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` aliases,
if present, must match the live pair exactly.

Local test checkout uses `PAYMENTS_TEST_ENABLED=true` with
`RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`,
`RAZORPAY_TEST_ACCOUNT_ID` and `RAZORPAY_TEST_WEBHOOK_SECRET` (or matching
generic key aliases). It is unavailable in production or any Vercel environment;
never place those test variables in live production configuration. The
[test adapter](../../src/lib/payments/razorpay-test.ts) also requires an
`rzp_test_` key ID, an `acc_` account ID, a webhook secret of at least 16
characters that differs from the key secret, and a loopback
`NEXT_PUBLIC_SUPABASE_URL`; populated alias pairs must match exactly. Any failed
check disables test checkout. A loopback tunnel does not prove a local database.

### Configurable Live Amounts

Source implementation, not a production-enable receipt. Apply the new
[pricing migration](../../db/migrations/20260927_configurable_payment_quotes.sql)
after the payment policy and customer allowance migrations before deploying
these callers. All settings below are server-only; never use `NEXT_PUBLIC_`.
Changing Vercel Production environment values requires a new deployment.

| Variable | Default / validation | Purpose |
| --- | --- | --- |
| `PAYMENTS_LIVE_AMOUNT_PAISE` | Unset: Billing pre-fills `150000` (INR 1,500); integer 100-1000000 | Default amount when a request names none and no unpaid order is open. Customers normally choose their own amount, INR 500-10,000 (see below); 100 paise = INR 1. Service receives floor(total/5), advertising the remainder |
| `PAYMENTS_LIVE_VERIFICATION_ENABLED` | Unset/empty/`false`: off; exactly `true`: on | Separate one-time real payment verification, not the annual service |
| `PAYMENTS_LIVE_VERIFICATION_AMOUNT_PAISE` | Unset: `1000`; integer 100-1000000 | Default and maximum selectable verification total, INR 10 by default; zero service/ad allocation |
| `PAYMENTS_LIVE_VERIFICATION_BUSINESS_ID` | Required UUID when enabled | Exact privately verified pilot business |
| `PAYMENTS_LIVE_VERIFICATION_USER_ID` | Required UUID when enabled | Exact authenticated owner of that business |
| `PAYMENTS_LIVE_VERIFICATION_EXPIRES_AT` | Required UTC ISO timestamp, at most 24 hours ahead | Expiry stops new verification checkout; saved-order recovery remains available |

For the INR 10 pilot, leave `PAYMENTS_LIVE_AMOUNT_PAISE=1000000`, set the
verification amount to `1000`, and enable verification only with the verified
owner/business IDs and a short expiry. Other owners receive the normal offer.
Do not lower the annual amount merely to test payment: an annual payment grants
its saved annual allocations. Amounts must be decimal digits without spaces,
decimals or exponent notation; blank amounts are invalid, while unset amounts
use their defaults. Invalid enabled verification configuration blocks collection.
The approved maximum remains INR 10,000; this setting cannot raise that ceiling.

The eligible pilot owner sees **Verification amount (₹)** in Billing before an
order is saved. Enter rupees with at most two decimal places, choose **Update
amount**, review the refreshed quote/terms, accept them and then choose **Pay**.
The input accepts INR 1 through the configured verification maximum; with the
pilot configuration above it defaults to INR 10 and cannot exceed INR 10.
Updating the quote creates no provider order or charge and requires no deployment.
The server rechecks owner, expiry, ceiling and consent on creation. Once an order
exists its amount cannot change; recovery uses its saved quote. The input is not
available for the normal annual package, other users, expired or completed tests.
If the quote update fails, payment stays disabled until the amount is restored or
a valid updated quote is received and accepted.

Every total, the default included, produces a versioned quote and matching
`operator-managed-priced-v2` service/refund terms (#1235: no split shown), requiring
fresh hash-bound consent. Orders accepted under v1 keep their v1 terms. Nondefault pricing or enabled verification cannot be combined with an
explicit `PAYMENTS_LIVE_POLICY_JSON` override. Stored amounts, quotes, consent and
identities are immutable. A changed configuration never reprices an old order;
only a customer's own new amount replaces an unpaid order (see below).

### Customer-chosen annual amount

Billing asks for an amount from INR 500 to INR 10,000 (`50000`-`1000000`
paise, at most two decimals) and shows the split before payment: 80% ad money
including Meta GST and 20% AdBrain service. Service is floor(total/5) and ad
money is the remainder, so any odd paisa goes to ad money and the two always add
up exactly. The same approved terms apply with the amount filled in; the terms
hash covers the amount. `PAYMENTS_LIVE_AMOUNT_PAISE` is only the default when a
request names no amount, and a default outside INR 500-10,000 is refused.

A customer can pay again at any time; ad money from every captured payment adds
up. At most one unpaid annual order is open per business. Choosing a new amount
replaces it: the old row is kept and marked `superseded` (shown as "Replaced by a
newer payment request", no Pay button). Paid, refunded, held, review-required or
event-pending orders are never replaced, and a new amount is refused until they
are reconciled. Razorpay cannot cancel an order, so if a replaced order is paid
later the capture is recorded and credited once like any top-up.

Verification creates at most one recoverable order per business, including after
a refund. A verified capture or expiry restores the normal quote on the next
order-list read; a stale open page must reload. Disable
`PAYMENTS_LIVE_VERIFICATION_ENABLED` and deploy after the test. Previous verification
captures/refunds remain visible; no automatic refund, renewal or Meta activation
occurs. Check the authenticated displayed quote and server/provider order amount
before the owner submits payment. Only the owner completes the real charge.

Keep a quote-aware runtime after any nondefault order exists: the old fixed-price
runtime cannot read those orders. Suspend collection and use a compatible
forward fix rather than deleting orders or undoing the migration.
