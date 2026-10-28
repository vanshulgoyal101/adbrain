export interface ImageRequest {
  signal?: AbortSignal;
  onAttempt?: (attempt: ImageAttempt) => void;
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Public brand/product images used by capable providers as visual references. */
  referenceImages?: string[];
  /** #1542: the paid picture is unavailable, so this one comes from the slower free provider. Advisory. */
  onFallback?: () => void;
}

export interface ImageAttempt {
  provider: string;
  model: string;
  status: "success" | "error";
  providerRequestId?: string;
  providerFinalStatus: "completed" | "failed" | "unknown";
  estimatedCostUsd?: number;
  /** Why a failed attempt failed (`IMAGE_HTTP_402`, `IMAGE_INVALID`…); never provider text (#451). */
  errorCode?: string;
}

export interface GeneratedImage {
  /** A URL usable directly as an <img> src. */
  url: string;
  provider: string;
  prompt: string;
  seed?: number;
  model?: string;
  estimatedCostUsd?: number;
  latencyMs?: number;
  width?: number;
  height?: number;
  fallbackFrom?: string;
  providerRequestId?: string;
  providerFinalStatus?: "completed" | "failed" | "unknown";
}

export class ImageProviderError extends Error {
  constructor(message: string, public readonly providerRequestId?: string,
    public readonly providerFinalStatus: "completed" | "failed" | "unknown" = "unknown",
    /** #449: the paid key is out of credit (OpenRouter 402, or 403 "Key limit exceeded"). */
    public readonly creditExhausted = false) {
    super(message);
    this.name = "ImageProviderError";
  }
}

export class FreeImageBusyError extends Error {
  constructor() {
    super("Free test images are busy right now. Try again in a minute.");
    this.name = "FreeImageBusyError";
  }
}

export interface ImageProvider {
  name: string;
  generate(req: ImageRequest): Promise<GeneratedImage>;
}
