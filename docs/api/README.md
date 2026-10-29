
# API and Mutation Reference

This is the current application API, not a versioned public integration service.
Paths are relative to the configured app origin. Examples use synthetic IDs;
replace them only in an authorized isolated environment. Source: [route handlers](../../src/app/api),
[campaign schemas](../../src/lib/campaign/connect-contracts.ts),
[connection schemas](../../src/lib/meta/connect-contracts.ts).

## Conventions

- Workspace endpoints normally require the Supabase session cookie and enforce
  business ownership. There is no general application API-key authentication.
- `id` in a URL is usually an **AdBrain database ID**, not a Meta ID. Provider IDs
  remain strings. `businessId` is the application UUID; ad account IDs use `act_`.
- JSON requests use `Content-Type: application/json`. Do not stringify numbers or
  booleans; query strings are parsed separately. Strict schemas reject unknown
  fields where noted. Not every older route uses a strict schema.
- Money is whole INR rupees at the application boundary unless specified. Budget
  estimates are not invoices or guaranteed spend.
- HTTP 200 alone does not prove a business operation completed. Inspect `ready`,
  blockers, partial failures, and operation state.
- Retain request IDs for diagnosis, never tokens/cookies or sensitive bodies.
  Instrumented routes expose `X-Request-Id` where the response is mutable.

### Response Families

Connection, draft, preflight, and creation-operation APIs use a typed envelope:

```json
{
  "ok": false,
  "error": {
    "code": "CONFLICT",
    "message": "Draft changed in another tab. Reload before saving.",
    "retryable": true
  },
  "requestId": "00000000-0000-4000-8000-000000000001"
}
```

Success is `{ "ok": true, "data": <documented value>, "requestId": <UUID> }`.
Older APIs use plain objects, often `{error: string}` on failure. ZIP/Markdown
routes return files. Events can return an empty body. Do not apply one parser to
every endpoint. A `retryable` error can still require re-reading state before retry.

Common statuses: 400 invalid/blocked input, 401 unauthenticated, 403 forbidden,
404 unavailable owner-scoped resource, 409 stale/recovery conflict, 410 retired,
422 semantic input rejection, 429 quota/rate limit, 502 provider failure, 503
dependency unavailable. Exact mapping is route-specific; some legacy ownership
failures use 400. A 404 does not reveal another tenant's existence.

### Recovery Identities

| Value | Scope and correct recovery |
| --- | --- |
| Generation UUID | Claims one generation request; GET it before considering another paid POST |
| Draft ID/version | Versioned saved input; reload on conflict, save, then review again |
| `planHash` | Server review of current inputs, creatives and verified binding; never synthesize it |
| Connection generation | Invalidates stale binding-dependent work after the connection changes |
| Attempt revision | Optimistic concurrency for one consent/discovery attempt, not a campaign version |
| Creation `idempotencyKey` | Durable operation identity; keep it across ambiguous create responses |
| Activation digest | Confirms current activation inputs; not a creation key or spend reservation |
| Lead `syncId` | Resumes one lead import run under the same connection binding |
| Payment `idempotencyKey` | Reuse for the same live or test order after an unknown create result |
| Cursor | Continues only its own list or provider scan; campaign list, Meta discovery and enquiry cursors are not interchangeable |

A mutation timeout is ambiguous. Inspect persisted/provider evidence using the
same identity; do not change a key or clear local recovery data to force progress.

## Route Inventory

| Page | Routes |
| --- | --- |
| [Creatives](creatives.md) | `/api/brand/*`, `/api/creatives/*` |
| [Campaigns](campaigns.md) | `/api/campaign-drafts/*`, `/api/campaigns/*` (except enquiries) |
| [Leads, results and settings](leads-and-settings.md) | `/api/leads/*`, campaign enquiries, `/api/spend-limits`, `/api/preferences`, `/api/privacy-requests/*` |
| [Meta connection](meta.md) | `/api/meta/*`, `/api/managed/*`, `/api/whatsapp/webhook` |
| [Payments](payments.md) | `/api/payments/*` |
| [Authentication](auth.md) | `/api/auth/*`, `/auth/*` |
| [Jobs and telemetry](jobs-and-telemetry.md) | `/api/cron/*`, `/api/internal/*`, `/api/events`, `/api/feedback/*`, `/api/meta/access-request` |

Each page starts with its routes table. A new route gets exactly one row, on the page for its path (`npm run docs:check` enforces this).

## Rate Limits and Timeouts

| Route family | Per-user request limit |
| --- | --- |
| Autofill | 15 / 5 minutes |
| Interview | 40 / 5 minutes |
| Generation | 20 / 5 minutes |
| Regeneration | 30 / 5 minutes |
| Planner | 40 / 5 minutes |
| ZIP export | 10 / 5 minutes |
| Internal traffic | 10 / 10 minutes |
| Client events | 60 / minute |
| Customer balance reads | 60 / minute |
| Customer accounting evidence | 20 / 5 minutes |
| Test order creation | 10 / 5 minutes |
| Test order read / verification | 60 / 5 minutes, per action |

Shared DB enforcement returns 429/Retry-After for saturation and fails closed in
production if unavailable. These are not blanket limits on every route. Quota
checks and provider deadlines are separate. A timeout on a mutation is an
ambiguous result, not authorization to repeat it.

## Server Actions and Direct Persistence

These are React/Next server actions, not stable manually callable REST endpoints:

| Action | Input / behavior |
| --- | --- |
| `saveBusiness` | FormData with optional `id`, required `name`, profile/contact/brand fields; newline-delimited languages, locations, USPs, offers; owner comes from session |
| `saveInstruction` | Optional `id`; `businessId,title,content,isActive`; nonempty trimmed title; update scoped to business |
| `deleteInstruction` | `id,businessId`; affected-row confirmation required |
| `setCreativeStatus` | `id`, `draft` or `approved`; affected-row confirmation required |
| `updateCreativeCopy` | `id`, `{headline,primary_text,description,cta}` with Create's limits (description may be empty); no AI call, status unchanged; description saved in `generation.concept.description`; returns `warnings` (claims the Brand doesn't back, never blocking), the saved fields and `liveNotice` when the ad is in a launched campaign |
| `deleteCreative` | `id`; local record deletion, not remote-ad deletion |

Actions return `{ok:boolean,error?:string}` and revalidate relevant pages.
Brand field validation lives in [validation](../../src/lib/brand/validation.ts);
list parsing preserves commas in place names. Asset upload/delete and selection
also use browser Supabase/Storage APIs under RLS; see [Data Model](../DATA_MODEL.md).
Do not document an invented upload REST route.
