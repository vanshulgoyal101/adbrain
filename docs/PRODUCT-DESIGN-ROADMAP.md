# AdBrain — Product Design Roadmap

> The product-design plan for making AdBrain feel like a sellable, trustworthy
> marketing workspace rather than a collection of AI features. This document
> covers product hierarchy, visual language, workflows, trust signals, and the
> order in which the work should be delivered.
>
> Engineering status belongs in [ROADMAP.md](./ROADMAP.md); the feature
> inventory belongs in [FEATURES.md](./FEATURES.md).
>
_Last reviewed: 2026-09-05_

## Product thesis

AdBrain should feel like a calm operating system for creating, approving,
launching, and learning from local-business advertising.

The interface must answer one question immediately:

> What should I do next to get a better ad live?

The product should feel professional, purpose-built for local businesses and
agencies, opinionated enough for a non-expert, safe enough to trust with a
budget and a brand reputation, and fast enough to use repeatedly.

It should not feel like a generic CRUD dashboard, a developer console, or a
demo of unrelated AI widgets.

## Current diagnosis

The current implementation is functional but visually and structurally reads as
an internal tool:

- Eight equally weighted navigation items expose implementation areas instead
  of the ad lifecycle.
- Most pages use the same heading, paragraph, bordered-card composition.
- The system relies on generic system typography, blue accents, slate text, and
  repeated rounded cards without enough hierarchy.
- The Dashboard emphasizes record counts (`Total creatives`, `Drafts`) instead
  of the customer's next decision or business outcome.
- Creation is split across Dashboard, Ad Assistant, and Creative Studio without
  one clearly dominant workflow.
- Brand Brain is presented as a long form even though it is AdBrain's central
  differentiator and durable customer asset.
- Creative Studio behaves like a form plus image grid rather than a production
  and review workspace.

## Product architecture

The primary navigation should follow the customer's work, not the database:

```text
Home
Create
Review
Launch
Results

Workspace
  Brand Brain
  Assets
  Connections
  Settings
```

The primary lifecycle is:

```text
Understand the business -> Create -> Review -> Launch safely -> Learn from results
```

Secondary configuration should remain accessible without competing with the
main job-to-be-done.

## Design principles

1. **Outcome before implementation.** Prefer ads ready to review, campaigns
   ready to launch, and new leads over raw record counts.
2. **One dominant next action.** Every page should make the best next step
   obvious within five seconds.
3. **Calm confidence.** Use whitespace, hierarchy, restrained color, and clear
   status language. Avoid decoration that competes with the work.
4. **Safe by default.** Budget, targeting, Meta connection, paused status, and
   irreversible actions must be understandable before confirmation.
5. **Brand is an asset.** Brand Brain should visibly improve the generated work,
   not feel like data entry.
6. **Progressive disclosure.** Keep first-run flows simple; expose advanced
   targeting and operational detail when it is relevant.
7. **One system.** Shared tokens, page headers, empty states, statuses, dialogs,
   loading states, and feedback should make every screen feel related.
8. **Mobile is a workflow.** Design mobile navigation and task completion
   intentionally; do not merely stack desktop columns.

## Visual language

Create shared design tokens for:

- Display and interface typography
- Workspace background, surfaces, borders, and text hierarchy
- Primary action, attention, success, warning, danger, paused, active, and draft
- A small radius scale and elevation scale
- Spacing, control heights, focus rings, and motion durations

The visual direction should use a warm or neutral workspace, deep graphite text,
one recognizable AdBrain action color, restrained semantic colors, and strong
typographic hierarchy. Avoid a blue-only palette, decorative gradient blobs,
excessive glassmorphism, and card-inside-card layouts.

Every shared control needs intentional hover, focus, disabled, loading, error,
and empty states.

## Workstreams

### 1. Product shell and visual foundation

- Establish tokens and typography in `src/app/globals.css`.
- Build shared page headers, section headers, status pills, empty states, toasts,
  confirmation dialogs, and loading/skeleton primitives.
- Rework desktop and mobile navigation around Home, Create, Review, Launch, and
  Results; keep Brand Brain and operational settings in Workspace.
- Replace the raw email footer treatment with a product/account menu.
- Define a responsive content grid and consistent page rhythm.

**Acceptance:** every existing page looks like one coherent product before
page-specific redesign begins.

### 2. Home and onboarding

- Recompose Dashboard as Home or Overview.
- Make the primary panel a dynamic next-best-action.
- Replace implementation stats with workflow statuses: brand readiness, ads to
  review, Meta connection, active campaigns, and new leads.
- Add a first-run sequence: business basics, brand, assets, Meta, first ad.
- Use meaningful readiness states: Needs basics, Ready for first ads, Strong
  foundation, Campaign-ready.

**Acceptance:** a new user knows what to do within five seconds; a returning
user immediately sees what needs attention.

### 3. Brand Brain

- Turn the long form into sections: identity, audience and service areas,
  voice and messaging, offers and proof, contact details, visual identity,
  advertising rules, and assets.
- Add readiness, last-updated state, and section completion.
- Add a preview showing how Brand Brain changes a headline, copy, CTA, contact
  line, and locality.
- Make save state, unsaved changes, errors, and autofill outcomes explicit.

**Acceptance:** a customer understands why each field matters and can see its
effect on generated ads.

### 4. Creation and review

- Make Ad Assistant the primary creation path.
- Turn Creative Studio into a selected-creative workspace with brief/controls,
  canvas preview, and review inspector.
- Add platform-aware square, story, and feed previews.
- Make generation progress explain what is happening and preserve the brief.
- Use explicit creative states: Generated, Needs edits, Approved, Exported, and
  Used in campaign.

**Acceptance:** generating, comparing, editing, approving, and exporting feel
like one continuous workflow.

### 5. Launch and results

- Add a final launch review showing objective, audience, location, daily budget,
  creative, lead destination, and initial paused status.
- Make safety promises visible before confirmation.
- Turn Leads into Results with new leads, response time, CPL, campaign and
  creative context, trends, and plain-language next actions.
- Keep advanced ad-platform detail available without making it the first thing a
  non-expert sees.

**Acceptance:** a non-expert can understand what will happen before spending
money and can explain what happened afterward.

### 6. Trust and commercial maturity

- Add billing, plan, and usage surfaces when monetization is enabled.
- Add help/support, changelog, workspace/account settings, and data controls.
- Add activity history for important actions.
- Add usability, accessibility, responsive, and error-recovery review across
  all core flows.
- Instrument activation and conversion events so design decisions can be
  measured.

## Delivery sequence

### Sprint 1 — Shell and visual foundation

Tokens, typography, shared primitives, navigation hierarchy, page headers,
responsive grid, account treatment, and Home foundation.

### Sprint 2 — Home and onboarding

Next-best-action, workflow status strip, first-run flow, and Brand readiness.

### Sprint 3 — Brand Brain

Sectioned form, readiness, preview, asset handling, save feedback, and autofill
feedback.

### Sprint 4 — Creation and review

Ad Assistant as primary entry, Studio workspace, format previews, generation
states, and approval flow.

### Sprint 5 — Launch and results

Campaign review, budget/targeting summary, paused-by-default safety, Results
view, and performance explanations.

### Sprint 6 — Trust and commercial readiness

Billing surfaces, support, activity history, accessibility, responsive polish,
and product analytics.

## Non-goals

Do not add more AI features before the core workflow is coherent. Do not turn
AdBrain into a full CRM or analytics suite. Do not add charts, gradients, or
animation merely to make the product look more sophisticated. Do not expose
more Meta controls than a local-business owner can use safely.

## Measurement

Track the following as the redesign ships:

- Time from first sign-in to completed Brand Brain
- Time from completed Brand Brain to first generated ad
- Percentage of generated ads approved
- Percentage of approved ads reaching launch review
- Percentage of launch reviews resulting in a paused campaign
- Time from new lead arrival to first owner action
- Repeat creation sessions per active business
- User-reported confidence before activating spend
