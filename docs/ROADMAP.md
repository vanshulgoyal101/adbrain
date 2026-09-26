# Roadmap

Priorities describe future work and unresolved evidence, not shipped commitments
or estimated delivery dates. [Features](FEATURES.md) is the current capability
inventory; [QA](qa/) and [releases](releases/) record dated verification. Review
this backlog against the checked-out source and current remote state before starting.

## Current Focus: One Verified Managed Customer

September 26 operator clarification: AdBrain currently operates as Vanshul Goyal's
unregistered business, not under Solaride. The permitted Razorpay merchant display
name is Vanshul Goyal. Moving into Solaride remains a future legal/provider change;
it must not be inferred from the earlier plans below. Existing Meta bindings are
preserved and real collections remain disabled. The separate local Razorpay
test-checkout work was not included in the identity-only production correction.

Reset 2026-09-24: prioritize customer outcomes and business-model feasibility over
additional infrastructure. The product goal is a local business turning its offer
into approved ads and measurable enquiries with minimal advertising operations.
Latest owner clarification September 25: one INR 10,000 annual customer payment,
INR 2,000 service allocation and INR 8,000 covering Meta media plus applicable
Meta taxes, with automatic Meta payment and a separate Solaride-owned account
per customer. Customer invoice tax treatment remains to be reviewed; do not
silently add tax to the requested total. Proving outbound automatic funding is
the highest priority, ahead of further campaign preparation or checkout code.

September 26 exception: the owner confirmed no Razorpay account exists yet and
authorized isolated Razorpay test-mode implementation in parallel with funding
verification. A disabled-by-default local backend now creates durable test orders
and verifies callbacks/webhooks; the gated Settings checkout UI supports mocked
capture and reload recovery. Actual Razorpay provider testing remains pending
account setup. This does not authorize live collection or change the funding, commercial
or delivery gates. See the current [implementation receipt](PAYMENTS-PLAN.md#9-implementation-receipt).

The [detailed payments implementation plan](PAYMENTS-PLAN.md#8-delivery-phases-and-acceptance-gates)
maps existing foundations to milestones M0-M7, proposed API/data contracts,
unattended delivery authorization, recovery tests and rollout gates. It is the
build sequence for this priority, not authorization for live financial actions.

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
| P2 | Solaride can pay Meta automatically | HIGHEST PRIORITY: prove a usable route before more campaign work | Assess automatic postpaid agency billing for new customer accounts; resolve existing-account UPI enrollment only with account-specific evidence; no more one-off QR or generic AI-support loops | After specific owner authorization, one mandate and bounded automatic payment reconcile to the correct account without manual payment each time; limits and failure handling verified |
| P1 | One useful Solaride campaign ready to run | PAUSED FOLLOW-UP: revised form ACTIVE; campaign, ad set and ad published OFF; creation already worked | After funding work, verify Pankaj's enquiry access/response window and authorized receipt test; check AdBrain sync | Lead handling and final launch review verified; no activation bundled with funding setup |
| P3 | A package worth selling | Annual INR 10,000 model clarified; INR 8,000 includes Meta taxes | Obtain CA/gateway review of customer invoice tax; define annual scope, renewal, unused funds and refunds; verify fee economics | Legally viable approved terms and contribution margin; no automatic annual renewal assumed |
| P4 | One real customer can connect the right assets | REQUIRED before an external paid pilot | Verify customer consent/app access, a Solaride-owned customer account plus the customer's Page, account capacity and offboarding responsibilities | The intended customer completes the real connection flow; correct ownership, permissions and destination work without global tokens or an admin credential backfill |
| P5 | One customer payment safely funds the service | WAIT for P2 feasibility, P3 decisions and isolated gateway test access | Integrate one hosted checkout with existing quote helpers; verify capture/webhook retries, durable allocation, refund and campaign funding gates; prove one test-mode capture/refund | The exact order reconciles once, retries do not duplicate credit, failed/unverified payments cannot authorize spending, and a refund is verified |
| P6 | Demonstrate value, then decide whether to expand | WAIT for campaign, funding and commercial gates; P4/P5 also required for the external paid pilot | Separately approve the pilot budget/activation; deliver the campaign; reconcile actual costs; measure qualified enquiries, owner effort and margin | A completed pilot report supports a continue/change/stop decision; an internal Solaride test alone is not proof of customer checkout or repeatable onboarding |

P2 is now first in the work queue. Its ID is retained for existing references,
not priority order. Campaign creation already worked; the latest Meta campaign
was operational setup, not a new product capability. P3's tax/gateway questions
can progress alongside funding because they affect the same money flow. Defer
further campaign polish and generic billing frameworks until a usable route exists.
An internal spend test requires P1, verified P2, agreed cost/measurement limits and
separate activation approval. It does not complete the external customer journey.

### Solaride Pilot Brief

Owner approved September 25: **free solar site survey with Meta instant-form
enquiries**. Subsequently authorized publishing the saved form and creating a new
paused campaign: "publish it, create paused campaign dont hesitate". This does not
authorize spending, funding, paid generation or activation.

| Brief item | Decision / draft |
| --- | --- |
| Offer | Free solar site survey; no payment details collected from the enquirer |
| Destination | Solaride Energy Page's Meta instant form, not WhatsApp |
| Service area | Owner-approved: Chandigarh and Panchkula; no wider radius or surrounding cities assumed |
| Initial customer segment | Owner-approved: homeowners, residential rooftop solar |
| Primary outcome | Qualified survey requests, then surveys booked; form submissions alone are not success |
| Follow-up | Owner named Pankaj Kumar; response window and lead-access/handoff still to verify. Contact number supplied privately is intentionally not recorded here |
| Campaign state | New campaign, ad set and ad published OFF; existing campaigns and three older unpublished drafts preserved |

**Approved headline (September 25):** Request Your Free Solar Site Survey

**Approved primary text (September 25):** Own a home in Chandigarh or Panchkula? Explore rooftop solar
with a free site survey from Solaride. Share your details and our team will contact
you to discuss your roof and arrange a suitable time.

**Published form intro:** Request a free rooftop solar site survey in Chandigarh or
Panchkula. Share your contact details and a little about your property so our team
can discuss the next step with you.

**Published form fields:** name, phone number, city (Chandigarh / Panchkula /
Other / please review coverage), locality,
and whether the enquirer owns the property or has permission to install solar.
Flag Other for coverage review rather than promising a visit. Treat roof access as a qualification
question, not an automatic rejection. Do not request full addresses, identity
documents, bank details or electricity-bill uploads in this initial form.

**Saved contact-purpose disclosure:** Solaride will use these details to contact you
about your site survey request and rooftop solar requirements. Submitting this
form does not confirm an appointment. Review this wording alongside the actual
privacy policy and Meta consent controls before any future revision.

**Saved completion headline:** Thank you for your request

**Saved completion message:** Solaride has received your request. Our team will
contact you to discuss your property and arrange the next step.

The owner approved the ad headline and primary text above on September 25 and
then explicitly authorized saving an unpublished Meta form draft with the proposed
fields, followed by publication and a new paused campaign. The actual lead-receipt
workflow, final launch review, funding and activation remain separate gates. Do not
promise subsidy eligibility, a savings percentage, a confirmed appointment or a
response time without evidence.

### Published Form and Paused Campaign

September 25: published the previously saved and reopened form on Solaride Energy
Page `885223068001054`, named
`Solaride | Free Survey | CHD-PKL | Homeowners | Sep 2026`.
Authenticated AdBrain `GET /api/campaigns/lead-forms` returned HTTP 200 with form
`2531491190682703` in `ACTIVE` status.

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
- **Verification:** the saved draft was reloaded and reopened to check its fields,
	privacy URL, settings and ending before publication. The published form was
	then selected on the new ad and its selection survived editor navigation.

Created directly in Ads Manager under Solaride 101 account `act_2398686420592052`:

| Object | Name | Meta ID | Verified state after publication |
| --- | --- | --- | --- |
| Campaign | Solaride \| Free Survey \| CHD-PKL \| Sep 2026 | `120253256980050526` | Off; not In draft |
| Ad set | Homeowners \| Chandigarh & Panchkula \| Free Survey | `120253256980060526` | Off; not In draft |
| Ad | Solaride \| Free Survey \| CHD-PKL \| Sep 2026 | `120253256980040526` | Own switch off; delivery Campaign off; not In draft |

- **Budget:** INR 200/day at campaign level, verified after publication and
	reopening. This is a saved setup value, not spending approval or a hard daily
	cap. Meta displays INR 350 maximum daily and INR 1,400 maximum weekly spend.
- **Targeting:** Chandigarh and Panchkula, current-city-only selections shown as
	0 miles, with no added radius or Mohali exclusion. Location-interest expansion
	was turned off. Meta's city definitions are not verified municipal boundaries.
	Minimum age 18, suggested ages 18-65+, all genders, Advantage+ placements.
	Homeowners are addressed by the copy and property-permission questions, not a
	verified exclusive homeownership demographic filter.
- **Creative:** reused the Solaride website's installation-canopy image,
	converted to JPEG, with the exact approved primary text/headline and `Learn more`
	CTA. Original media selected; no AI variants selected. Music, visual touch-ups,
	animation, overlays and text improvements all off. Preview images loaded;
	this is not certification of every placement or device.
- **Publication:** the ad-level Publish operation processed exactly three new
	objects. The new ad changed from In draft to Campaign off. The campaign and
	ad set were reopened and each showed Off. All three switches were individually
	verified off; the three older drafts remained in `Review and publish (3)`.
- **Application boundary:** this was direct Meta creation, not an AdBrain campaign
	operation. AdBrain campaign-list import/sync is not yet verified. Do not insert
	production database records manually to manufacture that linkage.

[Open the paused campaign in Meta](https://adsmanager.facebook.com/adsmanager/manage/campaigns/edit/standalone?act=2398686420592052&business_id=1158100643072508&selected_campaign_ids=120253256980050526).
No existing campaign/form/draft was replaced, no test lead or message was sent,
and no payment, mandate, account funding or activation was performed. Pankaj's
actual receipt/access and response commitment remain unverified.

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
| 1 | Verify a usable automatic funding route for a Solaride-owned INR account | Copilot verifies provider/account requirements; owner handles bank consent | Actual route, enrollment steps, limits and separate approval for a bounded payment test; no fabricated top-up API or manual-payment substitute |
| 2 | Confirm annual INR 10,000 invoice, service scope and fee economics | Owner, CA and gateway confirm; Copilot implements reviewed rules | INR 2,000 service and INR 8,000 tax-inclusive Meta allocation are the product target; tax, renewal, unused-funds/refund rules and gateway eligibility still need review |
| 3 | Prove one automatic Meta payment, then connect the annual checkout flow | Copilot integrates only the verified route; owner authorizes the exact financial test | Bank/Meta receipt matched once, with payment failure and spending limits tested; current general request is not a bank mandate or ad activation |
| 4 | Confirm Pankaj's response time/access and test one enquiry when authorized | Owner/Pankaj and Copilot | Actual consent-safe receipt and handoff; no test lead submitted yet |
| 5 | Verify AdBrain campaign visibility and complete launch review | Copilot checks normal sync/import when authorized | Direct Meta setup is not an AdBrain create receipt; preserve old drafts and keep all objects off |
| 6 | Run a separately approved campaign schedule within the annual allocation | Owner approves; Copilot measures costs and results | INR 200/day paused setup is not permission for year-round delivery or an annual budget; report qualified enquiries and service effort |
| 7 | Publish the already-fixed OAuth test fixture and verify the exact dev CI run when Git publication is authorized | Copilot | Small release-maintenance task, not a product milestone; no production promotion bundled with it |

**Next deliverable:** establish how Solaride will pay Meta automatically for the
annual package, with a concrete setup path, account eligibility and the exact
human authorization required. Do not ask the owner to approve the 20/80 or
tax-inclusive Meta allocation again. Bank consent, any test charge and ad activation
remain separately scoped approvals. Existing campaign/form work stays off and
does not take priority over resolving the money flow.

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
| Approved creative to deliverable campaign | September 25: new evergreen free-survey form ACTIVE; campaign `120253256980050526`, ad set and ad published with all switches OFF; INR 200/day saved | Verify AdBrain import, final launch review and enquiry handoff; direct Meta creation does not resolve the old Holi error or prove paid delivery |
| Solaride automatically pays Meta | Solaride 101 has INR 0 available funds and no saved method; owner-approved INR 100 inspection produced only an unpaid one-off UPI QR, with no Save UPI/recurring option | Resolve account-specific auto-reload eligibility before separately approved funding/mandate setup; a one-off payment does not meet the requirement |
| Customer pays AdBrain once | Local-only SDK, durable test orders and gated Settings checkout; no provider-tested or live collection | Gateway business-model/KYC approval and one isolated test-mode capture/refund before an authorised live pilot |
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

The earlier browser was signed into the demo clinic. That workspace was also deliberately
bound to Solaride 101 by the earlier owner-authorized repair; a different workspace
name does not imply a different external account. Keep the pilot in the intended
Gmail owner's workspace. Do not copy clinic creatives, rebind credentials, transfer
ownership or create another business. The owner subsequently switched accounts;
the intended session and form access were verified on September 25.

The local diagnostic cannot decrypt production tokens because its environment has
no `META_TOKEN_ENCRYPTION_KEY`. This is not evidence of an expired or missing
production connection. No global token fallback, key change or Meta API call was
made. Use the existing authenticated production workflow for current provider
checks. Normal customer OAuth remains unverified by the administrator-provisioned
connection. The specific paused creation above was subsequently authorized and
completed; bank authorization, funding and spending still require separate approval.

The latest creatives in the correct workspace include Holi/summer copy, and its
saved service locations are empty. Before a live pilot, approve a current offer,
service area and evergreen creative. Do not automatically reuse seasonal copy,
unsupported savings claims or another workspace's geography. Verify automatic
billing eligibility and mandate separately from campaign permissions. See the
[package sensitivity](PAYMENTS-PLAN.md#annual-package-and-illustrative-economics) before
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
