# Image generation

Part of the [repository map](../../../docs/architecture/overview.md#repository-map). This module turns an image prompt into a validated raster: provider choice, free and paid fallback, download and size checks, and storage encoding. It does not write prompts or compose the finished ad; that is [creative](../creative/).

## Start here

| File | Owns |
| --- | --- |
| [index.ts](index.ts) | `generateImage()` (provider, fallback, free-image queue, credit parking) and `downloadImage()` |
| [types.ts](types.ts) | Request, result and attempt shapes; the busy, provider and reference-photo errors |
| [providers/](providers/) | OpenRouter (paid, takes reference images), Cloudflare FLUX and Pollinations (free, no references) |
| [raster.ts](raster.ts) | `validateRaster()`: 20 MB cap, single PNG/JPEG/WebP, Pollinations watermark trim |
| [encode.ts](encode.ts) | WebP for storage, JPEG for downloads and Meta uploads |

## Rules

- Every generated image is downloaded and checked by `validateRaster` before it is returned ([index.ts](index.ts), [raster.ts](raster.ts)); remote URLs are fetched only through `fetchPublicUrl` (SSRF guard, 30 s timeout).
- `IMAGE_PROVIDER` picks the provider (default `pollinations`); an unknown name or a selected provider without its keys throws. Fallback runs only when `IMAGE_PROVIDER_FALLBACK` names a different provider, or when the paid key is out of credit (then the free pictures, and the paid provider is parked for 15 min per instance).
- A timeout or abort never starts another provider.
- Internal accounts (`freeImagesOnly()` in [spend-policy.ts](../llm/spend-policy.ts)) always get free pictures, with reference images dropped and no paid fallback.
- Free providers never take reference images: a fallback from a request with product references throws `ReferencePhotoPausedError` rather than draw an unrelated product.
- Pollinations runs one image at a time per instance, waits at least 15 s on a busy answer, and gives up after about 90 s, parking free pictures for 2 min.
- In a Create batch, an ad whose free picture busies out (`FreeImageBusyError`) reuses a picture a sibling ad made, under its own words: no new image call, $0, `fallbackFrom: "batch_reuse"` ([batch-reuse.ts](../creative/batch-reuse.ts)). Other picture failures, or a batch with no picture made, still fail the ad.
- Every attempt reports through `onAttempt` with a fixed `errorCode` so usage rows can record it. A change to providers, models or timeouts must add or update a core test (`npm run test:core`) with recorded real responses (AGENTS.md).

## Tests

- [imageGen tests](../../../tests/imageGen.test.ts), [image-execution tests](../../../tests/image-execution.test.ts), [image-encode tests](../../../tests/image-encode.test.ts), [creative-raster tests](../../../tests/creative-raster.test.ts)
- Core: [cloudflare-free-images](../../../tests/core/cloudflare-free-images.test.ts), [internal-free-providers](../../../tests/core/internal-free-providers.test.ts), [create-free-busy-reuse](../../../tests/core/create-free-busy-reuse.test.ts), [pollinations-watermark](../../../tests/core/pollinations-watermark.test.ts), [webp-meta-upload](../../../tests/core/webp-meta-upload.test.ts)

## More

- [Images and fallback](../../../docs/architecture/ai-pipeline-routing.md#images-and-fallback)
- [Text routing and cache](../../../docs/architecture/ai-pipeline-routing.md#text-routing-and-cache) (free-image rules for internal accounts)
- [Raster and composition rules](../../../docs/architecture/ai-pipeline-variants.md#raster-and-composition-rules)
