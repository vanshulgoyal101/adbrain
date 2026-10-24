---
name: budget-aware-provider-routing
description: "Use this when a product calls paid LLM or image providers for tasks with different value, latency, or quality requirements, or when it has per-tenant AI quotas, concurrent variants or uncertain reservation lifetime."
---

<!-- Generated from vanshulgoyal101/skills@fb8f6e0 skills/budget-aware-provider-routing.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Budget-Aware Provider Routing

## Trigger

Use this when a product calls paid LLM or image providers for tasks with different value, latency, or quality requirements, or when it has per-tenant AI quotas, concurrent variants or uncertain reservation lifetime.

## Invariant

Each task selects an explicit cost tier; budget tasks use only the budget pool and fail closed if that pool is unavailable. Quota and prompt-cost checks happen before provider spend.

## Failure pattern

One provider order makes low-value summaries or extraction burn premium tokens. A missing cheap-provider key silently falls through to the expensive pool. A quota is checked after the request, turning a control into an audit log.

## Recommended method

- Declare a task tier such as `budget` or `standard` at the call site.
- Build separate provider registries and never let an empty budget pool escalate to premium providers.
- Record usage, estimated prompt cost, tenant, task, and provider.
- Check monthly quota and prompt-cost limits before making the provider call.
- Return a typed, actionable error when a budget task is not configured.
- Keep this separate from availability cooldowns: cooldowns choose a healthy provider; budget routing chooses an allowed cost class.
- Extract provider usage before rejecting a terminal/truncated response. HTTP success
	can still be a failed generation with real billed tokens. Carry known usage and
	provider/model identity on the failure; retain unknown costs as unknown.
- Record a physical failed attempt inside the single-flight producer, not once per
	waiter. Aggregation must preserve earlier failed attempts and report them once.
- Do not reconstruct an original provider total by summing visible prompt/completion
	fields when provider semantics differ. Preserve the supplied accounting receipt.
- When adopting an SDK, verify endpoint, structured-output, usage and retry behavior
	with focused transport tests. Disable SDK retries when the application already owns
	retry policy; types or factory signatures alone do not prove runtime behavior.

### Concurrent work and reservation lifetime

- Persist tenant-scoped immutable intent before paid work and atomically reserve
	shared quota. A process-local single-flight or later usage callback cannot
	serialize independent server instances competing for the same remaining budget.
- Distinguish one failed variant from terminal failure of the entire request.
	A child callback can arrive before siblings save or settle; do not release the
	request reservation or make late results unreachable at that point.
- Release unused exposure only after whole-request completion establishes that
	no sibling work or unresolved liability remains. Proven all-no-provider failure
	differs from mixed success/failure and an unknown provider outcome.
- Keep late saved results recoverable as partial work. Timeout, lease expiry or
	a missing response does not authorize another paid execution.
- Label quota units, estimated exposure and provider-billed currency separately;
	a reserved image count is not an audited monetary cost.
- Shrink a hold to actual usage when work settles, partial runs included. Nine
	settled partials held 1.67M tokens for 163k used and blocked new runs (#138).

## Discriminating checks

- Empty budget pool: assert no premium provider is called.
- Quota exceeded: assert the request fails before any provider call.
- Repeated request: assert usage ledger and cache/single-flight behavior do not double-charge unexpectedly.
- Standard task with budget providers unavailable: assert the standard policy, not accidental fallback, decides the result.
- Return nonempty truncated output with known usage: assert the error retains usage,
	accounting runs once across concurrent waiters and no extra paid request is made.
- Fail the instruction/constraint read before generation: assert no provider is called.
	An empty successful instruction list is different from an unavailable safety input.
- Reserve 100 units for two variants against a 150-unit limit. Fail one variant
	before its sibling saves; a different 100-unit request must remain blocked.
	Save the sibling later and verify partial recovery. Repeat with all variants
	proven to fail before provider execution and with unresolved provider work.
- Exercise the real callback-to-storage path as well as SQL flags directly;
	a correct terminal flag in a database test does not prove the caller sends it.
- Settle N partial runs in real Postgres, then assert a new request is admitted.
	A 429 from your own quota can be stale holds, not usage (#98, #138).

## Common traps

- Reusing provider rotation as cost governance.
- Treating a missing budget key as permission to spend from the paid pool.
- Charging by requested max tokens rather than actual or bounded estimated cost.
- Keeping the ledger separate from the decision path so enforcement is too late.

## Evidence

AdBrain added low-risk budget routing, a paid-usage ledger, monthly quotas, and prompt-cost guards in `16f00e9`, `228a453`, and `bb858ff`.
