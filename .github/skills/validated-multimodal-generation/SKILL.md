---
name: validated-multimodal-generation
description: "Use this skill when an LLM plans copy and an image, video, audio, layout, or other generated artifact must remain coherent, grounded and attributable."
---

<!-- Generated from vanshulgoyal101/skills@b877c32 skills/validated-multimodal-generation.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Validated Multimodal Generation

## Trigger

Use this skill when an LLM plans copy and an image, video, audio, layout, or
other generated artifact must remain coherent, grounded and attributable.

## Invariant

A validated structured concept is the single source of truth for message,
visual direction, placement and claims. No expensive artifact generation starts
until the concept passes schema, grounding and policy checks; the finished asset
retains its model and execution receipt.

## Failure pattern

Copy generation and image prompting run independently. Better models produce
more polished but still generic visuals, unsupported claims enter the rationale,
static templates erase the model's visual decisions, or a failed render silently
becomes a raw source image presented as a finished ad.

## Recommended method

1. Ask the model for one bounded concept containing message, CTA, rationale,
   medium, detailed visual direction, text placement and source quotations.
2. Validate structured output with a schema. Give one repair attempt the actual
   validation findings and previous output; reject after that.
3. Check source quotations against supplied facts and scan all customer-visible
   fields plus rationale/direction for unsupported commercial terms. Treat this as
   a guardrail, not proof of semantic entailment.
4. Send the validated visual direction and placement to the image provider. Do
   not universally force photography, stock people, text-free layouts or a fixed
   composition that contradicts the concept.
5. Discover provider capabilities before sending model-specific image options;
   validate returned bytes, format, size and actual dimensions.
6. Persist concept, prompt, references, provider/model, latency, cost and
   fallback provenance with the asset. Distinguish unknown cost from zero.
7. Save successful variants independently and expose sibling failures. A render,
   download or storage failure must not return a raw image as a completed ad.
8. Test actual raster output across formats and text positions; mocks do not catch
   renderer crashes or clipping.
9. Use the owner's real photo as the image itself (generated fallback) and tell the
   copy model it cannot see it; a style reference alone gave generic scenes (#195).

## Discriminating checks

### Comparing model changes

- Identify the model actually used from its saved receipt, then verify replacement
   availability and token rates in current official model and provider docs.
   Equal token rates do not imply equal per-image cost or token consumption.
- Replay exact saved image prompts and references against original source images,
   not finished ads whose overlays hide defects. Match quality and aspect ratio,
   verify decoded dimensions, and disclose any unknown historical settings.
- Separate image-call cost, concept/interview cost, credit-purchase fees, and
   total workflow latency. A key-wide usage delta can include concurrent requests.
- Bound paid evaluation by request count and explicit authorization; persist a
   one-use submission guard before sending. Do not retry ambiguous paid outcomes.
   Check receipt totals as well as potentially delayed account usage before the
   next request. A local stop threshold is not a provider-side per-request cap.
- Inspect prompt adherence, anatomy, equipment, forbidden details, and space for
   copy separately from aesthetics. Repeated scene instructions can explain a
   stock-like result even after a model upgrade. Note contradictory prompts.
- A few unblinded samples in one domain support a sample-level preference, not
   statistical significance, general superiority, or improved ad performance.

### Pipeline checks

- Invalid JSON, unsafe claims and invalid citations trigger no image call.
- The image request contains the exact validated visual direction and placement.
- A provider capability fixture rejects unsupported parameters and records actual
  decoded dimensions.
- A failed composite or storage upload produces no finished creative row.
- A partial batch retains completed siblings and reports failed siblings.
- Inspect at least one paid output and its receipt; do not infer quality from test
  counts or a successful deployment.

### Diagnosing rejections

- Record rejections per field, such as `schema:<field>:<validator code>`, without
  storing the rejected copy. Three of four rejections in one run were an opaque
  `schema-or-other`; per-field codes later named `schema:description:too_big`.
- If rejected outputs were not stored, compare field lengths in saved outputs with
  their caps. One internal field averaged 477 of 600 characters, 12 of 28 at 80% or
  more, maximum 592; other fields had room. Widening only that internal cap while
  the prompt still asks for 600 kept an uncited price rejected (verified in CI).
- Fix deterministic formatting overruns in code before validation instead of
  discarding paid output: clip a capped field at a word boundary, turn an empty
  optional field into null. Run the grounding checks on the fixed text.
- Record real outputs from every model you route to. Each new model broke a
  different rule (an overlong rationale, an overlong 100-character description in
  2 of 4 outputs, an out-of-range numeric field).
- Before loosening a fact validator, check each rejected claim against the source
  data. In one review every questioned claim was present in the saved brand facts.
- More time and more parallelism do not fix rejection-driven failures. Raising the
  deadline from 240s to 270s still saved 1 of 3; a fully parallel probe increased
  paid repairs and was reverted.
- Validators misfire on real output: an all-caps rule counted a price like `$49,`.
  Record a live probe of the failing variant before changing prompts (#98).
- Carve layout terms ("55% of the frame", "free of detail") out of claim scans on
  visual direction, and audit gold labels: one recorded the false positive (#202).

## Common traps

- Adding more adjectives to a static image prompt and calling it model improvement.
- Using a rationale as if it were a sourced business fact.
- Treating a data URL, Pollinations URL or raw photo as durable finished output.
- Assuming requested dimensions equal returned dimensions.
- Silently falling back from a paid image provider to a free provider.
- Calling a single sample proof of persuasive quality or product fidelity.
- Running repairs strictly in series under one shared deadline. A repaired concept
  can starve later variants; start the next variant's text request while a repair
  runs, but keep validation and image work gated on accepted concepts.
- Treating `completion_tokens == max_tokens` as a model failure. It is truncation;
  raise or right-size the output cap before blaming the prompt.
- Keeping a model's explanation after a deterministic filter changed what it
  describes. Re-derive it: a rationale kept interests the matcher dropped (#174).
- Trusting a text-only judge for layout: it scored almost every ad 4-5. Check the
  125-character "See more" fold, line count and image directly (#188, #194).

## Evidence

AdBrain's structured concept pipeline caught an uncited "free assessment" during
live evaluation, rejected it before image execution, and caught a Satori crash
that had previously been hidden by a raw-photo fallback. Twelve real PNG renders
across four formats and three text positions passed after the renderer fix.


## Lesson (AdBrain, Oct 28)

- Code-drawn SVG "art" converges on one look. When the brief is a different artistic
  style per asset, use a real image model, and show the owner 3 samples before the set.

## AdBrain lessons (Oct 29)

- A claim backed by several brand facts must be checked against the brand, not only
  the fact the model quoted (#1676).
- Number and claim checks must normalise non-ASCII digits (Unicode `Nd` → ASCII) before
  any regex; a Hindi or Punjabi ad can carry an invented price that `\d` never sees.
  Add a red row per script (#2166).
- JS `\b` is ASCII-only and never matches beside Devanagari. Use the `u` flag and a
  `(?![\p{L}\p{M}\p{N}])` lookahead; `\p{M}` keeps vowel signs inside the word (#2120).
- Provenance without tools: list PNG chunks (`caBX`, `iTXt`, `eXIf`) or WebP chunks
  (`VP8X`, `XMP `, `EXIF`) with the stdlib; none means no embedded credentials. Only a
  watermark detector or the platform's own view can say more (#1988).
