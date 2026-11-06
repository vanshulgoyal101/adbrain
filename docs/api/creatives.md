# Creatives API

Brand autofill, the interview, generation, editing and export. Conventions, response families and recovery identities: [API reference](README.md).

## Routes

`Envelope` means the typed family in [Response Families](README.md#response-families); `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| POST | `/api/brand/autofill` | `{url}` or (#1317) `{text}`: an Instagram bio, Google listing or catalogue text pasted by hand (30+ letters, ≤ 6000 chars; nothing fetched, phone read from the text). URL -> plain extraction; `name` (#1379) comes from the page's `og:site_name`/title or the text's first words, never the model | Website fetch + model call, no brand save |
| POST | `/api/creatives/assistant` | Interview -> question/brief | Model call |
| POST | `/api/creatives/generate` | Generation input -> saved variants/failures | Paid work + Storage/DB |
| GET | `/api/creatives/generate` | Business/group/count -> saved status | DB lookup/unknown-ID fence, no generation |
| POST | `/api/creatives/[id]/regenerate` | No body -> `{creative}` | Paid work, overwrite, reset approval |
| POST | `/api/creatives/[id]/picture` | `{headline,subhead,phone,ctaLabel,showCta?}` -> `{creative,liveNotice?}` | Re-renders the overlay, no AI; new `image_url`, status kept. `showCta` paints the button on the picture (off for new ads, #760); omitted keeps it as is |
| POST | `/api/creatives/[id]/background` | `{instruction}` (3-300) or `{photoUrl,fit?}` -> `{creative,liveNotice?}` | Paid image (like Regenerate) or the owner's Brand photo (free), same claim; keeps copy, overlay words and status |
| GET | `/api/creatives/[id]/photo-fit` | `?photo=<Brand photo URL>&fit=attention\|blur&shape=ad\|square` -> PNG | Preview of how a Brand photo fits the ad's frame or 1:1 (#1904); no AI, nothing saved |
| POST | `/api/creatives/export` | IDs -> ZIP; each picture is a JPEG, transparency on white (#1897); a sales prospect's account (internal `+prospect` address, #1317) gets `00-sample-note.png` first (#1471), every picture with a 'Sample ad: not live yet' pill in its bottom-left corner, and the note's sentence atop copy.txt, which ends with the WhatsApp follow-up and `/for/<segment>` link when the Brand category is solar, IELTS/study-abroad or interiors (#1582); a picture that can't be marked is left out (`X-Images-Skipped`) | Downloads selected media |
| POST | `/api/media/sign` | `{businessId,mime,bytes,sha256,width,height,durationMs?,name?}` -> `{ok,duplicate:false,id,bucket,path,token,fit}` or `{ok,duplicate:true,asset}` (#1209; videos #748). Checks the owner's confirmation of the current rights terms (#784: #1248's `hasCurrentMediaConsent`, with the people clause where the business needs it; **409** `MEDIA_RIGHTS_REQUIRED` until then; this route never writes consent), JPEG/PNG/WebP (**415**), ≤ 8 MB (**413**), ≥ 600 px short side (**422**), 50 uploads a month (**429**; the database's insert trigger holds it under parallel requests), duplicate sha256. With `MEDIA_VIDEO_ENABLED`, MP4/MOV with `durationMs`: ≤ 50 MB (**413** says how many seconds to trim to, or to save a smaller copy when even 5 seconds would be over), ≤ 60 s (**422** `MEDIA_TOO_LONG`), 3 videos a month counted apart from photos (**429** says when more come); these refusals happen before any row exists, so they don't use one up. Inserts a `pending` row (a retry of a pending row gets a new path; upload tokens can't overwrite, `upsert: false`); the browser uploads with `uploadToSignedUrl` to the returned `bucket`. **404** while `MEDIA_UPLOADS_ENABLED` is off | Service-role row + signed upload URL on the private `media` bucket (videos: `media-video`); no bytes through Vercel |
| POST | `/api/media/finalize` | `{id}` -> `{ok,asset}` (#1209). A video (#748) is checked from its MP4/MOV boxes (`src/lib/media/mp4.ts`: container, length, size shown after rotation), kept un-re-encoded with its `udta`/`meta`/XMP boxes blanked in place (location, device), and copied to a fresh path; a photo: downloads the stored object, checks size, sha256, real type and pixel size (sharp), re-encodes server-side without EXIF/XMP/IPTC (GPS, camera, times; orientation applied) and records the stored object's hash (`checks.storedSha256`, re-checked by `readVerifiedMedia` before any use), sets `ready` with its fit; on a mismatch deletes the object and row (**413/415/422**); **409** `MEDIA_NOT_UPLOADED` when the object isn't there yet | RLS read proves the owner; service-role write |
| GET | `/api/media?businessId=&before=` | -> `{ok,items:[{id,kind,name,tags,width,height,bytes,durationMs,fit,url,createdAt}],next,uploads:{used,limit,videos:{enabled,used,limit,maxSeconds,maxBytes}}}` (#1209, #748): the owner's ready photos and videos, newest first, 30 a page, each with a 1 h signed URL | RLS reads; signed URLs |
| PATCH/DELETE | `/api/media/[id]` | PATCH `{name?,tags?}` -> `{ok,asset}`; DELETE -> `{ok}`: removes the object, then soft-deletes the row; **409** `MEDIA_IN_USE` with the campaign's name while a running campaign uses an ad made from it (#1209, #778) | RLS read, service-role write and object delete |
| POST | `/api/media/[id]/meta` | `{retry?}` -> `{ok,status:"ready",kind:"image",imageHash}`, `{ok,status:"ready",kind:"video",videoId,width,height,lengthMs,instagramEligible}`, `{ok,status:"processing",kind:"video",videoId}` (call again to poll, about every 5 s) or `{ok,status:"error",kind,problem:{kind,message}}` (#749). Sends the owner's ready file to the business's own connected ad account once per account (`ensureMetaMedia`, `media_meta_uploads`); a video is claimed before its `advideos` POST so it is never sent twice; `retry` re-sends only a video that ended in `error`, after checking Meta doesn't have it. **404** `MEDIA_NOT_FOUND` (not theirs, or `MEDIA_UPLOADS_ENABLED` off), **409** `MEDIA_NOT_UPLOADED` / `META_NOT_CONNECTED`, **403** `META_READ_ONLY` (the pause-only smoke account; nothing sent); 300 calls per 10 min per owner. Never creates an ad or spends | RLS read proves the owner; service-role row; Meta `adimages`/`advideos` on the business's `MetaClient` (`sendOwnMediaToMeta`) |
| POST | `/api/media/consent` | `{businessId,rights,people?}` -> `{ok}` (#778 slice 3b, #784): the upload sheet and Review's "Confirm your rights" card (`/assets?confirm=rights`) save the owner's rights tick through `media_consent_record` (owner's own client; the RPC re-checks ownership). **400** with the reason when unticked or the people clause is missing (clinics, salons, coaching), **404** for another owner's business (works with `MEDIA_UPLOADS_ENABLED` off), **503** when it can't be saved | Appends to `media_consents` |

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
the 45 s deadline), it returns `503 {error, code: "AI_BUSY"}` with `Retry-After: 10`.
Gemini gets at most 25 s of that, so a hanging Gemini still leaves the paid fallback time (#2249);
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
| `mediaIds` | Optional 1-3 UUIDs of the Brand's ready library photos (#780; any video ID is rejected with **415** `MEDIA_KIND_UNSUPPORTED` before batch admission; 404 while `MEDIA_UPLOADS_ENABLED` is off or for another Brand's photo, 409 for one not ready, 503 when it can't be read; all checked before the batch is admitted). Each ad uses one photo, and its words are written from the photo's saved description (one paid vision call the first time); the saved ad gets `media_asset_id` and its receipt `ownerPhotoUrl: media:<id>`, never the signed link. The library's **Make ads from these (N)** opens `/create?all=1&photos=<ids>`; Create shows photos (removable until the ads are being made), identifies selected videos as unsupported, and sends only photos here |

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
429/`LLM_MONTHLY_QUOTA_EXCEEDED`. While another batch for the business is still
making its first ad (under 5 minutes), a new id returns 409/`CREATE_RUNNING` with
that batch's `variantGroup` and `expectedCount`, so the caller follows it instead
of paying for a second (#1402). Generation/regeneration declare a 300-second
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

Recovery uses `GET /api/creatives/generate?businessId=...&generationId=...&expectedCount=3`
(150 reads per 5 minutes per owner across all tabs, 429 with `Retry-After` beyond; #2553).
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
A picture that failed on a free provider (Pollinations, Cloudflare) or that the provider
refused, after copy whose attempts all finished and were receipted, also releases it
with a 502 retry message (#2219). After the
[stale-claim migration](../../db/migrations/20261029_creative_regeneration_stale_claims.sql),
a `processing` claim untouched for 15 minutes (a request killed past the 300-second
limit or by a deploy) is taken over by the next attempt; `unresolved` never is.
A takeover writes a `creative.claim_taken_over` audit row (`details: {route, attemptId}`, #2291),
because the killed attempt may have paid for a picture it never recorded.
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
and `backgroundInstruction`. If every attempt was a free picture or the provider
confirmed it failed, the claim is released with a retry message, so a Pollinations
timeout never locks the ad (#2219). Any other paid failure (OpenRouter reports
`unknown`) holds the claim as `unresolved` with a 502, exactly like Regenerate.
With `{photoUrl}` instead, the URL must be one of the business's `product_photo`
Brand assets (else 400 before the claim). There is no image call, no usage row and
no monthly-limit check; the photo is copied through the guarded downloader, the
receipt records `ownerPhoto`, and a failure releases the claim. `fit` (#1904) is how
the photo meets the frame: `attention` (default, a saliency crop that keeps faces) or
`blur` (the whole photo over a soft copy of itself). It is saved as
`design.backgroundFit` and used by every later render of the ad (words, 9:16); a new
AI background clears it. `GET /api/creatives/[id]/photo-fit` draws the same fit at
preview size (520 px wide for the ad's frame, 96 px for `shape=square`) for the
"Check how your photo fits" sheet: same Brand-photo check, own rate limit (120 per
5 minutes), private one-hour cache.
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
