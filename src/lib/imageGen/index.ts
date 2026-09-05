import { getEnv } from "@/lib/env";
import { createPollinationsProvider } from "./providers/pollinations";
import { createOpenRouterProvider } from "./providers/openrouter";
import type { GeneratedImage, ImageProvider, ImageRequest } from "./types";
import { readBoundedResponse, validateRaster } from "./raster";

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
  return !env.IMAGE_PROVIDER_FALLBACK || env.IMAGE_PROVIDER_FALLBACK === "none"
    ? null : getProvider(env.IMAGE_PROVIDER_FALLBACK);
}

async function executeImage(provider: ImageProvider, req: ImageRequest): Promise<GeneratedImage> {
  if (provider.name === "pollinations" && req.referenceImages?.length) throw new Error("Pollinations does not support product references. Select a reference-capable image provider.");
  const generated = await provider.generate(req);
  const raster = await downloadImage(generated.url, req.signal);
  return { ...generated, url: `data:image/png;base64,${Buffer.from(raster.bytes).toString("base64")}`, width: raster.width, height: raster.height };
}

/** Generate a single image with the configured provider. */
export async function generateImage(
  req: ImageRequest,
): Promise<GeneratedImage> {
  const startedAt = Date.now();
  req.signal?.throwIfAborted();
  const provider = getProvider();
  try {
    return {
      ...(await executeImage(provider, req)),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    req.signal?.throwIfAborted();
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw error;
    const fallback = getFallbackProvider();
    if (!fallback || fallback.name === provider.name) throw error;
    return {
      ...(await executeImage(fallback, req)),
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
  const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status}).`);
  }
  return validateRaster(await readBoundedResponse(res));
}
