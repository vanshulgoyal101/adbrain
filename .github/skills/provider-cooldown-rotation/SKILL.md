---
name: provider-cooldown-rotation
description: "When a product calls multiple external providers, models, accounts, or API keys for the same operation."
---

<!-- Generated from vanshulgoyal101/skills@fb8f6e0 skills/provider-cooldown-rotation.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Provider Cooldown Rotation

## Trigger

When a product calls multiple external providers, models, accounts, or API keys for the same operation.

## Invariant

One provider failure does not make the user-visible operation fail when another eligible provider can complete it; rate-limited or retired combinations are not hammered repeatedly.

## Failure pattern

A sequential fallback retries a dead model or exhausted key, then emits a generic error even though another configured provider could serve the request. The operator cannot tell whether the problem is quota, authentication, retirement, or a transient outage.

## Recommended method

1. Model each provider/key pair as a candidate with a standard error category.
2. Try each eligible pair once per operation in round-robin order.
3. Cool down rate-limited pairs; fail fast on retired models or invalid configuration.
4. Record provider, model, key slot, status, and reason without logging secrets.
5. Throw one actionable aggregate error only after all candidates are exhausted.
   Make it typed, such as `<STAGE>_EXHAUSTED_<TIMEOUT|ABORTED|RATE_LIMIT|NO_KEYS>`;
   a plain `Error` left one production failure unidentifiable after the fact.
6. Persist every failed attempt, not only successes, with a sanitized code
   (`TIMEOUT`, `DEADLINE`, `ABORTED`, `TRUNCATED`, `EMPTY`, `TRANSPORT`,
   `HTTP_<n>`), latency and the operation ID. A success-only usage table left
   failures invisible; with per-attempt rows one read-only query keyed by the
   operation ID named the top rejection, and a fix shipped about 30 minutes later.
7. Classify your own deadline abort as `DEADLINE`, separate from provider errors.
8. Let a timeout or truncated reply fall through to the next model or provider
   instead of ending the chain; allow a list of models per provider.
9. On a 5xx overload, skip the remaining keys of that same model. On a 429,
   honor `Retry-After` with a cap (60s) instead of a fixed cooldown.
10. Treat keys in one provider account as one capacity pool. Rotating them adds
   no throughput; when every key is blocked for a short reset, wait once and
   retry before falling back (proposed fix, not yet verified).

## Discriminating checks

- Mock a 429 and verify the pair is skipped during cooldown and retried after expiry.
- Mock a 404 model-retired response and verify the next provider is attempted without repeated hammering.
- Mock a 5xx and verify bounded retry behavior.
- Configure no candidates and assert a clear configuration error.
- Make every candidate fail and assert the aggregate error names provider/reason, never the key value.
- Compare each failure's elapsed time with your route deadline. Failures clustered
  at the deadline are your abort: three zero-token "provider failures" landed at
  230-240s against a 240s deadline while four tiny diagnostic calls returned 200.
- Read the deployed provider-order setting. With one provider listed, fallback
  code is inert however well it is tested.
- Spend a known amount on key A, then read the remaining quota on key B. If B
  dropped too, the keys share one limit (verified: 799 tokens on one key moved the
  other key's remaining count and reset time identically; one 8k tokens/min pool).
- Mock a 503 on one model's first key and assert its other keys are not tried.

## Common traps

- Retrying a rate-limited key immediately.
- Rotating keys while keeping a retired model name.
- Hiding all provider failures behind “AI unavailable.”
- Logging authorization headers or full provider responses.
- Counting four keys as four times the capacity. All four returned 429 within
  about 0.6s right after one run's own ~5.9k tokens.
- Retrying each key of an overloaded model: one overloaded model cost 4 x 16-43s.
- Blaming a provider for failures before checking timing against your deadline.
- Shipping fallback code and assuming it is live; check the deployed setting.

## Evidence

AdBrain's `src/lib/llm/index.ts` rotates providers and keys with cooldowns; tests and operational notes cover Gemini 429s and retired Groq models.

October 2026 evidence and status per item is in
[the Create reliability incident](../incidents/adbrain-create-reliability-2026-10.md):
failure codes, typed exhaustion and deadline classification verified in
production; 5xx key-skip and capped `Retry-After` verified in CI; shared-limit
wait still open.
