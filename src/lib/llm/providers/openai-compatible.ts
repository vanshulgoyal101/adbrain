import {
  LLMError,
  type ChatMessage,
  type CompletionOptions,
  type LLMProvider,
  type ProviderCallContext,
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
    ): Promise<string> {
      const body: Record<string, unknown> = {
        model: ctx.model,
        messages,
        temperature: options.temperature ?? 0.7,
      };
      if (options.maxTokens) body.max_tokens = options.maxTokens;
      if (options.json) body.response_format = { type: "json_object" };

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
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new LLMError(`${config.name}: empty response`, {
          provider: config.name,
          retryable: true,
        });
      }
      return content;
    },
  };
}
