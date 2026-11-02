# Review and Go Live

Part of [Features and workflows](README.md). Step of [Prepare a Campaign](launch.md#prepare-a-campaign).

### Review, Create, Activate

A first-timer with approved ads and no campaign yet, who can connect Meta, gets
setup step 3 "Go live" on `/campaigns` (#1251 WS1, #1271; in Hindi too, #1438): the picked ads, a daily
budget (₹300/₹500/₹1,000 a day) for 2 days (default) or 7 days (#1530: pilots, ₹2,478 at
most at ₹300) with the most it can spend including
Meta's GST (`capWithGstPaise`, the activation reserve's own formula), the areas,
the WhatsApp chat with the welcome Go live sends (#1529: `setupWelcome`, Review's own
`campaignWhatsAppMessage` on Go live's draft, so the saved message or AdBrain's), "Change
who sees it" (full composer) once the Page is connected, and the weekly cap line (#1342; over the cap, Go live can't be
tapped). The checklist shows the Facebook Page, the money row (payment on the
owner's own Meta account; the AdBrain ad money row is hidden for every funding
mode until flat ₹999/month pricing with pass-through ad money, #1251 CEO) and the
"Stops at" total.
The one primary connects the Page first (MetaConnectDialog), then "Go live · ₹{d} a
day" is one tap (#1271 4b, `src/lib/campaign/setup-go-live-flow.ts`) through the
same routes the Campaigns page uses: connection status (not connected → the Meta
dialog), save the composer's default draft (the picked ads, ₹d a day, WhatsApp to
Meta's first ready number, default targeting, no A/B), preflight, create it PAUSED
(operation polled), then `GET /api/campaigns/{id}` and `PATCH` it active as a
capped run of the chosen days (`capDays: 2` or `7`, so Meta's total limit is ₹d×days; the server also
checks the weekly cap and funding). One progress line per step. Review blockers
are shown in their own words with "Fix in campaign review"
(`?all=1&new=1&review=1&budget=d&creatives=…`) and nothing is created; a refused
activation is shown verbatim and the campaign stays paused with nothing spent.
When Meta can't activate because the ad account has no way to pay (`BILLING_REQUIRED`,
#1990), step 3 says it in the owner's language instead of Meta's text: "Meta needs a way to
pay first: a card, or money added by UPI or net banking. Add it in Meta, then tap Go live
again. Nothing was spent.", with "Add payment in Meta" (Meta's payment settings); "Fix in campaign review"
shows only if other blockers remain. The payment row's "Add a card, or pay by UPI or net
banking" explains that Meta charges a card after the ads run, while UPI or net banking money
must be added first, at least the run's total, or the ads stop when it runs out.
The create request (idempotency key) is kept in sessionStorage per business, ads
and budget, so a second tap or a reload resumes its operation
(`operationForRequest`) instead of creating another campaign.

Closing the composer (More options) retains its unsaved brief, creatives, audience, destination
and budget in memory for the current business; returning to a business in the
same mounted view restores its own setup. Use **Discard and start new** to clear
it after confirmation. Unsaved edits are not durable across reload/navigation:
use Save draft for server-backed recovery. A pending or uncertain creation
operation cannot be discarded to bypass its recovery identity; saved drafts
remain available after clearing the local setup.

Preflight validates ownership, approved creative content, active lead form,
connection capability, INR currency, resolved targeting, and budget. For health,
education and solar/interiors businesses it also reads each ad's saved wording
with Create's banned-claim rule (whole words only), so an owner-edited "Cures back
pain" or "Guaranteed savings" is blocked before Meta (`REVIEW_AD_POLICY`, #739,
#2423). The WhatsApp welcome, pre-typed message and quick questions that launch
will send (suggested, saved or edited) get the same rule plus #738's policy rules,
naming the field (`REVIEW_WHATSAPP_MESSAGE`, #2422). Its hash
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
generation. See [API Reference](../api/README.md) for payloads and states.

Pause and delete verify account/Page binding too. Missing legacy binding requires
reconciliation, not guessing. Meta writes and local mirrors are not atomic: a
provider action can succeed while the subsequent database write fails. Keep the
record and investigate; do not treat an HTTP failure as proof of no remote effect.

## When Review stops you

Review lists what blocks the launch, one message each, with a fix button under it (`src/lib/campaign/preflight.ts`,
`review-fix.ts`). Tap the button, fix the one thing, then **Check again**. Words in `{braces}` are filled in
with the ad, area or interest Meta named. Support can paste the row's message and "What to do" line.

| Code | Review says | Fix button | What to do |
| --- | --- | --- | --- |
| `REVIEW_NO_META_CONNECTION` | "Connect Facebook and choose your Page and ad account." | "Connect Facebook" | Connect, then pick this business's Page and ad account. |
| `REVIEW_CURRENCY` | "Choose an ad account that pays in Indian rupees (INR)." | "Choose another ad account" | Pick an ad account in rupees. Meta can't change an account's currency, so make a new one in INR if you have none. |
| `REVIEW_META_ACCESS` | "Meta hasn't confirmed AdBrain can create campaigns in this ad account. Connect Facebook again and allow every permission it asks for." | "Connect Facebook again" | Connect again and leave every permission switched on. |
| `REVIEW_CREATIVES` | "Choose at least one ad to send to Meta.", "One of the ads you chose isn't available any more. Choose your ads again.", or an ad that "isn't approved yet", "has no picture yet" or "has no headline" | "Choose your ads" (opens the ad picker) | Choose approved ads that have a picture and a headline. |
| `REVIEW_WHATSAPP_NOT_LINKED` | "Your Facebook Page has no WhatsApp number linked yet, so the ad's button has nowhere to open a chat. Link the number in Settings, then review again." | "Link your WhatsApp number" (opens Settings) | Link the WhatsApp Business number to the Page in Meta, then check it in Settings. |
| `REVIEW_WHATSAPP_MESSAGE` | "Your WhatsApp message: {problem}" | "Edit the WhatsApp message" | Fix what the message names (too long, missing, or a promise in the welcome, pre-typed message or a question). |
| `REVIEW_NO_LEAD_FORM` | "Choose an active lead form from your Facebook Page in the Lead form field." | "Choose a lead form" | Pick an active form, or make one on the Facebook Page first. |
| `REVIEW_NO_WEBSITE` | "Add your business website on the Your business page. Meta lead ads must link to the advertiser's own website, not Facebook." | "Add your website" (opens Brand), or "Use WhatsApp chat instead (no website needed)" | Add your own website, or switch to WhatsApp chat ads. |
| `REVIEW_AD_POLICY` | "{word}" in an ad is a health promise (clinics) or a promise (others) "Meta rejects. Edit the ad to describe the service instead." | "Edit the ad's wording" | Say what the service is, not what it cures or guarantees. |
| `REVIEW_BUDGET` | "Set a daily budget above ₹0." or "Meta needs at least ₹96 a day. Set a daily budget of ₹96 or more." | "Set the daily budget" | Pick ₹300, ₹500 or ₹1,000 a day. |
| `REVIEW_NO_AGE_RANGE` | "Choose an age range, or let AdBrain recommend one, before reviewing." | "Set the age range" | Set the ages, or tap **Recommend audience**. |
| `REVIEW_RADIUS` | "Set the city radius between 17 and 80 km; Meta allows nothing outside that range." | "Set the city radius" | Choose a radius from 17 to 80 km. |
| `REVIEW_CITY_RADIUS` | City only "came back from Meta with a radius. Choose the locations again." | "Choose the locations again" | Pick the locations again. |
| `REVIEW_AREAS_UNRESOLVED` | "Meta didn't recognise some of your areas. Fix or remove them, or choose nationwide targeting." (or names the areas) | "Fix the areas" | Fix the spelling, remove the area, or choose all of India. |
| `REVIEW_NO_AUDIENCE` | "Let AdBrain recommend the audience (Recommend audience) before reviewing." | "Go to Recommend audience" | Tap **Recommend audience** and keep its suggestion or change it. |
| `REVIEW_INTERESTS_UNRESOLVED` | "Meta didn't recognise some audience interests. Edit or remove them." (or names them) | "Edit the interests" | Remove the interest, or pick one Meta suggests. |
| `REVIEW_CHANGED` | Not a blocker: the campaign changed after Review, so **Send to Meta** says "This campaign changed after you checked it. Tap Check my campaign again, then Send to Meta." | None | Tap **Check my campaign** again, then **Send to Meta**. |
