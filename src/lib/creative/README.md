# Creative

Part of the [repository map](../../../docs/architecture/overview.md#repository-map). This module owns making an ad: the interview, the concept prompt and its validation, the design spec, the rendered poster, image storage and usage receipts. Model calls go through [llm](../llm/) and pictures through [imageGen](../imageGen/); HTTP handling lives in the `src/app/api/creatives/` routes.

## Start here

| File | Owns |
| --- | --- |
| [generate.ts](generate.ts) | `generateVariants()`: one concept and one picture per angle, with progress and failure callbacks |
| [batch-reuse.ts](batch-reuse.ts) | An ad whose free picture busied out reuses a sibling's picture, $0, `fallbackFrom: "batch_reuse"` (#2378) |
| [concept.ts](concept.ts) | Concept prompt, `creativeConceptSchema` and `validateConcept()` |
| [generate-request.ts](generate-request.ts) | The Create request body (brief, count, format, facts, picked library photos) |
| [interview.ts](interview.ts) | The Create interview: next question or an editable brief |
| [design.ts](design.ts) | `AdDesignSpec`, formats and sizes, brand colour and contact labels |
| [render.tsx](render.tsx), [ad-composite.tsx](ad-composite.tsx) | Rasterise the spec into the finished poster (Satori/resvg, bundled fonts, Indic shaping) |
| [persist.ts](persist.ts) | Store images and thumbnails in the `creatives` bucket |
| [receipt.ts](receipt.ts) | Generation receipt and usage events for each variant |
| [slopScan.ts](slopScan.ts), [policy-rules.ts](policy-rules.ts) | Copy checks: AI-cliché phrases, vertical banned claims, ad-policy findings |

## Rules

- The picture-copy editor coalesces identical in-flight exact previews per authenticated user, creative and complete design, after each request's auth, tenant lookup and rate limit. There is no completed-image cache; at most 32 distinct in-flight keys are retained per instance. Client instant preview, debounce and stale-response suppression are unchanged.
- Exact previews retain final-size layout and Indic shaping, then downsample to at most 720 px wide. Changing layout dimensions can change rounded text metrics and wrapping; bounded rasterization is deferred rather than weakening exactness. Save still renders/stores the full-size design.
- Photo fitting reuses upright PNG input instead of encoding/decoding it again before fitting. Other formats and oriented input retain the rotation path; download validation, pixel/byte limits, SSRF checks and watermark trimming are unchanged.
- Generated copy is used only after `validateConcept` passes ([concept.ts](concept.ts)). It runs the schema, [slopScan.ts](slopScan.ts) and [policy-rules.ts](policy-rules.ts); claims are checked against the supplied facts.
- A concept gets at most two text calls: the first, then one repair that shows the model its own draft and the failed rules, and asks it to rewrite only those ([concept-repair.ts](concept-repair.ts), #2444). Then it fails with `CreativeValidationError`; picture failures are `CreativeImageError`.
- Concept calls use `routing: "creative"`, no cache, and `CREATIVE_*` env settings for tokens, reasoning and per-attempt timeout. A whole `generateVariants` run is capped at 270 s.
- Inputs are bounded before prompting (brief, instructions, preferences, at most 12 source facts, at most 3 reference images).
- Every provider attempt, including failures, is kept in `llmUsage` / `imageAttempts` so the route can write usage rows ([receipt.ts](receipt.ts)).
- Stored images are WebP when smaller ([persist.ts](persist.ts)); a storage failure means no finished creative is saved.
- Any change to generation, validation, prompts, models, timeouts or the planner must add or update a core test (`npm run test:core`) with recorded real responses, not only mocks (AGENTS.md).

## Tests

- Offline preview/codec CPU comparison (synthetic input only): `./node_modules/.bin/tsx --import ./scripts/trusted-server-cli.mjs scripts/benchmark-creative-preview.mts`. Five alternating trials measure native-inclusive process CPU for four identical concurrent previews (independent vs coalesced) and the PNG fit roundtrip. These workloads do not establish production duplication rate or whole-app savings.
- [creative-concept tests](../../../tests/creative-concept.test.ts), [creative-pipeline tests](../../../tests/creative-pipeline.test.tsx), [interview tests](../../../tests/interview.test.ts), [design tests](../../../tests/design.test.ts)
- [slop-scan tests](../../../tests/slop-scan.test.ts), [creative-policy-rules tests](../../../tests/creative-policy-rules.test.ts), [creative-generation-route tests](../../../tests/creative-generation-route.test.ts)
- Core (recorded responses in [fixtures](../../../tests/core/fixtures/)): [create-concept](../../../tests/core/create-concept.test.ts), [create-route](../../../tests/core/create-route.test.ts), [create-interview](../../../tests/core/create-interview.test.ts), [creative-indic](../../../tests/core/creative-indic.test.tsx)

## More

- [Creative data flow](../../../docs/architecture/overview.md#creative-data-flow)
- [Interview](../../../docs/architecture/ai-pipeline.md#interview)
- [Variant generation](../../../docs/architecture/ai-pipeline-variants.md#variant-generation)
- [Raster and composition rules](../../../docs/architecture/ai-pipeline-variants.md#raster-and-composition-rules)
