# AdBrain Product Transformation Plan

> This is the execution plan for turning AdBrain from a functional internal
> tool into a customer-ready advertising workspace. It is stricter than a
> component backlog: a workstream is not complete because tokens, wrappers, or
> route names exist. It is complete only when the customer-facing workflow is
> visibly better in desktop and mobile screenshots and can be used without
> explanation.

_Last reviewed: 2026-09-05_

## Honest baseline

The backend has meaningful capability and the safety work is strong, but the
customer experience is not yet a sellable product. The live public page is a
large pale canvas with a centered headline, one CTA, and generic feature cards.
It does not show the product's strongest proof: a real ad, brand transformation,
campaign control, lead outcomes, or a credible customer example.

The signed-in workspace has better navigation and safety copy, but still uses
the visual grammar of an internal tool: form-first screens, repeated cards,
sparse populated states, weak cross-page context, and no convincing review
workspace for the actual creative work.

Therefore:

- Incremental styling changes must not be described as a major redesign.
- Tokens, shadows, labels, and route names are not progress unless they change
	a customer task or visible hierarchy.
- SEO metadata is not a substitute for useful indexable content.
- More AI features, metrics, and billing UI are paused until the core workflow
	is coherent.

## Product promise

AdBrain helps a local business turn its real brand and offer into ads it can
understand, approve, launch safely, and improve from results.

| Screen | Customer question |
|---|---|
| Public site | Is this for my business, and can I see what it produces? |
| Home | What needs my attention today? |
| Brand Brain | What does AdBrain know, and how does it affect the ad? |
| Create | What am I trying to achieve? |
| Review | Which ad should I use, and why? |
| Launch | What exactly will happen, and what is protected? |
| Results | Did it work, and what should I do next? |

## Two experiences, one product

### Public acquisition experience

The public site must sell understanding and proof, not list capabilities.

Required first viewport:

- A specific promise for local businesses.
- A real, readable ad example or product workflow visual.
- A labelled business context such as a clearly marked demo workspace.
- One primary CTA and one lower-friction secondary action.
- A hint of the next section without a large unexplained gap.

Required sections: hero with creative proof; brand-input-to-ad before/after;
review and paused-launch safety; results and lead follow-up; honest demo or
customer context; FAQ, trust, legal, and final CTA.

### Authenticated operating workspace

The app must feel like a focused campaign room, not a collection of forms.
It needs persistent business/campaign context, one clear current action,
realistic populated fixtures, and deliberate empty, loading, error, paused,
success, and offline states. Mobile is a workflow design, not a collapsed
desktop sidebar.

## Visual contract

Use a restrained editorial operations language: warm mineral background, deep
ink, white work surfaces, cobalt primary action, amber/coral attention, and
green only for verified success. The work supplies the visual drama: creative
previews, lead status, campaign state, and performance change.

- Use a distinctive display face and a separate interface face.
- Use a 12-column desktop grid and deliberate mobile rhythm.
- Prefer split panes, tables, timelines, dividers, and work queues over nested
	card grids.
- Keep radii generally 6-8px; reserve pills for status and filters.
- Use stable dimensions for creative previews and controls.
- Use motion only for entry, generation progress, and meaningful state change.
- Do not use decorative blobs, fake activity, oversized empty hero spacing, or
	gradients without a job.

## Shared foundations

Build these before polishing individual routes:

- `PageFrame`, `PageHeader`, `StatusBadge`, `EmptyState`, `LoadingState`,
	`ErrorState`, `Notice`, and `ConfirmDialog`.
- `Metric`, `ChangeIndicator`, `WorkQueue`, `StepProgress`, `DataTable`,
	`Drawer`, and `CreativePreview`.
- One state vocabulary: draft, needs review, approved, paused, active,
	learning, attention, failed, complete.
- Demo fixtures for a complete business, mixed creatives, a paused campaign,
	leads, results, and a true first-run account.

Fixtures power screenshots, browser tests, and demos; they must never appear as
real customer activity.

## Delivery phases

### Phase A — Public proof reset

**Progress (2026-09-05):** the public route now has a photographic first viewport,
a labelled fictional brand-to-ad example with two selectable copy angles, and
explicit review/paused-launch guidance. The generic feature-card grid is gone.
The auth redirect, FAQ schema, and legal links remain intact. Production-build
browser checks covered 1440, 1024, 768, and 390 CSS pixels; see
[validation evidence](qa/public-refresh.md).

This is partial delivery, not Phase A acceptance: the example is authored sample
copy with stock photography, not verified output from the generation pipeline.
Actual generated-work proof, results/follow-up evidence, and customer-task
validation remain open. No authenticated workspace redesign is claimed here.

**Outcome:** a stranger understands the product and sees its output in five
seconds.

Replace the text-only hero with a real labelled creative/workflow composition;
show brand inputs becoming a finished ad; demonstrate review-before-launch and
paused safety; reduce the generic feature grid; add vertical pages only when
each has unique useful copy and a real example.

**Gate:** first viewport proof at 1440px and 390px; no large unexplained empty
region; every claim has an owning feature or honest evidence.

### Phase B — Workspace shell and density reset

**Outcome:** every authenticated route feels like one commercial product.

Add business context, connection health, account control, shared page framing,
consistent action placement, global recovery states, and realistic populated
fixtures. Test 1440, 1024, 768, and 390px.

**Gate:** dashboard, Brand Brain, Create, Studio, Campaigns, Leads, Assets, and
Settings pass a four-viewport screenshot review.

### Phase C — Home command center

**Progress (2026-09-05):** Home now derives a work queue from brand context,
drafts, unused approved creatives, Meta readiness, and paused/draft campaigns.
Repeated shortcut panels were replaced with task rows, campaign state, brand
context, linked creative previews, and activity. Independent reads start in
parallel. First-run behavior is unit-tested; real populated Home-to-Review flows
are browser-tested at four widths. User-task evaluation remains open.

**Outcome:** a returning customer knows what to do next without opening the nav.

Build one reasoned next-best action, a campaign pipeline, a work queue for
review/leads/connections/spend, an outcome strip, and a useful first-run path.

**Gate:** the five-second test identifies the next action in populated and
first-run states.

### Phase D — Brand Brain asset

**Outcome:** the user sees why Brand Brain matters before generating an ad.

Add section completion, live headline/copy/CTA/contact/visual previews, visible
before/after changes, coherent assets and rules, dirty-state protection, and
field-level recovery.

**Gate:** changing one field visibly changes the preview; the page reads as a
brand system, not a database form.

### Phase E — Create and Review workspace

**Progress (2026-09-05):** Review now has a selectable board and inspector,
status/search filters, Home deep links, collapsed brief entry for returning
users, visible approval/deletion failures, and keyboard-contained enlargement.
Mobile uses a horizontal thumbnail strip. Existing generate/regenerate/export
paths remain covered. Explicit compare mode, editing, rejection, additional
placements, and generation-progress redesign are not delivered yet. See
[workspace validation](qa/workspace-refresh.md).

**Outcome:** a customer can generate, compare, approve, and export without
mentally switching tools.

Add persistent brief context, a split creative board/inspector, feed/square/
story placements, compare mode, keyboard navigation, approve/reject/edit/
regenerate/export states, named generation progress, and partial-failure
preservation.

**Gate:** a customer can choose a winner and explain why in desktop and mobile
flows.

### Phase F — Launch and Results retention loop

**Outcome:** customers trust the launch and know what to do after delivery.

Connect approved work to a single launch preflight covering creative, objective,
audience, budget, lead form, schedule, and connection. Then connect campaigns to
results with leads, spend, CPL, response time, trend context, lead states, and
one recommended next action. Handle delayed sync, empty data, provider errors,
and expired connections explicitly.

**Gate:** a non-expert can describe the final action and find the next action
after launch without support.

### Phase G — Evidence and commercial readiness

**Outcome:** the product can be trusted by customers and operated by the team.

Add browser tests for the primary journey, accessibility checks, error and
provider monitoring, sync health, SEO validation, Meta App Review, pricing,
usage limits, support, and account controls only when their contracts are
verified.

**Gate:** five people unfamiliar with the implementation complete the primary
journey; critical failures are observable and recoverable.

## Evidence gates

Every phase requires:

1. Before/after screenshots at 1440px and 390px.
2. A populated fixture and a first-run fixture.
3. Focused behavior tests plus accessibility/keyboard checks.
4. Full lint, typecheck, test, build, and deployment checks.
5. A short note naming what became easier for the customer.
6. No “complete” label while an acceptance rule is unverified.

## Measurement

Track time to saved Brand Brain, time to first creative, approval rate,
launch-review completion, time to first lead follow-up, return-session next
actions, and support questions caused by unclear state or copy.

## Explicit non-goals

Do not add decorative UI, fake customer proof, generic doorway pages, random AI
chat surfaces, more dashboard metrics, or billing screens without a pricing
decision. Do not promise first-place search rankings. Build useful content,
technical correctness, performance, trustworthy claims, and measurement;
ranking is an outcome to earn.

## Delivery order

1. Public proof reset.
2. Workspace shell and density reset.
3. Home command center and fixtures.
4. Brand Brain asset.
5. Create and Review workspace.
6. Launch and Results loop.
7. Browser evidence, operations, SEO content, App Review, and billing.

