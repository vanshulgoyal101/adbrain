# AdBrain Product Design Plan

> This is the execution plan for turning AdBrain from a functional internal
> tool into a customer-ready advertising workspace. It is stricter than a
> component backlog: a workstream is not complete because tokens, wrappers, or
> route names exist. It is complete only when the customer-facing workflow is
> visibly better in desktop and mobile screenshots and can be used without
> explanation.

_Last reviewed: 2026-09-05_

## Honest assessment

The previous plan overstated progress. The code has a reasonable backend,
strong safety work, and the beginnings of lifecycle navigation, but the visual
product is still too close to a starter dashboard:

- The shell is a pale page with a narrow sidebar, generic-looking type, one blue
  accent, and repeated white bordered cards.
- Home still spends valuable space on counts and implementation status instead
  of showing the customer's campaign work and next decision.
- Create, Review, Launch, and Results are named as a lifecycle, but they do not
  yet feel like one connected workflow with shared context.
- Creative Studio is still a brief form followed by a grid of cards, not a
  production review surface where a customer compares, edits, approves, and
  prepares an ad.
- Brand Brain remains primarily data entry. It does not yet visibly prove how
  the saved brand changes the output.
- Empty states are technically polite but visually empty and operationally
  passive. They do not provide a meaningful preview, example, or next step.
- “In progress” and “delivered” described code structure, not a measurable
  improvement in customer experience.

This plan resets the baseline. Until Phase 1 is complete, do not claim that the
UI has had a major redesign.

## Product target

AdBrain should feel like a focused campaign workspace for a busy local-business
owner or a small agency operator:

1. The user sees what needs attention immediately.
2. The user can create a campaign brief without understanding AI terminology.
3. The user can compare real ad outputs in a serious review surface.
4. The user understands exactly what will happen before money or a Meta account
   is involved.
5. The user can return later and understand what changed, what worked, and what
   to do next.

The product should feel composed, useful, and commercially credible. It should
not feel playful, neon, gamified, oversized, or like a collection of AI demos.

## Visual direction

Use an editorial operations aesthetic: warm mineral workspace background, deep
ink typography, crisp white work surfaces, a confident cobalt action color, and
one restrained coral signal color for attention. Use color to communicate
workflow state, not decoration.

Required characteristics:

- Use a distinctive display face for page titles and a highly legible interface
  face for controls and data. Avoid default-looking system typography.
- Establish a strong type scale: compact navigation, quiet metadata, clear page
  titles, and larger outcome numbers only where they help a decision.
- Reduce the number of floating cards. Use full-width bands, dividers, tables,
  split panes, and framed tools where those structures fit the job.
- Keep radii restrained, generally 6-8px. Avoid pill-shaped UI except for
  statuses and filters.
- Make the creative image, campaign state, lead state, and next action the
  visual anchors. Empty background is not a substitute for hierarchy.
- Use motion sparingly: page-load reveal, generation progress, and state changes.
  No decorative bouncing, floating, or generic shimmer everywhere.
- Design at 1440px, 1024px, 768px, and 390px widths. Nothing is accepted from a
  desktop screenshot alone.

## Navigation model

The primary workflow is:

```text
Home -> Create -> Review -> Launch -> Results
```

Workspace configuration is secondary:

```text
Brand Brain | Assets | Connections | Settings
```

Use persistent workspace context in the shell: business name, current campaign
or draft, connection state, and account menu. Do not make the user rediscover
which business or campaign they are viewing on every route.

## Non-negotiable acceptance rules

Every redesigned screen must satisfy all of these before being marked complete:

- A first-time user can identify the primary action in five seconds.
- A returning user can identify what needs attention in five seconds.
- The screen has a deliberate populated state, empty state, loading state,
  error state, and success state.
- The primary content is visible without a wall of explanatory copy.
- The screen has one dominant action, not a row of equally weighted buttons.
- Important actions have clear pending, disabled, confirmation, and failure
  behavior.
- Desktop and mobile screenshots show no clipped text, accidental horizontal
  scrolling, or collapsed hierarchy.
- The page is tested with realistic seeded data, not only an empty database.
- Someone unfamiliar with the code can complete the core task without
  narration.

## Phased execution

### Phase 0 — Establish the visual contract

**Goal:** stop design drift before touching individual pages.

Deliver:

- Finalize color, typography, spacing, radius, elevation, control-height, focus,
  and motion tokens in `globals.css`.
- Create shared primitives for `PageFrame`, `PageHeader`, `StatusBadge`,
  `EmptyState`, `Notice`, `Metric`, `StepProgress`, `DataTable`, `Drawer`, and
  `ConfirmDialog`.
- Define shared status semantics: draft, needs review, approved, scheduled,
  paused, active, attention, failed, and complete.
- Create realistic demo fixtures: one complete Brand Brain, six creatives in
  mixed states, one paused campaign, leads, and an empty first-run workspace.

**Gate:** a before/after screenshot board demonstrates a materially different
visual system. Do not proceed if the result still reads as white cards on a
pale blue page.

### Phase 1 — Rebuild the application shell

**Goal:** make the whole product feel like one deliberate application.

Deliver:

- Replace the oversized sidebar treatment with a compact, purposeful shell that
  gives the work area more room.
- Add workspace context, account menu, connection health, and a compact mobile
  navigation pattern.
- Give every page the same header rhythm, content width, action placement, and
  context treatment where needed.
- Remove duplicate page labels and implementation-oriented wording.
- Add global toast, error boundary, loading skeleton, and unsaved-change
  patterns.

**Gate:** dashboard, brand, studio, campaigns, leads, assets, and settings look
like the same product in a four-viewport screenshot review.

### Phase 2 — Make Home a command center

**Goal:** replace dashboard reporting with a useful work queue.

Deliver:

- A compact greeting and workspace context, followed by one dominant next-best
  action with a real reason: finish brand, review ads, connect Meta, or respond
  to a lead.
- A campaign pipeline showing Brand ready -> Ads ready -> Review -> Paused
  launch -> Learning, with counts and state.
- A work queue for ads needing review, unanswered leads, connection issues, and
  spend warnings.
- A visible weekly outcome strip: leads, spend, cost per lead, and change versus
  the previous period when data exists.
- A strong populated demo state and a useful first-run state with a guided
  checklist, example creative, and clear next action.

**Gate:** a customer can decide what to do next without opening the sidebar.

### Phase 3 — Turn Brand Brain into a product asset

**Goal:** make the differentiator feel valuable rather than like a long form.

Deliver:

- A section navigator with completion state and a short reason each section
  matters.
- Sections for identity, audience/service areas, voice, offers/proof, contact,
  visual identity, and advertising rules.
- A live Brand signal preview showing how saved inputs change a headline, primary
  text, CTA, and contact line.
- Strong save/autofill feedback, dirty-state protection, field-level errors, and
  completion/readiness scoring.
- Asset handling as part of brand setup, not a disconnected storage page.

**Gate:** a user can explain why Brand Brain exists and can see its effect before
generating anything.

### Phase 4 — Make Create and Review one production workflow

**Goal:** make ad creation feel like a serious creative tool.

Deliver:

- Make Ad Assistant the friendly entry point for a new user, with a visible
  brief summary and progress through the conversation.
- Make Studio a split workspace: creative board on the left, selected-creative
  inspector on the right, and persistent brief/context above.
- Show real platform formats: feed, square, and story previews with safe areas.
- Add compare mode for 2-3 variants, keyboard navigation, approve/reject/edit
  actions, and clear status transitions.
- Make generation progress specific: writing copy, creating imagery,
  composing poster, saving variants. Preserve completed work if one variant
  fails.
- Replace generic empty cards with example output, a useful brief template, and
  one primary Create first batch action.

**Gate:** a customer can generate, compare, approve, and export without moving
mentally between separate tools.

### Phase 5 — Make Launch safe and legible

**Goal:** make the first campaign feel trustworthy.

Deliver:

- A launch review with creative, objective, location, audience, lead form,
  budget, schedule, and connection state in one summary.
- A clear “Paused: nothing will spend yet” safety treatment adjacent to the
  final action, not buried in helper text.
- Editable review sections with a final confirmation dialog that states exactly
  what will be created.
- Campaign list with lifecycle states, last sync, spend, leads, and next action.
- Recoverable errors for expired Meta connections, missing lead forms, rejected
  creatives, and budget guardrail blocks.

**Gate:** a non-expert can describe what will happen after clicking the final
button and can find the campaign again afterward.

### Phase 6 — Make Results retain customers

**Goal:** turn delivery into an ongoing reason to return.

Deliver:

- Results home with leads, spend, CPL, response time, and trend context.
- Lead inbox grouped by new, contacted, qualified, won, and archived.
- Lead detail with campaign, creative, timestamp, notes, and one-tap status
  change.
- Plain-language interpretation: what changed, what is working, and what to do
  next. Avoid charts without a decision attached.
- Empty, delayed-sync, and no-results states that explain the next useful step.

**Gate:** after a campaign launches, the user knows what happened and what to
do next without needing a support call.

### Phase 7 — Commercial polish and evidence

**Goal:** earn trust before asking for money.

Deliver:

- Activity history for generation, approvals, exports, campaign changes, and
  connection events.
- Support/help entry point, changelog, privacy/data controls, and account
  management.
- Billing and usage surfaces only after pricing and payment flow are validated.
- Product analytics for activation, first creative, approval, launch review,
  first lead, and repeat session.
- Accessibility, keyboard, reduced-motion, responsive, and error-recovery audit.

**Gate:** five people unfamiliar with the implementation can complete the
primary journey; all critical failures are observable and recoverable.

## Delivery order

1. Phase 0 visual contract and realistic fixtures.
2. Phase 1 shell and shared states.
3. Phase 2 Home command center.
4. Phase 3 Brand Brain asset.
5. Phase 4 Create/Review workspace.
6. Phase 5 Launch review.
7. Phase 6 Results and lead workflow.
8. Phase 7 commercial polish, analytics, and billing readiness.

Do not add more AI features, more dashboard metrics, or billing UI ahead of
these phases. The product needs a coherent customer workflow before it needs
more capability.

## Definition of “improved”

The redesign is successful only when all of the following are true:

- The populated Home screen has a clear work queue and outcome hierarchy.
- The first-run workspace is useful rather than blank.
- Brand Brain visibly changes the creative output.
- Studio feels like a review tool, not a card grid.
- Launch explains safety and consequences before confirmation.
- Results explains performance in plain language.
- The visual system is recognizable without seeing the logo.
- Before/after screenshots show an unmistakable improvement at every core route.
- Core task measurements improve: first creative time, approval rate, launch
  review completion, and return visits.

## Explicit non-goals

Do not add decorative gradients, random illustrations, excessive charts,
gamification, fake activity, or more cards to make the product look busy. Do not
call a page “premium” because it has shadows or rounded corners. The goal is
useful density, clear hierarchy, and confidence around real advertising work.
