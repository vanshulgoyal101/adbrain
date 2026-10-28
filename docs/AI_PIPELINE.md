# AI and Creative Pipeline

This guide describes model calls, image processing, retries, and accounting.
Parameters are in [Configuration](CONFIGURATION.md) and [API Reference](api/README.md).
Design history lives in git history; it does not override current code.

## Task Boundaries

| Task | Entry / main implementation | Result |
| --- | --- | --- |
| Website extraction | [autofill route](../src/app/api/brand/autofill/route.ts), template builders | Proposed brand fields, not an automatic save |
| Creative interview | [interview](../src/lib/creative/interview.ts) | Next question or editable brief |
| Creative generation | [generate](../src/lib/creative/generate.ts), [concept](../src/lib/creative/concept.ts) | Validated concept/copy, image, design spec |
| Campaign planning | [planner](../src/lib/campaign/planner.ts), [draft conversion](../src/lib/campaign/planner-draft.ts) | Reviewed draft or audience proposal, not direct publication |
| Results summary | [summary](../src/lib/creative/summary.ts) | Plain-language interpretation of supplied metrics |

## Interview

Saved brand facts, active instructions, goal, answer history, recent goals, and
optional reference brief form the context. The interviewer can finish with zero
questions and may ask at most three new decisions. Field/ID/history checks reject
repeated decisions and recycled options. Structured output and commercial-claim
checks prevent some unsupported terms, not all misleading claims in every language.
When declared preferences are enabled, a bounded advisory note may guide style,
but wording copied only from that note cannot establish a factual brief. The
interview checks positive support in current owner answers or factual Brand fields;
negated requests, Brand voice and model-derived reference briefs are not factual
support. This check cannot recognize every paraphrase, so generation must also
keep the generated brief separate from verified claim evidence.

There is one repair opportunity, sharing a 45-second deadline and request
cancellation. Accepted brief length is at most 2000 characters. Follow-up
recommendations are optional; the user reviews the next brief before generating.
An interview response does not itself produce paid image variants.
Options that mean "I'll type my own" (custom, other, type below) are dropped and the
text box is kept. An answer that adds no fact (such a chip, skip, not sure) does not
count as a repeat, so the question can be asked again. A currency amount such as
"₹10,000" is supported by "10,000 rupees" or "Rs 10000" in a source (#284).
Options on an `offer` question are proposals the owner picks or rejects, so they skip the
commercial-claim check; the AI can't pick one for the owner (`allowRandom` and
`aiCanDecide` are off). When the repair still states an unsupported term and that is
the only failure, the sentences, recommendations or options with the term are dropped
and the result is re-checked; it is returned only if every check passes and the brief
keeps at least 40 characters (#613).
Past results (#371): when the business has a campaign with stored results from the last
60 days and spend above zero, the interview gets a `PAST RESULTS` block after the
reference brief (the cheapest campaign per result and the weakest, built in
`src/lib/campaign/result-evidence.ts`) and one system rule: use them only for angle, hook
and format; offers and claims still need a Brand fact. An ad is credited only when its
campaign ran one ad. The wording is fixed in code: under 5 results "early: based on N
chats", 5–19 "so far", 20+ plain, none "₹X spent, no chats yet". Without results the
prompt is unchanged. The concept fact check never sees past results.
Failed attempts log rule names only (`metadata.validationRules`, for example
`unsupported-commercial-claim`, `repeated-question`, `schema:<path>`). The interview
adds the term's class, never the term: `unsupported-commercial-claim:free`, `:percent`,
`:currency` or `:guarantee` (#613). A Brand fact supports a term unless that term itself
is negated or withdrawn ("no free survey", "isn't free", "don't offer free", "Free survey no longer
offered"); a negation about something else ("Free survey, no obligation") doesn't count.
A subsidy line (`subsidy`, `PM Surya Ghar`, `सब्सिडी`, `ਸਬਸਿਡੀ`; class `:subsidy`, #1676) needs a Brand
fact that states it with no negated mention ("Not a subsidy vendor" refuses it); any such fact counts, quoted
or not. It is a claim, not an offer, so the above-the-fold offer rule ignores it.

### Campaign Interview

The campaign planner is a separate workflow from the creative interviewer above.
The September 29 source change uses `campaign-planner-v5` and keeps structured
`questionId`, `topic`, answer and `answered`/`deferred` disposition across turns.
Brand context and explicitly selected campaign settings are supplied with history.
Known single service areas/offers and manual settings do not need confirmation;
exclusions default empty unless requested, and the planner recommends creatives
and technical targeting rather than asking the owner for API IDs or ad jargon.
`campaign-planner-v6` (#686) asks for interests named the way Meta names them
(topics, hobbies, activities, life events), not professions, specialties or
symptoms. On production's Cedar Ridge facts this took plans with no Meta match from
1 in 5 to 0 in 5, and resolved interests from 30% to 84% (Solaride unchanged, 0 in 5).
Goal interpretation remains model-driven, including natural-language city/radius
requests; a prompt example is not a guarantee of correct interpretation.

Questions have a fixed topic enum. The server filters previously answered/deferred
topics, repeated IDs and normalized question text, deduplicates topics within the
response, and returns at most two useful questions per turn. After six supplied
decisions it permits one final plan attempt but no more questions. Missing or
repeated output gets at most one correction call under the same 45-second deadline;
transport/provider failures are not retried by this progress check. Each completed
attempt retains usage and validity metadata. The planner uses budget routing
(`LLM_BUDGET_PROVIDER_ORDER`) with a 20-second attempt deadline, because the
standard reasoning model needs 30-90 seconds per plan. For speed (#366, #668) it
sends `thinking: "off"`: a zero thinking budget on Gemini (5-second cap) and
`reasoning: {effort: "none"}` on OpenRouter. OpenRouter (production's Claude Haiku)
is tried right after the first budget provider (`nextProviders`), and on a short
429 the router tries it before waiting out the cooldown, coming back afterwards
(`fallbackBeforeRateLimitWait`). Recorded: Groq ~1 s, Haiku 3-5 s with reasoning
off (6-8 s and ~800 extra tokens with it on), Gemini 4-5 s or a timeout. Other
budget tasks still never use OpenRouter. Provider routing has its own
bounded fallback behavior; two planner attempts are not a guarantee of only two
physical provider requests.

A deferred budget/compliance decision without an explicit editor value stops for
manual completion; skipping is not permission to invent spending or compliance.
No-progress and question-limit responses contain an editor `handoff`, not another
question loop or fabricated plan. Guided UI persists submitted answers and the
handoff per business/destination in session storage, and offers the existing
campaign editor with a goal/answer summary capped at 2000 characters. The full
submitted transcript remains in that browser session; this is not a durable,
cross-device checkpoint. Transport failures retain the exact pending request for
explicit retry. A lost successful draft response still requires checking Saved
drafts before retry; this change does not add server-side planner idempotency.

Audience-only recommendations preserve an explicitly selected radius as well as
manual location/age settings. Both callers display the no-progress handoff without
creating a campaign. Preflight, approved-creative checks, ownership, special-category
restrictions, paused creation and explicit activation remain authoritative.
The `campaign.interview` workflow event records fixed no-progress/limit codes,
not conversation text. These are source claims, not deployed conversation results.
The `campaign.plan` event is `success` for a ready plan, `partial` when it falls
back (`PLAN_AUDIENCE_NO_META_INTERESTS`, questions, a failed interest lookup) and
`failed` otherwise; `count` and `failedCount` are the suggested and unresolved
interest counts, never the names (#686); `durationMs` is Prepare's end-to-end time (#821). A concept whose `visual.direction` shows an empty scene
(an empty or bare space, a reception or waiting room) with no person, team or product is
refused as `no-subject` before any image is paid for, and repaired once ([visual-rules.ts](../src/lib/creative/visual-rules.ts), #760). The `creative.batch` event carries the
batch's wall time (`durationMs`, from the request to the saved batch) and its image
path (`provider`: `cloudflare` or `pollinations` for internal accounts, `paid` for customers) and its
estimated AI cost (`costUsd`, `textCostUsd`, `imageCostUsd`; the scoreboard shows the median, #1468), so
Create speed is timed per path; usage rows are written when the batch ends and
can't time it (#681). When the first pass saves fewer ads than asked, one top-up
round remakes the angles whose concept or image failed (never "no provider" or every
provider down), in parallel and in the same request, through the same validators and
repair. It starts only if the first pass ended within 60 s and is cut off after 45 s
(`CREATE_TOP_UP_*` in [stream.ts](../src/lib/creative/stream.ts)); the stream sends
`{ type: "topUp", missing }`, the page says "Making N more…", and `creative.batch`
records `topUp`, the number of ads retried (#1123). On a `+prospect` account (a sales
visit, free pictures) an ad that lost only its picture is not remade: once the first pass
ends, it gets one more free picture with the words that already passed (no text call,
₹0), if at least 45 s remain before 250 s (`PROSPECT_PICTURE_RETRY_*`). The stream sends
`{ type: "topUp", missing, kind: "picture" }`, the page says "N pictures didn't come
through. Trying again…", and `creative.batch` records `pictureRetry` (#1547). A refused commercial claim in Create adds a
`claim:<class>:<reason>` validation rule to its usage row (class `free`/`percent`/
`currency`/`guarantee`; reason `uncited`, or `negated-quote` when a quote cited it but a
negation elsewhere in that quote refused it), never the term or the copy (#687).
Create also applies Meta ad-policy rules ([policy-rules.ts](../src/lib/creative/policy-rules.ts), #738),
repairing once like any other rule: `personal-attribute` (in health verticals, a question or
"your …" naming the reader's symptom or condition, or suggesting they neglected care; in any
vertical, a question about the reader's money trouble such as debt or a bill that "feels heavy"),
`unsupported-superlative` (#1, top-rated, leading, "Austin's best" unless a supplied fact says it)
and `exaggerated-result` ("up to N%": refused in health verticals even when a fact states it;
elsewhere allowed when a supplied fact states the same figure, refused when uncited; also, #941, a zero-cost
claim ("zero investment", "₹0 down payment"), a result-or-refund promise ("no band, no fee", "money-back") and a
timed result ("new teeth in days", "fluency in 30 days"), each refused unless a supplied fact states it, and a timed
result always refused in health verticals). Health verticals also ban implied
outcomes (lasting relief, eliminate, fix your, feel better…) and any guarantee, cited or not. Owner-typed
copy only gets these as warnings.

### Orchestration Reuse

Keep the existing pinned AI SDK Core (`ai` 7.0.116, Apache-2.0) and Zod structured
output behind the provider facade. It already owns model transport, schema output
and provider compatibility; the interview state/progress rules are AdBrain domain
logic. No new framework, dependency upgrade or paid provider is needed for this fix.

This follows [Anthropic's simple workflow guidance](https://www.anthropic.com/engineering/building-effective-agents)
and [AI SDK structured workflows/agent guidance](https://ai-sdk.dev/docs/agents/overview):
explicit state, bounded steps and a clear handoff instead of an unconstrained loop.
The [loop-control guide](https://ai-sdk.dev/docs/agents/loop-control) distinguishes
tool-loop agents from manually controlled structured workflows. Use ToolLoopAgent
when a real tool-selection loop becomes necessary, preserving current tenant,
usage, cancellation and provider-selection controls.

[LangGraph](https://docs.langchain.com/oss/javascript/langgraph/overview) is worth
considering for durable multi-session workflows, not as an automatic question-quality
fix. Its [interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
need a durable checkpointer, tenant-scoped thread identity and replay-safe effects;
adopting it would require persistence integration and migration, not merely a prompt
swap. A general coding harness is not a drop-in campaign runtime. Do not grant shell,
filesystem or unrestricted provider tools to solve a bounded interview problem.

Focused regressions live in the existing planner, campaign-chat and planner-route
suites, with one manual-audience handoff case. They reproduce lost IDs/deferrals,
paraphrased topic repetition, known-fact reuse, correction usage, cancellation,
question limits, reload recovery and radius preservation. Synthetic tests establish
these contracts, not a live-model quality score. Use real authorized conversation
feedback to assess unnecessary questions, abandonment and time to a useful draft.

## Variant Generation

1. Bound the context: brief 2000 characters, selected brand strings 1000 each,
    lists at most ten items, active instruction text at most 3000 characters.
    When enabled, read up to five relevant declared preferences for this owner
    and business; pass at most 1200 advisory characters separately to concept
    and image prompts. Current brief/instructions and Brand facts take priority.
2. Choose up to six configured marketing angles; default batch count is three.
3. For each angle, request a structured concept with caching disabled. First
   attempt temperature is 0.8; one repair attempt uses 0.4 and is told each
   failed check, with the actual length when text is too long (#281). Max output and
   reasoning effort are configured. Failed validation stops the variant.
   Before validation, cosmetic slips are normalized once:
   - Over-long `visual.medium`, `visual.direction` and rationale are clipped at a word. An over-long link
     description is cut back to its last full sentence ('Rs.', 'Dr.' and similar don't count), else its last clause
     if that keeps half the limit; with neither it fails and the repair rewrites it, never mid-thought (#1544).
   - Case and spacing variants of a CTA or `textPlacement` are mapped, and `left` becomes `center`.
   - An empty or over-long `supportingText` becomes null, and empty quotes are dropped.
   - A quote that differs from a fact only in case is stored as the fact's exact text.
   - A quote that only adds a leading "the", "a" or "an" to a fact (20+ characters after it) is
     stored as the fact's own words (#713).
   - A quote that matches no fact is dropped when at least one other quote does;
     claims are then checked against the remaining quotes, and a concept with no
     verbatim quote is still refused (#713).
   - Any primary-text line over 125 characters is split into sentence lines
     (words unchanged), because Meta shows about 125 characters on mobile before
     "See more" (#194, #713).

   Headline and primary text are never clipped, and every claim check still runs.
   In `visual.direction`, layout notes such as "55% of the frame height", "45%
   opacity" and "free of detail" are not read as offers (#202); a price, "20% off"
   or "FREE" shown in the visual still needs a supporting fact. A cited "₹10,000"
   is supported by a quote saying "10,000 rupees" or "Rs 10000", the same match
   the interview uses (#284, #281). An offer the copy states without citing it is cited
   automatically with the one supplied fact that contains it (#281): an amount or percentage
   by its token, and "free", "no-cost" or "guarantee" only when the thing offered (the next
   words) is in that fact too, so "FREE consultation" is not cited by "Free 15-minute spine
   check". No match or several matches leave it uncited and rejected. "No-cost" counts as
   "free", and a negated term ("not a guaranteed saving", "no guarantee", "गारंटी नहीं") is not a
   claim; "not just free installation" still is (#378). The interview's claim check follows
   the same two rules.
   A first line over 125 characters (`hook-length`) or an offer (price, %, free)
   that starts after character 125 (`offer-below-fold`) is repaired once like any
   other validation failure. An amount in words leading the first line ("10,000
   rupaye per kW") counts like the same amount in ₹. `all-caps` ignores acronyms
   joined by "/" or "-" ("IIT/PEC", "नॉन-DCR") and capitals the owner's own facts use
   (a brand written "SOLARIDE") (#418).
   A price the Brand facts give only as a rate ("10,000 rupees per kilowatt") must keep
   that unit in the ad (`price-unit`; kW, kilowatt and किलोवाट count as one); a flat
   Brand price may be worded freely (#418 rule 3).
   Once a concept passes, the offer goes on the picture (#418 rule 2): when the copy
   states a cited offer that neither the headline nor `supportingText` carries,
   `supportingText` becomes the one Brand offer fact (up to 64 characters) that states
   it. No repair and no new words; Hindi and Punjabi copy keeps its own picture line.
4. Generate an image from the validated concept and up to three reference images.
   When the business has uploaded product photos (Brand assets), ads 1 to
   min(k, 3) each use a different one, newest first (#195, #1901); a retried ad keeps
   its own photo. The rest get generated images. An owner-photo ad makes no image call and has no image cost,
   its concept is told the image is the owner's unseen photo, and the receipt
   records `ownerPhoto`. If that photo can't be downloaded or validated, the ad
   gets a generated image as usual.
   The renderer fits every background to the ad's exact frame first
   (`fitPhoto`, #1904): EXIF orientation, then sharp's `attention` saliency crop
   so a phone photo's face isn't cut off, or `backgroundFit: "blur"` (the whole
   photo on a blurred copy of itself) for group shots.
5. Download and validate the raster, persist the source image, render the designed
   poster when enabled, persist the final image, then insert a draft creative row.
   The poster's contact bar asks for a WhatsApp message (chat icon, no number) for a business whose
   campaigns open WhatsApp: an India-based phone (#235) or a saved WhatsApp message (`contactChannel`,
   #1147). The ask is in the ad's language ("Message us on WhatsApp", "WhatsApp पर मैसेज करें",
   "WhatsApp par message karein", "WhatsApp ਤੇ ਮੈਸੇਜ ਕਰੋ"; Indic words shaped like the rest, #1177).
   Others show their phone number, as do designs saved before #1147. A WhatsApp business's concept
   gets no phone or email and is told its button opens a chat; when the copy's last line doesn't mention
   WhatsApp, that same ask is added as the last line, in the ad's language ($0, no repair). Review warns, without
   blocking, when such a picture goes to a form campaign, and offers "Switch to WhatsApp".
6. Save usage receipts and report partial failures independently of successful rows.

Variants run concurrently using `Promise.allSettled` with a shared 240-second
generation signal. POST route duration is 300 seconds. These are implementation
budgets, not an SLA: persistence has its own calls and hosting limits still apply.
The batch is not automatically cancelled merely because a browser stopped waiting.

`CreativeValidationError` retains usage from invalid concepts; image failure also
retains preceding text usage. The #54 prevention candidate records each text and
image provider attempt on success, fallback and failure, including a bounded
provider request ID where returned and completed/unknown finality. The generation
UUID stays separate from the HTTP request ID. Missing IDs or zero-token error
receipts do not prove a provider charged nothing or completed no work. Provider
errors are returned as safe user-facing failures, not raw prompt/token traces. No model validation proves the image
accurately depicts a real product or that an ad claim is legally supportable.
Preferences are style guidance, not evidence for `sourceQuotes` or commercial
claims and not permission to spend. The brief is direction, not quote evidence:
Create passes only the original user goal and free-text answers as explicit
`sourceFacts`; model-suggested options and the interview brief are excluded.
Studio passes its directly authored brief as evidence. Validated user facts are
saved in the generation receipt for regeneration and fenced by the generation ID;
older receipts without facts use Brand fields and saved instructions only.
Review or edits to a generated brief alone do not certify its claims; add new
facts to the goal/answers or write a direct Studio brief instead. Paused, forgotten, fresh-direction and
unavailable memory supply no advisory text. A read failure omits notes without
changing admission, replay, usage accounting or the unresolved-intent hold.
When notes are used for an image, the saved image-prompt receipt contains only
an omission marker, not a provider prompt or a prompt reconstructed from the
concept. The validated concept, copy and finished image can still echo advisory
style; no deterministic filter can distinguish identical user art direction from
model-echoed memory. An in-flight paid request cannot retract context already
sent to a provider after a later forget; older creative output may still reflect
the guidance.

### Recover a Lost Response

[Studio](../src/components/studio.tsx) stores a generation UUID and count in local
storage before POST. On reload or an unconfirmed response it calls the generation
GET with that UUID/count and shows saved rows before allowing a new request; it
clears the stored intent only after saved creatives, `complete`, `failed`, 404 or
a definitive 4xx rejection. Repeating POST with the same UUID returns 202 without starting another
producer. `processing` does not prove a worker is alive, and `unresolved` needs
investigation rather than another paid request. Exact statuses are in
[Generate and Recover](api/creatives.md#generate-and-recover).

### Product References

[Reference selection](../src/lib/creative/references.ts) reads the latest 12
`product_photo`/`past_ad` assets, prioritizes product photos, and uses at most
three. Logo assets are not selected as product references; logo composition is
separate. A reference lookup failure stops generation rather than silently
omitting a paid input. Reference URLs and media are provided to the selected
image provider; account for this in consent and data handling.

Pollinations rejects reference images. Selecting it with saved product references
can fail unless an explicitly configured compatible fallback succeeds. Reference
support and asset fidelity are provider-specific, not guaranteed by the interface.

### Formats and Languages

| Format | Final design dimensions |
| --- | --- |
| `portrait` (default) | 1080 x 1350 |
| `square` | 1080 x 1080 |
| `story` | 1080 x 1920 |
| `landscape` | 1200 x 628 |

Dimensions come from [AD_FORMATS](../src/lib/creative/design.ts). Image providers
may generate a different source raster before the compositor fits the final
design; do not confuse source dimensions with final placement dimensions.

[Language IDs](../src/lib/languages.ts): `brand`, `en`, `hinglish`, `hi`, `pa`,
`pa_roman`. Unknown generation language IDs normalize to brand-default guidance.
Interview output validates its language choice against the supported list.
Create offers `en`, `hinglish`, `hi` and `pa` (#290). The interview detects whether
the owner writes Devanagari Hindi, Gurmukhi Punjabi or Roman-script Hindi, tells the
model to ask in it (`OWNER WRITES IN`), and suggests that ad language when the model
leaves `language` out. Hindi or Punjabi copy can go on the image too (`headline`,
`supportingText`); the compositor shapes it (#300). The claim check reads
"फ्री"/"मुफ़्त"/"ਮੁਫ਼ਤ" as free, "गारंटी" as guarantee and "रुपये"/"rupaye" as rupees, and a
quote with "नहीं" or "बिना" doesn't back a claim.
Font coverage and language quality still need visual/human review.

### Raster and Composition Rules

The shared downloader accepts only validated, single-frame PNG/JPEG/WebP, limits
input and normalized output to 20 MiB, limits decoding to 40 million pixels,
applies orientation, and normalizes to PNG. It bounds streamed bytes even when
Content-Length is absent or false. HTTP media downloads use safe public URL/DNS
and redirect handling; inline data URIs are base64 raster-only.

The design spec contains brand lockup, headline/subhead, up to four benefits,
the Brand phone (drawn large and bold with a call icon), a small contact line
(website and first service area), CTA, colors, font, and angle-specific
top/center/bottom placement. A subhead that states an offer (a ₹ price, "free …",
"% off", a flat discount; `isOfferLine` in [ad-composite](../src/lib/creative/ad-composite.tsx))
is drawn as a bold strip in the brand colour, as long-running local ads do (#967);
any other subhead stays a quiet grey line. The editor preview uses the same composite.
The [renderer](../src/lib/creative/render.tsx) receives validated inline media.
It draws all text in Inter 400/600/700/800 ([fonts](../src/lib/creative/fonts/),
OFL), so headlines are really bold; the brand's sans/serif/mono choice falls
back to Inter. Words in Devanagari or Gurmukhi (brand, headline, subhead,
benefits, contact line) are shaped by [sharp/Pango](../src/lib/creative/shaped-text.ts)
with Noto Sans Devanagari/Gurmukhi (OFL) and drawn as an image in their place,
because Satori misplaces vowel signs.
With overlay enabled, render/persistence failure fails the variant: **there is
no implicit bare-photo success fallback**. `AD_DESIGN_OVERLAY=false` explicitly
chooses the source photo. Source uploads can remain if later steps fail.

## Text Routing and Cache

[The orchestrator](../src/lib/llm/index.ts) supports Google plus OpenAI-compatible
Groq, OpenRouter, and Cerebras. It follows the selected standard/budget order,
round-robins keys within each provider, skips missing pools, and parks HTTP-429
keys for the provider's Retry-After (at most 60 seconds). When every key of a
model is parked for 20 seconds or less, it waits once and retries that model
before falling through; Groq keys share one organization tokens-per-minute
limit, so rotating keys does not add capacity. A 5xx skips that model's other
keys. First successful provider response wins. Cancellation and
terminal local errors do not mean trying every key indefinitely.

Internal accounts (team, owner, test; [internal-accounts.json](../src/lib/internal-accounts.json))
write on the same models as customers (Haiku text is about $0.006 a Create, and the free text
tiers allow 20 Gemini requests a day) but make their images free, without reference images and
never falling back to the paid image model (#449, #466). When `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_AI_TOKEN` are set, the free picture comes from Cloudflare Workers AI FLUX-1-schnell
([cloudflare.ts](../src/lib/imageGen/providers/cloudflare.ts), #1476): 4 steps, prompt capped at
2048 characters, $0 within the daily free allowance. It returns a square JPEG (no size option); the
poster covers its frame, so a 4:5 ad crops the sides. A 429, 5xx or error 4006 (daily allowance
used) is recorded as `IMAGE_FREE_BUSY`, any other failure as `IMAGE_PROVIDER`, and the picture falls
to Pollinations, which stays last. Pollinations answers
402/429/503 past its free limit of one image per 45 s per address, while its Retry-After says 1 s;
from production it also answered a fast 404 in the same spot (#634). So free images run one at a
time per server instance, treat 402/404/429/503 as busy, wait the longer of Retry-After and 15 s,
and fail with "Free test images are busy" after about 90 s. The anonymous tier ignores `nologo` and stamps
"pollinations.ai" bottom-right, and returns about 686×858 for a 1080×1350 request; `downloadImage` trims
a bottom strip (6%, at least 44 px) and the matching width, centred, before the image is stored or
composed (#661). A clean, full-size image needs a paid Pollinations key. The request's verified Supabase user decides; requests without
one (cron, workers) are billed as customers. Exceptions are listed by user id in
`exemptFromFreeProviders`, each with its reason: the Meta App Review reviewer (until #156 is
decided) and the owner, whose Solaride is a real advertiser (#466).

The text adapters use pinned `ai@7.0.116`, `@ai-sdk/google@4.0.82`, and
`@ai-sdk/openai-compatible@3.0.57`. These packages use Apache-2.0 licenses,
require Node >=22, and accept the project's Zod 4 version. Package-distributed
licenses remain in the installed dependency tree. The issue-local resolved
dependency audit on September 26, 2026 reported zero vulnerabilities; this is
not a guarantee against future advisories.

The SDK receives direct configured provider models and keys, never a gateway
model string. No AI Gateway account, new service, model change, or image adapter
is required. SDK retries are explicitly zero; the facade alone rotates keys and
providers. Caller cancellation stops further attempts. An attempt deadline (90 seconds
by default, `attemptTimeoutMs` per task), truncated output or an HTTP 5xx skips the rest of
that model's key pool and tries the next configured model or provider; with no
other model left, the original timeout or truncation error is thrown. Each
attempt reports a sanitized failure code (`TIMEOUT`, `DEADLINE` for the caller's
own deadline, `ABORTED`, `TRUNCATED`, `EMPTY`, `TRANSPORT`, `HTTP_<status>`) and
latency. Usage rows keep it in `metadata.failure` and `ai.completion` events as
`errorCode: LLM_<code>`. A 429 whose message names the limit (Groq: "on tokens per minute (TPM): Limit …,
Used …, Requested …") also records `rateLimitType`, `rateLimitLimit`, `rateLimitUsed` and `rateLimitRequested`
on the planner's and assistant's failed attempts (#1200); never the message or org id. System prompts, Gemini thinking headroom, OpenRouter reasoning exclusion, and
provider-reported usage retain their facade semantics. SDK-recomputed totals are
not substituted for the provider's original counts.

Existing concept, interview, and planner schemas use SDK structured output.
Gemini receives its native JSON schema; compatible providers retain their
existing `json_object` mode with SDK validation, since native schema support is
model-specific. Invalid structured text and its usage return to those task
validators for their existing bounded repair/accounting paths, not another
provider attempt. Explicit `completeJSON` schema requests reject invalid results
with a sanitized error. Calls without a schema retain tolerant `parseJSON`
behavior. Mocked transport tests establish adapter compatibility, not live model
quality or provider capability certification.

Cerebras currently uses the registry's fixed `llama-3.3-70b`; it has no model
environment override. Configuring OpenRouter for text also supplies image keys,
but image routing remains independently selected. `parseJSON` can remove fences
or recover a JSON block; a successful parse is not schema validation. Callers
such as the interviewer/concept validator apply their own runtime checks.

Cache is opt-in, in-process only, default TTL ten minutes and maximum 500 entries.
It shares identical in-flight requests within that process and marks cache hits.
Waiters share the first producer's outcome; a failed result is not cached.
It is not a distributed billing guarantee or durable job lock. Current key inputs
are prompt version, messages, optional provider/model options, temperature,
maxTokens, JSON mode, and the optional response schema. It does **not** include
the API key or tenant identity, nor fingerprint the full
effective environment/routing configuration; restart/clear cache after routing
changes and review key semantics before extending cached tasks. Extraction and
summary opt in; concept generation intentionally seeks fresh variation.

Rollback the SDK integration as one dependency-complete change: adapters,
facade/schema call sites, tests, `package.json`, and `package-lock.json` together,
then reinstall from that lockfile through the normal reviewed release process.
There are no new migrations, environment variables, accounts, or credentials.

## Images and Fallback

Supported selectors are `openrouter`, `cloudflare` and `pollinations`. Unknown names fail;
reserved OpenAI/fal.ai environment fields do not imply adapters exist. The default
parser value is Pollinations; an environment can select a paid OpenRouter model.
Do not infer the deployed provider from defaults.

Fallback is only used when explicitly configured to a different provider.
Timeout/AbortError and an aborted caller do not start another image provider.
Successful fallback records `fallbackFrom`, but does not prove equivalent quality.
Avoid casually fetching legacy generation URLs: some image URLs generate work on
request rather than reading a stored artifact.

## Reliability Budget

Owned by the CTO (#378). Models are re-reviewed every 21 days (#388): [model-review-reminder.yml](../.github/workflows/model-review-reminder.yml) opens a `Model review due` issue for the CTO 21 days after the last one. Measured from `product_events` (`ai.completion`, `creative.batch`) over the last 3 days, real traffic and QA alike (models don't know who calls them):

| Measure | Budget |
| --- | --- |
| Failed AI calls, per model | ≤ 3% (a retried call still counts as failed) |
| Failures a customer sees (a step errors after its retries) | 0 in 3 days |
| Create batches that save all requested ads | ≥ 95% |
| One concept or image call, p90 | ≤ 20 s; a whole Create run ≤ 60 s p90 |

Every failed call logs its `errorCode`; validation failures also log the failed rule ids, so the top cause is one query away. Over budget: fix the biggest cause first (routing, timeout, retry or validator), with a core test from a recorded response, then re-read 48 h later.

## Usage and Cost

[Usage persistence](../src/lib/llm/persist.ts) writes through the server admin
client to `llm_usage_events`. Rows include provider/model, route/request, text or
image kind, tokens, estimated USD, prompt version, attempt, latency, cache flag,
status/error category, and dimensions. The prevention candidate also writes
generationId, bounded providerRequestId (when available) and providerFinalStatus
in row metadata; the latter remains unknown on transport/HTTP failures. Do not
store raw prompts, secrets, provider response bodies or image bytes there.
Creative rows contain separate user-facing provenance receipts.

Quota checks use a UTC calendar-month start and an owner-scoped database aggregate.
If configured positive and usage cannot be verified, generation/interview/planning
gates fail closed. A zero configured limit disables that check.

Limits remain important:

- Creative generation has atomic per-business/month reservation and durable
  unresolved holds. Other LLM callers do not all share that admission boundary;
  even a reserved request can use more tokens than its estimate.
- Persistence is best effort, so crashes, provider omissions, and write failure
  can undercount. Do not rerun paid generation merely to fill a missing ledger row.
- Model cost tables and fallback estimates are estimates, not account invoices.
- Text-token limits are not comprehensive dollar limits across image providers.
- Not every LLM call site has identical durable quota/usage behavior; autofill
  and insight summaries must not be advertised as fully ledger-enforced merely
  because they use the shared text orchestrator.

Provider-side hard caps, owner confirmation, and isolated evaluation budgets
remain necessary.

## Evaluation and Extension

Use pure prompt/schema tests first, then mocked route/component tests, then an
explicitly authorized small provider evaluation with a fixed budget and saved
artifacts. Record model/provider, prompt version, source inputs, human review,
latency, partial failures, and cost. A JSON-valid output is not a quality score.
See [Testing](TESTING.md) for safe commands.

To add a provider: implement the existing interface, wire selection deliberately,
document required keys and formats/references, propagate deadlines, enforce media
validation, record provenance/usage, and add failure/fallback tests. Do not add a
hidden provider fallback to make a broken paid path appear successful.

## When Paid Credit Runs Out (#449)

OpenRouter (paid) can run out of credit: a 402, or a 403 "Key limit exceeded" once a key's total
limit is spent. AdBrain treats either as `CREDIT_EXHAUSTED`, not as a generic refusal:

- **Text:** that key is parked for 15 minutes, and the call is answered by the free providers
  (Gemini, Groq) even when the routing order (for example Create's `CREATIVE_PROVIDER_ORDER`) lists
  only OpenRouter. Free providers are added only after a credit failure; other failures behave as
  before. Usage events record `LLM_CREDIT_EXHAUSTED`.
- **Images:** a credit-exhausted OpenRouter image falls back to the free picture (Cloudflare when
  configured, then Pollinations, #1476) even when `IMAGE_PROVIDER_FALLBACK` is `none`. Neither can
  take product reference photos, so a picture made from the owner's product photos or past ads
  **fails** instead (#1593: 'Your product photo needs our paid pictures, which are paused right
  now. Try again in 15 minutes.'), on the first refusal and while the key is parked; it never
  becomes a generic product. Pictures without references fall back; the receipt records
  `fallbackFrom`. Only the credit refusal counts
  as not charged (`providerFinalStatus: failed`); any other image failure stays `unknown`.
  The exhausted image provider is then parked for 15 minutes per server (#1422), so the rest of
  the batch and the next Creates go straight to the free picture. A Pollinations fallback joins the
  one-at-a-time free queue and waits out one busy answer (402/404/429/503, at least 15 s) before
  that ad fails.
- **Owner message:** if the free models can't help either, Create says plainly that AdBrain's paid
  AI or image credit has run out and to try again shortly, instead of a generic failure.

The core test `credit-exhausted` replays OpenRouter's real 402 (recorded Oct 25 with a request
the key couldn't afford: refused before generating, usage unchanged).

