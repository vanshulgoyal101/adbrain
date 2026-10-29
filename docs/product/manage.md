# Manage: Sync, Results and Leads

Part of [Features and workflows](README.md).

## Sync, Results, and Leads

While campaigns run, Home (and, on an own-account plan, Settings → Billing under
"If you stop") offers **Pause all ads**: one confirmation, then each
running campaign's existing emergency stop, one at a time. It reports success
only when every pause is confirmed, otherwise a partial result with Try again
and Open in Ads Manager. Resume remains per campaign.

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
leads, not a broken campaign. WhatsApp conversations are not imported; the owner
answers them in WhatsApp Business ([Answer the chats your ad brings](answer-chats.md)).

When Meta counts no chats, owner-added real enquiries are still shown as
"You added N real enquiries", not as chats. Meta's test rows are labelled
"Test from Meta", distinct from a new customer enquiry.

The inbox searches, filters (follow-up status, contact details), sorts and pages
saved enquiries on the server, with matching totals. Owners can record a
follow-up status (`new`, `contacted`, `qualified`, `booked`, `customer`, `closed`) and a
note up to 2000 characters; a failed save keeps the edits for retry. Follow-up is
local record-keeping only and sends nothing. Each row also has a one-tap **Became a
customer** button with Undo (#798). A campaign card then shows its customers and
**Per customer** (Meta spend ÷ enquiries marked as customers, any source) once
there is at least one. Before them it shows bookings (#1994: enquiries marked Booked or
Customer), named for the segment: "consultations booked" (interiors), "site visits
booked" (solar), "demo classes booked" (IELTS), otherwise "booked"; hidden at 0.

**Delete an enquiry** (#1761). An owner can delete one enquiry (**Delete enquiry** in
its row menu or detail panel) or every enquiry of one campaign, including chats they
added (**Delete enquiries** in the campaign card's menu; not on drafts). A confirm
step says what goes; after it, the delete is permanent: there is no Undo and no
restore. The enquiry's details, answers, follow-up status and note leave AdBrain.
What stays: Meta's own copy in the Page's leads (AdBrain does not delete it there),
the ads (unaffected), a tombstone holding only a SHA-256 hash of Meta's lead id so
Sync never imports that enquiry again, and an audit row with ids and a count, no
contact details. Owners only, their own business; 60 deletes per 5 minutes.

The copy-ready digest summarizes the last seven days of the currently loaded
enquiries with at most ten contacts, including email where available. It is not
a WhatsApp send, CRM, notification service, complete export, or revenue
attribution system.

## What your campaign card says

Each campaign card answers one question, is it working, in one sentence, one number and at most one
button. Home shows the one word next to the campaign. AdBrain uses fixed rules, no AI.
It never raises your budget or changes who sees your ads.

A result is a chat (WhatsApp ads) or an enquiry (form ads). The usual cost is what
AdBrain's other ads in your kind of business paid per result, or your own last campaign,
counted only when at least 20 results sit behind it.

| State | Card says | What it means | What to do |
| --- | --- | --- | --- |
| `weak_ad` | "Costly" | One ad costs at least 2 times as much per result as your best ad, or has spent that much with no result while your others bring them. | Tap "Pause this ad", or "Keep" to leave it running (the offer hides for 3 days). |
| `no_results` | "No chats yet" or "No enquiries yet" | At least ₹300 spent (or 1.5 times the usual cost, if that is more) and no result yet. | WhatsApp ads: tap "Edit the ad" to change the message. Form ads: no button; check the form and the ad words. |
| `not_showing` | "Not showing yet" | The campaign is on but nobody has seen it yet, and it was turned on less than a day ago. Meta is still checking the ads. | Wait. This usually takes a few hours, sometimes up to a day. |
| `not_showing_day` | "Not showing yet" | The campaign has been on for a day or more and nobody has seen it yet. | Tap "See Meta's status" and look for a rejection or a payment problem. |
| `early` | "Early days" | Fewer than 5 results, or less than ₹500 spent. Too soon to judge. | Wait. Reply to every chat fast. |
| `costly` | "Costly" | 5 or more results and ₹500 or more spent, and each result costs more than 1.5 times the usual cost. | Tap "Try new ads". |
| `about_average` | "About average" | 5 or more results and ₹500 or more spent, and each result costs about the usual cost (from 0.67 to 1.5 times it). | Nothing. Let it run. |
| `working` | "Working" | 5 or more results and ₹500 or more spent, and each result costs less than 0.67 times the usual cost. | Nothing. Let it run. |
| `measured` | "Live" | 5 or more results and ₹500 or more spent, but there is no usual cost to compare with yet. The card shows the cost per result only. | Nothing. Home shows no word for it. |
| `ended_worked` | "Ended" | It ended with 5 or more results and ₹500 or more spent, at or below 1.5 times the usual cost. | Tap "Run this again" (best ad first). |
| `ended_costly` | "Ended" | It ended with 5 or more results and ₹500 or more spent, but each result cost more than 1.5 times the usual cost. | Tap "Try new ads". |
| `ended_measured` | "Ended" | It ended with 5 or more results and ₹500 or more spent, with no usual cost to compare with. | Tap "Run this again". |
| `ended_too_few` | "Ended" | It ended with fewer than 5 results or less than ₹500 spent. Too few to judge; that is not a bad result. | Tap "Run this again" to run it longer. If nobody tapped at all, the card offers "Try new ads". |

If someone is waiting for your reply, a running card starts with how many "people are waiting for your
reply." and offers "Reply now" when it has no other button. A run with an end date reads as ended once
that time has passed (#2281).

## Why AdBrain paused your campaign

AdBrain pauses a running campaign by itself for four reasons only. It checks every 15
minutes. The card then says "Paused" and offers "Resume", and Home's Recent activity shows
"Campaigns auto-paused at your cap" for all four, even when the cap was not the reason.

| Reason | When it happens | What to do |
| --- | --- | --- |
| Weekly cap reached | Settings has a "Weekly cap (₹)" and "Auto-pause at the cap." is on, and this week's spend (Monday to today, in your ad account's time zone) has reached the cap. Every running campaign is paused. | Wait for Monday, or raise the cap in Settings, then tap "Resume". If you resume while this week's spend is still over the cap, AdBrain pauses it again at the next check. |
| Spend couldn't be checked | The same cap and auto-pause are on, but AdBrain couldn't read this week's spend from Meta. Every running campaign is paused to be safe. | Tap "Resume" once Meta answers again. If Meta asks you to connect again, do that first. If it keeps happening, message us. |
| Funds need a check | Only when AdBrain pays Meta for you from your AdBrain balance: the balance is on hold, or AdBrain couldn't read it. Every running campaign is paused. | Message us. "Resume" works again once AdBrain has cleared the hold. |
| The run ended | The run has a total and an end date, and the end date has passed. AdBrain pauses the campaign, its ad sets and its ads. The card says "Ended". | Tap "Run this again", or "Resume" and choose how many days to run. It runs with a total again. |

Until the check pauses an ended run, its card shows **Needs attention** with "This run's end
date has passed. Pause it, or start a new run." Code: `src/app/api/cron/enforce-spend/route.ts`
(the pause and its reason), `src/lib/campaign/spend.ts` (`campaignsToAutoPause`,
`weeklySpendDecision`), `src/lib/campaign/health.ts` (the ended flag).
