import { getEnv } from "@/lib/env";
import { createPollinationsProvider } from "./providers/pollinations";
import { createOpenRouterProvider } from "./providers/openrouter";
import { CLOUDFLARE_IMAGE_MODEL, cloudflareConfigured, createCloudflareProvider } from "./providers/cloudflare";
import { FreeImageBusyError, FreeImageDailyLimitError, ImageProviderError, ReferencePhotoPausedError, type GeneratedImage, type ImageProvider, type ImageRequest, FREE_IMAGE_PROVIDERS as FREE_PROVIDERS } from "./types";
import { MAX_IMAGE_BYTES, readBoundedResponse, validateRaster } from "./raster";
import { fetchPublicUrl, SafeFetchError } from "@/lib/security/ssrf";
import { costCapped, freeImagesOnly } from "@/lib/llm/spend-policy";
import { recordProductEvent } from "@/lib/observability/logger";

export type { GeneratedImage, ImageRequest } from "./types";

function getProvider(name = getEnv().IMAGE_PROVIDER): ImageProvider {
  const env = getEnv();
  switch (name) {
    case "pollinations":
      return createPollinationsProvider();
    case "cloudflare":
      if (!cloudflareConfigured()) throw new Error("Cloudflare image generation is selected but it is not configured.");
      return createCloudflareProvider();
    case "openrouter":
      if (!env.OPENROUTER_API_KEYS.length) throw new Error("OpenRouter image generation is selected but no key is configured.");
      return createOpenRouterProvider();
    default:
      throw new Error(`Unknown image provider: ${name}`);
  }
}

function getFallbackProvider(): ImageProvider | null {
  const env = getEnv();
  return freeImagesOnly() || !env.IMAGE_PROVIDER_FALLBACK || env.IMAGE_PROVIDER_FALLBACK === "none"
    ? null : getProvider(env.IMAGE_PROVIDER_FALLBACK);
}

async function executeImage(provider: ImageProvider, req: ImageRequest): Promise<GeneratedImage> {
  if (FREE_PROVIDERS.includes(provider.name) && req.referenceImages?.length) throw new Error(`${provider.name} does not support product references. Select a reference-capable image provider.`);
  const generated = await provider.generate(req);
  const raster = await downloadImage(generated.url, req.signal).catch((error: unknown) => {
    if (!generated.providerRequestId) throw error;
    throw new ImageProviderError("Image response could not be validated.", generated.providerRequestId,
      generated.providerFinalStatus ?? "unknown");
  });
  return { ...generated, url: `data:image/png;base64,${Buffer.from(raster.bytes).toString("base64")}`, width: raster.width, height: raster.height };
}

// Pollinations answers 402/429/503 with Retry-After past about one image per 20–40 s per address
// (measured Oct 24), so free images run one at a time per server instance and wait it out (#466).
// Its free tier allows one image per 45 s per address but says Retry-After: 1 (Oct 25, #634), so
// waits are at least 15 s instead of a request every second.
const FREE_IMAGE_WAIT_CAP_MS = 90_000;
const FREE_IMAGE_DEFAULT_WAIT_MS = 15_000;
const FREE_IMAGE_MIN_WAIT_MS = 15_000;
// #2153: a picture busy past the 90 s cap parks the free pictures for 2 min per instance, so the rest of the batch fails at
// once (about 90 s, not 3 × 90 s). A paid fallback's one-retry busy-out doesn't park: its next picture may get the next slot.
const FREE_BUSY_PARK_MS = 2 * 60_000;
let freeBusyUntil = 0;
let freeImageQueue: Promise<unknown> = Promise.resolve();

/** `retries`: how many busy answers to wait out; internal accounts wait up to the cap, a paid fallback once (#1422). */
function queuedFreeImage(provider: ImageProvider, req: ImageRequest, retries = Number.POSITIVE_INFINITY): Promise<GeneratedImage> {
  const run = freeImageQueue.then(() => freeImageWithRetry(provider, req, retries));
  freeImageQueue = run.catch(() => undefined);
  return run;
}

// #2145: a busy Cloudflare gets one more try a second later (Pollinations, next in line, takes about a minute);
// a used-up daily allowance skips Cloudflare on this instance until it resets at 00:00 UTC.
const CLOUDFLARE_BUSY_RETRY_MS = 1_000;
let cloudflareCappedUntil = 0;

/** #1476: a free picture: Cloudflare FLUX-1-schnell when configured, Pollinations last. */
async function freeImage(req: ImageRequest, retries = Number.POSITIVE_INFINITY): Promise<GeneratedImage> {
  if (cloudflareConfigured() && cloudflareCappedUntil <= Date.now()) {
    const cloudflare = createCloudflareProvider();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await executeImage(cloudflare, req);
      } catch (error) {
        req.onAttempt?.({ provider: cloudflare.name, model: CLOUDFLARE_IMAGE_MODEL, status: "error", errorCode: imageFailureCode(error),
          providerRequestId: error instanceof ImageProviderError ? error.providerRequestId : undefined,
          providerFinalStatus: error instanceof ImageProviderError ? error.providerFinalStatus : "unknown" });
        req.signal?.throwIfAborted();
        if (error instanceof FreeImageDailyLimitError) {
          cloudflareCappedUntil = new Date(Date.now()).setUTCHours(24, 0, 0, 0);
          // #2404: a capped day must reach us before a customer does; the scheduled check also counts these rows.
          recordProductEvent({ kind: "system", name: "image.free_daily_limit", outcome: "failed",
            attributes: { provider: cloudflare.name, errorCode: imageFailureCode(error) } });
        }
        if (!(error instanceof FreeImageBusyError) || error instanceof FreeImageDailyLimitError || attempt > 0) break;
        await wait(CLOUDFLARE_BUSY_RETRY_MS, req.signal);
      }
    }
  }
  return queuedFreeImage(getProvider("pollinations"), req, retries);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function freeImageWithRetry(provider: ImageProvider, req: ImageRequest, retries: number): Promise<GeneratedImage> {
  if (freeBusyUntil > Date.now()) throw new FreeImageBusyError();
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    req.signal?.throwIfAborted();
    try {
      return await executeImage(provider, req);
    } catch (error) {
      // Production's fast 404s came only while another free image had just finished (#634).
      const busy = error instanceof SafeFetchError && error.code === "status" && [402, 404, 429, 503].includes(error.status ?? 0);
      if (!busy) throw error;
      if (attempt >= retries) throw new FreeImageBusyError();
      const pause = Math.max(FREE_IMAGE_MIN_WAIT_MS, error.retryAfterMs ?? FREE_IMAGE_DEFAULT_WAIT_MS);
      if (Date.now() - started + pause > FREE_IMAGE_WAIT_CAP_MS) {
        freeBusyUntil = Date.now() + FREE_BUSY_PARK_MS;
        throw new FreeImageBusyError();
      }
      await wait(pause, req.signal);
    }
  }
}

// #1422: a paid image key out of credit stays out for 15 min (as text keys do, #449), so the rest of the batch and the
// next Creates go straight to the free pictures instead of asking it again. Per server instance.
const CREDIT_PARK_MS = 15 * 60_000;
const parkedUntil = new Map<string, number>();
const isParked = (name: string) => (parkedUntil.get(name) ?? 0) > Date.now();

/** A short, fixed reason for a failed image attempt, for usage rows and events (#451). */
function imageFailureCode(error: unknown): string {
  if (error instanceof FreeImageDailyLimitError) return "IMAGE_FREE_DAILY_LIMIT";
  if (error instanceof FreeImageBusyError) return "IMAGE_FREE_BUSY";
  if (error instanceof SafeFetchError) return error.code === "status" ? `IMAGE_HTTP_${error.status ?? "unknown"}` : `IMAGE_FETCH_${error.code.toUpperCase()}`;
  if (error instanceof ImageProviderError) return error.creditExhausted ? "IMAGE_CREDIT_EXHAUSTED" : "IMAGE_PROVIDER";
  if (error instanceof Error && error.name === "TimeoutError") return "IMAGE_TIMEOUT";
  if (error instanceof Error && error.name === "AbortError") return "IMAGE_ABORTED";
  // validateRaster and readBoundedResponse: the body was not a usable picture.
  if (error instanceof Error && /image|png|jpeg|webp|raster|dimension/i.test(error.message)) return "IMAGE_INVALID";
  return "IMAGE_OTHER";
}

/** Generate a single image with the configured provider. */
export async function generateImage(
  req: ImageRequest,
): Promise<GeneratedImage> {
  const startedAt = Date.now();
  req.signal?.throwIfAborted();
  // Internal accounts make free images (Cloudflare, then Pollinations), which take no reference images (#449, #466, #1476).
  const free = freeImagesOnly();
  if (free) req = { ...req, referenceImages: undefined };
  const provider = getProvider(free ? "pollinations" : undefined);
  // #1717: a business over its monthly AI cost cap gets free pictures, like a parked key (with the 'taking longer' notice).
  if (!free && costCapped() && provider.name !== "pollinations") return fallbackImage(getProvider("pollinations"), provider, req, startedAt, "allowance", true);
  const parkedFallback = !free && isParked(provider.name) ? getFallbackProvider() ?? getProvider("pollinations") : null;
  if (parkedFallback && parkedFallback.name !== provider.name) return fallbackImage(parkedFallback, provider, req, startedAt, "paused", true);
  try {
    const generated = {
      ...(await (free ? freeImage(req) : executeImage(provider, req))),
      latencyMs: Date.now() - startedAt,
    };
    req.onAttempt?.({ provider: generated.provider, model: generated.model ?? generated.provider,
      providerRequestId: generated.providerRequestId, providerFinalStatus: generated.providerFinalStatus ?? "unknown",
      estimatedCostUsd: generated.estimatedCostUsd, status: "success" });
    return generated;
  } catch (error) {
    req.onAttempt?.({ provider: provider.name, model: provider.name, status: "error", errorCode: imageFailureCode(error),
      providerRequestId: error instanceof ImageProviderError ? error.providerRequestId : undefined,
      providerFinalStatus: error instanceof ImageProviderError ? error.providerFinalStatus : "unknown" });
    req.signal?.throwIfAborted();
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error;
    // #449: out of credit means free pictures, even with no fallback configured (no product references there).
    const credit = error instanceof ImageProviderError && error.creditExhausted;
    if (credit) parkedUntil.set(provider.name, Date.now() + CREDIT_PARK_MS);
    const fallback = getFallbackProvider() ?? (credit ? getProvider("pollinations") : null);
    if (!fallback || fallback.name === provider.name) throw error;
    return fallbackImage(fallback, provider, req, startedAt, "paused", credit);
  }
}

/**
 * `waitLikeFree`: this customer is on free pictures for a while (paid key out of credit, or over the monthly cost cap),
 * so Pollinations gets the free account's wait, not one retry (#2189).
 */
async function fallbackImage(fallback: ImageProvider, from: ImageProvider, req: ImageRequest, startedAt: number,
  reason: "paused" | "allowance" = "paused", waitLikeFree = false): Promise<GeneratedImage> {
  // #1593: the free pictures can't use the owner's product photo; an unrelated product would misrepresent what they sell.
  if (req.referenceImages?.length && FREE_PROVIDERS.includes(fallback.name)) throw new ReferencePhotoPausedError(reason, from.name);
  try {
    req.onFallback?.();
  } catch {
    // Advisory: a broken listener must not cost the picture.
  }
  // #1422: Pollinations answers 404/busy right after another free picture; after a one-off paid failure, wait that out once.
  // #2189: out of credit, wait up to the 90 s cap like a free account; one wait left 2 of a batch's 3 pictures blank.
  // #1476: the free fallback tries Cloudflare first when it is configured.
  const run = fallback.name === "pollinations" ? freeImage(req, waitLikeFree ? undefined : 1) : executeImage(fallback, req);
  const generated = await run.catch((fallbackError: unknown) => {
    req.onAttempt?.({ provider: fallback.name, model: fallback.name, status: "error", errorCode: imageFailureCode(fallbackError),
      providerRequestId: fallbackError instanceof ImageProviderError ? fallbackError.providerRequestId : undefined,
      providerFinalStatus: fallbackError instanceof ImageProviderError ? fallbackError.providerFinalStatus : "unknown" });
    throw fallbackError;
  });
  req.onAttempt?.({ provider: generated.provider, model: generated.model ?? generated.provider,
    providerRequestId: generated.providerRequestId, providerFinalStatus: generated.providerFinalStatus ?? "unknown",
    estimatedCostUsd: generated.estimatedCostUsd, status: "success" });
  return {
    ...generated,
    latencyMs: Date.now() - startedAt,
    fallbackFrom: from.name,
  };
}

/** Download image bytes (used when persisting/exporting a creative). */
export async function downloadImage(
  url: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string; width: number; height: number }> {
  signal?.throwIfAborted();
  if (url.startsWith("data:")) {
    if (url.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) throw new Error("Image response is too large.");
    const match = /^data:image\/(?:png|jpeg|webp);base64,([a-z\d+/]+={0,2})$/i.exec(url);
    if (!match) throw new Error("Expected a base64 PNG, JPEG or WebP image.");
    return validateRaster(Buffer.from(match[1], "base64"));
  }
  const res = await fetchPublicUrl(url, { signal, timeoutMs: 30_000 });
  return validateRaster(await readBoundedResponse(res), { trimWatermark: new URL(url).hostname === "image.pollinations.ai" });
}
