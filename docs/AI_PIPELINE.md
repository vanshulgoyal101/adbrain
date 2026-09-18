# AI and Creative Pipeline

This guide describes model calls, image processing, retries, and accounting.
Parameters are in [Configuration](CONFIGURATION.md) and [API Reference](API_REFERENCE.md).
Design history and experiments remain in [Creative Generation Plan](CREATIVE-GENERATION-PLAN.md)
and [QA](qa/); they do not override current code.

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

There is one repair opportunity, sharing a 45-second deadline and request
cancellation. Accepted brief length is at most 2000 characters. Follow-up
recommendations are optional; the user reviews the next brief before generating.
An interview response does not itself produce paid image variants.

## Variant Generation

1. Bound the context: brief 2000 characters, selected brand strings 1000 each,
   lists at most ten items, active instruction text at most 3000 characters.
2. Choose up to six configured marketing angles; default batch count is three.
3. For each angle, request a structured concept with caching disabled. First
   attempt temperature is 0.8; one repair attempt uses 0.4. Max output and
   reasoning effort are configured. Failed validation stops the variant.
4. Generate an image from the validated concept and up to three reference images.
5. Download and validate the raster, persist the source image, render the designed
   poster when enabled, persist the final image, then insert a draft creative row.
6. Save usage receipts and report partial failures independently of successful rows.

Variants run concurrently using `Promise.allSettled` with a shared 240-second
generation signal. POST route duration is 300 seconds. These are implementation
budgets, not an SLA: persistence has its own calls and hosting limits still apply.
The batch is not automatically cancelled merely because a browser stopped waiting.

`CreativeValidationError` retains usage from invalid concepts; image failure also
retains preceding text usage. Provider errors are returned as safe user-facing
failures, not raw prompt/token traces. No model validation proves the image
accurately depicts a real product or that an ad claim is legally supportable.

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
Font coverage and language quality still need visual/human review.

### Raster and Composition Rules

The shared downloader accepts only validated, single-frame PNG/JPEG/WebP, limits
input and normalized output to 20 MiB, limits decoding to 40 million pixels,
applies orientation, and normalizes to PNG. It bounds streamed bytes even when
Content-Length is absent or false. HTTP media downloads use safe public URL/DNS
and redirect handling; inline data URIs are base64 raster-only.

The design spec contains brand lockup, headline/subhead, up to four benefits,
contact line, CTA, colors, font, and angle-specific top/center/bottom placement.
The [renderer](../src/lib/creative/render.tsx) receives validated inline media.
With overlay enabled, render/persistence failure fails the variant: **there is
no implicit bare-photo success fallback**. `AD_DESIGN_OVERLAY=false` explicitly
chooses the source photo. Source uploads can remain if later steps fail.

## Text Routing and Cache

[The orchestrator](../src/lib/llm/index.ts) supports Google plus OpenAI-compatible
Groq, OpenRouter, and Cerebras. It follows the selected standard/budget order,
round-robins keys within each provider, skips missing pools, and parks HTTP-429
keys for 60 seconds. First successful provider response wins. Cancellation and
terminal local errors do not mean trying every key indefinitely.

Cerebras currently uses the registry's fixed `llama-3.3-70b`; it has no model
environment override. Configuring OpenRouter for text also supplies image keys,
but image routing remains independently selected. `parseJSON` can remove fences
or recover a JSON block; a successful parse is not schema validation. Callers
such as the interviewer/concept validator apply their own runtime checks.

Cache is opt-in, in-process only, default TTL ten minutes and maximum 500 entries.
It shares identical in-flight requests within that process and marks cache hits.
It is not a distributed billing guarantee or durable job lock. Current key inputs
are prompt version, messages, optional provider/model options, temperature,
maxTokens, and JSON mode. It does **not** independently fingerprint the full
effective environment/routing configuration; restart/clear cache after routing
changes and review key semantics before extending cached tasks. Extraction and
summary opt in; concept generation intentionally seeks fresh variation.

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
status/error category, and dimensions. Do not store raw prompts, secrets, or image
bytes there. Creative rows contain separate user-facing provenance receipts.

Quota checks use a UTC calendar-month start and an owner-scoped database aggregate.
If configured positive and usage cannot be verified, generation/interview/planning
gates fail closed. A zero configured limit disables that check.

Limits remain important:

- The check is not an atomic reservation; concurrent requests can exceed the
  ceiling, and one request can consume more tokens than remaining headroom.
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