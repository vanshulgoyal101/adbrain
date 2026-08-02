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
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
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
  ): Promise<string>;
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
