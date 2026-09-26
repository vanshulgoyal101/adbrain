# Roadmap

Priorities describe future work and unresolved evidence, not shipped commitments
or estimated delivery dates. [Features](FEATURES.md) is the current capability
inventory; [QA](qa/) and [releases](releases/) record dated verification. Review
this backlog against the checked-out source and current remote state before starting.

## Current Focus: One Verified Managed Customer

September 26 operator clarification: AdBrain currently operates as Vanshul
Goyal's unregistered business. Solaride is a future arrangement requiring
formalization, not the current AdBrain operator. Existing Meta bindings remain
unchanged and real collections remain disabled. The separate local Razorpay
test-checkout work is not included in this identity-only production correction.

Reset 2026-09-24: prioritize customer outcomes and business-model feasibility over
additional infrastructure. The product goal is a local business turning its offer
into approved ads and measurable enquiries with minimal advertising operations.
The selected commercial model is one INR payment to AdBrain/Solaride Energy,
20% pre-tax service fee and 80% advertising allocation, automatic Meta payment,
and a separate Solaride-owned account per customer. Funding feasibility comes
before checkout implementation, as requested by the owner.

### Start Here: Execution Board

Updated September 25. This is the active task queue; the evidence and larger backlog
below are reference material, not a list of equally urgent work.

**Customer journey:** business offer and budget -> approved creative -> one customer
payment -> funded, approved ads -> attributable enquiries and a spend report.

**Current stage:** core workflow implemented and a paused campaign exists, but the
managed service is not yet proven end to end. We have not verified automatic Meta
funding, customer checkout, repeatable customer onboarding or profitable results.
Solaride is the internal pilot, not evidence that an external customer can onboard.

| ID | High-level outcome | State | Concrete next tasks | Complete when |
| --- | --- | --- | --- | --- |
| P1 | One useful Solaride campaign ready to run | IN PROGRESS: ad wording approved; owner login/form access verified; revised Meta form saved as an unpublished draft | Review the saved form and ad visual; review targeting and existing unpublished ad changes; verify Pankaj's enquiry access/response window before a separately approved receipt test | Owner approves the remaining brief and creative; the intended Page, destination, ad and lead-handling path are verified, with campaign still off |
| P2 | Solaride can pay Meta automatically | BLOCKED externally; investigate alongside P1 | Seek an account-specific human billing review, or assess an eligible automatic-card-billing route; do not repeat the exhausted AI-support conversation or pay the one-off QR to guess | A supported account/method is verified and, after separate owner approval, a mandate is active with actual automatic funding/charge evidence and spending controls |
| P3 | A package worth selling | CAN START alongside P1/P2 | Decide whether the 80% covers Meta tax; obtain CA/gateway business-model review; define refunds and service scope; measure delivery/support costs against the fee | Owner-approved price, tax treatment, refund terms and contribution-margin target, with merchant onboarding requirements resolved |
| P4 | One real customer can connect the right assets | REQUIRED before an external paid pilot | Verify customer consent/app access, a Solaride-owned customer account plus the customer's Page, account capacity and offboarding responsibilities | The intended customer completes the real connection flow; correct ownership, permissions and destination work without global tokens or an admin credential backfill |
| P5 | One customer payment safely funds the service | WAIT for P2 feasibility, P3 decisions and isolated gateway test access | Integrate one hosted checkout with existing quote helpers; verify capture/webhook retries, durable allocation, refund and campaign funding gates; prove one test-mode capture/refund | The exact order reconciles once, retries do not duplicate credit, failed/unverified payments cannot authorize spending, and a refund is verified |
| P6 | Demonstrate value, then decide whether to expand | WAIT for campaign, funding and commercial gates; P4/P5 also required for the external paid pilot | Separately approve the pilot budget/activation; deliver the campaign; reconcile actual costs; measure qualified enquiries, owner effort and margin | A completed pilot report supports a continue/change/stop decision; an internal Solaride test alone is not proof of customer checkout or repeatable onboarding |

P1 is first in the work queue, not a prerequisite for investigating P2. P1, P2 and
P3 can progress together. P2 blocks checkout implementation and paid delivery, not
creative review, campaign diagnostics, economics or customer-access preparation.
An internal spend test requires P1, verified P2, agreed cost/measurement limits and
separate activation approval. It does not complete the external customer journey.

### Solaride Pilot Brief

Owner approved September 25: **free solar site survey with Meta instant-form
enquiries**. This approves the offer and destination, not spending, paid generation,
publishing a new form/ad, or activating an existing campaign.

| Brief item | Decision / draft |
| --- | --- |
| Offer | Free solar site survey; no payment details collected from the enquirer |
| Destination | Solaride Energy Page's Meta instant form, not WhatsApp |
| Service area | Owner-approved: Chandigarh and Panchkula; no wider radius or surrounding cities assumed |
| Initial customer segment | Owner-approved: homeowners, residential rooftop solar |
| Primary outcome | Qualified survey requests, then surveys booked; form submissions alone are not success |
| Follow-up | Owner named Pankaj Kumar; response window and lead-access/handoff still to verify. Contact number supplied privately is intentionally not recorded here |
| Campaign state | Remain off; inspect existing objects and unpublished edits before deciding whether anything needs replacement |

**Approved headline (September 25):** Request Your Free Solar Site Survey

**Approved primary text (September 25):** Own a home in Chandigarh or Panchkula? Explore rooftop solar
with a free site survey from Solaride. Share your details and our team will contact
you to discuss your roof and arrange a suitable time.

**Saved form-draft intro:** Request a free rooftop solar site survey in Chandigarh or
Panchkula. Share your contact details and a little about your property so our team
can discuss the next step with you.

**Saved form-draft fields:** name, phone number, city (Chandigarh / Panchkula /
Other / please review coverage), locality,
and whether the enquirer owns the property or has permission to install solar.
Flag Other for coverage review rather than promising a visit. Treat roof access as a qualification
question, not an automatic rejection. Do not request full addresses, identity
documents, bank details or electricity-bill uploads in this initial form.

**Saved contact-purpose disclosure:** Solaride will use these details to contact you
about your site survey request and rooftop solar requirements. Submitting this
form does not confirm an appointment. Review this wording alongside the actual
privacy policy and Meta consent controls before publishing.

**Saved completion headline:** Thank you for your request

**Saved completion message:** Solaride has received your request. Our team will
contact you to discuss your property and arrange the next step.

The owner approved the ad headline and primary text above on September 25 and
then explicitly authorized saving an unpublished Meta form draft with the proposed
fields. This does not approve publication, spending or activation. Final form and
image review and the actual lead-receipt workflow remain launch gates. Do not
promise subsidy eligibility, a savings percentage, a confirmed appointment or a
response time without evidence.

### Saved Meta Form Draft

September 25: created only the authorized new draft on Solaride Energy Page
`885223068001054`, named
`Solaride | Free Survey | CHD-PKL | Homeowners | Sep 2026`.

- **Fields:** full name and phone; city choices `Chandigarh`, `Panchkula`,
	`Other / please review coverage`; locality/sector with a request not to enter a
	full address; property-permission choices `I own the home`,
	`I have the owner's permission`, `Not yet / I need guidance`. No automatic
	rejection rules were added. The default email field was removed.
- **Settings:** Higher intent with review step; phone OTP verification off;
	flexible form delivery off so Meta cannot remove the agreed elements.
- **Privacy:** saved `https://solaride.in/privacy.html` and the contact-purpose
	disclosure above. No extra marketing opt-in was added.
- **Ending:** saved the message above, with an optional `Visit Solaride website`
	action to `https://solaride.in/`. Messenger conversations are off; WhatsApp is
	not the completion action. No response-time or confirmed-booking promise.
- **Verification:** Meta showed `All changes to draft saved`; the named row
	remained in Draft forms after a reload. Reopened it and verified the persisted
	questions, intro, privacy URL, form settings and ending. The authenticated
	AdBrain form API still returns the same four ACTIVE forms; this draft is not
	among them. No published form ID is claimed.

The draft was not published or attached to an ad. No existing form or ad draft
was replaced, no test lead was submitted, and no campaign or payment setting was
changed. Form publication, any provider receipt test, ad changes and activation
remain separate approvals. The editor was closed after verification; the
[Meta draft library](https://business.facebook.com/latest/instant_forms/draft_forms?asset_id=885223068001054&business_id=1158100643072508)
is left open for owner review.

### Existing Pilot Audit

September 25 read-only audit, scoped to the documented owner's `solar energy`
business. Saved configuration is distinguished from current Meta evidence:

| Item | Evidence | Pilot decision / remaining check |
| --- | --- | --- |
| Existing campaign | Saved `new year` campaign remains `paused`, instant-form destination, INR 200/day, with one attached creative/ad; the live ad preview did not load | Preserve the campaign and three unpublished drafts. Saved budget is not a new pilot approval; live ad delivery and unpublished changes remain unverified |
| Attached creative | Saved headline is `New Year. New Energy. Same Roof.`; text advertises homes/farms across Punjab, Haryana, Chandigarh and Rajasthan and claims up to 98% bill reduction. An image is present | Do not reuse unchanged. Use the evergreen homeowner copy above, remove unsupported claims, and approve the actual image/preview before launch |
| Saved audience | Ages 26-50; Chandigarh and Panchkula each have a 17 km radius; Mohali has a 17 km exclusion | Do not inherit these limits automatically. Radius coverage and the overlapping exclusion may differ from the approved cities; review the actual map and age limits before saving targeting |
| Attached form | Saved form ID `1206878731403456` matches live Meta form `Solaride \| Free Site Visit \| CHD-PKL \| Jan` on the Solaride Energy Page. Meta reports Active, restricted sharing, More volume, zero leads | Existing Page/form association is verified. Active form status does not mean the campaign is delivering; zero leads is not handoff evidence |
| Form questions and promises | Preview collects full name and phone only. Intro references government subsidy and EMI support; completion promises contact shortly. It lacks city/locality and property-permission questions | Prepare a revised version for owner review; add qualification and remove unverified service/response promises. Do not create or publish a replacement under read-only audit permission |
| Consent and destination | Contact-purpose text limits use to rooftop-solar consultation. Preview shows Messenger and WhatsApp options checked and a Chat on WhatsApp completion action | Review these separately from the approved instant-form destination; no secondary messaging handoff or marketing consent is assumed approved |
| Privacy policy | Public [Solaride privacy policy](https://solaride.in/privacy.html) retrieved September 25: explicitly covers Facebook/Instagram lead forms, contact/city data, site-visit follow-up, service-provider sharing, retention and deletion rights; names Pankaj Kumar as data-protection contact | Use this URL for the revised form and verify its actual link in the final preview. The old form's configured URL remains unverified; this is a content/reachability check, not legal sign-off |
| Lead receipt | Current source exposes operator-triggered Meta sync into the owning business's Enquiries inbox, plus copy/WhatsApp sharing. This path has no automatic Pankaj assignment or notification | Verify Pankaj's authorized access or name the operator who will sync and securely hand off enquiries. Agree the response/checking window, then separately approve one controlled receipt test |
| AdBrain identity | September 25 owner sign-in confirmed: `vanshulg101@gmail.com`, `solar energy` workspace. Authenticated form API returns the four active Solaride forms, including the attached form; business-scoped campaign API returns the expected paused campaign and matching Meta IDs | Correct owner session and current application form access verified without reconnecting or repairing credentials; this does not prove lead retrieval, delivery or Pankaj's access |

After owner sign-in, the Enquiries route returned HTTP 200 with inbox content.
The shared browser nevertheless kept showing its loading shell after a reload;
inspection found the tab hidden and the inbox content present in a hidden DOM
container. Do not diagnose missing data or a backend failure from that loading
shell alone, or claim successful visible rendering. Bring the tab into view for
the next inbox check. No sync, test submission or receipt test was performed.

The form preview itself warns that it may differ from the Facebook experience;
messaging/consent controls still need final preview verification. No form was
submitted, leads downloaded/synced, messages sent, drafts published/discarded,
production records changed, or campaign toggles changed in this audit.

Lead-flow source references: [inbox and manual sharing](../src/components/lead-inbox.tsx),
[business-scoped sync](../src/app/api/leads/sync/route.ts). Source inspection is not
proof of successful deployed receipt or Pankaj's access. Automatic funding remains
a separate paid-launch gate; it does not block these non-spending preparations.

### Low-Level Tasks Next

| Order | Task | Owner | Output / boundary |
| --- | --- | --- | --- |
| 1 | Review the saved form draft and confirm follow-up response time/access | Owner reviews final form and response commitment; Copilot checks | Authorized unpublished form draft saved and reopened successfully; no response-time promise or verified lead handoff yet. Publication and receipt testing remain separately gated |
| 2 | Finish live ad, targeting and unpublished-change review in the verified owner workspace | Copilot inspects and diagnoses | Owner session and application form access verified; remaining checks must not recreate the campaign or publish the three existing drafts just to make progress |
| 3 | Prepare/review one evergreen creative and verify where an enquiry will arrive | Copilot prepares; owner approves claims and destination | Launch-ready creative and a consent-safe lead-receipt check; paid generation, production edits or provider test actions require their appropriate approval |
| 4 | Investigate one viable funding alternative or obtain human account-specific review | Copilot researches/checks approved accounts; owner handles provider/bank consent | Written supported setup path or a clear no-go. No mandate, new account, billing-mode change, deposit or ad activation under general research permission |
| 5 | Resolve the package's 80% tax meaning, gateway eligibility and refund terms | Copilot prepares comparison/questions; owner, CA and gateway confirm | Approved commercial specification; the INR 10,000 example and illustrative tax rates are not approved pricing/tax policy |
| 6 | Measure creative/API costs and expected operator effort for this pilot | Copilot collects available cost evidence; owner supplies real time/cost assumptions | Contribution estimate with explicit assumptions; revise scope/price if the fee cannot cover delivery and reserves |
| 7 | Publish the already-fixed OAuth test fixture and verify the exact dev CI run when Git publication is authorized | Copilot | Small release-maintenance task, not a product milestone; no production promotion bundled with it |

**The owner's next input:** review the saved Meta form and ad visual, confirm a realistic enquiry-response
window and the handoff operator. The intended owner session is now verified. Offer, destination,
service area, segment, follow-up owner and ad wording are already approved. No payment is needed to define
or inspect that pilot. Copilot's next task is to turn the audit findings into an
owner-approved creative/form and verify the real receipt path, not another billing
adapter or another generic Meta AI chat.

**Funding decision rule:** when a provider-supported automatic route is demonstrated,
request approval for its specific setup and limits. If no route can be demonstrated,
keep the managed-payment launch blocked and bring that product decision to the owner.
Do not quietly replace automatic funding with manual top-ups or customer-direct
Meta billing. Do not invent an API or grow infrastructure around an unproven route.

**Not now:** generic ledger/reconciliation frameworks, broad agency dashboards,
unattended account provisioning, extra status panels, Google Ads, video or automatic
optimization. Keep existing safety checks and implement only controls required by
the selected end-to-end path. The broader backlog below does not override this queue.

### Outcome Scorecard

| Outcome | Evidence so far | Remaining acceptance evidence |
| --- | --- | --- |
| Brand to approved creative | Existing implemented workflow; generation and review are available | One representative customer's approved creative and measured generation cost |
| Customer access to the correct Page/account | The documented Gmail owner's `solar energy` workspace has a saved Solaride 101 account/Page binding; the September 18 repair verified provider access | Recheck current provider access; normal customer OAuth, customer-owned Page onboarding and remaining account capacity remain unproven |
| Approved creative to deliverable campaign | September 24 Ads Manager check shows `new year` Off and its ad set Off with unpublished edits; exact stored object-ID selection returns one ad, matching the earlier successful creation record | Verify the ad's delivery/creative status and review unpublished changes; this does not resolve the later Holi publishing error or prove paid delivery |
| Solaride automatically pays Meta | Solaride 101 has INR 0 available funds and no saved method; owner-approved INR 100 inspection produced only an unpaid one-off UPI QR, with no Save UPI/recurring option | Resolve account-specific auto-reload eligibility before separately approved funding/mandate setup; a one-off payment does not meet the requirement |
| Customer pays AdBrain once | Quote/signature helpers only; no checkout | Gateway business-model/KYC approval and one isolated test-mode capture/refund before an authorised live pilot |
| Customer receives attributable value | Reporting/lead tools exist | Approved capped pilot with attributable enquiries, actual spend, service cost and support effort recorded |

No end-to-end managed-payment pilot has been verified in this work. Do not turn
test counts or completed schemas into a percentage of commercial readiness.
The dev billing foundations are reusable support code, not a functioning money
flow: their execution helpers have no application callers and migrations remain
unapplied. See [Payments Plan](PAYMENTS-PLAN.md) for their precise boundaries.

### Corrected Pilot Status

The initial September 24 name-only lookup checked a different business named
Solaride. Its missing connection and empty operation history must not be used to
describe the intended owner's progress. The documented owner/business IDs in the
[September 18 binding repair](qa/solaride-account-bindings-2026-09-18.md) identify
the Gmail owner's `solar energy` workspace. The corrected read-only check found
its connected generation-1 Solaride 101 binding and a successful campaign-create
operation, completed September 18 at 18:17 UTC. Its linked `new year` campaign is
stored PAUSED, targets instant forms, and has external campaign, ad-set and ad IDs.

After the owner signed into Meta on September 24, Ads Manager showed all five
campaign toggles Off, including `new year`. Its ad set was Off with unpublished
edits. Two other ad sets had their own toggles On but were blocked by Campaign off;
do not treat parent activation as harmless. Exact campaign/ad-set/ad IDs from the
stored record produced one selected object at each level and one ad result. The
ad row failed to render reliably in the embedded browser, so its delivery/creative
status remains unverified. Three unpublished drafts were left untouched. Recheck
current states before funding or activation; this snapshot is not a lasting lock.
No campaign, budget, draft or payment was submitted or changed by this inspection.

The owner later authorized an INR 100 UPI setup inspection, not a payment. Meta
created an expiring, unpaid QR request with no recurring-payment option. The flow
was left without payment; a fresh billing view still showed INR 0, no saved method
and no recent spending. Account-specific UPI auto-reload eligibility, rather than
the existence of a generic UPI payment method, is now the next funding blocker.

The owner then opened Meta support. Its AI-enabled chat reported eligibility but
could not explain the missing Save UPI option, connect a human specialist or issue
a case number. It acknowledged the unresolved issue. It also warned that a one-off
QR payment likely would not save a recurring method without prior recurring consent.
Do not treat that chat as verified funding or authorize a top-up to guess whether
the option appears. See the support outcome in [Payments Plan](PAYMENTS-PLAN.md).

The browser is signed into the demo clinic. That workspace was also deliberately
bound to Solaride 101 by the earlier owner-authorized repair; a different workspace
name does not imply a different external account. Keep the pilot in the intended
Gmail owner's workspace. Do not copy clinic creatives, rebind credentials, transfer
ownership or create another business. The owner will switch browser accounts.

The local diagnostic cannot decrypt production tokens because its environment has
no `META_TOKEN_ENCRYPTION_KEY`. This is not evidence of an expired or missing
production connection. No global token fallback, key change or Meta API call was
made. Use the existing authenticated production workflow for current provider
checks. Normal customer OAuth remains unverified by the administrator-provisioned
connection. Any new PAUSED creation, bank authorization and spending need separate
approval.

The latest creatives in the correct workspace include Holi/summer copy, and its
saved service locations are empty. Before a live pilot, approve a current offer,
service area and evergreen creative. Do not automatically reuse seasonal copy,
unsupported savings claims or another workspace's geography. Verify automatic
billing eligibility and mandate separately from campaign permissions. See the
[package sensitivity](PAYMENTS-PLAN.md#first-package-proposal-and-economics) before
committing to a net-media promise or implementing checkout.

The billing foundations were pushed to dev at `abfbfe1`, not deployed to production.
[Its CI run](https://github.com/vanshulgoyal101/adbrain/actions/runs/35997237310)
failed one OAuth test, with 1,717 tests passing and one skipped. The failing fixture
uses a fixed data-access expiry of 1790000000, now in the past; this is a test-clock
issue, not evidence of a real expired Meta token. The fixture now uses relative
future dates locally. All 1,718 tests pass with one skipped and coverage thresholds
met; scoped lint and the full typecheck also pass. The repair is not yet committed
or pushed, so the hosted CI result for `abfbfe1` remains failed.

## Release and Customer Gates

| Priority | Gap | Acceptance evidence |
| --- | --- | --- |
| First | Dependency-complete promotion and migration coordination | Exact reviewed SHA, passing gates, authorized schema/env changes, deployed workflow receipt |
| First | Real intended-customer Meta consent | Successful owner-controlled consent/selection/capabilities, current provider approvals; mocks insufficient |
| First | Repeatable creative quality and cost | Consented representative fixtures, bounded paid evaluations, actual provider usage and human review |
| First | Honest performance proof | Permissioned campaign baseline, comparable measurement window and attributable outcomes |
| First | Operational readiness | Monitored jobs, alert ownership, recovery and deletion drills, support escalation |

## Reliability and Workflow

| Work | Why / dependency |
| --- | --- |
| Durable generation jobs and server idempotency | Avoid duplicate paid work and recover across request/process termination; tab recovery alone is insufficient |
| Atomic quota reservation and stronger budget controls | Current token check and best-effort ledger can race/undercount; image costs need separate treatment |
| Campaign reconciliation tooling | Make uncertain external operations inspectable and safely repairable without blind manual edits |
| Scheduled insight/lead synchronization | Daily spend enforcement exists but reads stored snapshots; it is not fresh provider sync |
| Snapshot persistence hardening | Refresh currently can return a null stored result despite fetched metrics |
| Media retention and privacy operations | Public URLs, row/object non-atomicity and orphan cleanup need explicit policy/tooling |
| Operational alerts and incident views | Structured privacy-aware events exist; alert delivery and a cross-account support UI do not |
| Guided onboarding completion | Validate first-run brand -> creative -> paused campaign across real customer states |
| Visual/accessibility regression depth | Extend populated/empty/error, keyboard and mobile evidence; do not reclassify already delivered UI as wholly absent |

## Commercial and Growth

| Work | Gate |
| --- | --- |
| Pricing, billing and entitlements | Demonstrated repeatable value, measured costs, payment/webhook/refund/cancellation/support design |
| Lead notifications and follow-up | Reliable sync/webhooks, consent, channel configuration, retry/delivery tracking |
| Lead-to-deal and revenue attribution | Explicit lifecycle/data model and trustworthy outcome evidence |
| Trend and per-creative analysis | Defined insight windows, historical data quality and attribution |
| Teams and agency workspaces | Membership roles, shared ownership/RLS, audit and business selection design |
| Scheduled activation / optimization | Durable execution, financial consent and strong stop/recovery controls |
| Google Ads, video and other channels | Customer demand, access approval, evaluated providers and separate contracts |
| Branded auth domain | Verified provider configuration, DNS/plan costs and migration strategy; do not bypass Auth casually |

## Already Implemented, Still Bounded

Industry-neutral profiles, paid OpenRouter images, explicit image fallback,
creative interview/recovery, versioned drafts, durable campaign operations,
encrypted business-bound Meta access, local spend controls, daily spend cron,
structured logging and server-only usage/rate-limit persistence are implemented
in source. This does not establish that every migration is deployed or every
customer/provider path has been verified. Consult the dedicated references.

## Sequencing

Resolve customer-access and release gates, make core workflows recoverable and
observable, measure real value and costs, then introduce commercial automation.
Run legitimate Meta review work in parallel without synthetic traffic promises.
Extend channels and autonomous optimization only after the current loop is
understandable, supportable and safe to operate.
