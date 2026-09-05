import { getEnv } from "@/lib/env";
import { createPollinationsProvider } from "./providers/pollinations";
import { createOpenRouterProvider } from "./providers/openrouter";
import type { GeneratedImage, ImageProvider, ImageRequest } from "./types";

export type { GeneratedImage, ImageRequest } from "./types";

function getProvider(): ImageProvider {
  const env = getEnv();
  switch (env.IMAGE_PROVIDER) {
    case "pollinations":
      return createPollinationsProvider();
    case "openrouter":
      return getEnv().OPENROUTER_API_KEYS.length
        ? createOpenRouterProvider()
        : createPollinationsProvider();
    default:
      return createPollinationsProvider();
  }
}

function getFallbackProvider(): ImageProvider | null {
  const env = getEnv();
  if (env.IMAGE_PROVIDER_FALLBACK === "pollinations") {
    return createPollinationsProvider();
  }
  if (env.IMAGE_PROVIDER_FALLBACK === "openrouter" && env.OPENROUTER_API_KEYS.length) {
    return createOpenRouterProvider();
  }
  return null;
}

/** Generate a single image with the configured provider. */
export async function generateImage(
  req: ImageRequest,
): Promise<GeneratedImage> {
  const startedAt = Date.now();
  const provider = getProvider();
  try {
    return {
      ...(await provider.generate(req)),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const fallback = getFallbackProvider();
    if (!fallback || fallback.name === provider.name) throw error;
    return {
      ...(await fallback.generate(req)),
      latencyMs: Date.now() - startedAt,
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
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status}) from ${url}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = await res.arrayBuffer();
  return { bytes, contentType };
}
