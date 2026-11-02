# LLM

Part of the [repository map](../../../docs/architecture/overview.md#repository-map). This module is the one way server code calls a text model: provider order, key rotation and cooldown, the response cache, token accounting and the usage ledger. It does not own prompts or output rules; those live with each caller (for example [creative](../creative/) and the campaign planner).

## Start here

| File | Owns |
| --- | --- |
| [index.ts](index.ts) | `complete()` and `completeJSON()`: provider order, key round-robin, 429/credit parking, free-model fallback |
| [types.ts](types.ts) | Messages, completion options, `LLMError` and failure codes |
| [providers/](providers/) | Google and OpenAI-compatible (Groq, OpenRouter, Cerebras) adapters on the AI SDK ([sdk.ts](providers/sdk.ts)) |
| [cache.ts](cache.ts) | Opt-in, process-local response cache with single-flight |
| [usage.ts](usage.ts) | Process-local token totals, including tokens saved by the cache |
| [persist.ts](persist.ts) | `llm_usage_events` writes, monthly token usage and the configured limit |
| [spend-policy.ts](spend-policy.ts) | `freeImagesOnly()`: internal accounts get free images |
| [key-health.ts](key-health.ts) | No-spend probes of every configured key and model id |

## Rules

- All text calls go through `complete()` or `completeJSON()` in [index.ts](index.ts). Do not call a provider SDK or endpoint directly; the only direct provider call outside this folder is the OpenRouter credit read in the `llm-credit` cron.
- Order comes from `LLM_PROVIDER_ORDER`, `LLM_BUDGET_PROVIDER_ORDER` or `CREATIVE_PROVIDER_ORDER` (by `routing`). A 429 parks that key (a named organization limit parks every key of the provider, a daily limit up to 6 h); out of credit parks the key for 15 min and falls back to the free Google/Groq models. Parking state is per server instance.
- Each provider attempt has its own deadline (`attemptTimeoutMs`, 90 s by default in [sdk.ts](providers/sdk.ts)); an aborted caller signal stops rotation.
- Every completion is counted by `recordUsage` ([usage.ts](usage.ts)), and callers get one `onAttempt` per provider attempt. Routes that need a durable record pass those to `persistLLMUsage` ([persist.ts](persist.ts)); it is best effort and must never store prompts, keys, response bodies or image bytes.
- The cache is off unless a caller opts in, and it is only for low-variance calls; it is keyed on the request and model, never the API key.
- [key-health.ts](key-health.ts) reads only the free models/key endpoints and returns env names, never keys.
- A change to models, timeouts, routing or parsing must add or update a core test (`npm run test:core`) with recorded real responses, not only mocks (AGENTS.md).

## Tests

- [llm-rotation tests](../../../tests/llm-rotation.test.ts) and [edge cases](../../../tests/llm-rotation-edge.test.ts)
- [llm-routing tests](../../../tests/llm-routing.test.ts), [llm-providers tests](../../../tests/llm-providers.test.ts), [llm-parse tests](../../../tests/llm-parse.test.ts)
- [llm-cache tests](../../../tests/llm-cache.test.ts), [llm-usage tests](../../../tests/llm-usage.test.ts), [llm-key-health tests](../../../tests/llm-key-health.test.ts)
- Core: [credit-exhausted](../../../tests/core/credit-exhausted.test.ts), [planner-groq-limits](../../../tests/core/planner-groq-limits.test.ts), [create-haiku](../../../tests/core/create-haiku.test.ts)

## More

- [Text routing and cache](../../../docs/architecture/ai-pipeline-routing.md#text-routing-and-cache)
- [Usage and cost](../../../docs/architecture/ai-pipeline-routing.md#usage-and-cost)
- [Reliability budget](../../../docs/architecture/ai-pipeline-routing.md#reliability-budget)
- [Task boundaries](../../../docs/architecture/ai-pipeline.md#task-boundaries)
