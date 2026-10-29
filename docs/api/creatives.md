# Creatives API

Brand autofill, the interview, generation, editing and export. Conventions, response families and recovery identities: [API reference](README.md).

## Routes

`Envelope` means the typed family in [Response Families](README.md#response-families); `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| POST | `/api/brand/autofill` | `{url}` or (#1317) `{text}`: an Instagram bio, Google listing or catalogue text pasted by hand (30+ letters, ≤ 6000 chars; nothing fetched, phone read from the text). URL -> plain extraction; `name` (#1379) comes from the page's `og:site_name`/title or the text's first words, never the model | Website fetch + model call, no brand save |
| POST | `/api/creatives/assistant` | Interview -> question/brief | Model call |
| POST | `/api/creatives/generate` | Generation input -> saved variants/failures | Paid work + Storage/DB. 402 `{code:"PLAN_UNPAID"}` before any AI call when an own-account ₹999 plan is unpaid (#718; fails open) |
| GET | `/api/creatives/generate` | Business/group/count -> saved status | DB lookup/unknown-ID fence, no generation |
| POST | `/api/creatives/[id]/regenerate` | No body -> `{creative}` | Paid work, overwrite, reset approval; 402 `PLAN_UNPAID` before paid work when the own-account plan is unpaid (#718) |
| POST | `/api/creatives/[id]/picture` | `{headline,subhead,phone,ctaLabel,showCta?}` -> `{creative,liveNotice?}` | Re-renders the overlay, no AI; new `image_url`, status kept. `showCta` paints the button on the picture (off for new ads, #760); omitted keeps it as is |
| POST | `/api/creatives/[id]/background` | `{instruction}` (3-300) or `{photoUrl}` -> `{creative,liveNotice?}` | Paid image (like Regenerate) or the owner's Brand photo (free), same claim; keeps copy, overlay words and status. An unpaid own-account plan returns 402 `PLAN_UNPAID` for a paid image; a saved Brand photo remains available (#718) |
| POST | `/api/creatives/export` | IDs -> ZIP; a sales prospect's account (internal `+prospect` address, #1317) gets `00-sample-note.png` first (#1471), every picture with a 'Sample ad: not live yet' pill in its bottom-left corner, and the note's sentence atop copy.txt, which ends with the WhatsApp follow-up and `/for/<segment>` link when the Brand category is solar, IELTS/study-abroad or interiors (#1582); a picture that can't be marked is left out (`X-Images-Skipped`) | Downloads selected media |

## Creative Requests

### Website Autofill

`POST /api/brand/autofill`: `{url: string, businessId?: uuid}`; trimmed length 1-2048, or (#1317) `{text: string, businessId?: uuid}` with text pasted by hand (an Instagram bio, a Google listing; at least 30 letters, read up to 6000 characters, never fetched; 400 'Paste a little more…' when too short). Public URL
policy and redirect/DNS checks apply. Returns `{extraction}` with suggested brand
fields; the caller must review and save separately. Blocked URL: 400; fetch/model
failure: 502; no readable text: 422. Extraction is a model result, not a factual
verification. `extraction.locations` (#1037): up to 5 service areas the page itself names (never a
country or a compass region like "North India"); with a Meta connection, only ones Meta's location
resolver can place. `extraction.phone` comes only from the page's first `tel:` link in
international `+` format (never from the model). Website fetch deadline is 10 seconds; route duration setting is 30.
Every provider attempt (and a response-cache hit, as a zero-token row) is logged as usage with
route `brand.autofill` on `businessId` when the owner's session can read that business; on
first Brand setup there is no business yet, so only the `ai.completion` product event is kept (#650). Each
autofill the owner waited for (not 400/401/429) also records a `brand.autofill` workflow event with its
outcome and whole-request duration, which the #681 scoreboard Brand row counts (calls, failed, p90; #1025).

### Interview

`POST /api/creatives/assistant` uses a strict object:

| Field | Contract |
| --- | --- |
| `businessId` | Trimmed nonempty string, maximum 100; owner-scoped lookup |
| `goal` | Trimmed 1-2000 characters |
| `answers` | Default `[]`, at most 12 records for history compatibility |
| `answers[].question` | Trimmed 1-300 characters |
| `answers[].answer` | Trimmed 1-1000 characters |
| `answers[].questionId` | Optional trimmed 1-80 characters |
| `answers[].field` | Optional `objective`, `audience`, `offer`, `visual`, `tone`, `language`, `location`, `constraints` |
| `answers[].options` | Optional at most 6 strings, each 1-160 characters |
| `recentGoals` | Default `[]`, at most 6 strings, each 1-500 characters |
| `referenceBrief` | Optional trimmed 1-2000 characters for follow-up context |

The interview asks no more than three new decisions, despite accepting longer
historical input. Returns either `{ready:false, question, promptVersion}` or
`{ready:true, brief, language?, angleId?, recommendations?, promptVersion}`.
Questions carry `id`, `field`, `question`, optional help, options and input flags.
When no AI provider answers because of load (rate limits, provider 5xx, timeouts or
the 45 s deadline), it returns `503 {error, code: "AI_BUSY"}` with `Retry-After: 10`;
the page shows the message with a one-tap Try again (#410). A refused key or request
(401, 403, 400, such as a key over its spending limit, #449) stays a 500 so it alerts.
Optional recommendations contain 2-3 distinct `{label,prompt}` records.
Invalid/repetitive output receives at most one repair within a shared 45-second
deadline, then fails; it does not silently proceed to generation.

Example interview input for a synthetic business:

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "goal": "Promote our saved rooftop survey offer to homeowners in Jaipur",
  "answers": [],
  "recentGoals": []
}
```

### Generate and Recover

`POST /api/creatives/generate`:

| Field | Contract |
| --- | --- |
| `businessId` | Trimmed nonempty string; owner-scoped lookup |
| `brief` | Trimmed 1-2000 characters |
| `count` | Integer 1-6, default 3 |
| `generationId` | Optional UUID; use a client-known UUID before the first POST |
| `language` | Optional string normalized through language helpers |
| `sourceFacts` | Optional array of up to 12 explicit user-authored facts, each up to 2000 characters (6000 combined); never copy an AI-generated brief or advisory preferences here |
| `format` | `portrait` (default), `square`, `story`, `landscape` |

Example paid-generation input, submitted after the owner starts Create (after the brief review, or straight from any goal on a complete Brand, #858/#1004):

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "brief": "Invite Jaipur homeowners to enquire about our saved rooftop survey offer. Use only verified brand facts and contact details.",
  "sourceFacts": ["We offer rooftop surveys in Jaipur."],
  "count": 3,
  "generationId": "22222222-2222-4222-8222-222222222222",
  "language": "en",
  "format": "portrait"
}
```

Returns `{variantGroup, creatives, failures}`. Individual saved variants survive
other failures. If none save, returns 502 with an error/failure list. Missing
generation schema or unavailable admission blocks before work with 503.
No configured text keys can return 400/`NO_LLM_KEYS`; exceeded quota returns
429/`LLM_MONTHLY_QUOTA_EXCEEDED`. Generation/regeneration declare a 300-second
route duration; host execution limits still apply.

Live progress (Create): send `Accept: application/x-ndjson`. A request rejected
before admission still gets its normal JSON status. After admission the route
answers 200 `application/x-ndjson`, one JSON object per line:
`{type:"progress", angleId, angleName, stage, at}` (stage `queued`, `writing`,
`checking`, `fixing`, `image`, `ready` or `failed`; angles run concurrently; an
`image` line with `slowPictures: true` means that ad's picture fell back to the slower
free provider, and the page says "Pictures are taking longer today", #1542),
`{type:"creative", angleId, creative}` once that ad is saved (before its
`ready`), and last `{type:"result", status, body}` carrying the status and body
the JSON mode would have returned. A blank line arrives every 15 s as a
heartbeat; skip it. A stream that ends without `result`, or that goes silent
(the page allows 60 s once it has seen a heartbeat, else 330 s), must be
treated as unconfirmed and recovered with the GET below.

POST atomically claims the
generation UUID and normalized request inputs before paid work. Repeating the
same ID returns 202 with `{variantGroup, status, creatives: [], count: 0,
expectedCount}` and never starts another producer. A changed brief, count,
language, format or nonempty `sourceFacts` for that ID returns 409; another business
or owner gets 404. Omitting `sourceFacts` keeps the prior hash format for existing
requests. The validator uses Brand facts, saved instructions and `sourceFacts` as
quote evidence, not the potentially model-derived `brief`. Studio submits its
directly authored brief as user evidence; Create submits the original goal and
free-text answers, excluding model-suggested options and the generated brief.
The accepted facts are stored in the generation receipt for regeneration. Existing
creatives without that field regenerate with no separate user-fact evidence.
The route reserves monthly quota for text and images, counts recorded tokens,
and retains an allowance of 10,000 quota units per completed image. This is
**not** measured image billing or a USD spend limit: image usage may lack a known
cost. Uncertain provider, usage or result writes retain their reservation until
an operator can reconcile them. A definitive whole-request pre-provider failure
can free unused quota after the batch has settled; one failed angle cannot free
its still-running siblings' hold. The failed UUID remains non-reusable. Omitted `generationId` gets
a new server UUID and cannot be replayed safely after a lost response.

Recovery uses `GET /api/creatives/generate?businessId=...&generationId=...&expectedCount=3`.
`generationId` must be UUID; optional `expectedCount` is integer 1-6 and, if
provided, must match the claimed count (409 otherwise). The source candidate
returns `{status, creatives, count, expectedCount}` based on the persisted
intent and saved rows. Status may be `processing`, `partial`, `complete`,
`failed`, `unresolved` (including stale processing after five minutes) or `ended`
(#1407: the batch finished short, as its closing `creatives.generate` audit row shows;
no more ads are coming).
Unknown/foreign ID returns 404; unavailable status or row lookup returns 503.
An owner lookup returning 404 permanently fences that UUID with a zero-quota
no-spend record; a delayed original POST cannot start generation afterward.
Recovery lookups are limited to 30 per user per five minutes (429 when exceeded).
`processing` does not prove a worker is running. Inspect saved results after a
timeout; `unresolved` requires investigation, not another paid request.

`POST /api/creatives/[id]/regenerate` has no request body. It uses saved generation
settings and current business context, replaces the creative, and sets `draft`.
After the [regeneration claims migration](../../db/migrations/20261001_creative_regeneration_claims.sql)
is applied, the server claims the owned creative before paid work. A concurrent
attempt or unresolved previous attempt returns 409 without another provider call;
unavailable admission returns 503 before paid work. A confirmed save or pre-provider
failure releases the claim. So does a fact-check rejection whose text attempts all
completed and were receipted: it returns 422 with a plain message naming any
uncited claim (for example "10%, free"), and the creative is unchanged (#281).
An uncertain paid failure returns 502 and retains the claim for operator review.

`POST /api/creatives/[id]/picture` redraws the words printed on the picture
(headline up to 40, offer line up to 64, phone, a Meta button label) over the
ad's stored background, with no AI call (#280). It uses the saved `design` spec,
or rebuilds one from the Brand for older ads. The background is `generation.photoUrl`,
or for older ads the newest `<angle>-<uuid>` file stored no later than the finished
picture in the ad's folder. If neither exists it returns 409 `no_background`.
The new picture gets a new versioned path; status is unchanged. It returns 409
when overlays are off or the ad is image-only, and rate-limits at 30 per 5 minutes.
With `preview: true` in the body it only renders the words for the editor's live
preview (#387) and returns `{previewUrl}` (a 720 px WebP data URL): no upload, no row
update, no audit event, own rate limit (120 per 5 minutes).

`POST /api/creatives/[id]/background` makes one new background image from the
owner's short description (the owner's direction wins over the ad's earlier visual
direction) and redraws the same overlay words on it (#280). It shares Regenerate's
rate limit, monthly AI limit and `creative_regeneration_claim`, so only one paid job
runs per ad. Usage is recorded as `creatives.background`. The copy, overlay words
and status are kept; the receipt gets the new `photoUrl`, `imagePrompt`, image usage
and `backgroundInstruction`. If the provider confirms every attempt failed, the claim
is released with a retry message. Any other failure (OpenRouter reports `unknown`)
holds the claim as `unresolved` with a 502, exactly like Regenerate.
With `{photoUrl}` instead, the URL must be one of the business's `product_photo`
Brand assets (else 400 before the claim). There is no image call, no usage row and
no monthly-limit check; the photo is copied through the guarded downloader, the
receipt records `ownerPhoto`, and a failure releases the claim.
The claim's attempt UUID is the request ID in usage receipts. It does not expire
automatically, and there is no customer-facing regeneration recovery endpoint.

### Export

`POST /api/creatives/export`: `{creativeIds: UUID[]}`, 1-50 entries before
deduplication. All distinct selections must be accessible (404 otherwise); DB
lookup failure is 503. Approved status is not a route requirement.

Downloads are sequential, capped at 40 MiB aggregate accepted image bytes and a
45-second shared deadline. ZIP includes `copy.txt`; missing/invalid/over-limit
images are skipped with an explanatory note. Header `X-Images-Skipped` gives the
count; filename is `adbrain-ad-pack.zip`. No raw HTML is accepted as an image.
