# AI and Creative Pipeline

This guide describes model calls, image processing, retries, and accounting.
Parameters are in [Configuration](CONFIGURATION.md) and [API Reference](API_REFERENCE.md).
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
Failed attempts log rule names only (`metadata.validationRules`, for example
`unsupported-commercial-claim`, `repeated-question`, `schema:<path>`).

### Campaign Interview

The campaign planner is a separate workflow from the creative interviewer above.
The September 29 source change uses `campaign-planner-v5` and keeps structured
`questionId`, `topic`, answer and `answered`/`deferred` disposition across turns.
Brand context and explicitly selected campaign settings are supplied with history.
Known single service areas/offers and manual settings do not need confirmation;
exclusions default empty unless requested, and the planner recommends creatives
and technical targeting rather than asking the owner for API IDs or ad jargon.
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
standard reasoning model needs 30-90 seconds per plan. Provider routing has its own
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
   - Over-long link description, `visual.medium`, `visual.direction` and rationale are clipped at a word.
   - Case and spacing variants of a CTA or `textPlacement` are mapped, and `left` becomes `center`.
   - An empty or over-long `supportingText` becomes null, and empty quotes are dropped.
   - A quote that differs from a fact only in case is stored as the fact's exact text.
   - Primary text written as one paragraph over 125 characters is split into
     sentence lines (words unchanged), because Meta shows about 125 characters on
     mobile before "See more" (#194).

   Headline and primary text are never clipped, and every claim check still runs.
   In `visual.direction`, layout notes such as "55% of the frame height", "45%
   opacity" and "free of detail" are not read as offers (#202); a price, "20% off"
   or "FREE" shown in the visual still needs a supporting fact. A cited "₹10,000"
   is supported by a quote saying "10,000 rupees" or "Rs 10000", the same match
   the interview uses (#284, #281). An offer the copy states without citing it is cited
   automatically with the one supplied fact that contains it (#281): an amount or percentage
   by its token, and "free", "no-cost" or "guarantee" only when the thing offered (the next
   words) is in that fact too, so "FREE consultation" is not cited by "Free 15-minute spine
   check". No match or several matches leave it uncited and rejected.
   A first line over 125 characters (`hook-length`) or an offer (price, %, free)
   that starts after character 125 (`offer-below-fold`) is repaired once like any
   other validation failure.
4. Generate an image from the validated concept and up to three reference images.
   When the business has uploaded product photos (Brand assets), the first ad
   uses the newest one as its image instead (#195): no image call or image cost,
   its concept is told the image is the owner's unseen photo, and the receipt
   records `ownerPhoto`. If that photo can't be downloaded or validated, the ad
   gets a generated image as usual.
5. Download and validate the raster, persist the source image, render the designed
   poster when enabled, persist the final image, then insert a draft creative row.
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
[Generate and Recover](API_REFERENCE.md#generate-and-recover).

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
top/center/bottom placement.
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
`errorCode: LLM_<code>`. System prompts, Gemini thinking headroom, OpenRouter reasoning exclusion, and
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

Supported selectors are `openrouter` and `pollinations`. Unknown names fail;
reserved OpenAI/fal.ai environment fields do not imply adapters exist. The default
parser value is Pollinations; an environment can select a paid OpenRouter model.
Do not infer the deployed provider from defaults.

Fallback is only used when explicitly configured to a different provider.
Timeout/AbortError and an aborted caller do not start another image provider.
Successful fallback records `fallbackFrom`, but does not prove equivalent quality.
Avoid casually fetching legacy generation URLs: some image URLs generate work on
request rather than reading a stored artifact.

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