# Create and Review Ads

Part of [Features and workflows](README.md).

## Create and Review Creatives

Until a business has a campaign that went live (or is on now), `/create` is setup
step 2 of 3 (#1251 WS1, #1270; in Hindi too, #1438, except the sales sample pack). With no saved batch it runs the existing interview
(answering "Let the AI decide" to any question, up to 3) and one 3-ad Create run
in the Brand's first language, else the segment default (solar → Hinglish, others
English; #1681). Step 1 (and step 2 before a tapped "Make 3 ads") shows "Your ads will be in:
English · Hinglish · हिंदी · ਪੰਜਾਬੀ"; a pick is saved first in Brand `languages`,
showing one line of progress at a time. Then it shows the newest batch
(`variant_group`) with 2 pre-picked by a fixed rule (`setupPicks`: fewest text
repairs, then no image fallback, then the order made). "Continue" approves the picks
and opens `/campaigns?new=1&creatives=…`. The generation id is kept in
localStorage for 15 minutes (#1402), so coming back or a second tab reads the
saved ads instead of starting again; the step waits through "processing" and
"partial" and treats "unresolved" as finished short, and on arrival it checks the
newest batch (#1407). The tab that gets a batch's ads publishes them in localStorage
(`setup-generation-result:{businessId}`, 15 minutes), so other waiting tabs show them
at once; a 429 from the shared status budget waits out Retry-After (#1534). Opened mid-batch, the step says "Making your ads…" and Continue waits ("N more on the way…") until the rest lands or the batch ends short (#1564). Missing ads show "N ads couldn't be made. Make another", and a
top-up shows beside its batch (`setupBatch`). Only ads made from today's step 1
count (`madeForSetup`: the receipt's source fact is today's `setupGoal`, #1432):
after the owner changes what they sell, where or their offer, step 2 makes new
ads, and step 3 sends back to step 2 rather than offering older approved ads.
With such earlier ads (older details, or approved in Studio) step 2 never starts a
paid batch by itself: it shows "Make 3 ads" (a tap) and "Use your earlier ads" →
`/campaigns?all=1`; a batch already running in another tab still resumes (#1475).
`/create?all=1` opens the full Create below.

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

Sharing an approved ad converts a stored WebP to a full-size JPEG (`.jpg`) in the
browser, including the desktop download fallback (#2016). Transparent areas
become white. Existing PNG/JPEG pictures stay unchanged. Conversion failures show
the existing preparation error instead of sharing or downloading the WebP.

Regeneration uses the creative's saved language/format, updates that creative,
and resets approval to `draft`. Approval toggles `draft`/`approved`; it does not
change existing remote ads. Deleting a local creative is not a request to delete
a Meta ad already created from it.

Studio's Background editor offers saved Brand photos before the optional
"Or describe an AI picture" field. Opening it does not focus that text field;
the owner can choose a photo without first opening the phone keyboard.

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
