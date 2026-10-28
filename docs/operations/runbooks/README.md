# Runbooks

Part of [Operations](../README.md). One page per incident type or hand-over; the symptom table below says where to start.

## Pages

- [Creative generation](creative-generation.md): reconciliation and regeneration claims
- [Campaign creation](campaigns.md): reconciliation and the worker rollout
- [Activation funnel](activation-funnel.md)
- [Pilots](pilots.md): setup call and day-7 answers
- [Prospect account hand-over](prospect-handover.md)

## Incident Playbooks

| Symptom | Inspect | Recovery / avoid |
| --- | --- | --- |
| Sign-in or redirect failure | Supabase availability, configured site/callback URLs, browser cookie state, safe redirect policy | Retry intended method; use local path destinations, never bypass authentication |
| Workspace stays loading or shows an error | In a visible session, compare the request and streamed response with Supabase auth and business-read failures; a fallback HTTP 200 alone is not a completed workspace | Use Try again to refetch the failed segment, or Sign in if the session expired. Check auth and business-read availability before treating an empty workspace as a first run; do not reset saved state or bypass the route guard |
| Brand autofill fails | URL validation, public DNS/fetch reachability, provider availability | Enter fields manually; do not disable SSRF protection or overwrite concurrent edits |
| Generation fails before starting | Ownership, monthly aggregate RPC, receipt column, references, keys/model, rate limit | Repair verified configuration/schema; do not disable quota because usage is unknown |
| Browser loses generation result | GET recovery by business/generation UUID and expected count | Recover saved rows first; a generation UUID now fences replay and unknown paid outcomes |
| Partial generation | Saved count and per-variant failures | Keep successes, review before a deliberate additional paid request |
| Image/composition failure | Provider/reference compatibility, bounded raster validation, upload/render stage | No silent raw-photo substitution; uploaded sources may need later cleanup |
| Draft conflict/expiry | Latest version, expiry, operation linkage | Reload/review; expired draft requires new intent, not an expiry extension hack |
| Create times out | Original idempotency key, operation phase/lease/external IDs | Poll/lookup first; never choose a new key to evade uncertainty |
| `needs_reconciliation` | Checkpoint IDs, local campaign, correct bound Meta account/Page | Authorized operator reconciles actual objects; preserve evidence, no blind recreate/delete |
| Activation blocked | Current capability, generation/digest, binding, form/budget/spend evidence | Recheck and re-review; never relabel a different campaign to fit the connection |
| Sync incomplete | Cursor, skipped count, account/Page binding, status, save error | Continue pages or retry failed page; do not prune local rows based on one page |
| Refresh result cannot be saved | `campaign_results` persistence and request logs | 503 before summary/enforcement; inspect the saved row before retrying, and verify delivery in Meta |
| Spend protection unconfirmed | Refresh `protectionConfirmed:false` or cron `ok:false`, stored binding, provider insight period/currency, remote/local pause state | Confirm the campaign status in the original Meta account; repair reporting/connection/storage before retry. Do not read an empty `autoPaused`/`swept` as a safe spend total |
| Leads partly sync | `failedForms`, newly inserted count, `sync.hasMore`, reload result | Keep saved rows and retry failed forms after a permission fix; `sync.hasMore` means the import is incomplete. Repeated IDs are ignored, not counted as new leads |
| Disconnect fails | Explicit business UUID, owner check, RPC/schema availability | Keep existing UI state until confirmed; disconnect is not an emergency pause |
| Telemetry missing | Enable flags, applied migration, hosting logs, retention, request cap | Events are best effort; a missing event does not prove no action occurred |
