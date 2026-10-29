# Leads, Results and Settings API

Sync, insights, enquiries, spend limits, preferences and privacy requests. Conventions: [API reference](README.md).

## Routes

`Envelope` means the typed family in [Response Families](README.md#response-families); `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| GET | `/api/leads` | Filters/cursor -> `{leads,total,nextCursor}` | Owned saved enquiries only; Meta's test leads are listed but left out of `total` (#1149); no provider sync |
| POST | `/api/campaigns/[id]/enquiries` | Optional `name` (<=200), `phone` (<=40), `note` (<=2000), `customer: true` (#798: logged already marked "customer") -> 201 `{id,enquiries,customers}` | Logs one real enquiry from an owned WhatsApp campaign's chats into Enquiries (`source` `whatsapp_manual`); 400 for other destinations, 404 when not owned, 30 per 5 min (#335) |
| DELETE | `/api/campaigns/[id]/enquiries?lead=<uuid>` | No body -> `{enquiries,customers}`; **404** unless the lead is a `whatsapp_manual` enquiry of this campaign | #798 Undo for a one-tap customer: removes only an owner-logged WhatsApp enquiry, never a Meta form enquiry; RLS-scoped |
| PATCH | `/api/leads/[id]` | `workflow_status` and/or `follow_up_note`, or `{contacted:true}` (#1049: the server sets `first_contacted_at` once, only while the enquiry is `new`, and moves it to `contacted` (#1140); a time can't be sent) -> `{lead}` | Owned local follow-up only; no outreach or provider write |
| POST | `/api/leads/sync` | Empty body or `{syncId}` -> `{leads,imported,failedForms,sync}`; failed Meta reads return 502 with saved rows and a resumable `sync.id` | Bounded provider pages + atomic per-business deduplicated inserts/checkpoints; incomplete runs are not up to date |
| GET | `/api/leads/unseen` | `since` (ISO viewed time) -> `{count}` | Authenticated owner business only; exact count of locally imported leads after `since`, Meta's test leads excluded (#1149), private no-store; no provider sync. The sidebar badge polls it every 2 min while visible, waits out a 429's Retry-After and stops on 401 (`usePoll`, #1541) |
| POST | `/api/spend-limits` | Complete settings -> `{ok:true}` | DB write |
| GET | `/api/preferences` | `businessId` -> `{enabled,epoch,notes}` | Authenticated owner-scoped read, no cache |
| POST | `/api/preferences` | Versioned mutation -> `{enabled,epoch,notes}` | Owner-scoped opt-in/save/forget/pause/clear |
| GET | `/api/privacy-requests` | No body -> `{requests}` (latest 20) | Authenticated owner-only export/deletion status, no cache |
| POST | `/api/privacy-requests` | Same-origin `{kind:"export"|"delete"}` -> `{request}` (201) | Owner-scoped request; one open request per kind, no export/deletion |
| GET | `/api/privacy-requests/operator` | No body -> `{requests}` (oldest 100 open requests); `?check=1` -> `{allowed:true}` without loading the queue | Verified privacy operator only; server-only queue read |
| PATCH | `/api/privacy-requests/operator` | Same-origin `{id,expectedStatus,status}` -> `{request}` | Verified privacy operator only; status and handler audit, no export/deletion |
| POST | `/api/prospect/transfer` | `{businessId, ownerEmail}` -> `{ok, ownerEmail, expiresInMinutes: 30}` | #1670: only the business's own confirmed `+prospect` session; `business_transfer_start` re-checks that and the #1486 pre-checks (409 names the one that blocks). No link is sent |
| DELETE | `/api/prospect/transfer` | `{businessId}` -> `{ok}` | Cancels the pending hand-over (same session rule) |
| POST | `/api/prospect/claim` | `{transferId, decision:"accept"\|"decline"}` -> `{ok[, businessId]}` | #1670: the owner's answer on Home; the DB checks their confirmed address, expiry, single use, one business per account and the pre-checks; a team login can't accept (403) |

## Sync, Insights, Leads, and Settings

Campaign sync accepts optional query `after` of 1-2000 characters. Returns
`{campaigns,skipped,nextCursor,pageCursor}`. `nextCursor` continues Meta discovery;
`pageCursor` continues the bounded saved list. It processes one provider page, verifies bindings
and budgets, and imports only ACTIVE/PAUSED status. Local unsupported/unmatched
records remain unchanged. No remote-deletion pruning occurs. Concurrent insert
failure is not a successful import; partial writes before an error can exist.
Failed Meta binding reads return a generic 502 before local imports; only a
confirmed unmatched binding counts as skipped.

Refresh returns `{result,summary,insights,review,autoPaused,protectionConfirmed}`.
`review` is Meta's per-ad review (`[{adId,state,effectiveStatus,reasons}]`, state
`in_review|approved|rejected|issues|unknown`, reasons as Meta wrote them) or
`null` when the review read failed; it does not fail the refresh. **This
can invoke an LLM summary and pause live campaigns through spend enforcement**; it
is not a read-only smoke test. `autoPaused` lists only confirmed remote and local
pauses. `protectionConfirmed:false` means the spend decision or a required pause
could not be verified; inspect the bound campaign in Meta, since a local error
does not prove remote delivery stopped. Provider refresh failures can still attempt
protective pauses. An unsaved result returns 503 before summary and enforcement
(`Could not save refreshed results. Retry the refresh.`, `protectionConfirmed:false`);
a successful retry can still trigger the summary and protective pauses.

Saved campaigns are read with `GET /api/campaigns/list`. `businessId` is an owned
UUID; `query` is at most 200 characters; `status` is `draft`, `active`, `paused`
or `completed` (omit it for all; `status=all` is invalid). Rows are ordered by
creation time then ID, descending, 50 per page, with `nextCursor` null at the end.
There is no global total, and the route runs no provider sync.

Lead sync returns `{leads,imported,failedForms,sync,error}`; each failed form has
`id,name` and `sync` is `{id,state:"complete"|"partial",hasMore}`. An empty POST
starts or resumes the unfinished run for the current connection binding;
`{syncId}` resumes that run. Business, owner, Page, ad account and connection
generation are derived and rechecked on each save: a foreign or missing run is
404 and a changed binding or stale writer is 409 (start again with an empty POST
after reconnecting). Continue with the same ID while `hasMore` is true.

Each request reads at most 24 provider pages of 200 items, at most three forms
concurrently, within a 40-second provider deadline; checkpoints time out after
three seconds. Only opaque `after` cursors are saved. Successful pages stay saved
when another form or page fails; failed forms stay queued and are listed in
`failedForms`. A failed provider read returns 502 and unverifiable progress 503,
both with the known `imported`/`sync`. `imported` counts rows newly inserted by
this request; duplicates are ignored and keep their campaign and follow-up fields.
`leads` is a snapshot of at most 200 newest saved rows, not the inbox list; a
failed reload after import returns 503 even though rows were saved. Report export returns
`text/markdown` with dated attachment filename and uses stored primary-business
performance; it does not refresh Meta.

The saved inbox uses `GET /api/leads` for the primary business. Strict filters:
`query` (trimmed, up to 200 characters; matches name, phone, email, city, form),
`status` (`all`, `new`, `contacted`, `qualified`, `booked`, `closed`), `contact`
(`all`, `ready`, `missing`), `sort` (`newest`, `oldest`, `name`), `limit` (1-100,
default 50) and an opaque `cursor`. Cursors are bound to the business, query,
status, contact and sort; changed scope rejects them. `total` counts every
matching saved row. Ordering is deterministic keyset paging (missing values last,
UUID tie-break), not a frozen snapshot. Responses are private/no-store; invalid
filters or cursor are 400, no business is 404 and unavailable reads are 503.

`PATCH /api/leads/[id]` takes a UUID path and a nonempty strict body with
`workflow_status` (one of the five statuses) and/or `follow_up_note` (at most
2000 characters); other fields are 400. The update is scoped to the owned
business: missing or foreign rows are 404 and failed saves 503. It sends no
outreach and changes no provider data.

Spend settings are strict and complete:

```json
{"weeklyCapRupees": 5000, "alertPct": 80, "autoPause": false}
```

Cap is null or a positive integer <= 2147483647; threshold integer 1-100; autoPause
boolean. Missing fields, zero, and fractional caps return 422. Only null means
unlimited. Success `{ok:true}` does not assert that Meta account limits changed.

Preference reads require `GET /api/preferences?businessId=<owned UUID>`. The
uncached response is `{enabled,epoch,notes}`; each note has `category`, `value`,
`version` and `updated_at`. Notes stay visible to their owner while paused but
are not included in creative or campaign-planning prompts. An unconfigured
business returns `enabled:false`, `epoch:0`, and no notes.

Mutations use `POST /api/preferences` with a JSON object containing `businessId`,
`operation` (`enable`, `pause`, `save`, `forget`, `clear`), and `expectedEpoch` from
the latest read. `save` requires a category and 1-160 character value; `forget`
requires a category. The fixed categories are `copy_length`, `tone`, `language`,
`visual_style`, `layout_density`, `creative_dislikes`, and `workflow`. One current
value per category is retained. Successful mutations return the updated state.
The database rejects sensitive/financial content and unauthorized businesses;
failed content is 400, lost ownership is 403, a stale epoch is 409, and database
or reload failures are 503. A failed reload after a committed mutation may require
a refresh to determine what was saved; no best-effort memory write is reported
as confirmed.

Geo search trims `q`, truncates to 100 characters, and returns an empty array below
two characters. Up to eight results have `key,name,type,region,countryCode`.
