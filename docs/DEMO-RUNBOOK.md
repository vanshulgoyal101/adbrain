# AdBrain Demo Runbook

This is the operating guide for showing AdBrain to a prospective customer. It
covers the demo flow, provider-cost planning, failure fallbacks, and what must
be true before accepting payment.

## Immediate Execution Tracker

- [ ] Verify the latest Vercel deployment and complete the live smoke test.
- [x] Migrate the demo key from unavailable Gemini 2.5 Flash to the stable
   `gemini-3.6-flash` model and verify a live API response.
- [ ] **Deferred:** enable paid Gemini after demo demand justifies this account's
   current ₹3,000 minimum prepayment.
- [ ] Benchmark 30 ads across three industries; record quality, latency,
   retries, tokens, and actual cost.
- [ ] Prepare one polished demo account with 3-6 generated variants.
- [ ] Keep pre-generated creatives and screenshots ready as the demo fallback.
- [ ] Run 5-10 customer demos and record objections and willingness to pay.
- [ ] Evaluate and add a reliable paid image provider once demand is validated.
- [ ] Add billing only when the first customer is ready to pay: Razorpay for an
   India-first launch or Stripe for an international-first launch.

## Demo Positioning

Show AdBrain as a workflow for a non-technical local-business owner:

1. Fill the Brand Brain once.
2. Describe one business goal in plain language.
3. Review a small set of distinct, on-brand ad variants.
4. Approve one and create a **paused** Meta campaign.
5. Show where leads and plain-language results will appear.

The demo should show **3-6 strong variants**, not ten weak variations. The
current Creative Studio supports 3, 4, 5, or 6 variants across six marketing
angles: value, problem, offer, trust, aspiration, and urgency. Ten variants per
customer would require additional genuinely distinct angles; do not duplicate
angles just to reach a round number.

## Customer Demo Sequence

Prepare a realistic business before the call. The Brand Brain should contain:

- business name, industry, description, and target audience
- logo and brand colours
- phone, email, website, and address
- service locations
- USPs and current offers, one per line
- the language the business actually uses

During the call:

1. Open the saved Brand Brain and explain that it is the reusable source of
   truth for every generated ad.
2. Type one concrete goal, such as `Get more new-patient appointments in Austin
   this month. Emphasise the $49 exam and same-day availability.`
3. Generate 3-6 variants and explain the different angles rather than reading
   every card aloud.
4. Open one creative, show the finished poster, copy, CTA, and contact line.
5. Approve the strongest creative.
6. Open Campaigns, show the audience/budget summary, and create a campaign.
7. Explicitly point out that the campaign is **paused** and nothing spends until
   the customer activates it in Meta.
8. Open Leads and Results to show the post-launch workflow, even if the demo
   account has no fresh leads.
9. Close with the customer's next action: connect their own Meta account,
   complete their Brand Brain, and launch their first paused campaign.

Keep a pre-generated set of approved creatives and screenshots available. A
live demo must not depend on a provider, Meta, Supabase, or the customer's Wi-Fi
being healthy at that exact moment.

## Provider Recommendation

For the first customer demos, use:

```env
LLM_PROVIDER_ORDER=google,groq,openrouter,cerebras
GEMINI_MODEL=gemini-3.6-flash
GEMINI_THINKING_HEADROOM=3000
LLM_MONTHLY_TOKEN_LIMIT=2000000
```

Gemini 3.6 Flash is the validated primary copy model because it is a stable
endpoint with free-tier access and supports the existing structured-output
request path. Use a cheaper Flash-Lite-class model for low-stakes summaries,
classification, or retries only after evaluating quality. Keep the existing
provider rotation enabled as a reliability fallback.

Use a dedicated Google AI project for AdBrain. Prefer Gemini Prepay with the
minimum initial credit, leave auto-reload off, and set the project-level monthly
spend cap in AI Studio. The provider cap can lag by about ten minutes, so retain
the application's token ceiling and request rate limits as a second guardrail.
API keys inherit billing and caps from their project; keys do not have separate
budgets.

For the current account, Google raised the regional/security minimum prepayment
to ₹3,000. Do not fund it for early demos: prepaid Gemini credit is normally
non-refundable, expires after 12 months, and cannot pay for other Google Cloud
services. Continue on the free tier until measured usage or customer demand
justifies that commitment, then re-check the minimum before purchasing. While
using the free tier, send only synthetic or non-confidential demo data because
Google may use free-tier prompts and responses to improve its products.

The exact model name and price change over time. Verify the current provider
pricing and model availability before funding production. Do not leave a
retired or preview model as the only provider.

The current image default is Pollinations: free and keyless, but variable in
availability, latency, and output quality. It is acceptable for early private
demos. Before charging customers, add and evaluate a paid image provider behind
the existing `imageGen` abstraction, with a timeout and provider fallback.

## Cost Model

The current pipeline generates one image and one structured copy completion per
variant. Copy may make one additional completion when the deterministic quality
scanner rejects the first draft. Image and copy are generated in parallel. The
current UI supports up to six variants per batch.

For planning, call ten variants a "100-ad exercise" only if ten customers each
receive ten genuinely generated ads. The real cost must be measured from
provider usage, not guessed from request count:

1. Generate ten ads for three representative businesses.
2. Record prompt tokens, completion tokens, retries, image failures, and latency.
3. Calculate the median and worst-case cost per variant.
4. Multiply by the planned number of variants.
5. Add at least a 2x buffer for retries, regeneration, and provider failures.

As a planning estimate, 100 ads using a low-cost Flash-class text model plus a
paid 1K image provider should fit inside roughly **₹500-₹1,000** before tax and
payment/card fees, depending mainly on image pricing and retries. Keep **₹1,500-
₹2,000** of provider budget available for ten early demos. This is a reserve,
not a quote to customers. Recalculate from the recorded usage before setting a
commercial price.

The application already captures provider/model/token usage and persists
`llm_usage_events` for durable per-business quota accounting. Before billing,
expose a usage summary and enforce a per-business generation budget; process-local
counters alone are not sufficient for commercial chargeback.

## Spend and Safety Controls

Before a demo:

- set a monthly LLM token limit
- keep generation rate limits enabled
- keep variant count bounded to 3-6
- test the image fallback and timeout path
- use a test Meta ad account where possible
- keep every created campaign paused
- configure weekly spend guardrails
- never activate a campaign during a demo without explicit consent
- do not expose provider keys in browser code or screenshots

The demo account should have enough approved creatives to recover if live
image generation fails. Never use a customer's real ad account as the only
fallback environment.

## Payments and Commercial Readiness

Payments are **not required for the first ten validation demos**. The goal of
those calls is to validate willingness to pay, workflow fit, and objections.
Manual invoicing or a payment link is sufficient when a prospect is ready to pay.
Do not build subscription enforcement before the product has a price and a
customer asking for self-serve checkout.

When payments become necessary:

- choose **Razorpay** for an India-first INR/UPI customer base
- choose **Stripe** for an international-first customer base or when the
  existing company/bank setup already supports it

A production billing implementation includes plans/prices, checkout, signed
webhook verification, idempotent subscription state, payment failures,
cancellations, grace periods, entitlement checks, usage limits, refunds,
invoices/GST handling, and a customer/support workflow. Estimate:

- basic checkout + verified webhook + subscription state: **2-4 engineering
  days**
- production billing + entitlements + failure/retry handling: **5-10
  engineering days**

Do not represent AdBrain as paid or collect recurring money until the webhook,
entitlement, cancellation, and refund paths are tested.

## Launch Gates

### Required for private demos

- production URL and authentication work
- one prepared demo business
- paid or sufficiently reliable LLM capacity
- image fallback and pre-generated creative backup
- campaigns remain paused by default
- spend guardrails and rate limits are active
- privacy, terms, and data-deletion pages are live
- support/contact email is monitored

### Required before taking recurring payments

- Meta App Review status understood for the intended customer flow
- a paid image provider evaluated for quality and reliability
- durable usage ledger and per-business usage limits
- exception/crash monitoring
- scheduled sync and cron health monitoring
- billing webhooks and entitlement tests
- deletion/refund/support procedures
- a clear pricing and usage policy

Billing, self-serve onboarding, instant lead alerts, scheduled sync, and a
paid image provider remain roadmap work. Do not imply those are complete merely
because the demo workflow is functional.

## Demo Acceptance Checklist

- [ ] Log in with the demo account.
- [ ] Brand Brain opens with complete, believable data.
- [ ] Generate 3-6 variants successfully.
- [ ] At least one result has readable copy, correct contact details, and a
      usable image.
- [ ] Approve and unapprove a creative.
- [ ] Create a paused campaign without activating spend.
- [ ] Show audience, budget, leads, and results surfaces.
- [ ] Verify the fallback screenshots/pre-generated creatives are available.
- [ ] Record objections, requested integrations, and willingness to pay.
