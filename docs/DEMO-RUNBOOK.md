# Demo Runbook

Show the product's actual review-and-control workflow, not a provider benchmark
or a promise of advertising results. A demo account can share a real Meta account
and incur real costs. Preparation is not permission to generate, create, activate,
or clean up remote objects.

## Prepare

Choose a consented or synthetic local business with complete name, industry,
description, audience, service locations, current offers, languages, logo/contact
details, and usable product references. Prepare three distinct saved creatives,
including approved work, plus screenshots/export as an outage fallback.

Use an INR-compatible example when demonstrating campaign launch. Do not imply
that industry-neutral creative generation means multi-currency launch support.
Check real connection capabilities beforehand; never display tokens or personal
lead data. A fixed artifact demo is valid when live provider work is not approved.

## Customer Sequence

1. Open Brand Brain and show the facts that ground the creative.
2. Enter a goal such as `Promote our free rooftop survey in Jaipur this month;
   focus on homeowners and use our saved contact details.` Do not invent savings,
   discounts, testimonials, or guarantees that the business has not supplied.
3. Complete only the relevant interview questions, then edit the proposed brief.
   Confirm language/format and the separate generation action.
4. Show saved or authorized generated variants. Compare image fidelity, copy,
   CTA and contact details; distinguish useful angles rather than counting cards.
5. Approve one creative and demonstrate export. Explain that approval is local
   creative status, not Meta ad approval or permission to spend.
6. Open a manual/guided campaign draft. Review explicit geography, ages/interests,
   active form, account/Page and total budget across ad sets.
7. Show preflight and, only if authorized, create the paused campaign. Observe the
   operation result before saying it exists. Activation is a separate confirmation
   available in AdBrain subject to checks; it need not happen during the demo.
8. Show Leads and stored Results/Reports honestly. Empty data is not evidence of
   failure or a reason to fabricate conversion claims. Refresh can trigger
   auto-pause; do not use it as an assumed read-only demonstration.

## Provider and Cost Plan

Provider defaults, models and fallback controls are in [Configuration](CONFIGURATION.md).
The pipeline is concept -> image -> poster -> storage -> creative row, with
variants running concurrently. Text and image within one variant are not
independent parallel calls. One concept repair and provider fallback can add cost.
API generation allows 1-6 variants; the main Create flow requests three.

Before live generation, agree on a small exact request count and budget, configure
provider-side caps with auto-reload disabled where supported, and record actual
usage. Account dashboards, current pricing and terms are authoritative for costs;
historical model comparisons are not quotes or permanent funding requirements.

The token quota is non-atomic and usage persistence best effort. It is not an
invoice or hard image-dollar cap. Keep fallback explicit and tested; Pollinations
does not support product references and timeout cancellation does not silently
start another provider. Prefer saved artifacts to repeated paid retries on a call.

## Failure Paths

| Failure | Demo response |
| --- | --- |
| Interview unavailable | Show a prepared brief and existing reviewed creative; do not claim live generation succeeded |
| Partial generation | Keep successful variants; explain the failed portion and use saved examples |
| Uncertain generation | Recover by generation UUID before another paid POST |
| Meta consent unavailable | Show saved draft/review and explain the external permission gate |
| Create response lost | Look up the existing operation; never duplicate with a new key |
| No leads/results | Show the genuine empty state or clearly labeled synthetic fixture |
| Network/provider outage | Use saved artifacts and reschedule live verification |

## Demo Acceptance Checklist

- [ ] Intended environment, owner, data consent and side-effect boundaries verified.
- [ ] Brand Brain and product images are accurate and usable.
- [ ] Saved fallback artifacts load without a provider generation request.
- [ ] Brief review, creative comparison, approval/unapproval and export are clear.
- [ ] Exact audience, account/Page, form and total budget are visible before creation.
- [ ] Any authorized created campaign is confirmed paused, with operation evidence.
- [ ] No activation occurs without a separate explicit spending decision.
- [ ] Lead/result data is genuine or visibly synthetic; no unsupported performance claim.
- [ ] Objections, requested integrations and next customer action are recorded safely.

## Commercial Readiness

There is no in-product subscription checkout, entitlement service, automatic
WhatsApp outreach, universal customer Meta approval, or guaranteed conversion
improvement. Structured telemetry exists but is not a complete alerting/support
system. Scheduled spend checks are not scheduled insight/lead synchronization.

Before recurring billing, establish pricing, measured provider costs, usage and
refund policies, tested payment/webhook/entitlement/cancellation paths, customer
access approval, support, monitoring and data-deletion operations. Manual billing
outside the app is a separate business decision, not evidence those product
features are implemented. See [Roadmap](ROADMAP.md).
