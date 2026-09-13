# Flare Quality Comparison: 2026-09-13

## Conclusion

Keep Flare as the production default for cost and latency. These three samples
do not establish a significant overall visual-quality improvement over GPT Image
2. Visual quality is comparable, with some better scene details and some worse
layout choices. This is a qualitative review, not statistical significance or
evidence of better ad performance.

## Method

The owner authorized a few new Flare images. Exactly three paid requests were
made through OpenRouter's Images API, with no retries or fallback. No text-model
calls, production draft writes, campaign mutations, or deployment changes occurred.

Three distinct ad angles were selected from the dedicated demo account's newest
GPT Image 2 examples. Each original source photo was verified through owner-scoped
Storage listing and downloaded separately from its finished headline composite.
Flare received the exact saved image prompt, medium quality, one image, OpenAI-only
routing, and the historical source aspect ratio of 3:4. All six source images
were 1152 x 1536. None used reference images.

Original quality settings are not independently recorded in the historical image
receipts; the current adapter requests medium. These are historical baselines,
not simultaneous randomized runs. One result per prompt, one clinic domain, no
reference-fidelity tests, and no blinded panel limit the conclusions.

## Images and Review

Every comparison shows **GPT Image 2 on the left, Flare on the right**. Panels
are fitted without cropping. Full-resolution source images are alongside them.
Image links target private, Git-ignored local artifacts and are unavailable in
a fresh clone or on GitHub. The findings below remain readable without them.

1. [Practitioner portrait](../../.creative-evals/flare-comparison-2026-09-13/1-comparison.png):
   Flare more closely supplies the requested posture chart, stool, and instrument
   tray, and its treatment table reads more clearly as chiropractic equipment.
   Both faces look plausible at inspection size. GPT Image 2 keeps the person
   lower and preserves more quiet space for headline placement. Mixed result.
2. [Empty treatment room](../../.creative-evals/flare-comparison-2026-09-13/2-comparison.png):
   Flare better centers the table and uses a simpler, more legible tablet graphic.
   Both produce clean lighting and useful blank wall space; the older diagonal
   table composition is also usable. Slight Flare preference for prompt adherence,
   not a dramatic realism improvement. The prompt itself contradicts its request
   for a spinal-alignment graphic with a later prohibition on spine diagrams.
3. [Practitioner beside treatment table](../../.creative-evals/flare-comparison-2026-09-13/3-comparison.png):
   Flare follows the relaxed-arms instruction more closely; the older result puts
   one hand in a pocket. Flare's split headrest is a stronger equipment cue.
   However, the tablet now displays a body/skeletal-looking diagram, which needs
   review against the prompt's no-X-ray/no-spine-diagram restrictions. The older
   image's tablet is blank. Mixed result, not an unconditional Flare win.

No obvious gross hand/face malformation was apparent in the reviewed comparisons;
this does not establish anatomical accuracy. Both models retain an illustrative,
stock-like clinic look. The prompts repeatedly prescribe the same warm room,
window, treatment table, and practitioner, so changing models alone does not
provide concept diversity. These are fictional demo visuals, not photographs of
actual Cedar Ridge staff or premises.

## Measured Cost and Speed

| Sample | GPT Image 2 Cost | Flare Cost | Old Latency | Flare Request Time |
| --- | ---: | ---: | ---: | ---: |
| Practitioner portrait | $0.052345 | $0.015715 | 31.99 s | 13.32 s |
| Empty treatment room | $0.052340 | $0.015710 | 33.19 s | 15.39 s |
| Practitioner and table | $0.052275 | $0.015645 | 32.64 s | 14.14 s |
| Total cost / mean time | $0.156960 | $0.047070 | 32.61 s | 14.28 s |

Observed image-request cost was 70.0% lower; mean request time was about 2.28
times as fast. Historical adapter latency and direct-request timing differ in
instrumentation and date; this is not a controlled latency benchmark.

Each Flare result used 408 output image tokens at $30/million ($0.01224), plus
681-695 input text tokens at $5/million. These are image API prompt charges,
not separate concept/interview LLM calls. Total actual spend was $0.04707.
Credit-purchase fees/taxes are excluded.

Key usage initially lagged the receipts. A later read reconciled exactly:
$2.692621 -> $2.739691; remaining $2.260309 under the unchanged $5 limit.

## Evidence

- Harness: [compare-flare-images.mjs](../../scripts/compare-flare-images.mjs).
- Syntax, ESLint, and editor diagnostics passed; three HTTP 200 responses,
  decoded raster validation, and visual inspection completed.
- Private ignored directory: `.creative-evals/flare-comparison-2026-09-13/`.
- `plan.json` preserves prompts, references, and source identification;
  `report.json` preserves per-request usage and timing.
- `submitted-once.json` consumes this three-image authorization. Never remove
  it or repeat paid requests without fresh approval.
- Images are local comparison artifacts, not new Studio drafts. Production
   remains configured for Flare. No Git commit or push was performed during the
   evaluation; the subsequent branch synchronization publishes this report.
- The harness now checks receipt charges as well as potentially delayed key
   usage before each paid request. This does not impose a provider-side hard cap
   on an individual request and does not authorize repeating the evaluation.