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

## Workspace Responsiveness

Sidebar links retain Next.js automatic prefetching and request full destination
prefetch after hover, keyboard focus, or touch intent. Current-section links do
not request full prefetch. Next.js owns cache reuse and invalidation; navigation
still shows its pending indicator. A responsive, reduced-motion-aware skeleton
replaces the spinner-only page fallback while the workspace shell stays usable.

Campaign results start loading as soon as the campaign page is available, without
waiting for approved creatives or connection metadata. Campaign status selection
and clearing search fetch immediately; typed searches retain a 250 ms debounce
and obsolete requests are cancelled.

Settings connection controls and spend guardrails stream independently, with
section-local loading and error states. Unavailable spend data does not become
editable default limits. These changes do not bypass authorization, publishing
preflight, or spending checks, and do not eliminate database or provider latency.
Source behavior is not a production latency benchmark or deployment receipt.

## Sign In

Magic link, Google OAuth, and email/password use Supabase Auth. Provider setup and
email delivery are external prerequisites. Pending states prevent competing form
submissions; failures preserve the form and permit retry. Destinations must be
safe local paths. The app has no built-in team invitation, self-service signup,
password-reset, or subscription entitlement workflow.

The sign-in page uses the workspace typography, shared form controls and brand
asset, with persistent Home and legal navigation. Email/password share one form;
password visibility can be toggled without submitting. Magic links validate only
the email address. The email confirmation can return to sign-in with the address
and safe destination preserved, focus restored, and the password cleared.

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

New creative concepts require a headline, primary text, and a separate Meta link
description. Copy is directed toward one brief-specific argument, supported facts,
and a clear next step rather than repeating the complete brand profile. Generation
and regeneration load up to 12 recent creatives from the same business; earlier
concepts in a batch are also included. Exact normalized headline or first-eight-word
hook reuse triggers the existing single repair attempt before image generation.
Recent ads guide variety only and are not evidence for commercial claims. History
lookup failures stop generation before paid calls. This does not guarantee semantic
uniqueness across simultaneous requests or better campaign performance.

Descriptions are stored in the existing generation receipt, visible in Create and
Studio, included in copy exports and campaign review hashes, and sent to Meta as
the link description. Legacy creatives are not automatically rewritten. Meta
decides which placements display descriptions; filling the field does not guarantee
it appears in every preview. No live ads change when this generation behavior changes.

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
at save time. Preflight requires approved creatives, positive budget, resolved
targeting, and either an active form or a verified Page-linked WhatsApp Business
number for the selected destination. Saving does not invoke
AI; preparing AI-mode audience choices can.

Drafts expire seven days after creation, start at version 1, and are capped at
50 active editable drafts. Updates require the expected version; edits in another
tab produce a conflict rather than a silent overwrite. Updates do not extend the
original expiry. Drafts tied to a creation operation have additional edit/delete
restrictions.

Starting a replacement review invalidates the old send action immediately.
A failed validation, save, or reconnect does not erase a confirmed operation's
status; recovery is replaced only after the new draft is saved.

Guided interviews are kept separately per business and destination. Switching
destination, choosing manual setup, or closing setup aborts the browser request
and ignores late responses. Failed or interrupted requests retain their answer
payload for an explicit retry, including after reopening the interview. This
does not undo server work or guarantee exactly-once AI billing or draft saves;
check Saved drafts before retrying. Completed interviews remain completed after
the draft is handed to review.

The planner uses brand, approved creatives, active instructions, and available
performance history. It asks for missing facts rather than inventing provider
IDs. Audience recommendations remain editable; manual choices are preserved.
Reviewed creation supports **instant-form leads and WhatsApp chats** when the
selected destination passes server preflight. Old drafts without a destination
remain instant-form campaigns. Call campaigns are not supported by this editor.

### WhatsApp Campaigns

- **Publishing requires a verified Page-linked number.** Eligible reviews offer
  Send to Meta (paused); missing or unreadable linkage still blocks publishing.
  In the earlier 2026-09-19 read-only check, Solaride's Page omitted its linkage/number fields
  with both Page and system-user tokens. An existing ad set's historical recipient
  is not accepted as proof of the current linkage. No test campaign was created.
- Select WhatsApp chat in either manual or guided setup. No lead form is required
  or loaded for WhatsApp planning/review; the selected destination is preserved.
- Link a WhatsApp Business number to the selected Facebook Page in Meta first.
  Review reads that Page's `has_whatsapp_business_number` and `whatsapp_number`
  using its Page token. Missing, unreadable, or invalid evidence blocks creation.
  A normal Page contact phone number is not sufficient.
- Review displays and hashes the verified number. Creation rechecks it before
  any mutation. WhatsApp never silently falls back to a form.
- The WhatsApp creation adapter uses `OUTCOME_ENGAGEMENT`, `CONVERSATIONS`, `WHATSAPP`,
  a recipient-bound promoted object and `wa.me` creative link. Campaigns, ad sets,
  and ads are created PAUSED; activation remains a separate confirmation.
- Existing WhatsApp campaigns use the same account/Page-bound import, refresh,
  pause, and activation safeguards. Refresh detects all-WhatsApp ad sets and
  stores `onsite_conversion.messaging_conversation_started_7d` separately from
  leads. Overlapping messaging actions are not summed. Mixed-destination
  campaigns are not attributed wholly to WhatsApp.
- Campaign cards show conversations and cost per conversation; planner history
  and summaries distinguish conversations from verified leads/sales. This does
  not import chat messages, phone contacts, transcripts, or WhatsApp inbox leads.
  Leads-tab sync remains instant-form only.
- Apply `db/migrations/20260918_whatsapp_results.sql` before deploying the new
  reporting code, with separate migration authorization. Existing results stay
  unchanged (new columns are null); refresh results to populate conversations.
- Meta Page field references were checked; mocked provider tests do not certify
  actual account eligibility, delivery, or Graph v21 payload acceptance. Perform
  an explicitly authorized real-account PAUSED creation test before rollout.
  No live Solaride campaign is modified by this implementation.

### Targeting and Budget

- Every campaign must have detailed interest targeting before creation. AI plans
  require one to five relevant commercial interests grounded in the business and
  offer. Preparing a draft with missing/empty interests requests AI recommendations
  even when location and age are manual. Existing nonempty suggestions remain
  editable and reusable; saving an incomplete draft does not invoke AI.
- Missing or unresolvable interests block creation rather than silently falling
  back to a broad audience. Meta validates the interest IDs before review and
  creation; each ad set receives them as detailed-targeting signals. This does not
  create custom audiences or guarantee that Meta will never expand delivery beyond
  those signals. Restricted-category and sensitive-trait safeguards still apply.
- Gender can be set to All genders (default), Men, or Women under Audience &
  location. It is saved and restored with the draft, displayed in review, and
  applied to every ad set for both instant-form and WhatsApp campaigns. AI
  audience recommendations preserve the owner's selection; changing it requires
  a fresh review. Older drafts without this field keep All genders. The editor's
  existing special-ad-category restrictions still apply.
- Location and age "Let AdBrain decide" actions request a cancellable audience
  recommendation immediately after creative selection. Returned areas, ages,
  radius, interests, and rationale remain editable; the action does not save or
  create a campaign. Failures retain existing inputs. Budget, creative selection,
  destination, and lead form remain owner-controlled in audience-only planning.
- Planned and excluded area entries use one place per line, preserving commas
  inside names. Manual areas and radius edits are retained; explicitly requesting
  a fresh location decision replaces prior suggested areas. Age-only decisions
  preserve chosen geography. Geographic resolution prefers exact names and
  qualified city/region labels, without assuming India when no country is given.
- Manual location search separates loading, no-match, and failed lookups. Retry
  preserves selected places; editing a query immediately removes stale choices.
  Results show region labels and support arrow-key selection with Enter. Escape,
  Tab, and leaving the picker dismiss results, including late responses.
- Targeting help opens on hover, focus, click, or touch; explanations are linked
  to their triggers for assistive technology. Escape and outside clicks dismiss
  help, and positioning keeps it inside horizontal viewport edges.
- Ages must resolve to explicit bounds between 18 and 65, minimum no greater
  than maximum; Meta's upper endpoint represents its supported 65+ range.
- City coverage offers City only (no added radius) or City + radius. New manual
  drafts default to City only; guided planning defaults to it unless surrounding
  service areas justify a radius. Existing saved drafts without a scope retain
  their radius behavior. The scope applies to both included and excluded cities,
  is preserved during audience recommendations, and is bound to campaign review.
  States and countries are unchanged. City-only payloads send the Meta city key
  without radius/distance units; review blocks a contradictory resolved radius.
  This requests Meta's city area, not a verified municipal-boundary polygon.
  Real-account acceptance and returned coverage must be verified before rollout.
- City + radius requires 17-80 km at preflight. Draft schemas accept 5-80 km so a
  saved legacy/incomplete value can be edited, not so an invalid radius can launch.
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
