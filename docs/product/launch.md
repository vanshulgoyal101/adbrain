# Launch a Campaign

Part of [Features and workflows](README.md). Targeting and budget: [Targeting and Budget](targeting-and-budget.md#targeting-and-budget); review and go live: [Review, Create, Activate](review.md#review-create-activate).

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
  owner gets one `adbrain_daily_results` line for yesterday (IST): ₹ spent, how many people messaged or filled a
  form (the same per-ad numbers as "Which ad worked"), ₹ each or "none yet", and the ad to name with its
  people count (#783's best, else the most people, else the most WhatsApp taps; #1720 dropped "enquiries"). No line on a day with no spend and
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
