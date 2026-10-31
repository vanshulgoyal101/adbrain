# Creative

Part of the [repository map](../../../docs/architecture/overview.md#repository-map). This module owns making an ad: the interview, the concept prompt and its validation, the design spec, the rendered poster, image storage and usage receipts. Model calls go through [llm](../llm/) and pictures through [imageGen](../imageGen/); HTTP handling lives in the `src/app/api/creatives/` routes.

## Start here

| File | Owns |
| --- | --- |
| [generate.ts](generate.ts) | `generateVariants()`: one concept and one picture per angle, with progress and failure callbacks |
| [concept.ts](concept.ts) | Concept prompt, `creativeConceptSchema` and `validateConcept()` |
| [interview.ts](interview.ts) | The Create interview: next question or an editable brief |
| [design.ts](design.ts) | `AdDesignSpec`, formats and sizes, brand colour and contact labels |
| [render.tsx](render.tsx), [ad-composite.tsx](ad-composite.tsx) | Rasterise the spec into the finished poster (Satori/resvg, bundled fonts, Indic shaping) |
| [persist.ts](persist.ts) | Store images and thumbnails in the `creatives` bucket |
| [receipt.ts](receipt.ts) | Generation receipt and usage events for each variant |
| [slopScan.ts](slopScan.ts), [policy-rules.ts](policy-rules.ts) | Copy checks: AI-cliché phrases, vertical banned claims, ad-policy findings |

## Rules

- Generated copy is used only after `validateConcept` passes ([concept.ts](concept.ts)). It runs the schema, [slopScan.ts](slopScan.ts) and [policy-rules.ts](policy-rules.ts); claims are checked against the supplied facts.
- A concept gets at most two text calls: the first, then one repair listing the failed rules ([generate.ts](generate.ts)). Then it fails with `CreativeValidationError`; picture failures are `CreativeImageError`.
- Concept calls use `routing: "creative"`, no cache, and `CREATIVE_*` env settings for tokens, reasoning and per-attempt timeout. A whole `generateVariants` run is capped at 270 s.
- Inputs are bounded before prompting (brief, instructions, preferences, at most 12 source facts, at most 3 reference images).
- Every provider attempt, including failures, is kept in `llmUsage` / `imageAttempts` so the route can write usage rows ([receipt.ts](receipt.ts)).
- Stored images are WebP when smaller ([persist.ts](persist.ts)); a storage failure means no finished creative is saved.
- Any change to generation, validation, prompts, models, timeouts or the planner must add or update a core test (`npm run test:core`) with recorded real responses, not only mocks (AGENTS.md).

## Tests

- [creative-concept tests](../../../tests/creative-concept.test.ts), [creative-pipeline tests](../../../tests/creative-pipeline.test.tsx), [interview tests](../../../tests/interview.test.ts), [design tests](../../../tests/design.test.ts)
- [slop-scan tests](../../../tests/slop-scan.test.ts), [creative-policy-rules tests](../../../tests/creative-policy-rules.test.ts), [creative-generation-route tests](../../../tests/creative-generation-route.test.ts)
- Core (recorded responses in [fixtures](../../../tests/core/fixtures/)): [create-concept](../../../tests/core/create-concept.test.ts), [create-route](../../../tests/core/create-route.test.ts), [create-interview](../../../tests/core/create-interview.test.ts), [creative-indic](../../../tests/core/creative-indic.test.tsx)

## More

- [Creative data flow](../../../docs/architecture/overview.md#creative-data-flow)
- [Interview](../../../docs/architecture/ai-pipeline.md#interview)
- [Variant generation](../../../docs/architecture/ai-pipeline-variants.md#variant-generation)
- [Raster and composition rules](../../../docs/architecture/ai-pipeline-variants.md#raster-and-composition-rules)
