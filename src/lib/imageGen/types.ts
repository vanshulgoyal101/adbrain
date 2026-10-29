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

/** Free picture providers (no charge, no reference images). */
export const FREE_IMAGE_PROVIDERS = ["pollinations", "cloudflare"];
export const freeImageAttempt = (attempt: Pick<ImageAttempt, "provider">) => FREE_IMAGE_PROVIDERS.includes(attempt.provider);
/** #2219: a free picture or a provider-confirmed failure costs nothing, so no charge is left unknown. */
export const imageAttemptCostsNothing = (attempt: Pick<ImageAttempt, "provider" | "status" | "providerFinalStatus">) =>
  freeImageAttempt(attempt) || (attempt.status === "error" && attempt.providerFinalStatus === "failed");

export class ImageProviderError extends Error {
  constructor(message: string, public readonly providerRequestId?: string,
    public readonly providerFinalStatus: "completed" | "failed" | "unknown" = "unknown",
    /** #449: the paid key is out of credit (OpenRouter 402, or 403 "Key limit exceeded"). */
    public readonly creditExhausted = false) {
    super(message);
    this.name = "ImageProviderError";
  }
}

/** #1593: the owner's product photo needs the paid image model, which is out of credit or parked; no generic stand-in. */
export class ReferencePhotoPausedError extends Error {
  /** `allowance`: the business used this month's AI allowance (#1717); `paused`: the shared key is out of credit. */
  constructor(readonly reason: "paused" | "allowance" = "paused") {
    super(reason === "allowance"
      ? "The product photo needs the paid image model, and this month's allowance is used."
      : "The product photo needs the paid image model, which is paused right now.");
    this.name = "ReferencePhotoPausedError";
  }
}

export class FreeImageBusyError extends Error {
  constructor() {
    super("Free test images are busy right now. Try again in a minute.");
    this.name = "FreeImageBusyError";
  }
}

/** #2145: Cloudflare's daily free allowance is used up; it resets at 00:00 UTC, so asking again before then is wasted. */
export class FreeImageDailyLimitError extends FreeImageBusyError {
  constructor() {
    super();
    this.name = "FreeImageDailyLimitError";
  }
}

export interface ImageProvider {
  name: string;
  generate(req: ImageRequest): Promise<GeneratedImage>;
}
