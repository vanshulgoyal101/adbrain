# Review and Go Live

Part of [Features and workflows](README.md). Step of [Prepare a Campaign](launch.md#prepare-a-campaign).

### Review, Create, Activate

A first-timer with approved ads and no campaign yet, who can connect Meta, gets
setup step 3 "Go live" on `/campaigns` (#1251 WS1, #1271): the picked ads, a daily
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
generation. See [API Reference](../api/README.md) for payloads and states.

Pause and delete verify account/Page binding too. Missing legacy binding requires
reconciliation, not guessing. Meta writes and local mirrors are not atomic: a
provider action can succeed while the subsequent database write fails. Keep the
record and investigate; do not treat an HTTP failure as proof of no remote effect.
