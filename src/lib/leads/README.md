# Leads

Part of the [repository map](../../../docs/architecture/overview.md#repository-map). This module imports Meta instant-form enquiries into `leads`, reads the saved inbox, and holds the inbox's follow-up rules (waiting, first reply, test leads). It does not import WhatsApp conversations or send anything: replies open in the owner's own WhatsApp or dialler.

## Start here

| File | Owns |
| --- | --- |
| [sync.ts](sync.ts) | `syncMetaLeads`: the resumable, checkpointed import from the selected Page's lead forms |
| [parse.ts](parse.ts) | Turning Meta's `field_data` into name, phone, email and city |
| [queries.ts](queries.ts) | `getLeadPage`: the inbox page, filters and cursor, via the `get_lead_page` RPC |
| [filters.ts](filters.ts) | Inbox filter and update schemas, including the follow-up statuses |
| [waiting.ts](waiting.ts) | `isWaiting`: the one rule for "waiting for your reply", shared by the inbox, campaign cards and Home |
| [first-reply.ts](first-reply.ts), [reply-choices.ts](reply-choices.ts) | The pre-filled first reply and the pilot segments' reply choices |
| [test-lead.ts](test-lead.ts) | Spotting Meta's test leads so they are labelled but never counted |

## Rules

- Enquiries hold personal data (names, phones, emails). Keep them out of logs, prompts, audit rows and product events; [customer-event.ts](customer-event.ts) records ids and flags only.
- Reads run as the owner: [queries.ts](queries.ts) and [reply-time.ts](reply-time.ts) use the session client, and `get_lead_page` checks `owns_business`. Only [sync.ts](sync.ts) uses the admin client, and `lead_sync_start` checks the business, owner, connection generation, ad account and Page.
- Sync is resumable: each Graph page commits rows and progress together through `lead_sync_checkpoint`, with at most 24 Graph reads per request. A version mismatch is a 409, never an overwrite. Keep saved progress and rows after a partial or failed run.
- A repeated Meta lead id never overwrites a saved row, so the owner's follow-up fields survive re-syncs; the checkpoint only fills a missing campaign link.
- A deleted enquiry never comes back: `leads_erase` leaves a hashed tombstone and `lead_sync_checkpoint` skips it ([migration](../../../db/migrations/20261029_lead_erase.sql)). On a Page shared by two businesses, a lead lands only in the business whose campaign it came from. Any migration that re-creates `lead_sync_checkpoint` must keep both filters.
- Meta's test leads stay listed but are taken off totals and never count as waiting ([test-lead.ts](test-lead.ts)).

## Tests

- [Parse, digest, filters and inbox page](../../../tests/leads.test.ts)
- [Waiting rule](../../../tests/lead-waiting.test.ts) and [waiting per campaign](../../../tests/leads-waiting.test.ts)
- [Sync route connection boundary](../../../tests/meta-connect-w2-leads-sync-route.test.ts) and [shared-Page filter](../../../tests/core/lead-sync-shared-page.test.ts)
- [Erase and tombstones](../../../tests/lead-erase-route.test.ts)
- [First reply](../../../tests/first-reply.test.ts) and [reply choices](../../../tests/reply-choices.test.ts)

## More

- [Lead import and follow-up](../../../docs/architecture/channels/meta-connect.md#lead-import-and-follow-up)
- [Leads data model](../../../docs/architecture/data-model-access.md#leads-limits-and-evidence)
- [Sync, results and leads (product)](../../../docs/product/manage.md#sync-results-and-leads)
- [Leads API](../../../docs/api/leads-and-settings.md#sync-insights-leads-and-settings)
