# Creative generation: coherent concepts, explicit failures

## Outcome and limits

An ad must communicate a real offering to a particular audience, depict it
faithfully, pair its image with its message, remain readable in its placement,
and give a clear next action. Model upgrades should improve the decisions in
that process, not merely fill three strings in an unchanged template.

Passing contracts is not proof of persuasion, factual truth, product fidelity,
or Meta policy compliance. Human approval remains required. No promised CTR,
automatic publication, or unbounded critique/regeneration loop.

## Implementation sequence

1. **One creative concept owns copy and art direction.** Replace independent
   copy/image requests with a structured concept, then image execution. Supply
   the full bounded brand, brief, audience, language, placement and reference
   availability. Let the model choose medium, subject, composition and message.
   Keep exact typography and contact details deterministic. Do not universally
   require photography, stock people, a particular country, or four benefit pills.
   Validate with Zod; one repair contains actual errors and previous output.
   Reject invalid concepts before image spend. Preserve the successful concept.
2. **Make provider execution honest.** Validate configuration and image responses;
   do not silently switch a paid provider to a free provider. Explicitly configured
   fallbacks must carry provenance. A failed image download is an image-generation
   failure, not a successful URL. Reject empty, oversized and non-image payloads.
   Align request deadlines with the deployment's supported duration. Avoid
   unsupported model-specific quality parameters and misleading seed metadata.
3. **Connect composition to art direction.** Render the selected placement using
   the exact validated copy, deliberate text space, and optional supporting line.
   Do not shorten or randomly supplement the model's message. Check actual PNG
   rendering for all formats and supported layouts, including long copy.
4. **Integrate all generation paths.** Batch, regeneration and assistant must use
   the same concept contract and asset/reference policy. Preserve completed
   variants when another fails; expose partial failure and actual provider/model.
   Never store raw-photo fallbacks as if they were finished ads. Keep usage and
   provenance attached to the work, with unknown costs distinguished from zero.
5. **Evaluate before claiming quality.** Add offline malformed-output, repair,
   provider-error, persistence and composition tests. Use a small, explicitly
   bounded paid evaluation only after configuration is verified. Compare identical
   briefs with a recorded model/version, reference set, format, cost and latency.
   Inspect the resulting ads; report weak outputs as well as successes.

## Acceptance checks

- Image requests contain the validated model's art direction and placement.
- Malformed or repeatedly unsafe copy triggers no image calls.
- Repair receives concrete errors; no extra call on the successful path.
- Reference availability and brand facts reach planning and image execution.
- No invisible provider substitution, data-URL persistence fallback, or failed
  composite masquerading as a finished ad.
- Partial successes are retained and failures are visible to the caller.
- All four formats render actual nonblank PNGs; text stays inside the canvas.
- Full tests, coverage thresholds, lint, typecheck and build pass.
- Production environment, database rollout and paid-output inspection are separate
  acceptance gates, not inferred from unit tests or successful deployment.

## Operational boundaries

Stay on Vercel Hobby. Do not add a queue service, new credentials or recurring
paid infrastructure implicitly. If the configured runtime cannot accommodate
paid-image latency, document the required setting or durable-job migration.
Never retry an ambiguous paid image timeout automatically: the provider may
already have charged for it. Text validation gets at most one repair.

## Implemented

- Validated concept controls copy, visual medium, detailed art direction, and text
   placement. One feedback-driven repair, then fail before image spend.
- Reasoning effort and total output budget are configurable. Shared 240-second
   generation deadline; 180-second image deadline; 300-second route budget.
- OpenRouter endpoint capabilities determine supported options and nearest aspect
   ratio. Real raster decoding verifies bytes and records actual dimensions.
- Fallback defaults to none; explicitly configured fallback is recorded. Missing
   paid keys never implicitly select Pollinations. Unsupported references fail.
- Completed variants save independently. Failed composition/storage cannot become
   a completed creative. Regeneration preserves format/language and checks quota.
- Creative rows retain concept, prompt, references and actual model receipts.
   Studio exposes receipt details, partial failures, 1-6 variants and four formats.
- Model copy is not shortened or supplemented with arbitrary benefit pills.

## Evidence (2026-09-06)

- 685 offline tests passed; one paid test skipped by default. Coverage: statements
   62.16%, branches 57.67%, functions 64.98%, lines 62.67%. Lint/types/build passed.
- Twelve actual PNG composites rendered across four formats and three text
   positions. Inspected landscape/top and story/bottom outputs. This caught and
   fixed Satori crashing on explicitly undefined positioning properties, previously
   hidden by the raw-photo fallback.
- Four authenticated browser checks passed at 1440, 1024, 768 and 390 pixels.
   Generation responses were intercepted fixtures: no customer writes or paid
   calls. Placement selection, partial success, receipts and overflow checked.
- Paid evaluation: Qwen `qwen/qwen3.8-max-0902` plus `openai/gpt-image-2`, no
   fallbacks, fictional Example Solar. Initial text attempt failed after 44s:
   model metadata showed mandatory reasoning, default xhigh effort, and the
   1800-token budget was insufficient. Separate effort/budget support fixed it.
- First image run: 134s total; image 94.7s, $0.19767. Inspection found an
   unsupported "free assessment" in the rationale. Added regression coverage,
   required source quotes, checked commercial terms across the concept, and
   stopped forwarding rationale to the image model.
- Final run: 155s total, including one concept repair; image 92.8s, $0.197435;
   actual source 1152x1536, finished portrait 1080x1350. Headline: "Your roof.
   Assessed. Then quoted." Supplied facts were cited. Image and copy share a
   rooftop-assessment scene. Both images were visually inspected in-session.
- Image charges total $0.395105; text charges additional and not independently
   reconciled. No claims about CTR or superiority over an older model are justified.
- Live artifacts initially lived under test-results and were removed by Playwright's
   output cleanup after inspection. Future opt-in runs use timestamped directories
   under ignored `.creative-evals/`, separately from browser artifacts.

## Research Used

- OpenAI Agents JS `packages/agents-core/src/guardrail.ts`: explicit output
   tripwires and granular findings. Used the pattern without adding its SDK.
   https://github.com/openai/openai-agents-js/blob/main/packages/agents-core/src/guardrail.ts
- OpenRouter Image API docs and public GPT image endpoint discovery: capability
   descriptors, reference limits, aspect ratios, and measured 94s sample latency.
   https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- OpenRouter reasoning docs plus public Qwen metadata: reasoning shares the output
   budget; the configured model requires it and defaults to xhigh.
   https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
- Vercel Fluid Compute: Hobby permits 300-second Node functions.
   https://vercel.com/docs/functions/limitations

## Database Migration Applied

On 2026-09-06, the existing workspace management credential was located and
verified against the healthy AdBrain Supabase project. Applied only
`db/migrations/20260906_creative_generation.sql` through the Management API,
inside a transaction with a five-second lock timeout.

PostgreSQL metadata confirms `creatives.generation` is nullable `jsonb`.
PostgREST returned HTTP 200 for `select=generation&limit=0` after the schema-cache
refresh. The migration did not modify existing creative records. The database
blocker is resolved; new routes still check availability before spending.

Confirm Fluid Compute is enabled and production selects the intended providers.
Do not infer production configuration from `.env.local`.

## Remaining Acceptance Work

- Source matching and commercial-term checks do not prove semantic entailment.
   The final sample still infers details such as checking roof structure from a
   general assessment offering. Human approval must verify those details.
- A no-reference fictional scene cannot prove product/person/location fidelity.
   Run a reference-backed product evaluation before claiming it.
- Typography remains deterministic and image models may ignore text-space
   direction. There is no automatic visual judge or guarantee against all clipping,
   glyph/font failures, misleading depictions, or placement-specific UI overlays.
- Batch saving survives sibling failures, not arbitrary function termination or
   network loss. No durable job/idempotency system was added. Quota checks are
   not atomic reservations; concurrent requests can exceed the remaining quota.
- Provider-side errors/truncated responses can incur unreported usage. Successful
   concept calls and validation/image failures retain usage, but billing must still
   be reconciled against provider records. Unknown image cost is null in receipts
   and marked costKnown=false in the existing numeric ledger.
- No live multibrand comparison, production generation test or deployment has been
   completed in this implementation pass. The database migration is applied and verified.