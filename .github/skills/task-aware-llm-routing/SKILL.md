---
name: task-aware-llm-routing
description: "Use this skill when one product sends multiple kinds of work to several LLM providers, especially when some tasks are expensive or latency-sensitive and others are extraction, summarization, classification, or conversational glue."
---

<!-- Generated from vanshulgoyal101/skills@77e6db7 skills/task-aware-llm-routing.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Task-Aware LLM Routing

## Trigger

Use this skill when one product sends multiple kinds of work to several LLM
providers, especially when some tasks are expensive or latency-sensitive and
others are extraction, summarization, classification, or conversational glue.

## Invariant

Every LLM call declares its task class and is routed only through the provider
pool allowed for that class. A low-risk task cannot silently spend through the
premium pool, while a quality-critical task is not accidentally downgraded.

## Failure pattern

A global provider order is reused for every call. A website autofill or short
summary reaches a reasoning-heavy paid model, exhausts its output budget, costs
money, or fails with an error that incorrectly tells the operator to change
creative-generation settings.

## Recommended method

1. Define named routing pools such as `standard` and `budget`; keep the pool
   policy in the orchestrator, not scattered across callers.
2. Require every non-default task to declare its route and a human-readable task
   name. Do not infer cost policy from prompt wording.
3. Make budget routes exclude premium providers by construction. If the budget
   pool is empty, fail closed rather than falling through to the premium pool.
4. Keep model-specific reasoning controls separate from the total output budget.
   Use minimal or disabled reasoning for extraction and summaries where supported.
5. Record provider, model, route, task, usage, latency and failure reason without
   logging keys or prompt secrets.
6. Keep high-value creative planning and campaign decisions on the stronger route;
   cost control is not permission to lower quality everywhere.

## Discriminating checks

- Put the premium provider first globally and verify a budget call still selects
  the budget provider.
- Empty every budget-provider key pool and verify the budget call fails without
  contacting the premium provider.
- Simulate a truncated budget response and verify the error names the actual task.
- Verify creative generation and campaign planning retain the standard route.
- Inspect production variable presence and route receipts without printing values.

## Common traps

- Calling every task through `LLM_PROVIDER_ORDER`.
- Calling a pool "free" when the provider account may still bill.
- Falling back from a budget route into a paid route to improve availability.
- Setting one global reasoning effort and token budget for every model/task.
- Treating a successful HTTP response as proof the intended provider was used.

- Picking models once. Models improve every few weeks; schedule a review (a cron that
  opens one issue) that reruns the per-task quality/speed/cost check on recorded
  inputs and switches only on a clear win, under a fixed evaluation budget.
- Burying a language rule in the system prompt: qwen 27b ignored it. State the detected
  language in the request ("OWNER WRITES IN: …") and assert that line in a core test (#290).
- Counting every logged provider attempt as a failed call: absorbed 429s then look like
  outages. Measure reliability on what the request returned (#378, #612).
- Hard-failing Create when a paid key runs out: degrade to free providers with an honest
  message. Record the 402 at $0 by sending an unaffordable request (#449).
- Adding an LLM route without an `onAttempt` hook: it's invisible in usage. Check that a
  route's core test writes usage rows (#650).
- Adding a retry knob before mutating the existing one: the router's 20 s per-provider
  wait already covered the burst; the real bug was a fallback logged as `failed` (#612).
- Fixing a validator rule in one route only: the spelled-currency rule (₹10,000 =
  "10,000 rupees") broke Regenerate after the interview was fixed. Search for variants
  when a validator rule changes (#284).
- Sizing an advisory AI review larger than the free tier: Groq's 8k TPM cap sets the
  diff budget. Cap the diff and list skipped files instead of failing (#423).
- On a 429, go straight to the fastest healthy provider instead of waiting out the next
  one's timeout serially.
- Before fixing a 0% success metric, check it isn't a logging artefact (a ready plan was
  never logged as success).
- Rules applied on every generation need negative tests from everyday copy ("Fix your
  appointment", "broke down"); substring matches ("cure" in "secure") cost paid repairs.
- Check the platform's own free feature before pricing third-party AI (Meta's image
  animation turned a ₹35–₹400-per-ad question into a ₹0 test).
- A free eval tier that gives one conclusive run a day can't gate releases; approve a
  small capped paid before/after run with an explicit no-worse gate.
- Verify a model's "invented" facts against the exact text the route reads, not a
  tag-stripped copy.

## Latency, deadlines and model promotion

- In multi-step generation, latency is the real cost. Measure tokens/s and
  reasoning tokens per task: one reasoning model ran about 35 tokens/s, spent
  about 300 reasoning tokens on a one-line answer and averaged 71s per concept
  call over 26 calls, while total spend was negligible.
- Do the worst-case arithmetic before shipping: attempt limit x sequential calls
  + repairs + image time must fit the route deadline. A 90s attempt limit with
  three calls plus an image is about 284s against a 270s deadline (open gap).
- Interactive steps get fast providers and short attempt limits. A planner on a
  slow model needed 30-90s against a 45s limit; fast providers at 20s per attempt
  brought the production step to 4.4s.
- Promote a model to primary only after a run under the real workload. Two models
  that answered diagnostics in 0.8s and 3.6s failed as primary: one returned 503
  after 16-43s on every key, the other hit a shared 429 limit.
- Choose by speed and reliability before price when spend is already small.
- Decide the revert trigger before shipping a routing change (for example "if the
  next run is not 3/3, revert") and keep routing overridable by a setting so the
  revert needs no release. Keep independent fixes from the reverted change.
- Measure each step on the real route before tuning. Parallel concept calls cut
  Create from 63-79s to 36.5-48s; model or effort changes risked quality (#142).
- A capped bake-off on the real route through a recorded harness chose model and
  schedule cheaply; two consecutive production 3/3 runs followed (48s, 40s) (#98).

### Discriminating checks

- Compute the worst case from configured limits, not from observed averages.
- Replay the real multi-call workload on a candidate model before promotion.
- Flip the routing setting back in a test and assert the previous order is used.

AdBrain runs and status are in
[the Create reliability incident](../incidents/adbrain-create-reliability-2026-10.md).

## Evidence

AdBrain's website autofill inherited the paid OpenRouter creative route and failed
with a creative-specific token-budget message. Explicit `standard`/`budget`
routing moved autofill, interviews and campaign summaries to Groq/Google/Cerebras,
while creative and campaign planning retained the premium route.
