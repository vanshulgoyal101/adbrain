export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider to return strict JSON. */
  json?: boolean;
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

/** What a provider returns from a single completion call. */
export interface ProviderCompletion {
  text: string;
  usage?: TokenUsage;
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
  usage?: TokenUsage;
  /** True when served from the response cache (zero token cost). */
  cached?: boolean;
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

/** Thrown by a provider on an HTTP/transport failure. */
export class LLMError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { provider: string; status?: number; retryable: boolean },
  ) {
    super(message);
    this.name = "LLMError";
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryable = opts.retryable;
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
