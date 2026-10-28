# Features and Workflows

Current source behavior, reviewed 2026-09-18. This guide replaces the older mixed
inventory of shipped features and proposals. Deployment evidence lives in
the PRs and issues; priorities belong in [Roadmap](ROADMAP.md). Start at [the documentation index](README.md).

## Source and Availability

This guide describes source behavior. Source alone does not prove that a target
database has the required migrations or that a deployment has the required
configuration; check [Data Model](DATA_MODEL.md#migration-map) and
[Configuration](CONFIGURATION.md) before demonstrating a workflow there.

| Workflow | Availability boundary |
| --- | --- |
| Resumable lead sync, enquiry follow-up and server inbox paging | Lead sync-progress and follow-up migrations |
| WhatsApp conversation results | WhatsApp reporting migration |
| Declared preferences, customer allowance | Their additive migrations |
| Worker campaign creation | `CAMPAIGN_EXECUTION_MODE=worker`, worker migration and a running worker; default is inline |
| Live checkout | Live payment flags on a production `main` deployment; see [API Reference](API_REFERENCE.md#configurable-live-payments) |
| Test checkout | Local only: `PAYMENTS_TEST_ENABLED=true`, loopback Supabase, no Vercel environment; see [test payments](API_REFERENCE.md#local-test-payments) |
| Scheduled jobs | `vercel.json` schedules only the keepalive and the daily spend-enforcement sweep |

No checkout path, test or live, makes money spendable or activates ads. Mocked
consent, a green build or merchant approval do not prove live delivery, payment
settlement or provider eligibility.

## Product Model

A user owns a business. Most workspace pages select that user's oldest business
as the primary business. The schema supports multiple business rows, but the UI
is not an agency workspace, team-role system, or general business switcher.
An application's business ID, Meta business ID, ad account ID, and Facebook Page
ID are different identifiers. Never infer one from another.

| Page | Job | Important boundary |
| --- | --- | --- |
| `/dashboard` | The newest enquiry from the last 24 h still waiting for a first reply ("Rohit tapped your ad at 9:40 am. Reply now; …", #1292), then results so far (enquiries, spent, per enquiry, oldest update; same latest results as the campaign cards, #764; the median time to first reply over 30 days, #1049), next action, onboarding progress, activity | Uses stored state; not proof of live provider health |
| `/brand` | Setup step 1 for first-timers; profile, assets, Markdown instructions (`?all=1`) | Saved business facts ground AI output |
| `/create` | Guided creative interview and brief review | Reviewing a brief is distinct from paid generation; the Brand context panel names missing offers, service areas and phone before a run. Any goal, typed or from a suggestion, on a Brand with an offer or proof point, an area and a phone skips the review when the interview needs no question. The start screen says what the ads will use ('Your 3 ads will use: Mohali · offer: Free site survey'; every Brand area Create sends, the first 3 then '+N more' (#1034); a proof point is labelled 'proof:', facts cut at 40 characters) above 'Make 3 ads', with 'About 2 minutes. Nothing is published.' under it and 'Edit brief' to keep the review; afterwards the brief shows as a collapsed 'What I'll write about · Edit' line (#858, #1004). After 'Use this ad', the one primary step 'Next: set up campaign' opens `/campaigns?…&review=1`, which prepares Review on its own (#1004, #1152); 'Review ads' and 'Make another' stay in the quieter row above. Up to two 'Coming up' occasion chips (festivals and seasons for today's date in IST, `src/lib/seasonal.ts`; November adds Chhath Puja, Guru Nanak Jayanti and the winter season, and a festival comes before a long season, #1210) fill the goal in one tap with plain words ('An ad for Chhath Puja from <Business>.'); they never assert a sale, discount or deadline, and the concept prompt and claim check allow only saved offers (#700, #1153) |
| `/studio` | Generate, inspect, approve, edit (ad text, words on picture, background), regenerate (asks first), delete, export, share approved ads (phone share sheet; desktop downloads and copies the text); "Create campaign (N)" links approved ads to Campaigns | Approval and sharing do not publish an ad on Meta |
| `/assets` | Browse/reuse/download saved images | Download/clipboard failures are surfaced |
| `/campaigns` | Draft, review, create paused, activate/pause, sync, report; `?new=1&creatives=<ids>` opens the composer with those approved ads selected; `&review=1` (#1004, from Create) then prepares Review on its own once Meta is connected, the WhatsApp check has run and a form campaign has its lead form (the same prepare as the Review button; nothing is sent to Meta). The lead form used for the last Review is preselected while the Page still has it; with several forms and none chosen, the field says choosing one opens Review | Live Meta writes require verified binding and capability |
| `/leads` | WhatsApp chats per campaign with **Add enquiry** (#764) first; the form table follows as "Form enquiries (n)", folded when there are none (#1223); then sync, search, and inspect enquiries; copy digest. Each enquiry with a phone has **WhatsApp them** (wa.me with a first reply in the business's first language, en/hi/Hinglish, naming the business and its first offer) and **Call**; the first tap records `first_contacted_at` ("Replied 12 min after the enquiry", #1049) | No automated outreach is sent: the owner sends the reply |
| `/settings` | Meta connection, spend guardrails, declared preferences | Disconnect does not pause running ads; preferences cannot authorize spend |

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
A website typed as a bare domain is saved as a full `https://` link, shown under the field
as "Ads link to …" (#470). The industry is free text, not a solar-only enum. The reusable fact record drives
copy, image prompts, and campaign audience suggestions.
"Saved" acknowledges only the submitted form revision after a successful save.
Later edits, including edits made while a save is pending, require another save;
failed saves leave the draft available for retry. The full form has no autosave.

Until a business has a campaign that went live (or is on now), `/brand` is setup
step 1 of 3 (#1251 WS1, #1269): the five `brandUsable` fields (name, what you
sell, places one per line, one offer, a 10-digit WhatsApp number) plus "Fill it
from my website", which fills only empty fields. It autosaves only those columns
(`saveSetupBusiness`; other offers and Brand fields are kept) and "Make my ads"
checks all five, then goes to `/create`. `/brand?all=1` opens the full page.

Until then Home (`/dashboard`) is one resume card, "Your first ad · Step N of 3 ·
{step} · Continue" (#1272, `setupResumeStep`): step 1 until the five facts make a
usable Brand, step 2 until an ad is picked (approved), then step 3. The + button
reads "Continue your first ad" and `/create` sends a first-timer without the five
facts to `/brand`. A campaign counts as having gone live once it has `launched_at`
or is active or completed.

Website autofill fetches a public website and proposes extracted facts. On a Brand with
nothing filled in yet it runs by itself when the owner leaves the Website field (once per
address, #1025); otherwise the "Autofill from website" button runs it. It proposes up to 5
service areas the site names (#1037) as Locations chips the owner checks before saving. It does
not prove those claims are true or authorize scraping private pages. The UI
preserves fields edited during extraction, discards a response when the website
changes, and prevents save while extraction is pending. Review suggestions before
saving. Network, validation, extraction, and storage failures are distinct from
an empty brand. After a successful extraction the form lists what it filled and
which key facts are still empty (offers or prices, service areas, phone, audience).
The phone is filled only from an international-format `tel:` link on the page.

Assets have types `logo`, `product_photo`, and `past_ad`. Uploading a logo and
selecting it as the business logo are separate persistence steps. Storage and
database writes are not one transaction: failed row creation attempts file
cleanup; a failed logo assignment is visible; deletion clears matching logo
references and confirms row deletion before file removal. Manual edits are not
silently overwritten by a refresh.

Brand readiness counts six checks, including a logo and at least one real photo
(`product_photo`); unready ones link to the asset section. Create also asks for a
missing logo or photos, linking to `/brand#brand-assets`. Both can be skipped.
Real photos are reference hints for image generation, not the ad image itself.

Instruction files have a title, Markdown body, and active flag. Active instructions
are included by generation/planning call sites; an instruction is guidance to a
model, not deterministic enforcement. Never put credentials or sensitive lead
details in prompts. See [Data Model](DATA_MODEL.md) and [AI Pipeline](AI_PIPELINE.md).

## Create and Review Creatives

Until a business has a campaign that went live (or is on now), `/create` is setup
step 2 of 3 (#1251 WS1, #1270). With no saved batch it runs the existing interview
(answering "Let the AI decide" to any question, up to 3) and one 3-ad Create run,
showing one line of progress at a time. Then it shows the newest batch
(`variant_group`) with 2 pre-picked by a fixed rule (`setupPicks`: fewest text
repairs, then no image fallback, then the order made). "Continue" approves the picks
and opens `/campaigns?new=1&creatives=…`. The generation id is kept in
sessionStorage, so coming back mid-run reads the saved ads instead of starting
again; missing ads show "N ads couldn't be made. Make another". `/create?all=1`
opens the full Create below.

1. When the business's campaigns have results, Create opens on one line such as "Your
   “Roof ready?” ad got 1 chat at ₹10.69 (early: based on 1 chat). Make 3 more like it, or
   try a new angle?" **More like this** fills the goal and uses that ad's brief, without
   its offer, price or percentage sentences, plus its angle as the reference, so an offer
   comes only from today's Brand; **New angle** fills a fresh goal (#371).
   Enter a goal in Create, in English, Hindi, Hinglish or Punjabi, and pick the **Ad
   language** (English · Hinglish · हिंदी · ਪੰਜਾਬੀ). It starts on the Brand's first
   language; if you don't pick, the assistant's suggestion is used. It shows again on
   the review step. Brand-aware and seasonal starters are suggestions, not an
   automatic campaign scheduler.
2. The interviewer can ask up to three new decisions, or finish immediately when
   saved facts suffice. It asks in the language you type in (#290). Questions offer
   contextual choices or text input.
   If a step fails, **Change my answer** brings the last question back with a typed
   answer prefilled; **Start over** is always available in the chat.
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

The Review board groups ads by Create batch (`variant_group`), newest batch first
and open, older batches folded (#762). Unreviewed ads older than 7 days, and the
ads not picked from a batch once one of them is approved (#1148), sit in a folded
"Set aside" section and leave the Needs review count (Home's too); this is
view-only, so approving one brings it back. With approved ads and no campaign
running, paused or drafted, Home's next step is "Launch a campaign with your
approved ads", ahead of any review.

Newly saved creatives use a smaller WebP for Review board and generated Assets
tiles when the derivative is smaller and its upload succeeds. Inspect, Open,
Download, ZIP export, and campaign delivery retain the original image. If the
derivative fails, the original remains available; older creatives and uploaded
brand assets are not retroactively resized.

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

Behind `META_SETUP_CHECKLIST` (#1016, #795 slice 1), Settings shows "Ready to launch on Meta"
under an owner's own connection: business portfolio, ad account in rupees (active), Facebook Page,
WhatsApp on the Page (the Page's number or one on the portfolio's WhatsApp Business account) and a
payment method (`funding_source_details`). Each row is a tick or one Meta link with an English and a
Hindi line. GET reads only (`MetaClient.setupReads`), recorded by
`scripts/record-meta-setup-checklist.ts`; never shown for AdBrain-managed accounts.

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

A new campaign is named after its first chosen ad until the owner types a name:
headline · WhatsApp or Lead form · day, e.g. "Free 15-minute spine check · WhatsApp ·
Oct 28" (the day appears once the browser has loaded). Preparing exactly the same ads
again updates their saved draft instead of adding another (#1151).

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
- A campaign draft may name its own WhatsApp button number (`whatsappNumber`), so the
  button can differ from the phone printed on the ad. It is accepted only if it is the
  Page's number or a number on a WhatsApp Business Account owned by the ad account's
  own Meta business; Meta accepts those for the Page's WhatsApp ad sets (#157).
- Brand and Settings show early whether WhatsApp chat ads can run ("Ready: +91 ••••• 4842" or
  "Not linked yet") with a short linking guide and a Check again button (#235).
- In manual setup, the campaign form lists those numbers (masked; full numbers never
  reach the browser before review) as **WhatsApp button number** and saves the chosen
  mask in the draft; preflight resolves it to the full number. A new campaign, and a plan
  from AdBrain, opens on **WhatsApp chat (recommended)**, listed first; without a ready
  number the setup says how to link one, with a one-tap "Use an
  Instant form for now", and Create's "Review this ad" waits instead of preparing a blocked
  review (#1171). Instant form is the second choice and still fully supported; a restored
  draft keeps its destination.
  The Brand's Website reads "optional: lets AdBrain fill this page for you" (#1238) and isn't in the readiness count. A guided draft uses the Page's own
  number until it is prepared again from manual setup.
- Review displays and hashes the verified number. Creation rechecks it before
  any mutation. WhatsApp never silently falls back to a form.
- The WhatsApp creation adapter uses `OUTCOME_ENGAGEMENT`, `CONVERSATIONS`, `WHATSAPP`,
  a recipient-bound promoted object and `wa.me` creative link. Campaigns, ad sets,
  and ads are created PAUSED; activation remains a separate confirmation.
- A WhatsApp campaign's results say how many opened WhatsApp and how many messaged
  ("12 opened WhatsApp, 1 messaged you": Meta `link_click` vs
  `messaging_conversation_started_7d`, #493).
- **4 tips to get more replies** (#493, #1154): on Campaigns, when setting up or running a
  WhatsApp campaign, a folded checklist for the owner's WhatsApp Business app: profile photo
  and name, greeting message, away message, reply within 5 minutes. They're optional tips, so
  the line shows a count only once one is ticked ("2 of 4 done"). AdBrain can't read these, so
  the owner ticks them; ticks are kept on that device per business. There is no nudge toward
  WhatsApp's AI reply (#1171; tag `removed/whatsapp-ai-card`).
- With no setup open, Campaigns lists the campaigns first; Saved drafts follow the list
  (#1154) and fold to one line above the setup while one is open.
- Each WhatsApp creative carries a `page_welcome_message` built from Brand facts
  (#209, #493): a short greeting asking the customer to send, and one short
  pre-typed ask ("Hi! I'd like a free site survey.") naming one offer the ads
  mention (a free offer first) and the city when the campaign targets exactly
  one. Its language is a per-campaign choice in setup (**Message language**): Same
  as the ad (default: the ads' saved language, where a plain "Hindi"/"Punjabi" follows
  the script and reads as Hinglish in Roman letters; else Devanagari → Hindi, Gurmukhi →
  Punjabi, Roman-script Hindi → Hinglish (#1081), else English), English, Hindi, Hinglish
  or Punjabi. The welcome follows the same language. The choice is part
  of the reviewed plan.
- Stories and Reels get a 9:16 version of each WhatsApp and lead-form ad (#333, #680): Prepare lays out
  the saved design and photo at 1080×1920 (no AI call; words, logo and offer kept
  inside the Stories/Reels safe zone, top 14%, bottom 35%, sides 6%, and with words on top the photo
  starts at the top safe line so its subject stays on screen, #1077) and sends both images through `asset_feed_spec` placement
  rules: Facebook/Instagram/Messenger stories and reels get the 9:16, every other
  position (named explicitly; Meta needs exactly one rule per placement) the 4:5.
  The creative names the Page's Instagram account (`instagram_user_id`), without
  which Meta refuses the ad. A Page without Instagram, a render over 6 s, a failed
  upload, or a creative or ad Meta refuses fall back to the single 4:5 image and
  log `campaign.story_fallback`. A lead-form ad names its form in
  `asset_feed_spec.call_to_actions` (Meta refuses it without, 3390001). Meta's real
  answers are recorded by `scripts/record-meta-story-fixtures.ts` and
  `scripts/record-meta-leadform-placements.ts`.
- **Which ad worked** (#783, behind `AD_RESULTS_ENABLED`): a launched campaign card has a collapsed
  section that loads each ad's stored results on first open: enquiries and ₹ per enquiry ("—" before the
  first one), "Best" only at ≥ 5 enquiries and ≥ 30% cheaper than the next ad, otherwise "Early: too few
  enquiries to pick a winner". AdBrain's own ads show a 40 px picture and their headline; outside ads keep
  Meta's name. A capped run lists its running copies; an earlier copy shows only if it delivered, marked
  "(earlier run)". Ads Meta hasn't shown say so; ads replaced by an audience edit are marked;
  more than 3 sit behind "All ads". Refreshes store the numbers (`ad_results`).
  #1045: with at least 5 enquiries across the campaign, a running ad that costs ≥ 2× the best ad per enquiry
  (or spent ≥ 2× the campaign's cost per enquiry with none) gets one line: "“B” costs ₹X per enquiry vs ₹Y
  for “A”. Pause it?" [Pause this ad] [Keep]. Pause turns off only that ad (read back from Meta) and can be
  undone on the card; Keep hides it for 3 days. Never automatic, never a budget change. Turning the campaign
  back on keeps that ad paused (#1055): a capped resume copies only the other ads, and the review says so.
- **Daily results on WhatsApp** (#1022, dark behind `OWNER_ALERTS_ENABLED`): from 09:00 IST, each opted-in
  owner gets one `adbrain_daily_results` line for yesterday (IST): ₹ spent, enquiries (form leads plus
  WhatsApp chats, the same per-ad numbers as "Which ad worked"), ₹ each or "none yet", and the ad to name
  (#783's best, else the most enquiries, else the most WhatsApp taps). No line on a day with no spend and
  no enquiry; at the monthly cap only this line pauses.
- WhatsApp and new lead-form ad sets run on Facebook, Instagram and Messenger only (#906, #680), so a
  WhatsApp vs lead-form A/B differs only in destination: `publisher_platforms`
  leaves Audience Network out (on #157 most of its WhatsApp taps were accidental); positions stay
  automatic within those. Review says "Shown on Facebook, Instagram and Messenger", the plan check
  passes it, and the #588 ledger records `placements: "advantage:facebook,instagram,messenger"`.
  An audience edit to a WhatsApp ad set applies the same rule; an edit to an older lead-form ad set keeps
  its placements.
- Every launch checks the payloads it sent against Meta's new-advertiser guidance
  (Advantage+ audience and placements, one ad set, budget vs learning, 4:5 and 9:16
  images) and logs `campaign.plan_check` (#419). Review shows two plain, non-blocking warnings
  when they apply (#419 2b): "No 9:16 ad" when no ad will get one (an ad without a saved design), and "Budget is below what Meta needs to learn" when the per-ad-set budget
  buys under ~50 results a week at the business's own cost per result over its last 60 days of
  stored results (no history, no budget warning). Neither changes the reviewed plan or the send.
  The activation review notes the edits AdBrain makes that restart Meta's learning (#419 item 2),
  also never blocking and outside the confirmation digest: a capped run copies the ads into a new
  ad set that learns from zero (with the business's cost per result, only when its days buy under
  ~50 results), and resuming a campaign paused 7 or more days ago by the owner or by AdBrain's
  spend auto-pause (from the audit log; a pause made in Meta isn't seen).
- Only campaigns AdBrain launched can be resumed from their card. A paused campaign that was
  synced from Meta (or stored before AdBrain kept its ad sets and ads) shows "Resume in Ads
  Manager" with the reason instead (#662). A card action's error (review, pause, refresh,
  delete) shows on that card, and an opened activation review scrolls into view.
- Existing WhatsApp campaigns use the same account/Page-bound import, refresh,
  pause, and activation safeguards. Stored results are lifetime insights (`date_preset=maximum`):
  Meta's default `last_30d` leaves out today, so a new campaign used to read ₹0 (#404). Refresh detects all-WhatsApp ad sets and
  stores `onsite_conversion.messaging_conversation_started_7d` separately from
  leads. Overlapping messaging actions are not summed. Mixed-destination
  campaigns are not attributed wholly to WhatsApp.
- Campaign cards show conversations and cost per conversation; planner history
  and summaries distinguish conversations from verified leads/sales. This does
  not import chat messages, phone contacts, transcripts, or WhatsApp inbox leads.
  Leads-tab sync remains instant-form only.
- Not every chat is a customer (#335). A WhatsApp campaign's results have **Add
  enquiry** (name, phone and note optional): each saves to Enquiries as "WhatsApp
  chat (added by you)" with the campaign, and the card shows real enquiries and
  cost per real enquiry (spend ÷ real enquiries) beside cost per conversation.
- Apply `db/migrations/20260918_whatsapp_results.sql` before deploying the new
  reporting code, with separate migration authorization. Existing results stay
  unchanged (new columns are null); refresh results to populate conversations.
- Meta Page field references were checked; mocked provider tests do not certify
  actual account eligibility, delivery, or Graph v21 payload acceptance. Perform
  an explicitly authorized real-account PAUSED creation test before rollout.
  No live Solaride campaign is modified by this implementation.

### Targeting and Budget

- New ad sets use Meta's Advantage+ audience (#334). The area and its exclusions
  are hard limits. Meta caps a hard minimum age at 25 and fixes the maximum at 65,
  so the owner's age range is sent as an `age_range` suggestion; gender and
  interests are suggestions too. The review says: "Meta may reach people beyond your
  age range and interests; never outside your area." Campaigns already launched
  keep their original targeting.
- **Edit ad words** (#775): a paused or running AdBrain campaign's More menu changes an ad's
  headline, text or description. Meta gets a new version of the ad (picture, 9:16 and WhatsApp
  message kept), the ad goes back to review, and nothing else changes. Same claim checks as Studio.
- A business's saved WhatsApp message (`businesses.whatsapp_template`, #840) is what every
  new WhatsApp campaign sends: the welcome, then a pre-typed message (optionally with a Call
  now button) or up to 3 questions. A campaign's own edit (draft `whatsappMessage`) wins over
  it, with the same claim checks as a blocker. With neither, AdBrain writes the greeting and
  prefill per campaign as before. Review returns the exact message (`whatsappMessage`) and
  launch sends that one; an edited or saved message is part of the plan hash. The ledger
  records the button and whether it was edited, saved or suggested. In the composer,
  "WhatsApp message: Your saved message · Edit for this campaign" opens the same fields and
  preview ("Also save as my message" is off by default); Review's "When they tap" shows the
  message in one line and a preview, with a soft note when its language differs from the ads.
  #1081: it also shows the business's past open → message rate across its WhatsApp campaigns
  (from 10 opens), and a soft note when the pre-typed ask names no offer or number ("Hi, I want
  info"); neither blocks the send (`src/lib/campaign/whatsapp-handoff.ts`).
  With Quick questions there is no pre-typed message, so AdBrain's own welcome reads "…Tap a question
  below and we'll reply here." (all 4 languages; Brand card, composer and launch alike, #1121); a
  welcome the owner typed is never changed.
  Choosing "Quick questions" on Brand, or in Review's "Edit for this campaign", fills the empty
  boxes with 3 suggestions from the Brand (`src/lib/campaign/whatsapp-questions.ts`, #905, #1114):
  up to 2 offers asked as a customer would, in the owner's words ("Can I book a free site survey?",
  "Can I get PM Surya Ghar subsidy help?"; Hinglish "… book ho sakta hai?" / "… kaise milega?",
  Hindi and Punjabi alike), then "What's the price?" or "Call me back". A labelled offer is asked by
  the words after its label; when the question would pass 40 characters it asks for the offer's first
  item with its price ("Can I get the $49 new-patient exam?"), else the offer itself as a question
  ("Check-up and cleaning for ₹499?"); one that still doesn't fit is skipped, never cut mid-claim. A free offer is booked,
  never asked as a cost. They are only suggestions: nothing is sent until the owner saves (or uses
  them for the campaign), and saving runs the claim check.
  #418 rule 7: when every ad's last line quotes the words to send ('WhatsApp “Free site survey” to
  book'), AdBrain's suggested pre-typed message is exactly those words (`quotedAsk`). When an ad
  quotes other words than the message WhatsApp will pre-type (a saved or edited one), Review warns
  (never blocks): "An ad asks customers to send “…”, but WhatsApp pre-types “…”".
  With Quick questions on there is no pre-typed message, so an ad that quotes one gets one warning
  instead (#1198): "Your ad promises a ready message, but customers will see quick questions…", with
  **Change the last line**: one tap rewrites each quoting ad's last line, in the ad's own language, to "Tap, then pick a question
  to send." (approval unchanged) and checks the campaign again.
  #418 rule 5: when the Brand has proof (years in business, jobs done, a named credential or a
  warranty; `src/lib/creative/proof-line.ts`) and none of the chosen ads cites it, Review warns
  (never blocks) and names one ("None of these ads has a proof line from your Brand…").
- Every Indian ad set also excludes everything outside the service area (#741):
  every state/UT with no included place (Tricity: all but Chandigarh, Punjab and
  Haryana), plus the larger cities in the kept states that lie further than the
  included city's radius + 30 km (Ludhiana, Amritsar, Ambala, Gurugram…); a state
  included as a whole keeps all its cities (#804). Places are matched
  by Meta key (`src/lib/meta/service-area.ts`); the owner's own exclusions are kept.
  If Meta can't describe the area, the launch is refused (`TARGETING_EXCLUSIONS_MISSING`),
  and a tree built before the rule can't be activated. With Advantage+ audience and
  interests, Meta refuses later targeting edits, so exclusions must be in the create;
  a targeting edit on a live ad set restarts ad review (about 5 minutes on #157).
  Country-wide and non-Indian areas get no automatic exclusions.
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
- Location is asked once, in "Where should ads show?" (#305). "Let AdBrain decide"
  shows the decided areas and exclusions as a summary; "Choose myself" holds the
  location search plus the typed planned and excluded areas.
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
- Background audience plan (#366): in Choose settings, 1.5 s after the ads are
  chosen (and the audience still needs AdBrain), the audience is planned in the
  background, at most three times per composer. Prepare uses that reply once if
  the Campaign goal field, ads, targeting and destination are unchanged and it
  succeeded (a name or budget typed later doesn't count); otherwise Prepare stops
  the stale request quietly and plans as before. The reply stays in the browser.
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

A first-timer with approved ads and no campaign yet, who can connect Meta, gets
setup step 3 "Go live" on `/campaigns` (#1251 WS1, #1271): the picked ads, a daily
budget (₹300/₹500/₹1,000 a day) for 2 days with the most it can spend including
Meta's GST (`capWithGstPaise`, the activation reserve's own formula), the areas,
the WhatsApp chat, and the weekly cap line (#1342; over the cap, Go live can't be
tapped). The checklist shows the Facebook Page, the money row (AdBrain ad money →
Settings, or payment on the owner's own Meta account) and the "Stops at" total.
The one primary connects the Page first (MetaConnectDialog), then "Go live · ₹{d} a
day" is one tap (#1271 4b, `src/lib/campaign/setup-go-live-flow.ts`) through the
same routes the Campaigns page uses: connection status (not connected → the Meta
dialog), save the composer's default draft (the picked ads, ₹d a day, WhatsApp to
Meta's first ready number, default targeting, no A/B), preflight, create it PAUSED
(operation polled), then `GET /api/campaigns/{id}` and `PATCH` it active as a
2-day capped run (`capDays: 2`, so Meta's total limit is ₹d×2; the server also
checks the weekly cap and funding). One progress line per step. Review blockers
are shown in their own words with "Fix in campaign review"
(`?all=1&new=1&review=1&budget=d&creatives=…`) and nothing is created; a refused
activation is shown verbatim and the campaign stays paused with nothing spent.
The create request (idempotency key) is kept in sessionStorage per business, ads
and budget, so a second tap or a reload resumes its operation
(`operationForRequest`) instead of creating another campaign.

Closing New campaign retains its unsaved brief, creatives, audience, destination
and budget in memory for the current business; returning to a business in the
same mounted view restores its own setup. Use **Discard and start new** to clear
it after confirmation. Unsaved edits are not durable across reload/navigation:
use Save draft for server-backed recovery. A pending or uncertain creation
operation cannot be discarded to bypass its recovery identity; saved drafts
remain available after clearing the local setup.

Preflight validates ownership, approved creative content, active lead form,
connection capability, INR currency, resolved targeting, and budget. For health
businesses it also reads each ad's saved wording with Create's banned-claim rule
(whole words only), so an owner-edited "Cures back pain" is blocked before Meta
(`REVIEW_AD_POLICY`, #739). Its hash
binds the reviewed inputs, selected assets, resolved IDs, and creative content.
Creation reruns preflight and rejects a stale draft, hash, or connection generation.
Each Review blocker shows a one-tap fix under its message (`reviewBlockerFix`,
#723): it opens Brand Brain (website, WhatsApp), opens Connect Facebook (no
connection, currency, access), or jumps to and focuses the composer control
(ads, lead form, budget, age, radius, locations, Recommend audience, interests).
The website blocker also offers **Use WhatsApp chat instead**, since chat ads need
no website (#742). After a fix, **Check again** in the blocked review re-runs
Review in place (#756). Prepare stays tappable while incomplete: with no ad or no
budget it says so beside that control and focuses it (#772).

The durable creation operation uses an idempotency key and checkpoints external
IDs. Poll it after ambiguity; do not submit a new key to escape a pending or
`needs_reconciliation` state. Optional worker mode queues that same operation and
does not fall back to inline execution when the queue is unavailable. A created campaign is paused. Activation requires a
fresh confirmation digest, connection recheck, provider verification, and spend
guardrail check. Creation idempotency does not extend to activation or paid
generation. See [API Reference](API_REFERENCE.md) for payloads and states.

Pause and delete verify account/Page binding too. Missing legacy binding requires
reconciliation, not guessing. Meta writes and local mirrors are not atomic: a
provider action can succeed while the subsequent database write fails. Keep the
record and investigate; do not treat an HTTP failure as proof of no remote effect.

## Sync, Results, and Leads

Each campaign with stored results has **Share results on WhatsApp** (#372): a
`wa.me` link with a plain summary built from the stored results and the campaign
(spend against the capped run's limit or the daily budget, chats or enquiries plus
any logged real enquiries, cost per result, one next step). No Meta call or provider.

Campaign sync verifies remote account/Page association, budgets, and supported
statuses before importing. It handles one provider page per request; the UI asks
for continuation and accumulates skipped counts. Unsupported/deleted/archived
statuses are not imported as paused. A completed scan does not prune local rows
for campaigns absent from Meta.

Results refresh fetches insights and saves a snapshot before producing a
plain-language summary or checking spend-limit auto-pause. Failed persistence
returns 503 before summary and auto-pause; resolve storage availability before an
explicit retry. A successful refresh can pause delivery, so it is not a
read-only diagnostic. Every card with results says how old they are ("Updated
4m ago"). When Campaigns or Home opens, a running campaign whose results are over
10 minutes old (or missing) refreshes quietly, one campaign at a time and once per
visit; under 10 minutes no Meta call is made. The 15-minute scheduled refresh
stays the floor (#1003, #992). Reports
are Markdown exports of stored performance, not a live refresh. They escape
campaign names (including pipes/newlines), count impressions/clicks as delivery,
and do not declare a lead winner when nobody has leads.

Lead sync reads Page instant forms and their leads page by page, normalizes
contact fields, and ignores duplicate `(business_id, meta_lead_id)` rows, so
imports keep existing follow-up fields. `imported` counts new inserts, not fetched
rows. Each request is bounded and checkpointed; when more pages or failed forms
remain, the UI reports the sync as incomplete and the next Sync continues the same
run. Only a complete run reports "up to date". Opening Enquiries starts a sync when
this browser has no recent complete sync. Zero imports can mean duplicates or no
leads, not a broken campaign. WhatsApp conversations are not imported.

The inbox searches, filters (follow-up status, contact details), sorts and pages
saved enquiries on the server, with matching totals. Owners can record a
follow-up status (`new`, `contacted`, `qualified`, `booked`, `customer`, `closed`) and a
note up to 2000 characters; a failed save keeps the edits for retry. Follow-up is
local record-keeping only and sends nothing. Each row also has a one-tap **Became a
customer** button with Undo (#798). A campaign card then shows its customers and
**Per customer** (Meta spend ÷ enquiries marked as customers, any source) once
there is at least one.

The copy-ready digest summarizes the last seven days of the currently loaded
enquiries with at most ten contacts, including email where available. It is not
a WhatsApp send, CRM, notification service, complete export, or revenue
attribution system.

## Spend Guardrails

Settings accept a positive whole-rupee weekly cap or explicit `null` for no cap,
an alert percentage from 1-100, and an auto-pause flag. Zero is invalid, not
unlimited. Unsaved changes invalidate the Saved indicator.

Activation compares projected weekly commitment against the cap; unavailable
spend data blocks activation. The same projection (`weeklyCapNotice`, #1342)
shows the cap on the campaign Review and the activation review, and an over-cap
daily budget is refused at the budget field, before Check my campaign or Send to
Meta, not first at Activate. Refresh and the daily scheduled sweep request bound
Meta insights for Monday through today in the selected account's timezone.
They require a complete INR observation for every campaign before comparing the
weekly total to the rupee cap. Missing, partial, mismatched-period/currency or
failed observations trigger protective pauses of active campaigns; an unknown
observation or failed pause remains unconfirmed even when some pauses succeed.
Existing reporting snapshots are not audited customer cost or tax evidence.
These are application guardrails, not Meta account spending limits or guaranteed
protection from overspend between checks or during outages. Use provider-side limits.

## Declared Preferences

After the additive [declared-preferences migration](../db/migrations/20260930_declared_preferences.sql)
is applied, Settings offers an optional per-owner, per-business preference list.
Enable it to remember one short note per category, then edit, forget, pause or
clear the notes. The same Settings area shows notes while paused and can export
the saved notes as JSON. Pausing excludes them from future interviews/planning;
it does not erase them. Re-enabling does not reread old conversations or campaigns.

Creative interviews, campaign planning and active ad generation/regeneration receive
at most five relevant advisory notes (up to 1000 characters of serialized notes)
alongside the current request. Generation gives these notes to concept and image
providers only after an accepted request; a replay does not launch another provider
call or reread notes.
"Ignore preferences" and "fresh direction" omit them for that request. Notes
cannot authorize spend, justify a commercial claim, override an explicit current
brief, or turn an old tagline into required copy. Explicit Brand and legal
requirements remain separate. A model-written Create brief is direction only,
not proof of commercial claims: its original typed goal and free-text answers
are separately supplied as evidence, while suggested options and saved memories
are excluded. A directly typed Studio brief can supply evidence. Changing explicit
facts under the same generation ID is rejected; the accepted facts are retained
for regeneration. This is source behavior after the migration is
applied, not a claim of deployment or provider quality. When preferences are
applied, saved image-prompt receipts contain only an omission marker. The saved
concept and creative may still reflect their style, and forgetting cannot retract
provider calls or erase older creative output influenced by a note. The first
slice has no inferred notes, background extraction, cross-business profile or
historical backfill. A memory
read outage omits advisory context; failed explicit writes surface an error.

## Public Surface and Operations

Landing/legal pages and `/guides` provide public metadata, structured data,
sitemap, and social images. Workspace pages are authenticated and noindex; robots
rules are indexing hints, not access control. No search-ranking guarantee follows
from metadata correctness.

`/ideas` and `/ideas/<industry>` (#289) show three real AdBrain ads for each of ten
example local businesses, labelled as examples, made by `scripts/make-idea-ads.ts`
with the production Create pipeline (no phone numbers, evergreen offers). "Make one
like this" saves the idea's goal in localStorage and opens Create, which starts from
it after sign-in; the login page keeps the create-account view while it's pending.

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
