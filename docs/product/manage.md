# Manage: Sync, Results and Leads

Part of [Features and workflows](README.md).

## Sync, Results, and Leads

While campaigns run, Home offers **Pause all ads**: one confirmation, then each
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
