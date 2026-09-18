# Features and Workflows

Current source behavior, reviewed 2026-09-18. This guide replaces the older mixed
inventory of shipped features and proposals. Deployment evidence lives in
[release receipts](releases/) and [QA records](qa/); priorities belong in
[Roadmap](ROADMAP.md). Start at [the documentation index](README.md).

## Product Model

A user owns a business. Most workspace pages select that user's oldest business
as the primary business. The schema supports multiple business rows, but the UI
is not an agency workspace, team-role system, or general business switcher.
An application's business ID, Meta business ID, ad account ID, and Facebook Page
ID are different identifiers. Never infer one from another.

| Page | Job | Important boundary |
| --- | --- | --- |
| `/dashboard` | Next action, onboarding progress, activity, results | Uses stored state; not proof of live provider health |
| `/brand` | Profile, assets, Markdown instructions | Saved business facts ground AI output |
| `/create` | Guided creative interview and brief review | Reviewing a brief is distinct from paid generation |
| `/studio` | Generate, inspect, approve, regenerate, delete, export | Approval does not publish an ad |
| `/assets` | Browse/reuse/download saved images | Download/clipboard failures are surfaced |
| `/campaigns` | Draft, review, create paused, activate/pause, sync, report | Live Meta writes require verified binding and capability |
| `/leads` | Sync, search, and inspect enquiries; copy digest | No automated outreach is sent |
| `/settings` | Meta connection and spend guardrails | Disconnect does not pause running ads |

## Sign In

Magic link, Google OAuth, and email/password use Supabase Auth. Provider setup and
email delivery are external prerequisites. Pending states prevent competing form
submissions; failures preserve the form and permit retry. Destinations must be
safe local paths. The app has no built-in team invitation, self-service signup,
password-reset, or subscription entitlement workflow.

## Brand Brain

Save business name, industry, website, description, voice, audience, languages,
service areas, selling points, offers, brand colors/font/logo, and contact fields.
The industry is free text, not a solar-only enum. The reusable fact record drives
copy, image prompts, and campaign audience suggestions.

Website autofill fetches a public website and proposes extracted facts. It does
not prove those claims are true or authorize scraping private pages. The UI
preserves fields edited during extraction, discards a response when the website
changes, and prevents save while extraction is pending. Review suggestions before
saving. Network, validation, extraction, and storage failures are distinct from
an empty brand.

Assets have types `logo`, `product_photo`, and `past_ad`. Uploading a logo and
selecting it as the business logo are separate persistence steps. Storage and
database writes are not one transaction: failed row creation attempts file
cleanup; a failed logo assignment is visible; deletion clears matching logo
references and confirms row deletion before file removal. Manual edits are not
silently overwritten by a refresh.

Instruction files have a title, Markdown body, and active flag. Active instructions
are included by generation/planning call sites; an instruction is guidance to a
model, not deterministic enforcement. Never put credentials or sensitive lead
details in prompts. See [Data Model](DATA_MODEL.md) and [AI Pipeline](AI_PIPELINE.md).

## Create and Review Creatives

1. Enter a goal in Create. Brand-aware and seasonal starters are suggestions,
   not an automatic campaign scheduler.
2. The interviewer can ask up to three new decisions, or finish immediately when
   saved facts suffice. Questions offer contextual choices or text input.
3. Review and edit the complete brief. Changing it changes the generation input.
4. Explicitly generate. Studio accepts 1-6 variants; Create's standard batch is
   three. Portrait is the API default; square, story, and landscape also exist.
5. Inspect each image and copy, then approve selected creatives. Human review is
   required for factual claims, language quality, and visual correctness.

Variants are saved independently. A partial batch returns saved creatives and
failures rather than pretending every variant succeeded. A disconnected browser
should check saved results using the same generation ID before starting another
paid request. Browser recovery metadata is scoped to user/business in session
storage; it is not cross-device durable generation idempotency.

Regeneration uses the creative's saved language/format, updates that creative,
and resets approval to `draft`. Approval toggles `draft`/`approved`; it does not
change existing remote ads. Deleting a local creative is not a request to delete
a Meta ad already created from it.

ZIP export includes selected copy and available images. Inaccessible selections
fail; unavailable/over-limit images can be omitted with a note and
`X-Images-Skipped`. A successful ZIP response need not contain every image.
The route does not require approved status even though review-first is the
recommended workflow.

## Connect Meta

Settings opens the shared connection flow. The owner authorizes Meta, discovery
finds eligible account/Page pairs, and a verified selection is committed. Partial
discovery must not auto-select. Existing selection replacement requires explicit
confirmation. Account currency, permissions, billing, and restrictions can block
individual capabilities after authentication succeeds.

Capabilities are independent: read insights, read leads, create paused, activate.
An `unknown` capability is not permission to proceed. Expired/revoked credentials
require reconnect; other blockers may require action in Meta. Details are in
[Meta Connection](META_CONNECT.md).

Disconnect revokes the app's stored binding; **it does not stop remote delivery**.
Pause intended campaigns before disconnecting, or manage them in Meta afterward.

## Prepare a Campaign

Both manual and guided workflows produce a saved, editable draft. Drafts can be
incomplete: zero budget, empty creative selection, and no lead form are allowed
at save time. They cannot pass preflight in that state. Saving does not invoke
AI; preparing AI-mode audience choices can.

Drafts expire seven days after creation, start at version 1, and are capped at
50 active editable drafts. Updates require the expected version; edits in another
tab produce a conflict rather than a silent overwrite. Updates do not extend the
original expiry. Drafts tied to a creation operation have additional edit/delete
restrictions.

The planner uses brand, approved creatives, active instructions, and available
performance history. It asks for missing facts rather than inventing provider
IDs. Audience recommendations remain editable; manual choices are preserved.
Current reviewed creation uses **instant-form lead campaigns**, not a supported
general WhatsApp/call destination workflow just because lower-level code contains
those concepts.

### Targeting and Budget

- Ages must resolve to explicit bounds between 18 and 65, minimum no greater
  than maximum; Meta's upper endpoint represents its supported 65+ range.
- Include/exclude city, region, or country locations; city radii must be 17-80 km
  at preflight. Draft schemas accept 5-80 km so a saved legacy/incomplete value
  can be edited, not so an invalid radius can launch.
- Up to five interest names and a nonempty rationale can be saved. Meta resolves
  IDs and eligibility; unresolved interests block creation.
- Missing geography does not silently broaden to nationwide. Nationwide must be
  an explicit, reviewable choice.
- Creation requires an INR account and a positive daily budget. API currency
  values are whole rupees; the Meta adapter converts to minor units.
- Optional age-split testing creates two ad sets. A 200-rupee daily input then
  means 400 rupees/day total, not 200 split between them. It is not a randomized
  Meta Experiments A/B test.
- Lead estimates and interest recommendations are heuristics, not delivery or
  conversion guarantees. Restricted-category support is not established by an
  AI declaration check.

### Review, Create, Activate

Preflight validates ownership, approved creative content, active lead form,
connection capability, INR currency, resolved targeting, and budget. Its hash
binds the reviewed inputs, selected assets, resolved IDs, and creative content.
Creation reruns preflight and rejects a stale draft, hash, or connection generation.

The durable creation operation uses an idempotency key and checkpoints external
IDs. Poll it after ambiguity; do not submit a new key to escape a pending or
`needs_reconciliation` state. A created campaign is paused. Activation requires a
fresh confirmation digest, connection recheck, provider verification, and spend
guardrail check. See [API Reference](API_REFERENCE.md) for payloads and states.

Pause and delete verify account/Page binding too. Missing legacy binding requires
reconciliation, not guessing. Meta writes and local mirrors are not atomic: a
provider action can succeed while the subsequent database write fails. Keep the
record and investigate; do not treat an HTTP failure as proof of no remote effect.

## Sync, Results, and Leads

Campaign sync verifies remote account/Page association, budgets, and supported
statuses before importing. It handles one provider page per request; the UI asks
for continuation and accumulates skipped counts. Unsupported/deleted/archived
statuses are not imported as paused. A completed scan does not prune local rows
for campaigns absent from Meta.

Results refresh fetches insights, attempts to store them and produces a
plain-language summary; it can also trigger spend-limit auto-pause. It is not a
read-only diagnostic. A null stored result needs investigation. Reports
are Markdown exports of stored performance, not a live refresh. They escape
campaign names (including pipes/newlines), count impressions/clicks as delivery,
and do not declare a lead winner when nobody has leads.

Lead sync reads active Page forms, normalizes contact fields, and ignores duplicate
`(business_id, meta_lead_id)` rows. `imported` counts new inserts, not fetched rows.
Some unreadable forms produce a partial result with `failedForms`; all forms
failing returns an error. Zero imports can mean duplicates or no leads, not a
broken campaign. Existing duplicates are not updated by this sync strategy.

The copy-ready digest summarizes the last seven days with at most ten contacts,
including email where available. It is not a WhatsApp send, CRM, notification
service, or revenue attribution system.

## Spend Guardrails

Settings accept a positive whole-rupee weekly cap or explicit `null` for no cap,
an alert percentage from 1-100, and an auto-pause flag. Zero is invalid, not
unlimited. Unsaved changes invalidate the Saved indicator.

Activation compares projected weekly commitment against the cap; unavailable
spend data blocks activation. Scheduled enforcement can pause bound active
campaigns when the cap is reached. Stored insights may be stale and the configured
job runs daily. These are application guardrails, not Meta account spending limits
or guaranteed protection from overspend. Use provider-side limits as well.

## Public Surface and Operations

Landing/legal pages and `/guides` provide public metadata, structured data,
sitemap, and social images. Workspace pages are authenticated and noindex; robots
rules are indexing hints, not access control. No search-ranking guarantee follows
from metadata correctness.

Owner activity records, AI usage events, and structured product telemetry serve
different purposes. See [Observability](OBSERVABILITY.md) for privacy, access, and
best-effort persistence; do not call an owner-insertable audit log tamper-proof.

## Known Limits

- Public customer Meta consent/app review must be verified separately from code
  and an operator's existing system-user connection.
- Generation quota is a non-atomic preflight; telemetry can undercount failures.
- Generation recovery is not durable job scheduling or exactly-once billing.
- Database, Storage, and Meta do not share a transaction.
- Remote campaign disappearance does not automatically delete local mirrors.
- Billing/subscriptions, team roles, self-service agency management, Google Ads,
  video generation, automated outreach, scheduled campaign activation, and general
  winner-based budget optimisation remain outside current product workflows.
- AI output validation is not independent factual, legal, or advertising-policy
  certification. Review output and measure real lead quality.
