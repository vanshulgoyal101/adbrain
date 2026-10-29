# AI Pipeline: Routing, Images and Cost

Part of [Architecture](README.md). [Interview and boundaries](ai-pipeline.md) · [Variant generation](ai-pipeline-variants.md) · [Routing, images and cost](ai-pipeline-routing.md).

## Text Routing and Cache

[The orchestrator](../../src/lib/llm/index.ts) supports Google plus OpenAI-compatible
Groq, OpenRouter, and Cerebras. It follows the selected standard/budget order,
round-robins keys within each provider, skips missing pools, and parks HTTP-429
keys for the provider's Retry-After (at most 60 seconds). When every key of a
model is parked for 20 seconds or less, it waits once and retries that model
before falling through; Groq keys share one organization tokens-per-minute
limit, so rotating keys does not add capacity. A 5xx skips that model's other
keys. First successful provider response wins. Cancellation and
terminal local errors do not mean trying every key indefinitely.

Internal accounts (team, owner, test; [internal-accounts.json](../../src/lib/internal-accounts.json))
write on the same models as customers (Haiku text is about $0.006 a Create, and the free text
tiers allow 20 Gemini requests a day) but make their images free, without reference images and
never falling back to the paid image model (#449, #466). When `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_AI_TOKEN` are set, the free picture comes from Cloudflare Workers AI FLUX-1-schnell
([cloudflare.ts](../../src/lib/imageGen/providers/cloudflare.ts), #1476): 4 steps, prompt capped at
2048 characters, $0 within the daily free allowance. It returns a square JPEG (no size option); the
poster covers its frame, so a 4:5 ad crops the sides. A 429, 5xx or error 4006 (daily allowance
used) is recorded as `IMAGE_FREE_BUSY`, any other failure as `IMAGE_PROVIDER`, and the picture falls
to Pollinations, which stays last. Pollinations answers
402/429/503 past its free limit of one image per 45 s per address, while its Retry-After says 1 s;
from production it also answered a fast 404 in the same spot (#634). So free images run one at a
time per server instance, treat 402/404/429/503 as busy, wait the longer of Retry-After and 15 s,
and fail with "Free test images are busy" after about 90 s; that busy-out parks the free pictures for 2 min
per instance, so the rest of the batch fails at once (#2153). The anonymous tier ignores `nologo` and stamps
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

Owned by the CTO (#378). Models are re-reviewed every 21 days (#388): [model-review-reminder.yml](../../.github/workflows/model-review-reminder.yml) opens a `Model review due` issue for the CTO 21 days after the last one. Measured from `product_events` (`ai.completion`, `creative.batch`) over the last 3 days, real traffic and QA alike (models don't know who calls them):

| Measure | Budget |
| --- | --- |
| Failed AI calls, per model | ≤ 3% (a retried call still counts as failed) |
| Failures a customer sees (a step errors after its retries) | 0 in 3 days |
| Create batches that save all requested ads | ≥ 95% |
| One concept or image call, p90 | ≤ 20 s; a whole Create run ≤ 60 s p90 |

Every failed call logs its `errorCode`; validation failures also log the failed rule ids, so the top cause is one query away. Over budget: fix the biggest cause first (routing, timeout, retry or validator), with a core test from a recorded response, then re-read 48 h later.

## Usage and Cost

[Usage persistence](../../src/lib/llm/persist.ts) writes through the server admin
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
See [Testing](../team/testing.md) for safe commands.

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
