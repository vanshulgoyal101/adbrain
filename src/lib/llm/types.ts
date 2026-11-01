import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionOptions {
  /** Select the provider pool for this task. Budget excludes OpenRouter. */
  routing?: "standard" | "budget" | "creative";
  task?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  signal?: AbortSignal;
  /** Per-provider attempt deadline; on expiry the next provider in the chain is tried. */
  attemptTimeoutMs?: number;
  /** Tighter deadlines for named providers (e.g. `{ google: 5000 }`), overriding attemptTimeoutMs. */
  providerAttemptTimeoutMs?: Partial<Record<string, number>>;
  /** #1200: a provider's own output cap; Groq counts `max_tokens` against its 1,000 output-tokens-per-minute limit. */
  providerMaxTokens?: Partial<Record<string, number>>;
  /** Providers tried after the routing order, if not already in it (e.g. a fast last resort). */
  extraProviders?: string[];
  /** Providers tried right after the routing order's first one, before the rest (e.g. a proven fast fallback). */
  nextProviders?: string[];
  /** On a brief 429, try later providers before waiting out the cooldown, then come back to it (#668). */
  fallbackBeforeRateLimitWait?: boolean;
  /**
   * #2189: when no later provider can answer, wait for another call's probe and out a limit the provider named
   * (≤ 60 s a round, ≤ 90 s a call) instead of failing. Only with `signal`, which bounds the wait; for long deadlines.
   */
  waitOnLastProvider?: boolean;
  /**
   * #2462: the caller's request deadline. While a later provider can still answer, each attempt also ends `reserveMs`
   * before `deadlineAt` (a provider with no time left is skipped), so the last one keeps that time; it gets the rest.
   */
  fallbackReserve?: { deadlineAt: number; reserveMs: number };
  /** "off" asks thinking models (Gemini) not to think: for small structured outputs where speed matters. */
  thinking?: "off";
  onAttempt?: (attempt: ProviderAttempt) => void;
  /** Stable cache identity for the selected routing policy/model. */
  provider?: string;
  model?: string;
  /** Bump when the prompt contract changes. */
  promptVersion?: string;
  /** Ask the provider to return strict JSON. */
  json?: boolean;
  responseSchema?: z.ZodType;
  /**
   * Reuse a cached response for an identical request instead of calling the
   * provider. Pass `true` for the default TTL, or an object to override it.
   * Only safe for low-variance calls (summaries, extraction) — leave off where
   * fresh variety is expected.
   */
  cache?: boolean | { ttlMs: number };
}

/** Prompt/completion token counts reported by a provider, when available. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Sanitized class of a failed provider attempt; never contains provider text. */
export type LLMFailureCode = "TIMEOUT" | "DEADLINE" | "ABORTED" | "TRUNCATED" | "EMPTY" | "TRANSPORT" | "UNKNOWN" | "CREDIT_EXHAUSTED" | `HTTP_${number}`;

export interface ProviderAttempt {
  provider: string;
  model: string;
  usage?: TokenUsage;
  providerRequestId?: string;
  providerFinalStatus: "completed" | "failed" | "unknown";
  status: "success" | "error";
  failure?: LLMFailureCode;
  latencyMs?: number;
  rateLimit?: RateLimitInfo;
}

/** What a provider returns from a single completion call. */
export interface ProviderCompletion {
  text: string;
  usage?: TokenUsage;
  providerRequestId?: string;
  providerFinalStatus?: "completed" | "failed" | "unknown";
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
  usage?: TokenUsage;
  providerRequestId?: string;
  providerFinalStatus?: "completed" | "failed" | "unknown";
  /** True when served from the response cache (zero token cost). */
  cached?: boolean;
  latencyMs?: number;
  inputChars?: number;
  outputChars?: number;
}

export interface ProviderCallContext {
  apiKey: string;
  model: string;
}

export interface LLMProvider {
  name: string;
  defaultModel: string;
  complete(
    messages: ChatMessage[],
    options: CompletionOptions,
    ctx: ProviderCallContext,
  ): Promise<ProviderCompletion>;
}

/** #1200: which provider limit a 429 hit, from the provider's message: type and numbers only, never its text or org id. */
export type RateLimitInfo = { type: "TPM" | "RPM" | "TPD" | "RPD" | "ITPM" | "OTPM"; limit?: number; used?: number; requested?: number };

/** Thrown by a provider on an HTTP/transport failure. */
export class LLMError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly model?: string;
  readonly usage?: TokenUsage;
  readonly providerRequestId?: string;
  readonly providerFinalStatus?: "completed" | "failed" | "unknown";
  readonly code?: LLMFailureCode;
  readonly retryAfterMs?: number;
  readonly rateLimit?: RateLimitInfo;

  constructor(
    message: string,
    opts: { provider: string; status?: number; retryable: boolean; model?: string; usage?: TokenUsage;
      providerRequestId?: string; providerFinalStatus?: "completed" | "failed" | "unknown"; code?: LLMFailureCode;
      retryAfterMs?: number; rateLimit?: RateLimitInfo },
  ) {
    super(message);
    this.name = "LLMError";
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.model = opts.model;
    this.usage = opts.usage;
    this.providerRequestId = opts.providerRequestId;
    this.providerFinalStatus = opts.providerFinalStatus;
    this.code = opts.code ?? (opts.status ? `HTTP_${opts.status}` : undefined);
    this.retryAfterMs = opts.retryAfterMs;
    this.rateLimit = opts.rateLimit;
  }
}

export type ProviderFailureReason = "CREDIT_EXHAUSTED" | "RATE_LIMIT" | "PROVIDER_SERVER" | "PROVIDER_CLIENT" | "TRANSPORT" | "TIMEOUT" | "TRUNCATED" | "UNKNOWN" | "MIXED" | "COOLDOWN" | "FREE_TEXT_UNAVAILABLE";

export class AllLLMProvidersFailedError extends Error {
  constructor(readonly reason: ProviderFailureReason, readonly providerCount: number) {
    super(`All LLM providers failed (${providerCount} tried)`);
    this.name = "AllLLMProvidersFailedError";
  }
}

/** Thrown when no provider has any keys configured. */
export class NoLLMKeysError extends Error {
  constructor() {
    super(
      "No LLM API keys configured. Add at least one key to .env.local " +
        "(GOOGLE_AI_API_KEYS, GROQ_API_KEYS, OPENROUTER_API_KEYS, or CEREBRAS_API_KEYS).",
    );
    this.name = "NoLLMKeysError";
  }
}
