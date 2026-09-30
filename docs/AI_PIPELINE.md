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
attempt retains usage and validity metadata. Existing provider routing has its own
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
Preferences are style guidance, not evidence for `sourceQuotes` or commercial
claims and not permission to spend. Paused, forgotten, fresh-direction and
unavailable memory supply no advisory text. A read failure omits notes without
changing admission, replay, usage accounting or the unresolved-intent hold.
When notes are used for an image, the saved image-prompt receipt records their
application without the raw note values. An in-flight paid request cannot retract
context already sent to a provider after a later forget; older creative output
may still reflect the guidance.

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

Cache is opt-in, in-process only, default TTL ten minutes and maximum 500 entries.
It shares identical in-flight requests within that process and marks cache hits.
It is not a distributed billing guarantee or durable job lock. Current key inputs
are prompt version, messages, optional provider/model options, temperature,
maxTokens, JSON mode, and the optional response schema. It does **not** independently fingerprint the full
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