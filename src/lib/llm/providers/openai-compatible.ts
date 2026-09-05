import {
  LLMError,
  type ChatMessage,
  type CompletionOptions,
  type LLMProvider,
  type ProviderCallContext,
  type ProviderCompletion,
} from "../types";

/**
 * Build a provider that speaks the OpenAI Chat Completions API shape.
 * Works for Groq, OpenRouter, Cerebras, Together, and OpenAI itself.
 */
export function createOpenAICompatibleProvider(config: {
  name: string;
  baseUrl: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}): LLMProvider {
  return {
    name: config.name,
    defaultModel: config.defaultModel,
    async complete(
      messages: ChatMessage[],
      options: CompletionOptions,
      ctx: ProviderCallContext,
    ): Promise<ProviderCompletion> {
      const body: Record<string, unknown> = {
        model: ctx.model,
        messages,
        temperature: options.temperature ?? 0.7,
      };
      if (options.maxTokens) body.max_tokens = options.maxTokens;
      if (options.json) body.response_format = { type: "json_object" };
      if (config.name === "openrouter" && options.reasoningEffort) body.reasoning = { effort: options.reasoningEffort, exclude: true };

      let res: Response;
      try {
        res = await fetch(config.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ctx.apiKey}`,
            ...config.extraHeaders,
          },
          body: JSON.stringify(body),
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
        });
      } catch (err) {
        throw new LLMError(
          `${config.name}: network error — ${(err as Error).message}`,
          { provider: config.name, retryable: true },
        );
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LLMError(
          `${config.name} HTTP ${res.status}: ${text.slice(0, 200)}`,
          {
            provider: config.name,
            status: res.status,
            retryable:
              res.status === 429 ||
              res.status >= 500 ||
              res.status === 401 ||
              res.status === 403,
          },
        );
      }

      const data = (await res.json()) as {
        choices?: { finish_reason?: string; message?: { content?: string | null } }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      const content = data.choices?.[0]?.message?.content;
      const finishReason = data.choices?.[0]?.finish_reason;
      if (finishReason === "length") {
        throw new LLMError(`${config.name}: output token budget exhausted before completion. Increase CREATIVE_MAX_TOKENS or reduce CREATIVE_REASONING_EFFORT.`, { provider: config.name, retryable: false });
      }
      if (!content) {
        throw new LLMError(`${config.name}: empty response (finish reason: ${finishReason ?? "unknown"})`, {
          provider: config.name,
          retryable: true,
        });
      }
      const u = data.usage;
      const usage = u
        ? {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens:
              u.total_tokens ??
              (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
          }
        : undefined;
      return { text: content, usage };
    },
  };
}
