import { getEnv } from "@/lib/env";
import { createPollinationsProvider } from "./providers/pollinations";
import { createOpenRouterProvider } from "./providers/openrouter";
import { ImageProviderError, type GeneratedImage, type ImageProvider, type ImageRequest } from "./types";
import { MAX_IMAGE_BYTES, readBoundedResponse, validateRaster } from "./raster";
import { fetchPublicUrl, SafeFetchError } from "@/lib/security/ssrf";
import { freeImagesOnly } from "@/lib/llm/spend-policy";

export type { GeneratedImage, ImageRequest } from "./types";

function getProvider(name = getEnv().IMAGE_PROVIDER): ImageProvider {
  const env = getEnv();
  switch (name) {
    case "pollinations":
      return createPollinationsProvider();
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
  if (provider.name === "pollinations" && req.referenceImages?.length) throw new Error("Pollinations does not support product references. Select a reference-capable image provider.");
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
const FREE_IMAGE_WAIT_CAP_MS = 90_000;
const FREE_IMAGE_DEFAULT_WAIT_MS = 10_000;
let freeImageQueue: Promise<unknown> = Promise.resolve();

export class FreeImageBusyError extends Error {
  constructor() {
    super("Free test images are busy right now. Try again in a minute.");
    this.name = "FreeImageBusyError";
  }
}

function queuedFreeImage(provider: ImageProvider, req: ImageRequest): Promise<GeneratedImage> {
  const run = freeImageQueue.then(() => freeImageWithRetry(provider, req));
  freeImageQueue = run.catch(() => undefined);
  return run;
}

async function freeImageWithRetry(provider: ImageProvider, req: ImageRequest): Promise<GeneratedImage> {
  const started = Date.now();
  for (;;) {
    req.signal?.throwIfAborted();
    try {
      return await executeImage(provider, req);
    } catch (error) {
      const busy = error instanceof SafeFetchError && error.code === "status" && [402, 429, 503].includes(error.status ?? 0);
      if (!busy) throw error;
      const wait = Math.max(1_000, error.retryAfterMs ?? FREE_IMAGE_DEFAULT_WAIT_MS);
      if (Date.now() - started + wait > FREE_IMAGE_WAIT_CAP_MS) throw new FreeImageBusyError();
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(req.signal?.reason); };
        const timer = setTimeout(() => { req.signal?.removeEventListener("abort", onAbort); resolve(); }, wait);
        req.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}

/** Generate a single image with the configured provider. */
export async function generateImage(
  req: ImageRequest,
): Promise<GeneratedImage> {
  const startedAt = Date.now();
  req.signal?.throwIfAborted();
  // Internal accounts make free Pollinations images, which take no reference images (#449, #466).
  const free = freeImagesOnly();
  if (free) req = { ...req, referenceImages: undefined };
  const provider = getProvider(free ? "pollinations" : undefined);
  try {
    const generated = {
      ...(await (free ? queuedFreeImage(provider, req) : executeImage(provider, req))),
      latencyMs: Date.now() - startedAt,
    };
    req.onAttempt?.({ provider: provider.name, model: generated.model ?? provider.name,
      providerRequestId: generated.providerRequestId, providerFinalStatus: generated.providerFinalStatus ?? "unknown",
      estimatedCostUsd: generated.estimatedCostUsd, status: "success" });
    return generated;
  } catch (error) {
    req.onAttempt?.({ provider: provider.name, model: provider.name, status: "error",
      providerRequestId: error instanceof ImageProviderError ? error.providerRequestId : undefined,
      providerFinalStatus: error instanceof ImageProviderError ? error.providerFinalStatus : "unknown" });
    req.signal?.throwIfAborted();
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error;
    const fallback = getFallbackProvider();
    if (!fallback || fallback.name === provider.name) throw error;
    const generated = await executeImage(fallback, req).catch((fallbackError: unknown) => {
      req.onAttempt?.({ provider: fallback.name, model: fallback.name, status: "error",
        providerRequestId: fallbackError instanceof ImageProviderError ? fallbackError.providerRequestId : undefined,
        providerFinalStatus: fallbackError instanceof ImageProviderError ? fallbackError.providerFinalStatus : "unknown" });
      throw fallbackError;
    });
    req.onAttempt?.({ provider: fallback.name, model: generated.model ?? fallback.name,
      providerRequestId: generated.providerRequestId, providerFinalStatus: generated.providerFinalStatus ?? "unknown",
      estimatedCostUsd: generated.estimatedCostUsd, status: "success" });
    return {
      ...generated,
      latencyMs: Date.now() - startedAt,
      fallbackFrom: provider.name,
    };
  }
}

/** The active image provider's name (for UI/diagnostics). */
export function imageProviderName(): string {
  return getEnv().IMAGE_PROVIDER;
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
  return validateRaster(await readBoundedResponse(res));
}
