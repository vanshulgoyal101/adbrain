# AI and Creative Pipeline

Use this guide to follow a creative request, recover saved results, or diagnose
provider and usage failures without accidentally repeating paid work.
Parameters belong in [Configuration](CONFIGURATION.md); route contracts belong
in [API Reference](API_REFERENCE.md).

Source baseline: development `672eb132ad57bb3ba31f118afaffddaa878b4923`, reviewed
September 26, 2026. The text SDK and truncation-accounting repair shipped in
[PR #36](qa/ops-environment-2026-09-26.md#o-11-sdk-and-query-release).
That receipt does not certify new live model output, image quality, or every
development migration. [Creative Generation Plan](CREATIVE-GENERATION-PLAN.md)
preserves design history; [QA](qa/) preserves candidate-specific evidence.

Before a paid request, the owner needs a saved business/brief, usable configured
providers, and approval for the intended generation/evaluation budget. Brand
instructions and reference assets are sent to providers as part of the request.
A local URL or test-looking brief does not make configured keys free or isolated.

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

The batch uses `Promise.allSettled`, but concept planning is chained so each angle
can see recent concepts and avoid repetition. Rendering/persistence can overlap
after each concept is ready. The shared generation signal is 240 seconds; the
POST route declares 300 seconds. These are implementation budgets, not an SLA:
persistence has its own calls and hosting limits still apply. Closing the browser
does not automatically cancel the batch or undo provider charges.

`CreativeValidationError` retains usage from invalid concepts; image failure also
retains preceding text usage. Provider errors are returned as safe user-facing
failures, not raw prompt/token traces. No model validation proves the image
accurately depicts a real product or that an ad claim is legally supportable.

### Recover a Lost Response

[Studio](../src/components/studio.tsx) records a generation UUID and expected
count before POST. On reload or an ambiguous response it uses the existing
[generation GET handler](../src/app/api/creatives/generate/route.ts) to reconcile
saved rows before allowing another request. For example, in an authenticated
isolated fixture, the read-only request shape is:

```http
GET /api/creatives/generate?businessId=11111111-1111-4111-8111-111111111111&generationId=22222222-2222-4222-8222-222222222222&expectedCount=3
```

Both UUIDs above are synthetic. GET returns `creatives`, `count`, `expectedCount`
and `status`: `complete` when enough rows exist, `partial` when some exist, or
`processing` when none exist. **Processing is inferred from row count**, not proof
that a worker is alive. A failed read is 503, not an empty successful recovery.
RLS scopes these reads to the signed-in owner.

Keep the same identity/count while reconciling. Late completion may clear only
its own pending identity, not a newer request from another tab. This preserves
client recovery state but is not atomic cross-tab admission. The generation UUID
is not a server-side paid-request idempotency key: repeating POST can invoke paid
work again. Regeneration likewise needs a deliberate new action, not an automatic
response to an unavailable usage or status read.

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

The text adapters use pinned `ai@7.0.116`, `@ai-sdk/google@4.0.82`, and
`@ai-sdk/openai-compatible@3.0.57`. These packages use Apache-2.0 licenses,
require Node >=22, and accept the project's Zod 4 version. Package-distributed
licenses remain in the installed dependency tree. The issue-local resolved
dependency audit on September 26, 2026 reported zero vulnerabilities; this is
not a guarantee against future advisories.

The SDK receives direct configured provider models and keys, never a gateway
model string. No AI Gateway account, new service, model change, or image adapter
is required. SDK retries are explicitly zero; the facade alone rotates keys and
providers. Caller cancellation or the adapter's 90-second deadline stops further
attempts. Truncated output is a terminal error, including Gemini truncation.
System prompts, Gemini thinking headroom, OpenRouter reasoning exclusion, and
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

### Retry Ownership

| Layer | Behavior and stopping condition |
| --- | --- |
| [SDK adapter](../src/lib/llm/providers/sdk.ts) | One physical attempt, `maxRetries: 0`; combines the caller signal with its 90-second deadline |
| [Facade](../src/lib/llm/index.ts) | Walks configured provider/key pools; 429 parks a key for 60 seconds. Caller abort or a terminal local error without HTTP status stops the walk |
| [Concept generation](../src/lib/creative/generate.ts) | At most two concept attempts for validation repair; truncation remains terminal and retains known usage |
| [Interview](../src/lib/creative/interview.ts) | One bounded repair, sharing the task's 45-second signal |
| [Images](../src/lib/imageGen/index.ts) | Only an explicitly configured different provider can be a fallback; caller abort/timeout does not trigger it |

Provider fallback and task repair are separate paid attempts. Do not wrap the
facade in an unbounded retry or assume an SDK error means no provider work occurred.

### Cache Ownership

[Cache](../src/lib/llm/cache.ts) is opt-in, process-local, ten-minute default TTL
and 500 entries. Identical in-flight requests share one producer; later waiters
are marked cached. Failed producers are removed. The producer's physical request
owns its signal; the cache is not independent per-waiter cancellation or durable
job coordination across instances.

The key contains prompt version, messages, optional provider/model options,
temperature, maxTokens, JSON mode and response schema. It does **not** independently
include tenant identity or the full effective environment/routing configuration.
Review key suitability before enabling caching for another task; restart/clear
cache after routing changes. Extraction and summary opt in; concept generation
does not. Cache savings do not guarantee once-only billing.

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
status/error category, and dimensions. Do not store raw prompts, secrets, or image
bytes there. Creative rows contain separate user-facing provenance receipts.

Keep three accounting layers separate:

| Layer | Meaning |
| --- | --- |
| [Process counters](../src/lib/llm/usage.ts) | Reported physical completions and cache savings in this warm process; not a durable billing ledger |
| Task callbacks and receipts | Interview/planner pass attempt validity and known usage; creative failures retain preceding concept attempts for `failedVariantUsage` |
| Database usage rows | Best-effort persisted provenance and cost estimates for supported callers, dependent on schema and privileges |

For truncated SDK output, `LLMError` carries model and original reported usage.
The facade records that failed physical attempt inside the shared producer, once
rather than once per cache waiter. Interview/planner forward retained usage to
their existing failure callbacks; creative generation wraps it with earlier
attempt receipts. No extra completion/image call is made to recover token counts.
The [regression fixtures](../tests/llm-providers.test.ts) include a Gemini response
with 8 prompt, 2 candidate and 17 total tokens: the original total is preserved,
not recomputed as 10. This is synthetic accounting evidence, not an invoice.

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

| Symptom | Inspect before another paid request |
| --- | --- |
| No configured text provider | [Registry and environment parser](../src/lib/env.ts); image configuration alone does not supply every text provider |
| Truncated/invalid concept | Task token/reasoning budget, schema issues and retained usage; do not silently accept incomplete text |
| Reference-capability failure | Selected image provider and reference count; never silently discard required product references |
| Overlay or persistence failure | Saved source/final assets and variant receipt; bare-photo fallback is not implicit |
| Browser timeout or missing receipt | Reconcile saved variants first; a missing record does not prove no charge |

Existing [SDK fixtures](../tests/llm-providers.test.ts),
[rotation tests](../tests/llm-rotation.test.ts),
[pipeline tests](../tests/creative-pipeline.test.tsx), and
[recovery tests](../tests/creative-generation-recovery.test.ts) cover these local
contracts. Reuse their exact-candidate evidence for a prose change; do not run
the live creative evaluation merely to refresh documentation.

To add a provider: implement the existing interface, wire selection deliberately,
document required keys and formats/references, propagate deadlines, enforce media
validation, record provenance/usage, and add failure/fallback tests. Do not add a
hidden provider fallback to make a broken paid path appear successful.