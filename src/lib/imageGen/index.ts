import { getEnv } from "@/lib/env";
import { createPollinationsProvider } from "./providers/pollinations";
import type { GeneratedImage, ImageProvider, ImageRequest } from "./types";

export type { GeneratedImage, ImageRequest } from "./types";

function getProvider(): ImageProvider {
  const env = getEnv();
  switch (env.IMAGE_PROVIDER) {
    case "pollinations":
      return createPollinationsProvider();
    // Add paid providers here when you have keys:
    // case "falai":  return createFalProvider();
    // case "openai": return createOpenAIImageProvider();
    default:
      return createPollinationsProvider();
  }
}

/** Generate a single image with the configured provider. */
export async function generateImage(
  req: ImageRequest,
): Promise<GeneratedImage> {
  return getProvider().generate(req);
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
