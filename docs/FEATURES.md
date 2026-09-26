# Features and Workflows

Use this guide to understand an owner's workflow, what an action changes, and
how to recover when it fails. Product intent belongs in [Scope](SPEC.md) and
[Roadmap](ROADMAP.md); setup and release authority belong in the
[documentation index](README.md) and [Release Workflow](RELEASING.md).

## Source and Availability

This rewrite examines dev `672eb132ad57bb3ba31f118afaffddaa878b4923` and the
separately identified enquiry candidates. It is not a declaration that all of
that source is deployed. The September 26 [SDK/query release receipt](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release)
records production `6291dc2d2691bfc8a235b2aa1b103f119b26b83e`.

| Boundary | What may be claimed |
| --- | --- |
| Recorded production release | AI SDK adapters and campaign-list Query integration are included; the receipt limits which workflows were exercised |
| Additional dev source | Trusted campaign writes, integrity migrations and test checkout exist; they were excluded from that release |
| [Import candidate #34 / PR #37](https://github.com/vanshulgoyal101/adbrain/pull/37) | Resumable multi-page enquiry import requires its migration and independent acceptance |
| [Inbox candidate #35 / PR #38](https://github.com/vanshulgoyal101/adbrain/pull/38) | Server-paginated enquiries and persistent follow-up require their migration; combined import/inbox acceptance is separate |
| External providers | Mocked consent, a green build, merchant account approval or saved metrics do not prove live delivery, payment settlement or provider eligibility |

Do not demonstrate an unreleased database-dependent caller against production.
Use [Demo Runbook](DEMO-RUNBOOK.md) to select a safe demonstration mode.

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

Campaign lists begin with server-supplied data. Search/status keys include the
owner and business; cursor pages are ordered and deduplicated. Status selection
and clearing search fetch immediately, while typing uses a 250 ms debounce.
Obsolete requests are aborted. Confirmed actions invalidate relevant list reads;
there is no automatic focus/reconnect refetch, polling or mutation retry.

Navigation and independently loading Settings sections remain dependent on server
and provider latency. Unavailable spend evidence does not become editable zero
limits. Read caching changes neither authorization nor spending authority and is
not a production latency benchmark. See the
[campaign-list hook](../src/lib/meta-connect-ui/use-campaign-list.ts).

## Sign In

Magic link, Google OAuth, and email/password use Supabase Auth. Provider setup and
email delivery are external prerequisites. Pending states prevent competing form
submissions; failures preserve the form and permit retry. Destinations must be
safe local paths. The app has no built-in team invitation, self-service signup,
password-reset, or subscription entitlement workflow.

A development-login cookie does not authenticate ordinary APIs or grant access
to a business. Remembered drafts and cached screens are not authorization. See
[authentication handlers](API_REFERENCE.md#authentication-handlers).

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

Variants are saved independently. A partial batch keeps successful creatives and
reports failures. After interruption, check saved results with the same generation
UUID before issuing another paid POST. Recovery GET counts saved rows: zero rows
and `processing` do not prove a durable worker is still running. The UUID groups
results; resubmitting it is not an exactly-once billing guarantee. Browser recovery
is scoped session state, not cross-device durable scheduling. The preceding
interview can itself use paid text AI. See the
[generation handler](../src/app/api/creatives/generate/route.ts).

Regeneration uses the creative's saved language/format, updates that creative,
and resets approval to `draft`. Approval toggles `draft`/`approved`; it does not
change existing remote ads. Deleting a local creative is not a request to delete
a Meta ad already created from it.

Review headline, primary text and the separate link description. Prior creative
history and repair checks guide variety, not factual correctness or guaranteed
uniqueness across concurrent requests. [AI Pipeline](AI_PIPELINE.md) owns model,
repair and provenance details. Meta decides which placements display descriptions;
filling the field does not guarantee it appears. Legacy ads are not rewritten.

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

Choose WhatsApp in manual or guided setup; no instant form is required. Publishing
requires a verified Business number linked to the selected Page. A Page contact
phone or historical ad-set recipient is not proof. Review binds the number to its
hash and creation rechecks it before mutation. Missing linkage blocks creation;
there is no silent fallback to an instant form.

The adapter creates paused objects. Reports distinguish conversations and cost
per conversation from instant-form leads or sales; mixed destinations are not
attributed wholly to WhatsApp. This does not import chat messages, transcripts
or contacts into Enquiries. Real-account eligibility and payload acceptance need
separate authorized provider evidence. See [Meta Connection](META_CONNECT.md) and
[reporting migration prerequisites](DATA_MODEL.md#migration-map).

### Targeting and Budget

Preflight requires approved creative content, positive INR daily budget, resolved
geography/ages, eligible interest targeting and a valid destination. Missing
geography or interests do not silently become broad targeting. Audience-only AI
recommendations remain editable and do not themselves save/create a campaign.

| Decision | Review boundary |
| --- | --- |
| Interests | Up to five names plus rationale; Meta resolves IDs/eligibility before creation |
| Geography | Explicit included/excluded areas; nationwide must be chosen, not inferred from missing input |
| City coverage | City-only and city-plus-radius are distinct; old drafts without a scope retain radius behavior |
| Radius | Drafts can retain 5-80 km for editing; radius-mode preflight requires 17-80 km |
| Age | Explicit ordered bounds 18-65; upper endpoint represents Meta's supported 65+ range |
| Gender | All (default), men or women; changed selection requires fresh review |
| Budget | Whole INR rupees per ad set; two INR 200/day age bands total INR 400/day |

Age-split setup is not a randomized Meta experiment. Interest signals do not
guarantee Meta never expands delivery; recommendations and lead estimates are not
conversion guarantees. Restricted-category checks are not independent policy
certification. [API targeting](API_REFERENCE.md#targeting) owns exact input bounds.

### Review, Create, Activate

Preflight validates ownership, approved creative content, active lead form,
connection capability, INR currency, resolved targeting, and budget. Its hash
binds the reviewed inputs, selected assets, resolved IDs, and creative content.
Creation reruns preflight and rejects a stale draft, hash, or connection generation.

The durable creation operation uses an idempotency key and checkpoints external
IDs. Poll it after ambiguity; do not submit a new key to escape a pending or
`needs_reconciliation` state. Optional worker mode queues that same operation and
does not fall back to inline execution on queue failure. A created campaign is
paused. Activation requires a fresh confirmation digest, connection recheck,
provider verification and spend guardrail check. Creation idempotency does not
extend to activation or paid generation. See the
[creation handler](../src/app/api/campaigns/create/route.ts) and
[API Reference](API_REFERENCE.md#review-and-durable-creation).

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

At the dev baseline, instant-form sync reads provider-default form/lead pages,
normalizes contact fields and ignores duplicate `(business_id, meta_lead_id)`
rows. `imported` counts inserts, not fetched rows. `failedForms` signals partial
failure; zero imports can mean duplicates or no new rows. This is not a complete,
resumable provider scan. The inbox initially loads at most 200 records and filters
that array. See [baseline sync](../src/app/api/leads/sync/route.ts).

### Enquiry Candidates

[#34 / PR #37](https://github.com/vanshulgoyal101/adbrain/pull/37) adds durable
multi-page checkpoints and explicit partial/complete results.
[#35 / PR #38](https://github.com/vanshulgoyal101/adbrain/pull/38) adds server-side
search, status/contact filters, cursor pages and matching totals. Owners can save
`new`, `contacted`, `qualified`, `booked` or `closed` status and a note up to 2000
characters. Import must preserve those local follow-up fields.

The candidate UI retains failed edits for retry, refreshes the list after a save,
and offers sync continuation without replacing the list with a partial response.
An ambiguous or partial response must not claim up-to-date. Both migrations and
combined-workflow acceptance are prerequisites; these are not production claims.
See [candidate API contracts](API_REFERENCE.md#enquiry-candidates).

The digest summarizes recent loaded enquiries with at most ten contacts. It does
not send outreach or constitute a complete customer export. WhatsApp campaign
conversations are not instant-form contacts or verified revenue.

## Spend Guardrails

Settings accept a positive whole-rupee weekly cap or explicit `null` for no cap,
an alert percentage from 1-100, and an auto-pause flag. Zero is invalid, not
unlimited. Unsaved changes invalidate the Saved indicator.

Activation compares projected weekly commitment against the cap; unavailable
spend data blocks activation. Scheduled enforcement can pause bound active
campaigns when the cap is reached. Stored insights may be stale and the configured
job runs daily. These are application guardrails, not a concurrent reservation
ledger or Meta account spending limit. Do not promise zero overspend or blindly
retry ambiguous activation. Use provider-side limits and
[operational reconciliation](OPERATIONS.md) as well.

## Public Surface and Operations

Landing/legal pages and `/guides` provide public metadata, structured data,
sitemap, and social images. Workspace pages are authenticated and noindex; robots
rules are indexing hints, not access control. No search-ranking guarantee follows
from metadata correctness.

Owner activity records, AI usage events, and structured product telemetry serve
different purposes. Dev's trusted audit writes require their migration; older
records may lack verified provenance. See [Observability](OBSERVABILITY.md) for
privacy, authority and persistence limits.

Dev also contains isolated Razorpay **test** checkout and test webhook handling.
It does not collect live customer money or prove funding reached Meta. Merchant
account approval is separate from implementing live checkout. See
[Payment Plan](PAYMENTS-PLAN.md) and [test API contracts](API_REFERENCE.md#local-test-payments).

### Deciding Sources

Use [campaign schemas](../src/lib/campaign/connect-contracts.ts),
[preflight](../src/lib/campaign/preflight-service.ts),
[draft persistence](../src/lib/campaign/draft-store.ts) and the
[campaign-list hook](../src/lib/meta-connect-ui/use-campaign-list.ts) to verify
the workflow boundaries above. [Data Model](DATA_MODEL.md) owns migration and
authorization details; [Roadmap](ROADMAP.md) owns planned scope.

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
